const { getDb, setCors } = require('../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  try {
    // GET /api/prompts — listar todos
    if (req.method === 'GET') {
      const snapshot = await db.collection('prompts').get();
      const prompts = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          name: d.name || '',
          description: d.description || '',
          content: d.content || '',
          parentId: d.parentId || null,
          order: d.order || 0,
          createdAt: d.createdAt || '',
          updatedAt: d.updatedAt || '',
        };
      });
      return res.json(prompts);
    }

    // POST /api/prompts — criar
    if (req.method === 'POST') {
      const { name, description, content, parentId, order } = req.body;
      const docRef = await db.collection('prompts').add({
        name, description: description || '', content: content || '',
        parentId: parentId || null, order: order || 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      const doc = await docRef.get();
      return res.json({ id: doc.id, ...doc.data() });
    }

    // PATCH /api/prompts?id=xxx — atualizar
    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id é obrigatório' });
      const { name, description, content, parentId, order } = req.body;
      const ref = db.collection('prompts').doc(id);
      await ref.update({
        name, description: description || '', content: content || '',
        parentId: parentId || null, order: order || 0,
        updatedAt: new Date().toISOString(),
      });
      const doc = await ref.get();
      return res.json({ id: doc.id, ...doc.data() });
    }

    // DELETE /api/prompts?id=xxx — deletar
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id é obrigatório' });
      await db.collection('prompts').doc(id).delete();
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Erro em /api/prompts:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
