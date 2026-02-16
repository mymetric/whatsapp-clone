const { getDb, setCors } = require('../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  try {
    const limitParam = parseInt(req.query.limit) || 200;
    const statusFilter = req.query.status || null;
    const typeFilter = req.query.type || null;

    const snapshot = await db
      .collection('file_processing_queue')
      .orderBy('createdAt', 'desc')
      .limit(limitParam)
      .get();

    let items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (statusFilter) items = items.filter(item => item.status === statusFilter);
    if (typeFilter) items = items.filter(item => item.mediaType === typeFilter);

    return res.json({ items, count: items.length });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar fila', details: err.message });
  }
};
