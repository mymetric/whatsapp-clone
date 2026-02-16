const { getDb, setCors } = require('../../../lib/firebase-admin');

// Nota: O processamento pesado (download, OCR, PDF, etc.) deve rodar no server Express.
// Esta function marca o item como "processing".

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

    const data = doc.data();
    await queueRef.update({
      status: 'processing',
      lastAttemptAt: new Date().toISOString(),
      attempts: (data.attempts || 0) + 1,
    });

    return res.json({
      processed: false,
      processing: true,
      itemId: id,
      message: 'Item marcado para processamento.',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao processar', details: err.message });
  }
};
