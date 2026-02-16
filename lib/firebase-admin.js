const admin = require('firebase-admin');

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
        credential: admin.credential.cert({ projectId, privateKeyId, privateKey, clientEmail }),
      });
    }
    firestoreDb = admin.firestore();
    firestoreDb.settings({ databaseId: 'messages' });
    return firestoreDb;
  } catch (err) {
    console.error('❌ Erro ao inicializar Firebase:', err.message);
    return null;
  }
}

function getDb() {
  if (!firestoreDb) {
    firestoreDb = initFirebase();
  }
  return firestoreDb;
}

const SESSION_TTL = 24 * 60 * 60 * 1000;
const ALL_PERMISSIONS = ['conversas-leads', 'file-processing', 'whatsapp', 'contencioso', 'prompts', 'admin'];
const DEFAULT_PERMISSIONS = {
  admin: ALL_PERMISSIONS,
  user: ['conversas-leads'],
};

// Validate auth token and return user session data, or null
async function validateAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);
  const db = getDb();
  if (!db) return null;

  const sessionDoc = await db.collection('sessions').doc(token).get();
  if (!sessionDoc.exists) return null;

  const session = sessionDoc.data();
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
    await db.collection('sessions').doc(token).delete();
    return null;
  }

  return { ...session, token };
}

// CORS + OPTIONS helper
function setCors(res, methods = 'GET, POST, PUT, DELETE, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Helper: Resolver URL de arquivo de email
function resolveEmailFileUrl(fileValue) {
  if (!fileValue) return '';
  if (fileValue.startsWith('http://') || fileValue.startsWith('https://')) return fileValue;
  return `https://drive.google.com/uc?export=download&id=${fileValue}`;
}

// Helper: Extrair anexos de email_webhooks (campos file_001..file_020)
function extractEmailAttachments(emailData) {
  const attachments = [];
  for (let i = 1; i <= 20; i++) {
    const key = `file_${String(i).padStart(3, '0')}`;
    const val = emailData[key];
    if (!val || typeof val !== 'string') continue;
    if (val.startsWith('$') || val.includes('$request.')) continue;
    const resolved = resolveEmailFileUrl(val);
    if (!resolved) continue;
    attachments.push({ index: i - 1, url: resolved, rawValue: val, fieldKey: key });
  }
  return attachments;
}

// Helper: Classificar tipo de mídia
function classifyMediaType(mimeType) {
  if (!mimeType) return 'image';
  const m = mimeType.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (m === 'application/msword') return 'docx';
  if (m.startsWith('video/')) return 'image';
  return 'image';
}

module.exports = {
  admin,
  getDb,
  validateAuth,
  setCors,
  SESSION_TTL,
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  resolveEmailFileUrl,
  extractEmailAttachments,
  classifyMediaType,
};
