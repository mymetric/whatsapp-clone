// Reutiliza a lógica do process-next (processQueueItem)
const processNextModule = require('../process-next');
const { getDb, setCors } = require('../../../lib/firebase-admin');

// Importar processQueueItem não é possível diretamente, então reimplementar como wrapper
module.exports = async (req, res) => {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'id é obrigatório' });

  // Delegar ao process-next com override: setar o item como queued temporariamente
  // para que o process-next o encontre
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  try {
    const queueRef = db.collection('file_processing_queue').doc(id);
    const doc = await queueRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Item não encontrado' });

    // Resetar para queued para que process-next o processe
    await queueRef.update({ status: 'queued', nextRetryAt: null });

    // Chamar process-next que vai pegar esse item
    return processNextModule(req, res);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao processar', details: err.message });
  }
};
