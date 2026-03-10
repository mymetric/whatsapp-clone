const { getDb, validateAuth, setCors } = require('../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const session = await validateAuth(req);
  if (!session || session.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não disponível' });

  try {
    const { action, userEmail, startDate, endDate, limit: qLimit } = req.query;
    const limitNum = Math.min(parseInt(qLimit) || 200, 1000);

    let query = db.collection('activity_logs').orderBy('timestamp', 'desc');

    if (action) {
      query = query.where('action', '==', action);
    }
    if (userEmail) {
      query = query.where('userEmail', '==', userEmail);
    }
    if (startDate) {
      query = query.where('timestamp', '>=', startDate);
    }
    if (endDate) {
      query = query.where('timestamp', '<=', endDate);
    }

    query = query.limit(limitNum);

    const snapshot = await query.get();
    const logs = [];
    snapshot.forEach((doc) => {
      logs.push({ id: doc.id, ...doc.data() });
    });

    // Compute summary stats
    const summary = {
      total: logs.length,
      byAction: {},
      byUser: {},
    };
    logs.forEach((log) => {
      summary.byAction[log.action] = (summary.byAction[log.action] || 0) + 1;
      summary.byUser[log.userEmail] = (summary.byUser[log.userEmail] || 0) + 1;
    });

    return res.json({ logs, summary });
  } catch (err) {
    console.error('❌ [activity-logs] Erro:', err.message);
    return res.status(500).json({ error: 'Erro ao buscar logs', details: err.message });
  }
};
