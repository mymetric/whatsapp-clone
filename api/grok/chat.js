const { loadGrokApiKey, axios } = require('../../lib/utils');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Ensure axios is available
  if (!axios) {
    console.error('❌ Axios não carregado corretamente no utils');
    return res.status(500).json({ error: 'Erro interno do servidor (dependências)' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = loadGrokApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'Grok API key não configurada no .env (GROK_API_KEY)' });
  }

  const { messages, model, max_tokens, temperature } = req.body || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array é obrigatório' });
  }

  console.log(`\n📥 ========== REQUISIÇÃO GROK CHAT RECEBIDA ==========`);
  console.log(`  - model: ${model || 'grok-4-fast'}`);
  console.log(`  - messages count: ${messages.length}`);
  console.log(`  - max_tokens: ${max_tokens}`);

  try {
    const response = await axios.post(
      'https://api.x.ai/v1/chat/completions',
      {
        model: model || 'grok-4-fast',
        messages,
        max_tokens: max_tokens || 1000,
        temperature: temperature || 0.7,
        stream: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    const data = response.data;
    
    // Log success
    console.log(`✅ Resposta do Grok recebida com sucesso`);
    
    return res.json(data);
  } catch (err) {
    console.error('❌ [server] Erro ao chamar Grok:', err.response?.status, err.message);
    
    if (err.response?.data) {
        console.error('❌ Detalhes do erro:', JSON.stringify(err.response.data, null, 2));
    }

    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao conversar com o Grok',
      details: err.response?.data || err.message,
    });
  }
};
