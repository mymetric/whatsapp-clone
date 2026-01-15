const { loadMondayApiKey, axios } = require('../utils');

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
  const rawItemId = req.query.itemId;

  if (!apiKey) {
    return res.status(500).json({ error: 'Monday API key não configurada no .env (MONDAY_API_KEY)' });
  }

  if (!rawItemId) {
    return res.status(400).json({ error: 'itemId é obrigatório' });
  }

  const itemId = String(rawItemId);

  const query = `
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
    console.log('📄 [server] Buscando updates do item de contencioso no Monday:', itemId);

    const response = await axios.post(
      'https://api.monday.com/v2',
      {
        query,
        variables: { itemId: [itemId] },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
      },
    );

    const data = response.data;

    if (data?.errors?.length) {
      console.error('❌ [server] Monday GraphQL errors (updates):', JSON.stringify(data.errors, null, 2));
      return res.status(502).json({ error: 'Erro do Monday GraphQL (updates)', details: data.errors });
    }

    const items = data?.data?.items;
    if (!Array.isArray(items) || items.length === 0) {
      console.warn('⚠️ [server] Nenhum item encontrado para itemId:', itemId);
      return res.json(null);
    }

    const item = items[0];
    const result = {
      id: item.id,
      name: item.name,
      updates: Array.isArray(item.updates) ? item.updates : [],
    };

    console.log(
      `✅ [server] Updates do item de contencioso retornadas: ${result.updates.length} update(s) para "${result.name}"`,
    );

    return res.json(result);
  } catch (err) {
    console.error('❌ [server] Erro ao buscar updates do item de contencioso no Monday:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao consultar updates do item no Monday',
      details: err.response?.data || err.message,
    });
  }
};
