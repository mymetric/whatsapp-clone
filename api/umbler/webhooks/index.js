const { getDb, setCors } = require('../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  try {
    const limitParam = parseInt(req.query.limit) || 50;

    const snapshot = await db
      .collection('umbler_webhooks')
      .orderBy('_receivedAt', 'desc')
      .limit(limitParam)
      .get();

    const webhooks = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      _receivedAt: doc.data()._receivedAt?.toDate?.() || doc.data()._receivedAt,
    }));

    return res.json({ webhooks, count: webhooks.length });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar webhooks', details: err.message });
  }
};
