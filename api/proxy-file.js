const { axios } = require('./utils');

const ALLOWED_PROXY_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  'drive.google.com',
  'docs.google.com',
]);

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const rawUrl = String(req.query.url || '');
    if (!rawUrl) {
      return res.status(400).json({ error: 'Parâmetro url é obrigatório' });
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: 'URL inválida' });
    }

    if (parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'Apenas URLs https são permitidas' });
    }

    if (!ALLOWED_PROXY_HOSTS.has(parsed.hostname)) {
      return res.status(403).json({ error: `Host não permitido: ${parsed.hostname}` });
    }

    const upstream = await axios.get(rawUrl, { responseType: 'arraybuffer' });
    const contentType = upstream.headers?.['content-type'] || 'application/octet-stream';
    const contentLength = upstream.headers?.['content-length'];

    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).send(Buffer.from(upstream.data));
  } catch (err) {
    console.error('❌ [server] Erro no proxy de arquivo:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao baixar arquivo',
      details: err.response?.data || err.message,
    });
  }
};
