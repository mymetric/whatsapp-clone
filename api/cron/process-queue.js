/**
 * Vercel Cron Job — Processa fila de arquivos automaticamente em segundo plano.
 * Roda a cada 1 minuto, processando até 5 itens por execução (em série).
 */

const { getDb } = require('../../lib/firebase-admin');

// Reutiliza a mesma lógica do process-next
const processNextHandler = require('../files/process-next');

module.exports = async (req, res) => {
  const startTime = Date.now();
  console.log(`[CRON] ⏰ process-queue iniciado em ${new Date().toISOString()}`);

  // Vercel Cron envia header de autorização
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.CRON_SECRET_OPTIONAL) {
    if (process.env.CRON_SECRET) {
      console.log('[CRON] ❌ Unauthorized - CRON_SECRET não confere');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // Verificar quantos itens estão na fila
  const db = getDb();
  let queueStats = { queued: 0, processing: 0, done: 0, error: 0 };
  if (db) {
    try {
      const snap = await db.collection('file_processing_queue').get();
      snap.docs.forEach(doc => {
        const status = doc.data().status || 'unknown';
        queueStats[status] = (queueStats[status] || 0) + 1;
      });
      console.log(`[CRON] 📊 Fila: ${queueStats.queued} queued, ${queueStats.processing} processing, ${queueStats.done} done, ${queueStats.error} errors`);
    } catch (err) {
      console.log(`[CRON] ⚠️ Erro ao buscar stats: ${err.message}`);
    }
  }

  if (queueStats.queued === 0) {
    const elapsed = Date.now() - startTime;
    console.log(`[CRON] ✅ Nada para processar. Finalizado em ${elapsed}ms`);
    return res.json({
      processed: 0,
      total: 0,
      queueStats,
      results: [],
      elapsed: `${elapsed}ms`,
      timestamp: new Date().toISOString(),
    });
  }

  const MAX_ITEMS = 5;
  const results = [];

  for (let i = 0; i < MAX_ITEMS; i++) {
    const itemStart = Date.now();
    try {
      const mockRes = {
        statusCode: 200,
        body: null,
        _headers: {},
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; },
        setHeader(key, value) { this._headers[key] = value; return this; },
        end() { return this; },
      };

      const mockReq = {
        method: 'POST',
        headers: req.headers,
        body: {},
      };

      await processNextHandler(mockReq, mockRes);

      if (!mockRes.body?.processed) {
        console.log(`[CRON] 📭 Item ${i + 1}: fila vazia, parando`);
        break;
      }

      const itemElapsed = Date.now() - itemStart;
      const itemId = mockRes.body.itemId || '?';
      const method = mockRes.body.processingMethod || '?';
      const textLen = mockRes.body.extractedText?.length || 0;
      console.log(`[CRON] ✅ Item ${i + 1}: ${itemId} | método: ${method} | ${textLen} chars | ${itemElapsed}ms`);

      results.push({
        itemId,
        method,
        textChars: textLen,
        elapsed: `${itemElapsed}ms`,
        success: true,
      });
    } catch (err) {
      const itemElapsed = Date.now() - itemStart;
      console.log(`[CRON] ❌ Item ${i + 1}: ERRO - ${err.message} | ${itemElapsed}ms`);
      results.push({ error: err.message, elapsed: `${itemElapsed}ms`, success: false });
      break;
    }
  }

  const totalElapsed = Date.now() - startTime;
  const successCount = results.filter(r => r.success).length;
  console.log(`[CRON] 🏁 Finalizado: ${successCount}/${results.length} processados em ${totalElapsed}ms`);

  return res.json({
    processed: successCount,
    total: results.length,
    queueStats,
    results,
    elapsed: `${totalElapsed}ms`,
    timestamp: new Date().toISOString(),
  });
};
