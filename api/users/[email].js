const { getDb, validateAuth, setCors, DEFAULT_PERMISSIONS } = require('../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  const user = await validateAuth(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito a admins' });

  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'email é obrigatório' });

  // PUT /api/users/:email — atualizar usuário
  if (req.method === 'PUT') {
    try {
      const userDoc = await db.collection('users').doc(email).get();
      if (!userDoc.exists) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }

      const updates = {};
      const { name, role, password } = req.body || {};
      if (name) updates.name = name;
      if (role && (role === 'admin' || role === 'user')) updates.role = role;
      if (password) updates.password = password;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      await db.collection('users').doc(email).update(updates);

      const updated = (await db.collection('users').doc(email).get()).data();
      return res.json({
        email: updated.email,
        name: updated.name,
        role: updated.role,
        permissions: updated.permissions || DEFAULT_PERMISSIONS[updated.role] || [],
      });
    } catch (err) {
      return res.status(500).json({ error: 'Erro ao atualizar usuário' });
    }
  }

  // DELETE /api/users/:email — deletar usuário
  if (req.method === 'DELETE') {
    try {
      if (email === user.email) {
        return res.status(400).json({ error: 'Não é possível deletar seu próprio usuário' });
      }

      const userDoc = await db.collection('users').doc(email).get();
      if (!userDoc.exists) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }

      const sessions = await db.collection('sessions').where('email', '==', email).get();
      const batch = db.batch();
      sessions.docs.forEach(doc => batch.delete(doc.ref));
      batch.delete(db.collection('users').doc(email));
      await batch.commit();

      return res.json({ success: true, email });
    } catch (err) {
      return res.status(500).json({ error: 'Erro ao deletar usuário' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
