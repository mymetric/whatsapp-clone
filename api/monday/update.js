const { loadMondayApiKey, axios } = require('../../lib/utils');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = loadMondayApiKey();
  if (!apiKey) return res.status(500).json({ error: 'Monday API key não configurada' });

  const { itemId, body } = req.body || {};
  if (!itemId) return res.status(400).json({ error: 'itemId é obrigatório' });
  if (!body || !body.trim()) return res.status(400).json({ error: 'body é obrigatório' });

  const mutation = `
    mutation ($itemId: ID!, $body: String!) {
      create_update (item_id: $itemId, body: $body) {
        id
      }
    }
  `;

  try {
    const response = await axios.post(
      'https://api.monday.com/v2',
      { query: mutation, variables: { itemId: String(itemId), body: String(body).trim() } },
      { headers: { 'Content-Type': 'application/json', Authorization: apiKey } },
    );

    const data = response.data;
    if (data?.errors?.length) {
      return res.status(502).json({ error: 'Erro do Monday GraphQL', details: data.errors });
    }

    const update = data?.data?.create_update;
    if (!update || !update.id) {
      return res.status(502).json({ error: 'Resposta inválida do Monday' });
    }

    return res.json({ id: update.id });
  } catch (err) {
    const status = err.response?.status || 500;
    return res.status(status).json({ error: 'Erro ao criar update no Monday', details: err.response?.data || err.message });
  }
};
