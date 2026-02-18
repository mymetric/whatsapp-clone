const { getDb, setCors } = require('../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id é obrigatório' });

  try {
    // PATCH /api/prompts/[id] — atualizar
    if (req.method === 'PATCH') {
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

    // DELETE /api/prompts/[id] — deletar
    if (req.method === 'DELETE') {
      await db.collection('prompts').doc(id).delete();
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Erro em /api/prompts/[id]:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
