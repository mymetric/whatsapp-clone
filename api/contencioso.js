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
    
    console.log('🔑 Carregando MONDAY_API_KEY...');
    const apiKey = loadMondayApiKey();

    if (!apiKey) {
      console.error('❌ MONDAY_API_KEY não encontrada');
      console.error('❌ Variáveis de ambiente disponíveis:', Object.keys(process.env).filter(k => k.includes('MONDAY') || k.includes('API')));
      return res.status(500).json({ 
        error: 'Monday API key não configurada',
        details: 'MONDAY_API_KEY não encontrada nas variáveis de ambiente'
      });
    }

    console.log('✅ MONDAY_API_KEY carregada com sucesso');

  const PAGE_LIMIT = 500;

  const firstPageQuery = `
    query ($boardId: [ID!], $limit: Int!) {
      boards (ids: $boardId) {
        id
        name
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
            }
          }
        }
      }
    }
  `;

  try {
    console.log('📄 [server] Buscando itens do board no Monday (com paginação):', boardId);

    const allItems = [];
    const seenIds = new Set();
    let cursor = null;
    let page = 0;
    const MAX_PAGES = 200;

    while (page < MAX_PAGES) {
      page += 1;

      const query = cursor ? nextPageQuery : firstPageQuery;
      const variables = cursor
        ? { boardId: [String(boardId)], limit: PAGE_LIMIT, cursor }
        : { boardId: [String(boardId)], limit: PAGE_LIMIT };

      console.log(
        `📄 [server] Página ${page} (limit=${PAGE_LIMIT})` + (cursor ? ' (cursor presente)' : ''),
      );

      const response = await axios.post(
        'https://api.monday.com/v2',
        { query, variables },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: apiKey,
          },
        },
      );

      const data = response.data;

      if (data?.errors?.length) {
        console.error('❌ [server] Monday GraphQL errors:', JSON.stringify(data.errors, null, 2));
        return res.status(502).json({ error: 'Erro do Monday GraphQL', details: data.errors });
      }

      const boards = data?.data?.boards;
      if (!Array.isArray(boards) || boards.length === 0) {
        return res.json([]);
      }

      const board = boards[0];
      const pageObj = board?.items_page;
      const items = Array.isArray(pageObj?.items) ? pageObj.items : [];

      for (const item of items) {
        if (!item || !item.id) continue;
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        allItems.push(item);
      }

      cursor = pageObj?.cursor || null;

      if (!cursor) break;
    }

    console.log(`✅ [server] Total de itens retornados: ${allItems.length}`);
    return res.json(allItems);
  } catch (err) {
    console.error('❌ [server] Erro ao chamar API do Monday:', err);
    console.error('❌ Erro completo:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
    console.error('❌ Stack:', err.stack);
    
    // Garantir que sempre retornamos uma resposta
    try {
      const status = err.response?.status || 500;
      return res.status(status).json({
        error: 'Erro ao consultar board no Monday',
        details: err.response?.data || err.message || 'Erro desconhecido',
        type: err.name || 'Error'
      });
    } catch (responseError) {
      console.error('❌ Erro ao enviar resposta de erro:', responseError);
      // Se não conseguirmos enviar JSON, tentar texto simples
      try {
        res.status(500).send('Erro interno do servidor');
      } catch (e) {
        // Se tudo falhar, apenas logar
        console.error('❌ Falha total ao enviar resposta');
      }
    }
  }
};
