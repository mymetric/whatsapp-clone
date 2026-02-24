const admin = require('firebase-admin');

// Inicializar Firebase Admin SDK (singleton)
let firestoreDb = null;

function initFirebase() {
  try {
    if (admin.apps.length === 0) {
      const projectId = process.env.FIREBASE_PROJECT_ID || process.env.REACT_APP_FIREBASE_PROJECT_ID;
      const privateKeyId = process.env.FIREBASE_PRIVATE_KEY_ID || process.env.REACT_APP_FIREBASE_PRIVATE_KEY_ID;
      let privateKey = process.env.FIREBASE_PRIVATE_KEY || process.env.REACT_APP_FIREBASE_PRIVATE_KEY || '';
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || process.env.REACT_APP_FIREBASE_CLIENT_EMAIL;

      if (!projectId || !privateKey || !clientEmail) {
        console.warn('⚠️ Firebase não configurado');
        return null;
      }

      privateKey = privateKey
        .replace(/^["']|["']$/g, '')
        .replace(/\\n/g, '\n');

      if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        console.warn('⚠️ FIREBASE_PRIVATE_KEY formato inválido');
        return null;
      }

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          privateKeyId,
          privateKey,
          clientEmail,
        }),
      });
      console.log('✅ Firebase Admin SDK inicializado');
    }
    firestoreDb = admin.firestore();
    firestoreDb.settings({ databaseId: 'messages' });
    return firestoreDb;
  } catch (err) {
    console.error('❌ Erro ao inicializar Firebase:', err.message);
    return null;
  }
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!firestoreDb) {
      firestoreDb = initFirebase();
    }

    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado no servidor' });
    }

    const phone = req.query.phone;
    const limitParam = parseInt(req.query.limit) || 50;

    if (!phone) {
      return res.status(400).json({ error: 'Parâmetro phone é obrigatório' });
    }

    const normalizedPhone = String(phone).replace(/\D/g, '');
    console.log(`📱 [server] Buscando mensagens para telefone: ${normalizedPhone}`);

    // Criar variantes do telefone para busca
    const variants = [normalizedPhone];
    if (normalizedPhone.startsWith('55') && normalizedPhone.length > 10) {
      variants.push(normalizedPhone.substring(2));
    }
    if (!normalizedPhone.startsWith('55') && normalizedPhone.length >= 10) {
      variants.push('55' + normalizedPhone);
    }

    // Buscar mensagens por todas as variantes do telefone
    const messagesRef = firestoreDb.collection('messages');
    let allMessages = [];

    for (const variant of variants) {
      const snapshot = await messagesRef
        .where('chat_phone', '==', variant)
        .orderBy('timestamp', 'desc')
        .limit(limitParam)
        .get();

      if (!snapshot.empty) {
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          allMessages.push({
            id: doc.id,
            audio: data.audio || false,
            chat_phone: String(data.chat_phone),
            content: data.content || '',
            image: data.image || '',
            name: data.name || '',
            source: data.source || '',
            timestamp: data.timestamp?.toDate?.() || data.timestamp || null,
          });
        });
        break; // Encontrou mensagens, parar de buscar variantes
      }
    }

    // Se não encontrou com where, tentar busca pelo número local (últimos 8-9 dígitos)
    if (allMessages.length === 0) {
      const localNum = normalizedPhone.length >= 9 ? normalizedPhone.slice(-9) : normalizedPhone.slice(-8);

      // Buscar todas as mensagens recentes e filtrar por número local
      const snapshot = await messagesRef
        .orderBy('timestamp', 'desc')
        .limit(5000)
        .get();

      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const msgPhone = String(data.chat_phone || '').replace(/\D/g, '');
        const msgLocal = msgPhone.length >= 9 ? msgPhone.slice(-9) : msgPhone.slice(-8);

        if (msgLocal === localNum) {
          allMessages.push({
            id: doc.id,
            audio: data.audio || false,
            chat_phone: String(data.chat_phone),
            content: data.content || '',
            image: data.image || '',
            name: data.name || '',
            source: data.source || '',
            timestamp: data.timestamp?.toDate?.() || data.timestamp || null,
          });
        }
      });

      allMessages = allMessages.slice(0, limitParam);
    }

    console.log(`✅ [server] Encontradas ${allMessages.length} mensagens para ${normalizedPhone}`);

    // Buscar channel_phone do webhook mais recente para este contato
    let conversationChannelPhone = null;
    try {
      const webhooksRef = firestoreDb.collection('umbler_webhooks');
      for (const variant of variants) {
        const whSnap = await webhooksRef
          .where('Payload.Content.Contact.PhoneNumber', '==', '+' + variant)
          .orderBy('_receivedAt', 'desc')
          .limit(1)
          .get();
        if (!whSnap.empty) {
          const whData = whSnap.docs[0].data();
          const chPhone = ((whData.Payload?.Content?.Channel?.PhoneNumber) || '').replace(/\D/g, '');
          if (chPhone) conversationChannelPhone = chPhone;
          break;
        }
      }
    } catch (whErr) {
      console.warn('⚠️ [server] Erro ao buscar channel_phone de webhooks:', whErr.message);
    }

    return res.json({ messages: allMessages, count: allMessages.length, channel_phone: conversationChannelPhone });
  } catch (err) {
    console.error('❌ [server] Erro ao buscar mensagens do Firestore:', err);
    return res.status(500).json({
      error: 'Erro ao buscar mensagens',
      details: err.message,
    });
  }
};
