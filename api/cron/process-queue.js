/**
 * Vercel Cron Job — Processa fila de arquivos automaticamente em segundo plano.
 * Roda a cada 1 minuto, processando até 5 itens por execução (em série).
 */

// Reutiliza a mesma lógica do process-next
const processNextHandler = require('../files/process-next');

module.exports = async (req, res) => {
  // Vercel Cron envia header de autorização
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.CRON_SECRET_OPTIONAL) {
    // Em dev ou se CRON_SECRET não estiver configurado, permitir
    if (process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const MAX_ITEMS = 5;
  const results = [];

  for (let i = 0; i < MAX_ITEMS; i++) {
    try {
      // Criar mock de req/res para chamar o handler
      const mockRes = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; },
        end() { return this; },
      };

      const mockReq = {
        method: 'POST',
        headers: req.headers,
        body: {},
      };

      await processNextHandler(mockReq, mockRes);

      if (!mockRes.body?.processed) {
        // Sem mais items na fila
        break;
      }

      results.push({
        itemId: mockRes.body.itemId,
        method: mockRes.body.processingMethod || '',
        success: true,
      });
    } catch (err) {
      results.push({ error: err.message, success: false });
      break;
    }
  }

  return res.json({
    processed: results.filter(r => r.success).length,
    total: results.length,
    results,
    timestamp: new Date().toISOString(),
  });
};
