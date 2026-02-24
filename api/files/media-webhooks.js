const { getDb, setCors, classifyMediaType, extractEmailAttachments } = require('../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  try {
    const limitParam = parseInt(req.query.limit) || 100;
    const typeFilter = req.query.type || null;

    const snapshot = await db
      .collection('umbler_webhooks')
      .orderBy('_receivedAt', 'desc')
      .limit(500)
      .get();

    const mediaWebhooks = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const payload = data.Payload || {};
      const content = payload.Content || {};
      const message = content.Message || data.Message || {};
      const lastMessage = content.LastMessage || data.LastMessage || {};

      const msgFile = message.File || {};
      const lmFile = lastMessage.File || {};
      const messageType = message.MessageType || lastMessage.MessageType || '';

      if (messageType === 'Text' || !messageType) continue;

      const mediaUrl = msgFile.Url || lmFile.Url || null;
      if (!mediaUrl) continue; // Webhook de status/leitura sem URL do arquivo
      const mimeType = msgFile.ContentType || lmFile.ContentType || '';
      const fileName = msgFile.OriginalName || lmFile.OriginalName || `file_${doc.id}`;
      const contactPhone = (content.Contact || data.Contact || {}).PhoneNumber || '';

      const thumbnailObj = message.Thumbnail || lastMessage.Thumbnail || {};
      const thumbnailData = thumbnailObj.Data || null;
      const thumbnailMime = thumbnailObj.ContentType || 'image/jpeg';

      let mediaType = classifyMediaType(mimeType);
      if (messageType === 'Audio') mediaType = 'audio';
      if (messageType === 'Image') mediaType = 'image';

      if (typeFilter && mediaType !== typeFilter) continue;

      mediaWebhooks.push({
        id: doc.id,
        from: contactPhone,
        mediaUrl,
        mediaFileName: fileName,
        mediaMimeType: mimeType,
        mediaType,
        receivedAt: data._receivedAtISO || data._receivedAt?.toDate?.()?.toISOString() || null,
        body: lastMessage.Content || data.Body || '',
        hasUrl: !!mediaUrl,
        thumbnailBase64: thumbnailData ? `data:${thumbnailMime};base64,${thumbnailData}` : null,
        source: 'umbler',
      });

      if (mediaWebhooks.length >= limitParam) break;
    }

    // Buscar anexos de email_webhooks
    if (mediaWebhooks.length < limitParam) {
      const emailSnapshot = await db
        .collection('email_webhooks')
        .orderBy('_receivedAt', 'desc')
        .limit(500)
        .get();

      for (const eDoc of emailSnapshot.docs) {
        if (mediaWebhooks.length >= limitParam) break;

        const eData = eDoc.data();
        const attachments = extractEmailAttachments(eData);
        if (attachments.length === 0) continue;

        const totalAttachments = attachments.length;
        const rawSender = eData.sender || eData.from || '';
        const senderName = rawSender.replace(/<[^>]+>/, '').replace(/["']/g, '').trim() || rawSender;

        for (const att of attachments) {
          if (mediaWebhooks.length >= limitParam) break;

          const eFileName = totalAttachments > 1
            ? `Anexo ${att.index + 1}/${totalAttachments} - ${senderName}`
            : `Anexo - ${senderName}`;
          let eMimeType = '';
          let eMediaType = 'image';

          const urlLower = att.url.toLowerCase();
          if (urlLower.includes('.pdf')) { eMediaType = 'pdf'; eMimeType = 'application/pdf'; }
          else if (urlLower.includes('.doc')) { eMediaType = 'docx'; eMimeType = 'application/msword'; }
          else if (urlLower.includes('.mp3') || urlLower.includes('.wav') || urlLower.includes('.ogg')) { eMediaType = 'audio'; }

          if (typeFilter && eMediaType !== typeFilter) continue;

          mediaWebhooks.push({
            id: eDoc.id,
            attachmentIndex: att.index,
            from: rawSender,
            mediaUrl: att.url,
            mediaFileName: eFileName,
            mediaMimeType: eMimeType,
            mediaType: eMediaType,
            receivedAt: eData._receivedAtISO || eData._receivedAt?.toDate?.()?.toISOString() || null,
            body: eData.subject || '',
            hasUrl: true,
            thumbnailBase64: null,
            source: 'email',
            totalAttachments,
          });
        }
      }
    }

    return res.json({ webhooks: mediaWebhooks, count: mediaWebhooks.length });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar webhooks', details: err.message });
  }
};
