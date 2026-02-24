const { getDb, setCors, validateAuth } = require('../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await validateAuth(req);
  if (!user) return res.status(401).json({ error: 'Nao autenticado' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase nao configurado' });

  try {
    // POST — criar report
    if (req.method === 'POST') {
      const { description, leadId, leadName, url, userAgent } = req.body || {};
      if (!description || typeof description !== 'string' || !description.trim()) {
        return res.status(400).json({ error: 'description e obrigatorio' });
      }

      const report = {
        description: description.trim(),
        leadId: leadId || null,
        leadName: leadName || null,
        url: url || null,
        userAgent: userAgent || null,
        reportedBy: user.email || 'unknown',
        reportedByName: user.name || 'unknown',
        status: 'open',
        createdAt: new Date().toISOString(),
      };

      const docRef = await db.collection('error_reports').add(report);
      console.log(`[ErrorReport] Novo erro por ${report.reportedBy}: "${description.substring(0, 80)}" (id: ${docRef.id})`);

      return res.json({ success: true, id: docRef.id });
    }

    // GET — listar (admin only)
    if (req.method === 'GET') {
      if (user.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const snapshot = await db.collection('error_reports')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return res.json({ reports });
    }

    return res.status(405).json({ error: 'Metodo nao permitido' });
  } catch (err) {
    console.error('[ErrorReport] Erro:', err.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
};
