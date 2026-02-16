const { getDb, setCors } = require('../../lib/firebase-admin');

// Nota: processQueueItem é muito complexo (download, OCR, PDF parse, GCS upload)
// e pode exceder o timeout de serverless functions do Vercel.
// Esta function apenas marca o item como "processing" e retorna os dados.
// O processamento pesado deve ser feito pelo server/server.js rodando separadamente.

module.exports = async (req, res) => {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  try {
    const now = new Date().toISOString();

    const snapshot = await db
      .collection('file_processing_queue')
      .where('status', '==', 'queued')
      .limit(50)
      .get();

    const candidates = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item => !item.nextRetryAt || item.nextRetryAt <= now)
      .sort((a, b) => (b.receivedAt || b.createdAt || '').localeCompare(a.receivedAt || a.createdAt || ''));

    const nextItem = candidates.length > 0 ? candidates[0] : null;

    if (!nextItem) {
      return res.json({ message: 'Nenhum item na fila para processar', processed: false });
    }

    // Marcar como processing
    await db.collection('file_processing_queue').doc(nextItem.id).update({
      status: 'processing',
      lastAttemptAt: now,
      attempts: (nextItem.attempts || 0) + 1,
    });

    return res.json({
      processed: false,
      processing: true,
      itemId: nextItem.id,
      item: nextItem,
      message: 'Item marcado para processamento. Use o server Express para processamento pesado.',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao processar', details: err.message });
  }
};
