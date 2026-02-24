// Carregar dependências
const axios = require('axios');

function loadMondayApiKey() {
  const apiKey = process.env.MONDAY_API_KEY;
  if (!apiKey) {
    console.error('❌ Monday: MONDAY_API_KEY não encontrada');
    return null;
  }
  return apiKey;
}

module.exports = async (req, res) => {
  // Variáveis fora do try para acesso no catch (retorno parcial)
  let allItems = [];
  let boardColumns = null;

  // Garantir que sempre retornamos uma resposta
  try {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    console.log('📥 Requisição recebida:', {
      method: req.method,
      query: req.query,
      url: req.url
    });

    const boardId = Number(req.query.boardId) || 632454515;
    const maxItems = Number(req.query.maxItems) || 0; // 0 = todos os itens
    const orderByRecent = req.query.orderByRecent === 'true'; // Ordenar por data de criação

    console.log('🔑 Carregando MONDAY_API_KEY...');
    const apiKey = loadMondayApiKey();

    if (!apiKey) {
      console.error('❌ MONDAY_API_KEY não encontrada');
      return res.status(500).json({
        error: 'Monday API key não configurada',
        details: 'MONDAY_API_KEY não encontrada nas variáveis de ambiente do Vercel'
      });
    }

    console.log('✅ MONDAY_API_KEY carregada com sucesso');
    console.log(`📄 [server] Buscando itens do board no Monday${maxItems ? ` (max: ${maxItems})` : ''}${orderByRecent ? ' (ordenado por data)' : ''}:`, boardId);

    const PAGE_LIMIT = 500;

    // Query com ordenação por data de criação (mais recentes primeiro)
    const firstPageQueryOrdered = `
      query ($boardId: [ID!], $limit: Int!) {
        boards (ids: $boardId) {
          id
          name
          columns {
            id
            title
            type
            settings_str
          }
          items_page (limit: $limit, query_params: {order_by: [{column_id: "__creation_log__", direction: desc}]}) {
            cursor
            items {
              id
              name
              created_at
              column_values {
                id
                text
                type
                column {
                  id
                  title
                  type
                }
              }
            }
          }
        }
      }
    `;

    // Query padrão (sem ordenação)
    const firstPageQuery = `
      query ($boardId: [ID!], $limit: Int!) {
        boards (ids: $boardId) {
          id
          name
          columns {
            id
            title
            type
            settings_str
          }
          items_page (limit: $limit) {
            cursor
            items {
              id
              name
              created_at
              column_values {
                id
                text
                type
                column {
                  id
                  title
                  type
                }
              }
            }
          }
        }
      }
    `;

    const nextPageQuery = `
      query ($boardId: [ID!], $limit: Int!, $cursor: String!) {
        boards (ids: $boardId) {
          id
          name
          columns {
            id
            title
            type
            settings_str
          }
          items_page (limit: $limit, cursor: $cursor) {
            cursor
            items {
              id
              name
              created_at
              column_values {
                id
                text
                type
                column {
                  id
                  title
                  type
                }
              }
            }
          }
        }
      }
    `;

    allItems = [];
    const seenIds = new Set();
    let cursor = null;
    let page = 0;
    const MAX_PAGES = 10; // Reduzir para evitar timeout (10 páginas = 5000 itens máximo)
    const startTime = Date.now();
    const MAX_EXECUTION_TIME = 50000; // 50 segundos máximo de execução
    boardColumns = null;
    let hasMore = false;

    while (page < MAX_PAGES) {
      // Verificar se estamos perto do timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_EXECUTION_TIME) {
        console.warn(`⚠️ Tempo de execução próximo do limite (${elapsed}ms), retornando itens coletados até agora`);
        hasMore = true;
        break;
      }

      page += 1;

      // Usar query ordenada apenas na primeira página se orderByRecent=true
      const query = cursor
        ? nextPageQuery
        : (orderByRecent ? firstPageQueryOrdered : firstPageQuery);
      const variables = cursor
        ? { boardId: [String(boardId)], limit: PAGE_LIMIT, cursor }
        : { boardId: [String(boardId)], limit: PAGE_LIMIT };

      console.log(
        `📄 [server] Página ${page} (limit=${PAGE_LIMIT})` + (cursor ? ' (cursor presente)' : ''),
      );

      const pageTimeout = Math.max(15000, MAX_EXECUTION_TIME - (Date.now() - startTime));
      const response = await axios.post(
        'https://api.monday.com/v2',
        { query, variables },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: apiKey,
          },
          timeout: pageTimeout,
        },
      );

      const data = response.data;

      if (data?.errors?.length) {
        console.error('❌ [server] Monday GraphQL errors:', JSON.stringify(data.errors, null, 2));
        return res.status(502).json({ error: 'Erro do Monday GraphQL', details: data.errors });
      }

      const boards = data?.data?.boards;
      if (!Array.isArray(boards) || boards.length === 0) {
        console.log('⚠️ Nenhum board encontrado, retornando objeto vazio');
        return res.json({ columns: [], items: [], hasMore: false });
      }

      const board = boards[0];

      // Salvar colunas apenas na primeira página
      if (!boardColumns && board.columns && Array.isArray(board.columns)) {
        boardColumns = board.columns;
      }

      const pageObj = board?.items_page;
      const items = Array.isArray(pageObj?.items) ? pageObj.items : [];

      for (const item of items) {
        if (!item || !item.id) continue;
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        allItems.push(item);

        // Se atingiu o limite máximo, parar
        if (maxItems > 0 && allItems.length >= maxItems) {
          hasMore = !!pageObj?.cursor || items.length === PAGE_LIMIT;
          break;
        }
      }

      // Se atingiu o limite máximo, parar
      if (maxItems > 0 && allItems.length >= maxItems) {
        break;
      }

      cursor = pageObj?.cursor || null;

      if (!cursor) {
        console.log('✅ Paginação concluída (sem mais cursor)');
        break;
      }

      hasMore = true;
    }

    console.log(`✅ Total de itens retornados: ${allItems.length}${hasMore ? ' (mais disponíveis)' : ''}`);

    return res.json({
      columns: boardColumns || [],
      items: allItems,
      hasMore: maxItems > 0 ? hasMore : false,
      totalLoaded: allItems.length
    });
  } catch (err) {
    console.error('❌ [server] Erro ao processar requisição:', err.message);

    // Se já coletamos itens, retornar dados parciais ao invés de erro
    if (allItems.length > 0) {
      console.log(`⚠️ Retornando ${allItems.length} itens parciais após erro: ${err.message}`);
      return res.json({
        columns: boardColumns || [],
        items: allItems,
        hasMore: true,
        totalLoaded: allItems.length,
        partial: true,
      });
    }

    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao consultar board no Monday',
      details: err.message || 'Erro desconhecido',
      type: err.name || 'Error'
    });
  }
};
