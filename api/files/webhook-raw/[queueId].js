const { getDb, setCors } = require('../../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  try {
    const queueId = req.query.queueId;
    if (!queueId) return res.status(400).json({ error: 'queueId é obrigatório' });

    const queueDoc = await db.collection('file_processing_queue').doc(queueId).get();
    if (!queueDoc.exists) {
      return res.status(404).json({ error: 'Item não encontrado na fila' });
    }

    const queueData = queueDoc.data();
    const webhookSource = queueData.webhookSource || 'umbler';
    const collectionName = webhookSource === 'email' ? 'email_webhooks' : 'umbler_webhooks';

    const webhookDoc = await db.collection(collectionName).doc(queueData.webhookId).get();
    if (!webhookDoc.exists) {
      return res.status(404).json({ error: `Webhook ${queueData.webhookId} não encontrado em ${collectionName}` });
    }

    const webhookData = webhookDoc.data();

    // Sanitizar timestamps do Firestore
    const sanitize = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      if (obj._seconds !== undefined && obj._nanoseconds !== undefined) {
        return new Date(obj._seconds * 1000).toISOString();
      }
      if (typeof obj.toDate === 'function') {
        return obj.toDate().toISOString();
      }
      if (Array.isArray(obj)) return obj.map(sanitize);
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = sanitize(v);
      }
      return result;
    };

    return res.json({
      queueItem: {
        id: queueDoc.id,
        webhookId: queueData.webhookId,
        webhookSource,
        attachmentIndex: queueData.attachmentIndex,
        mediaUrl: queueData.mediaUrl,
        mediaFileName: queueData.mediaFileName,
        mediaMimeType: queueData.mediaMimeType,
        mediaType: queueData.mediaType,
      },
      webhook: sanitize(webhookData),
      collection: collectionName,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar webhook', details: err.message });
  }
};
