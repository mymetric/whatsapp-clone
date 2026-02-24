const { getDb, setCors, extractEmailAttachments } = require('../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  try {
    const email = req.query.email;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Parâmetro "email" é obrigatório' });
    }

    const emailLower = email.toLowerCase().trim();
    const emailsRef = db.collection('email_webhooks');

    // 2 queries paralelas
    const [destSnap, senderSnap] = await Promise.all([
      emailsRef.where('destination', '==', emailLower).orderBy('_receivedAt', 'desc').limit(200).get(),
      emailsRef.where('sender', '==', emailLower).orderBy('_receivedAt', 'desc').limit(200).get(),
    ]);

    const docsMap = new Map();
    destSnap.docs.forEach(doc => docsMap.set(doc.id, { doc, matchField: 'destination' }));
    senderSnap.docs.forEach(doc => {
      if (!docsMap.has(doc.id)) docsMap.set(doc.id, { doc, matchField: 'sender' });
    });

    // Scan amplo se poucos resultados
    if (docsMap.size < 5) {
      const broadSnap = await emailsRef.orderBy('_receivedAt', 'desc').limit(500).get();
      broadSnap.docs.forEach(doc => {
        if (docsMap.has(doc.id)) return;
        const data = doc.data();
        const senderStr = (data.sender || '').toLowerCase();
        const destStr = (data.destination || '').toLowerCase();
        if (senderStr.includes(emailLower)) {
          docsMap.set(doc.id, { doc, matchField: 'sender' });
        } else if (destStr.includes(emailLower)) {
          docsMap.set(doc.id, { doc, matchField: 'destination' });
        }
      });
    }

    const emails = [];
    for (const [docId, { doc, matchField }] of docsMap) {
      const data = doc.data();

      let timestamp = null;
      if (data._receivedAtISO) {
        timestamp = data._receivedAtISO;
      } else if (data._receivedAt && typeof data._receivedAt.toDate === 'function') {
        timestamp = data._receivedAt.toDate().toISOString();
      } else if (data._receivedAt) {
        timestamp = new Date(data._receivedAt).toISOString();
      }

      const rawAttachments = extractEmailAttachments(data);
      const attachments = rawAttachments.map(a => ({
        url: a.url,
        name: a.rawValue ? a.rawValue.split('/').pop() || `anexo_${a.index + 1}` : `anexo_${a.index + 1}`,
      }));

      const direction = matchField === 'sender' ? 'sent' : 'received';

      emails.push({
        id: docId,
        subject: data.subject || '',
        sender: data.sender || '',
        destination: data.destination || '',
        text: data.text || '',
        timestamp,
        attachments,
        direction,
      });
    }

    emails.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });

    return res.json({ emails, count: emails.length, source: 'firestore' });
  } catch (err) {
    console.error('[emails] Erro:', err.message);
    // Firestore pode exigir índice composto para queries com orderBy
    if (err.code === 9 || err.message?.includes('index')) {
      console.error('[emails] Possível índice faltando no Firestore. Tentando busca sem orderBy...');
      try {
        const emailLower = (req.query.email || '').toLowerCase().trim();
        const emailsRef = db.collection('email_webhooks');
        const [destSnap, senderSnap] = await Promise.all([
          emailsRef.where('destination', '==', emailLower).limit(200).get(),
          emailsRef.where('sender', '==', emailLower).limit(200).get(),
        ]);
        const docsMap = new Map();
        destSnap.docs.forEach(doc => docsMap.set(doc.id, { doc, matchField: 'destination' }));
        senderSnap.docs.forEach(doc => {
          if (!docsMap.has(doc.id)) docsMap.set(doc.id, { doc, matchField: 'sender' });
        });
        const emails = [];
        for (const [docId, { doc, matchField }] of docsMap) {
          const data = doc.data();
          let timestamp = null;
          if (data._receivedAtISO) timestamp = data._receivedAtISO;
          else if (data._receivedAt?.toDate) timestamp = data._receivedAt.toDate().toISOString();
          else if (data._receivedAt) timestamp = new Date(data._receivedAt).toISOString();
          const rawAttachments = extractEmailAttachments(data);
          const attachments = rawAttachments.map(a => ({
            url: a.url,
            name: a.rawValue ? a.rawValue.split('/').pop() || `anexo_${a.index + 1}` : `anexo_${a.index + 1}`,
          }));
          emails.push({
            id: docId, subject: data.subject || '', sender: data.sender || '',
            destination: data.destination || '', text: data.text || '', timestamp, attachments,
            direction: matchField === 'sender' ? 'sent' : 'received',
          });
        }
        emails.sort((a, b) => {
          const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return tb - ta;
        });
        return res.json({ emails, count: emails.length, source: 'firestore' });
      } catch (fallbackErr) {
        console.error('[emails] Fallback também falhou:', fallbackErr.message);
      }
    }
    return res.status(500).json({ error: 'Erro ao buscar emails', details: err.message });
  }
};
