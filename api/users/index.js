const { getDb, validateAuth, setCors, DEFAULT_PERMISSIONS } = require('../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  const user = await validateAuth(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito a admins' });

  // GET /api/users — listar usuários
  if (req.method === 'GET') {
    try {
      const snapshot = await db.collection('users').get();
      const users = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          email: data.email,
          name: data.name,
          role: data.role,
          permissions: data.permissions || DEFAULT_PERMISSIONS[data.role] || [],
        };
      });
      return res.json(users);
    } catch (err) {
      return res.status(500).json({ error: 'Erro ao listar usuários' });
    }
  }

  // POST /api/users — criar usuário
  if (req.method === 'POST') {
    try {
      const { email, name, password, role } = req.body || {};
      if (!email || !name || !password) {
        return res.status(400).json({ error: 'email, name e password são obrigatórios' });
      }

      const existing = await db.collection('users').doc(email).get();
      if (existing.exists) {
        return res.status(409).json({ error: 'Usuário já existe' });
      }

      const userRole = role === 'admin' ? 'admin' : 'user';
      const permissions = DEFAULT_PERMISSIONS[userRole];

      await db.collection('users').doc(email).set({
        email, name, password, role: userRole, permissions,
      });

      return res.json({ email, name, role: userRole, permissions });
    } catch (err) {
      return res.status(500).json({ error: 'Erro ao criar usuário' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
