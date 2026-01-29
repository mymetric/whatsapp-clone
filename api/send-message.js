const { axios } = require('../lib/utils');

module.exports = async (req, res) => {
  // CORS headers (seguro para consumo via browser; same-origin no Vercel)
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

  const sendMessageUrl = process.env.SEND_MESSAGE_URL || process.env.REACT_APP_SEND_MESSAGE_URL;
  if (!sendMessageUrl) {
    return res.status(500).json({
      error: 'SEND_MESSAGE_URL não configurada',
      details: 'Configure SEND_MESSAGE_URL nas variáveis de ambiente do deploy',
    });
  }

  const { phone, message } = req.body || {};

  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ error: 'phone é obrigatório (string)' });
  }
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message é obrigatório (string)' });
  }

  try {
    console.log('📤 [api/send-message] Proxy envio mensagem:', {
      phone,
      messageLength: message.length,
      upstreamHost: (() => {
        try {
          return new URL(sendMessageUrl).host;
        } catch {
          return 'invalid-url';
        }
      })(),
    });

    const upstream = await axios.post(
      sendMessageUrl,
      { phone, message },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Rosenbaum-Chat-System/1.0',
        },
        timeout: 30000,
        // Não fazer throw automático em non-2xx; vamos repassar status/detalhes
        validateStatus: () => true,
      },
    );

    if (upstream.status < 200 || upstream.status >= 300) {
      console.error('❌ [api/send-message] Upstream erro:', upstream.status, upstream.data);
      return res.status(upstream.status).json({
        error: 'Erro ao enviar mensagem (upstream)',
        details: upstream.data,
        upstreamStatus: upstream.status,
      });
    }

    return res.status(200).json({
      success: true,
      upstreamStatus: upstream.status,
      data: upstream.data,
    });
  } catch (err) {
    console.error('❌ [api/send-message] Erro ao enviar mensagem:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao enviar mensagem',
      details: err.response?.data || err.message,
    });
  }
};
