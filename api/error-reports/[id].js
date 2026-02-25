const { getDb, setCors, validateAuth } = require('../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await validateAuth(req);
  if (!user) return res.status(401).json({ error: 'Nao autenticado' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase nao configurado' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id e obrigatorio' });

  const docRef = db.collection('error_reports').doc(id);

  try {
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Report nao encontrado' });

    // PATCH — atualizar status
    if (req.method === 'PATCH') {
      const { status } = req.body || {};
      if (!status) return res.status(400).json({ error: 'status e obrigatorio' });

      await docRef.update({
        status,
        resolvedAt: status === 'resolved' ? new Date().toISOString() : null,
        resolvedBy: status === 'resolved' ? user.email : null,
      });

      return res.json({ success: true });
    }

    // DELETE — remover report
    if (req.method === 'DELETE') {
      await docRef.delete();
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Metodo nao permitido' });
  } catch (err) {
    console.error('[ErrorReport] Erro:', err.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
};
