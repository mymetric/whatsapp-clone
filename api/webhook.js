const admin = require('firebase-admin');
const { extractEmailAttachments, classifyMediaType } = require('../lib/firebase-admin');

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

/**
 * Auto-enqueue: adiciona mídia detectada à file_processing_queue automaticamente.
 * Roda como fire-and-forget para não atrasar a response do webhook.
 */
async function autoEnqueueMedia(db, type, webhookId, webhookData) {
  const queueRef = db.collection('file_processing_queue');

  if (type === 'umbler') {
    const payload = webhookData.Payload || {};
    const content = payload.Content || {};
    const message = content.Message || webhookData.Message || {};
    const lastMessage = content.LastMessage || webhookData.LastMessage || {};
    const messageType = message.MessageType || lastMessage.MessageType || '';

    if (!messageType || messageType === 'Text') return;

    const msgFile = message.File || {};
    const lmFile = lastMessage.File || {};
    const mediaUrl = msgFile.Url || lmFile.Url || '';
    if (!mediaUrl) return;

    // Verificar duplicata
    const existing = await queueRef.where('webhookId', '==', webhookId).limit(1).get();
    if (!existing.empty) return;

    const mimeType = msgFile.ContentType || lmFile.ContentType || '';
    const fileName = msgFile.OriginalName || lmFile.OriginalName || `file_${webhookId}`;
    const contactPhone = (content.Contact || webhookData.Contact || {}).PhoneNumber || '';
    const thumbnailObj = message.Thumbnail || lastMessage.Thumbnail || {};
    const thumbnailData = thumbnailObj.Data || null;
    const thumbnailMime = thumbnailObj.ContentType || 'image/jpeg';

    let mediaType = classifyMediaType(mimeType);
    if (messageType === 'Audio') mediaType = 'audio';
    if (messageType === 'Image') mediaType = 'image';
    if (messageType === 'Video') mediaType = 'video';

    await queueRef.add({
      webhookId, webhookSource: 'umbler', sourcePhone: contactPhone,
      mediaUrl, mediaFileName: fileName, mediaMimeType: mimeType, mediaType,
      thumbnailBase64: thumbnailData ? `data:${thumbnailMime};base64,${thumbnailData}` : null,
      receivedAt: new Date().toISOString(),
      status: 'queued', extractedText: null, error: null, processingMethod: null,
      attempts: 0, maxAttempts: 3, lastAttemptAt: null, nextRetryAt: null,
      gcsUrl: null, gcsPath: null, processedAt: null, createdAt: new Date().toISOString(),
    });
    console.log(`📥 [Auto-enqueue] Umbler ${webhookId} (${messageType}) enfileirado`);

  } else if (type === 'email') {
    const attachments = extractEmailAttachments(webhookData);
    if (attachments.length === 0) return;

    // Verificar duplicata
    const existing = await queueRef.where('webhookId', '==', webhookId).limit(1).get();
    if (!existing.empty) return;

    const totalAtt = attachments.length;
    const rawSender = webhookData.sender || webhookData.from || '';
    const senderName = rawSender.replace(/<[^>]+>/, '').replace(/["']/g, '').trim() || rawSender;

    for (const att of attachments) {
      const eFileName = totalAtt > 1
        ? `Anexo ${att.index + 1}/${totalAtt} - ${senderName}`
        : `Anexo - ${senderName}`;
      let eMimeType = '';
      let eMediaType = 'image';
      const urlLower = att.url.toLowerCase();
      if (urlLower.includes('.pdf')) { eMediaType = 'pdf'; eMimeType = 'application/pdf'; }
      else if (urlLower.includes('.doc')) { eMediaType = 'docx'; eMimeType = 'application/msword'; }
      else if (urlLower.includes('.mp3') || urlLower.includes('.wav') || urlLower.includes('.ogg')) { eMediaType = 'audio'; }

      await queueRef.add({
        webhookId, webhookSource: 'email', attachmentIndex: att.index,
        sourcePhone: webhookData.sender || webhookData.from || '',
        mediaUrl: att.url, mediaFileName: eFileName, mediaMimeType: eMimeType, mediaType: eMediaType,
        thumbnailBase64: null, receivedAt: new Date().toISOString(),
        status: 'queued', extractedText: null, error: null, processingMethod: null,
        attempts: 0, maxAttempts: 3, lastAttemptAt: null, nextRetryAt: null,
        gcsUrl: null, gcsPath: null, processedAt: null, createdAt: new Date().toISOString(),
      });
    }
    console.log(`📥 [Auto-enqueue] Email ${webhookId} (${attachments.length} anexos) enfileirado`);
  }
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

    const savedId = docId || docRef.id;

    // Auto-enqueue: enfileirar mídia automaticamente (fire-and-forget)
    autoEnqueueMedia(firestoreDb, type, savedId, webhookData).catch(err => {
      console.warn(`⚠️ [Webhook ${type}] Auto-enqueue falhou (não fatal): ${err.message}`);
    });

    return res.status(200).json({
      success: true,
      id: savedId,
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
