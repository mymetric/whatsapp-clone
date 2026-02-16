const { getDb, setCors } = require('../../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id é obrigatório' });

    const queueRef = db.collection('file_processing_queue').doc(id);
    const doc = await queueRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }

    await queueRef.update({
      status: 'queued',
      attempts: 0,
      error: null,
      nextRetryAt: null,
      lastAttemptAt: null,
    });

    return res.json({ success: true, itemId: id, status: 'queued' });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao retentar', details: err.message });
  }
};
