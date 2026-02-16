const { getDb, validateAuth, setCors, ALL_PERMISSIONS } = require('../../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'PUT, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  const user = await validateAuth(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito a admins' });

  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'email é obrigatório' });

  try {
    const { permissions } = req.body || {};
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'permissions deve ser um array' });
    }

    const valid = permissions.filter(p => ALL_PERMISSIONS.includes(p));

    const userDoc = await db.collection('users').doc(email).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    await db.collection('users').doc(email).update({ permissions: valid });

    // Invalidar sessões ativas
    const sessions = await db.collection('sessions').where('email', '==', email).get();
    const batch = db.batch();
    sessions.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    return res.json({ email, permissions: valid, sessionsInvalidated: sessions.size });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao atualizar permissões' });
  }
};
