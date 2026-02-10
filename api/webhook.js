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

// Collections permitidas
const ALLOWED_TYPES = {
  'umbler': 'umbler_webhooks',
  'email': 'email_webhooks',
  'whatsapp': 'whatsapp_webhooks',
};

// Parser simples para multipart/form-data
function parseMultipartFormData(body, boundary) {
  const result = {};
  const parts = body.split(boundary).filter(part => part.trim() && part.trim() !== '--');

  for (const part of parts) {
    const match = part.match(/Content-Disposition: form-data; name="([^"]+)"[\s\S]*?\r\n\r\n([\s\S]*?)(?:\r\n)?$/);
    if (match) {
      const name = match[1];
      let value = match[2].trim();
      // Remover trailing -- se existir
      if (value.endsWith('--')) {
        value = value.slice(0, -2).trim();
      }
      result[name] = value;
    }
  }

  return result;
}

// Função para ler o body raw da requisição
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      // Body já foi parseado pelo Vercel
      resolve(null);
      return;
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Apenas POST permitido
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    // Tipo de webhook (umbler, email, whatsapp, etc)
    const type = req.query.type || 'umbler';
    const collectionName = ALLOWED_TYPES[type];

    if (!collectionName) {
      return res.status(400).json({
        error: `Tipo inválido: ${type}`,
        allowedTypes: Object.keys(ALLOWED_TYPES)
      });
    }

    if (!firestoreDb) {
      firestoreDb = initFirebase();
    }

    if (!firestoreDb) {
      console.error('❌ [Webhook] Firebase não configurado');
      return res.status(500).json({ error: 'Firebase não configurado no servidor' });
    }

    // Determinar o tipo de conteúdo e parsear o body
    let webhookData = {};
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
      // Extrair boundary do content-type
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      if (boundaryMatch) {
        const boundary = '--' + boundaryMatch[1].replace(/['"]/g, '');
        const rawBody = await getRawBody(req);
        if (rawBody) {
          webhookData = parseMultipartFormData(rawBody, boundary);
        } else if (req.body) {
          webhookData = req.body;
        }
      }
      console.log(`📥 [Webhook ${type}] Recebido (form-data):`, JSON.stringify(webhookData, null, 2).substring(0, 500));
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      // URL encoded form
      webhookData = req.body || {};
      console.log(`📥 [Webhook ${type}] Recebido (urlencoded):`, JSON.stringify(webhookData, null, 2).substring(0, 500));
    } else {
      // JSON (default)
      webhookData = req.body || {};
      console.log(`📥 [Webhook ${type}] Recebido (json):`, JSON.stringify(webhookData, null, 2).substring(0, 500));
    }

    if (!webhookData || Object.keys(webhookData).length === 0) {
      console.warn(`⚠️ [Webhook ${type}] Payload vazio recebido`);
      return res.status(400).json({ error: 'Payload vazio' });
    }

    // LOG DIAGNÓSTICO: logar webhook completo quando contém arquivo
    if (type === 'umbler') {
      const p = webhookData.Payload || {};
      const c = p.Content || {};
      const msg = c.Message || webhookData.Message || {};
      const lm = c.LastMessage || webhookData.LastMessage || {};
      const msgType = msg.MessageType || lm.MessageType || '';
      if (msgType === 'File' || msgType === 'Image' || msgType === 'Audio' || msgType === 'Video') {
        const fileUrl = (msg.File || {}).Url || (lm.File || {}).Url || 'VAZIO';
        console.log(`📎 [Webhook ${type}] MÍDIA DETECTADA — MessageType=${msgType}, File.Url=${fileUrl}`);
        console.log(`📎 [Webhook ${type}] PAYLOAD COMPLETO:`, JSON.stringify(webhookData, null, 2));
      }
    }

    // Preparar documento para salvar
    const docData = {
      ...webhookData,
      _receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      _receivedAtISO: new Date().toISOString(),
      _webhookType: type,
    };

    // Determinar ID do documento baseado no tipo
    let docId = null;
    if (type === 'umbler') {
      docId = webhookData.EventId || webhookData.Id || null;
    } else if (type === 'email') {
      // Para emails, usar hash do subject + sender + timestamp ou gerar automaticamente
      const subject = webhookData.subject || '';
      const sender = webhookData.sender || '';
      const dest = webhookData.destination || '';
      if (subject && sender) {
        // Criar um ID baseado no conteúdo do email
        docId = Buffer.from(`${subject}-${sender}-${dest}-${Date.now()}`).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 40);
      }
    }

    let docRef;
    if (docId) {
      docRef = firestoreDb.collection(collectionName).doc(docId);
      await docRef.set(docData, { merge: true });
      console.log(`✅ [Webhook ${type}] Salvo com ID: ${docId}`);
    } else {
      docRef = await firestoreDb.collection(collectionName).add(docData);
      console.log(`✅ [Webhook ${type}] Salvo com ID gerado: ${docRef.id}`);
    }

    return res.status(200).json({
      success: true,
      id: docId || docRef.id,
      type,
      collection: collectionName,
      message: 'Webhook recebido e salvo com sucesso'
    });
  } catch (err) {
    console.error('❌ [Webhook] Erro ao processar webhook:', err.message, err.stack);
    return res.status(500).json({
      error: 'Erro ao processar webhook',
      details: err.message,
    });
  }
};

// Desabilitar o body parser do Vercel para permitir leitura do raw body
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
