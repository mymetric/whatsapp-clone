const { loadMondayApiKey, axios } = require('../../lib/utils');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = loadMondayApiKey();
  if (!apiKey) return res.status(500).json({ error: 'Monday API key não configurada' });

  const { boardId, itemName, columnValues } = req.body || {};
  if (!boardId) return res.status(400).json({ error: 'boardId é obrigatório' });
  if (!itemName || !itemName.trim()) return res.status(400).json({ error: 'itemName é obrigatório' });

  let columnValuesJson = '{}';
  if (columnValues && typeof columnValues === 'object' && Object.keys(columnValues).length > 0) {
    columnValuesJson = JSON.stringify(columnValues);
  }

  const mutation = `
    mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item (board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
        name
        board { id name }
      }
    }
  `;

  try {
    const variables = {
      boardId: String(boardId),
      itemName: String(itemName).trim(),
      columnValues: columnValuesJson,
    };

    const response = await axios.post(
      'https://api.monday.com/v2',
      { query: mutation, variables },
      { headers: { 'Content-Type': 'application/json', Authorization: apiKey } },
    );

    const data = response.data;
    if (data?.errors?.length) {
      return res.status(502).json({ error: 'Erro do Monday GraphQL (create_item)', details: data.errors });
    }

    const item = data?.data?.create_item;
    if (!item || !item.id) {
      return res.status(502).json({ error: 'Resposta inválida do Monday' });
    }

    return res.json({
      id: item.id,
      name: item.name,
      boardId: item.board?.id,
      boardName: item.board?.name,
    });
  } catch (err) {
    const status = err.response?.status || 500;
    return res.status(status).json({ error: 'Erro ao criar item no Monday', details: err.response?.data || err.message });
  }
};
