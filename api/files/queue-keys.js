/**
 * GET /api/files/queue-keys — Retorna apenas webhookId + attachmentIndex de toda a fila.
 * Endpoint leve para o frontend comparar quais webhooks já foram enfileirados,
 * sem precisar carregar todos os campos de milhares de documentos.
 */
const { getDb, setCors } = require('../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  try {
    const snapshot = await db
      .collection('file_processing_queue')
      .select('webhookId', 'webhookSource', 'attachmentIndex')
      .get();

    const keys = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        webhookId: d.webhookId,
        webhookSource: d.webhookSource || 'umbler',
        attachmentIndex: d.attachmentIndex !== undefined ? d.attachmentIndex : null,
      };
    });

    return res.json({ keys, count: keys.length });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar chaves da fila', details: err.message });
  }
};
