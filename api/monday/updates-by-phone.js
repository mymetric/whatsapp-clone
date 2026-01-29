const { loadMondayApiKey, axios } = require('../../lib/utils');

module.exports = async (req, res) => {
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

  const apiKey = loadMondayApiKey();
  const phone = req.query.phone;
  const boardId = req.query.boardId || '607533664'; // Board padrão de leads

  if (!apiKey) {
    return res.status(500).json({ error: 'Monday API key não configurada no .env (MONDAY_API_KEY)' });
  }

  if (!phone) {
    return res.status(400).json({ error: 'phone é obrigatório' });
  }

  // Limpar o telefone para busca (remover caracteres especiais)
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const phoneVariations = [
    phone,
    cleanPhone,
    `+${cleanPhone}`,
    cleanPhone.replace(/^55/, ''), // Sem código do país
  ];

  // Query para buscar itens do board (sem updates - será buscado separadamente)
  const firstPageQuery = `
    query ($boardId: [ID!], $limit: Int!) {
      boards (ids: $boardId) {
        items_page (limit: $limit) {
          cursor
          items {
            id
            name
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
        items_page (limit: $limit, cursor: $cursor) {
          cursor
          items {
            id
            name
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

  // Query para buscar updates de um item específico
  const updatesQuery = `
    query ($itemId: [ID!]) {
      items (ids: $itemId) {
        id
        name
        updates {
          id
          body
          created_at
          creator {
            id
            name
            email
          }
        }
      }
    }
  `;

  try {
    console.log('📞 [vercel] Buscando itens no Monday por telefone:', phone);

    const PAGE_LIMIT = 500;
    let allItems = [];
    let cursor = null;
    let pageNumber = 0;

    // Buscar todos os itens com paginação
    while (true) {
      pageNumber++;
      const query = cursor ? nextPageQuery : firstPageQuery;
      const variables = cursor
        ? { boardId: [String(boardId)], limit: PAGE_LIMIT, cursor }
        : { boardId: [String(boardId)], limit: PAGE_LIMIT };

      console.log(`📞 [vercel] Buscando página ${pageNumber}...`);

      const itemsResponse = await axios.post(
        'https://api.monday.com/v2',
        { query, variables },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: apiKey,
          },
        },
      );

      const itemsData = itemsResponse.data;

      if (itemsData?.errors?.length) {
        console.error('❌ [vercel] Monday GraphQL errors (items):', JSON.stringify(itemsData.errors, null, 2));
        return res.status(502).json({ error: 'Erro do Monday GraphQL', details: itemsData.errors });
      }

      const boards = itemsData?.data?.boards;
      if (!Array.isArray(boards) || boards.length === 0) {
        break;
      }

      const itemsPage = boards[0]?.items_page;
      const pageItems = itemsPage?.items || [];
      allItems = allItems.concat(pageItems);

      console.log(`📞 [vercel] Página ${pageNumber}: ${pageItems.length} itens (total: ${allItems.length})`);

      // Se não há mais páginas, sair do loop
      cursor = itemsPage?.cursor;
      if (!cursor || pageItems.length < PAGE_LIMIT) {
        break;
      }
    }

    if (allItems.length === 0) {
      console.warn('⚠️ [vercel] Nenhum item encontrado no board');
      return res.json(null);
    }

    console.log(`📞 [vercel] Total de itens carregados: ${allItems.length}`);

    // Filtrar itens que têm o telefone em alguma coluna
    const matchingItems = allItems.filter((item) => {
      const phoneColumns = item.column_values?.filter((col) =>
        col.text && phoneVariations.some((pv) => col.text.includes(pv) || col.text.replace(/[^0-9]/g, '').includes(cleanPhone))
      );
      return phoneColumns && phoneColumns.length > 0;
    });

    if (matchingItems.length === 0) {
      console.log('📞 [vercel] Nenhum item encontrado para telefone:', phone);
      return res.json(null);
    }

    console.log(`📞 [vercel] Encontrados ${matchingItems.length} item(s), buscando updates...`);

    // Buscar updates para cada item encontrado
    const itemsWithUpdates = await Promise.all(
      matchingItems.map(async (item) => {
        try {
          const updatesResponse = await axios.post(
            'https://api.monday.com/v2',
            {
              query: updatesQuery,
              variables: { itemId: [String(item.id)] },
            },
            {
              headers: {
                'Content-Type': 'application/json',
                Authorization: apiKey,
              },
            },
          );

          const updatesData = updatesResponse.data;
          const itemWithUpdates = updatesData?.data?.items?.[0];

          return {
            id: item.id,
            name: item.name,
            updates: Array.isArray(itemWithUpdates?.updates) ? itemWithUpdates.updates : [],
          };
        } catch (err) {
          console.warn(`⚠️ [vercel] Erro ao buscar updates do item ${item.id}:`, err.message);
          return {
            id: item.id,
            name: item.name,
            updates: [],
          };
        }
      })
    );

    // Formatar resposta no mesmo formato que getMondayUpdates espera
    const result = {
      _name: matchingItems[0]?.name || 'Lead',
      _id: phone,
      _createTime: new Date().toISOString(),
      _updateTime: new Date().toISOString(),
      monday_updates: {
        items: itemsWithUpdates,
      },
    };

    console.log(`✅ [vercel] Retornando ${itemsWithUpdates.length} item(s) para telefone ${phone}`);
    return res.json(result);
  } catch (err) {
    console.error('❌ [vercel] Erro ao buscar updates por telefone no Monday:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao consultar Monday por telefone',
      details: err.response?.data || err.message,
    });
  }
};
