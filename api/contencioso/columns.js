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

    const boardId = Number(req.query.boardId) || 607533664;
    const apiKey = loadMondayApiKey();

    if (!apiKey) {
      console.error('❌ MONDAY_API_KEY não encontrada');
      return res.status(500).json({ 
        error: 'Monday API key não configurada',
        details: 'MONDAY_API_KEY não encontrada nas variáveis de ambiente'
      });
    }

    const query = `
      query ($boardId: [ID!]) {
        boards (ids: $boardId) {
          id
          name
          columns {
            id
            title
            type
            settings_str
          }
        }
      }
    `;

    console.log('🔍 [DEBUG] Buscando apenas colunas do board:', boardId);

    const response = await axios.post(
      'https://api.monday.com/v2',
      { 
        query, 
        variables: { boardId: [String(boardId)] } 
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
        timeout: 20000,
      },
    );

    const data = response.data;

    if (data?.errors?.length) {
      console.error('❌ [DEBUG] Monday GraphQL errors:', data.errors);
      return res.status(502).json({ error: 'Erro do Monday GraphQL', details: data.errors });
    }

    const columns = data?.data?.boards?.[0]?.columns || [];
    
    console.log(`✅ [DEBUG] ${columns.length} colunas encontradas`);
    columns.forEach((col, idx) => {
      console.log(`   [${idx + 1}] "${col.id}" → "${col.title}" (${col.type})`);
    });

    return res.json(columns);
  } catch (err) {
    console.error('❌ [DEBUG] Erro ao buscar colunas:', err);
    return res.status(500).json({ 
      error: 'Erro ao buscar colunas',
      details: err.message 
    });
  }
};
