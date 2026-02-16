const { getDb, setCors, extractEmailAttachments, classifyMediaType } = require('../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  try {
    const { webhookIds, source = 'umbler', attachmentIndex } = req.body || {};
    if (!Array.isArray(webhookIds) || webhookIds.length === 0) {
      return res.status(400).json({ error: 'webhookIds (array) é obrigatório' });
    }

    const webhookSource = source === 'email' ? 'email' : 'umbler';
    const collectionName = webhookSource === 'email' ? 'email_webhooks' : 'umbler_webhooks';

    const results = [];

    for (const webhookId of webhookIds) {
      const webhookDoc = await db.collection(collectionName).doc(webhookId).get();
      if (!webhookDoc.exists) {
        results.push({ webhookId, error: 'Webhook não encontrado' });
        continue;
      }

      const data = webhookDoc.data();

      if (webhookSource === 'email') {
        const attachments = extractEmailAttachments(data);
        if (attachments.length === 0) {
          results.push({ webhookId, error: 'Email sem anexos com URL válida' });
          continue;
        }

        const toProcess = (attachmentIndex !== undefined && attachmentIndex !== null)
          ? attachments.filter(a => a.index === attachmentIndex)
          : attachments;

        const totalAtt = attachments.length;
        const rawSender = data.sender || data.from || '';
        const senderName = rawSender.replace(/<[^>]+>/, '').replace(/["']/g, '').trim() || rawSender;

        for (const att of toProcess) {
          const eFileName = totalAtt > 1
            ? `Anexo ${att.index + 1}/${totalAtt} - ${senderName}`
            : `Anexo - ${senderName}`;
          let eMimeType = '';
          let eMediaType = 'image';

          const urlLower = att.url.toLowerCase();
          if (urlLower.includes('.pdf')) { eMediaType = 'pdf'; eMimeType = 'application/pdf'; }
          else if (urlLower.includes('.doc')) { eMediaType = 'docx'; eMimeType = 'application/msword'; }
          else if (urlLower.includes('.mp3') || urlLower.includes('.wav') || urlLower.includes('.ogg')) { eMediaType = 'audio'; }

          const existing = await db.collection('file_processing_queue')
            .where('webhookId', '==', webhookId)
            .where('attachmentIndex', '==', att.index)
            .limit(1).get();

          if (!existing.empty) {
            results.push({ webhookId, attachmentIndex: att.index, error: 'Já está na fila', existingId: existing.docs[0].id });
            continue;
          }

          const queueItem = {
            webhookId, webhookSource: 'email', attachmentIndex: att.index,
            sourcePhone: data.sender || data.from || '',
            mediaUrl: att.url, mediaFileName: eFileName, mediaMimeType: eMimeType, mediaType: eMediaType,
            thumbnailBase64: null,
            receivedAt: data._receivedAtISO || (data._receivedAt?.toDate ? data._receivedAt.toDate().toISOString() : null),
            status: 'queued', extractedText: null, error: null, processingMethod: null,
            attempts: 0, maxAttempts: 3, lastAttemptAt: null, nextRetryAt: null,
            gcsUrl: null, gcsPath: null, processedAt: null, createdAt: new Date().toISOString(),
          };

          const docRef = await db.collection('file_processing_queue').add(queueItem);
          results.push({ webhookId, attachmentIndex: att.index, queueId: docRef.id, status: 'queued' });
        }
      } else {
        // Umbler webhooks
        const payload = data.Payload || {};
        const content = payload.Content || {};
        const message = content.Message || data.Message || {};
        const lastMessage = content.LastMessage || data.LastMessage || {};

        const msgFile = message.File || {};
        const lmFile = lastMessage.File || {};
        const messageType = message.MessageType || lastMessage.MessageType || '';

        const mediaUrl = msgFile.Url || lmFile.Url || '';
        const mimeType = msgFile.ContentType || lmFile.ContentType || '';
        const fileName = msgFile.OriginalName || lmFile.OriginalName || `file_${webhookId}`;
        const contactPhone = (content.Contact || data.Contact || {}).PhoneNumber || '';

        const thumbnailObj = message.Thumbnail || lastMessage.Thumbnail || {};
        const thumbnailData = thumbnailObj.Data || null;
        const thumbnailMime = thumbnailObj.ContentType || 'image/jpeg';

        if (!messageType || messageType === 'Text') {
          results.push({ webhookId, error: 'Webhook sem mídia' });
          continue;
        }

        let mediaType = classifyMediaType(mimeType);
        if (messageType === 'Audio') mediaType = 'audio';
        if (messageType === 'Image') mediaType = 'image';

        const existing = await db.collection('file_processing_queue')
          .where('webhookId', '==', webhookId).limit(1).get();

        if (!existing.empty) {
          results.push({ webhookId, error: 'Já está na fila', existingId: existing.docs[0].id });
          continue;
        }

        const queueItem = {
          webhookId, webhookSource: 'umbler', sourcePhone: contactPhone,
          mediaUrl, mediaFileName: fileName, mediaMimeType: mimeType, mediaType,
          thumbnailBase64: thumbnailData ? `data:${thumbnailMime};base64,${thumbnailData}` : null,
          receivedAt: data._receivedAtISO || (data._receivedAt?.toDate ? data._receivedAt.toDate().toISOString() : null),
          status: 'queued', extractedText: null, error: null, processingMethod: null,
          attempts: 0, maxAttempts: 3, lastAttemptAt: null, nextRetryAt: null,
          gcsUrl: null, gcsPath: null, processedAt: null, createdAt: new Date().toISOString(),
        };

        const docRef = await db.collection('file_processing_queue').add(queueItem);
        results.push({ webhookId, queueId: docRef.id, status: 'queued' });
      }
    }

    return res.json({ results });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao enfileirar', details: err.message });
  }
};
