const { getDb, setCors } = require('../../../lib/firebase-admin');

module.exports = async (req, res) => {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase não configurado' });

  try {
    const snapshot = await db
      .collection('umbler_webhooks')
      .orderBy('_receivedAt', 'desc')
      .limit(10)
      .get();

    const diagnosis = snapshot.docs.map(doc => {
      const data = doc.data();
      const payload = data.Payload || {};
      const content = payload.Content || {};
      const message = content.Message || data.Message || {};
      const lastMessage = content.LastMessage || data.LastMessage || {};
      const contact = content.Contact || data.Contact || {};

      return {
        docId: doc.id,
        'Message.IsFromMe': message.IsFromMe,
        'LastMessage.IsFromMe': lastMessage.IsFromMe,
        'data.IsFromMe': data.IsFromMe,
        'content.IsFromMe': content.IsFromMe,
        'EventName': data.EventName || data.eventName || payload.EventName,
        'Trigger': data.Trigger || data.trigger,
        'Direction': data.Direction || data.direction || content.Direction,
        'Message.Participant': message.Participant,
        'Contact.PhoneNumber': contact.PhoneNumber,
        'Contact.Name': contact.Name || contact.DisplayName,
        'MessageType': message.MessageType || lastMessage.MessageType,
        'MessageContent': (message.Content || lastMessage.Content || '').substring(0, 80),
        timestamp: data._receivedAtISO,
        topLevelKeys: Object.keys(data).filter(k => !k.startsWith('_')),
      };
    });

    return res.json({ diagnosis, count: diagnosis.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
