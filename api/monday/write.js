const { loadMondayApiKey, axios } = require('../../lib/utils');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = loadMondayApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'Monday API key não configurada no .env (MONDAY_API_KEY)' });
  }

  const action = req.query.action || req.body.action;

  // Action: create-update (adicionar comentário a um item)
  if (action === 'update') {
    const { itemId, body } = req.body || {};

    if (!itemId) {
      return res.status(400).json({ error: 'itemId é obrigatório' });
    }

    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'body é obrigatório' });
    }

    const mutation = `
      mutation ($itemId: ID!, $body: String!) {
        create_update (item_id: $itemId, body: $body) {
          id
        }
      }
    `;

    try {
      console.log('📝 [server] Criando update no Monday:', itemId);

      const response = await axios.post(
        'https://api.monday.com/v2',
        {
          query: mutation,
          variables: {
            itemId: String(itemId),
            body: String(body).trim(),
          },
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
        console.error('❌ [server] Monday GraphQL errors (create_update):', JSON.stringify(data.errors, null, 2));
        return res.status(502).json({ error: 'Erro do Monday GraphQL (create_update)', details: data.errors });
      }

      const update = data?.data?.create_update;
      if (!update || !update.id) {
        console.warn('⚠️ [server] Resposta do Monday sem ID de update');
        return res.status(502).json({ error: 'Resposta inválida do Monday' });
      }

      console.log(`✅ [server] Update criado com sucesso: ${update.id}`);
      return res.json({ id: update.id });
    } catch (err) {
      console.error('❌ [server] Erro ao criar update no Monday:', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json({
        error: 'Erro ao criar update no Monday',
        details: err.response?.data || err.message,
      });
    }
  }

  // Action: create-item (criar novo item no board)
  if (action === 'create-item') {
    const { boardId, itemName, columnValues } = req.body || {};

    if (!boardId) {
      return res.status(400).json({ error: 'boardId é obrigatório' });
    }

    if (!itemName || !itemName.trim()) {
      return res.status(400).json({ error: 'itemName é obrigatório' });
    }

    let columnValuesJson = '{}';
    if (columnValues && typeof columnValues === 'object' && Object.keys(columnValues).length > 0) {
      columnValuesJson = JSON.stringify(columnValues);
    }

    const mutation = `
      mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
        create_item (board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
          id
          name
          board {
            id
            name
          }
        }
      }
    `;

    try {
      console.log('📝 [server] Criando item no Monday:', { boardId, itemName, columnValuesJson });

      const variables = {
        boardId: String(boardId),
        itemName: String(itemName).trim(),
        columnValues: columnValuesJson,
      };

      const response = await axios.post(
        'https://api.monday.com/v2',
        {
          query: mutation,
          variables,
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
        console.error('❌ [server] Monday GraphQL errors (create_item):', JSON.stringify(data.errors, null, 2));
        return res.status(502).json({ error: 'Erro do Monday GraphQL (create_item)', details: data.errors });
      }

      const item = data?.data?.create_item;
      if (!item || !item.id) {
        console.warn('⚠️ [server] Resposta do Monday sem ID de item');
        return res.status(502).json({ error: 'Resposta inválida do Monday' });
      }

      console.log(`✅ [server] Item criado com sucesso: ${item.id}`);
      return res.json({
        id: item.id,
        name: item.name,
        boardId: item.board?.id,
        boardName: item.board?.name
      });
    } catch (err) {
      console.error('❌ [server] Erro ao criar item no Monday:', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json({
        error: 'Erro ao criar item no Monday',
        details: err.response?.data || err.message,
      });
    }
  }

  return res.status(400).json({ error: 'action é obrigatório (update ou create-item)' });
};
