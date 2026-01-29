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
        console.warn('⚠️ Firebase não configurado. Configure FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY e FIREBASE_CLIENT_EMAIL');
        return null;
      }

      // Processar a private key: remover aspas e converter \\n para quebras de linha reais
      privateKey = privateKey
        .replace(/^["']|["']$/g, '') // Remove aspas no início e fim
        .replace(/\\n/g, '\n'); // Converte \n literais para quebras de linha

      // Verificar se a chave parece válida
      if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        console.warn('⚠️ FIREBASE_PRIVATE_KEY não parece estar no formato PEM correto');
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
    // Conectar ao database "messages"
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
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Inicializar Firebase se necessário
    if (!firestoreDb) {
      firestoreDb = initFirebase();
    }

    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado no servidor' });
    }

    console.log('📱 [server] Buscando telefones únicos do Firestore...');

    // Buscar todas as mensagens
    const messagesRef = firestoreDb.collection('messages');
    const snapshot = await messagesRef.orderBy('timestamp', 'desc').get();

    if (snapshot.empty) {
      console.log('ℹ️ [server] Nenhuma mensagem encontrada no Firestore');
      return res.json({ phones: [], count: 0 });
    }

    // Agrupar mensagens por telefone
    const phoneMap = new Map();

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const phone = String(data.chat_phone || '').replace(/\D/g, '');

      if (!phone || phone.length < 10) return;

      if (!phoneMap.has(phone)) {
        phoneMap.set(phone, {
          phone,
          messageCount: 0,
          lastMessage: null,
          contactName: null,
        });
      }

      const entry = phoneMap.get(phone);
      entry.messageCount++;

      // Atualizar última mensagem (já ordenado por timestamp desc)
      if (!entry.lastMessage) {
        entry.lastMessage = {
          content: data.content || '',
          timestamp: data.timestamp?.toDate?.() || data.timestamp || null,
          source: data.source || '',
        };
      }

      // Pegar nome do contato se disponível
      if (!entry.contactName && data.name && data.source === 'Contact') {
        entry.contactName = data.name;
      }
    });

    // Converter Map para array e ordenar por última mensagem
    const phones = Array.from(phoneMap.values()).sort((a, b) => {
      const timeA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
      const timeB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
      return timeB - timeA;
    });

    console.log(`✅ [server] Encontrados ${phones.length} telefones únicos`);

    return res.json({ phones, count: phones.length });
  } catch (err) {
    console.error('❌ [server] Erro ao buscar telefones únicos do Firestore:', err);
    return res.status(500).json({
      error: 'Erro ao buscar telefones únicos',
      details: err.message,
    });
  }
};
