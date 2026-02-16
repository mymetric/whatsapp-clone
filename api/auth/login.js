const admin = require('firebase-admin');
const crypto = require('crypto');

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

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 horas

const ALL_PERMISSIONS = ['conversas-leads', 'file-processing', 'whatsapp', 'contencioso', 'prompts', 'admin'];

const DEFAULT_PERMISSIONS = {
  admin: ALL_PERMISSIONS,
  user: ['conversas-leads'],
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!firestoreDb) {
      firestoreDb = initFirebase();
    }

    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado' });
    }

    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    const userDoc = await firestoreDb.collection('users').doc(email).get();
    if (!userDoc.exists) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const userData = userDoc.data();
    if (userData.password !== password) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const permissions = userData.permissions || DEFAULT_PERMISSIONS[userData.role] || [];

    await firestoreDb.collection('sessions').doc(token).set({
      email: userData.email,
      name: userData.name,
      role: userData.role,
      permissions,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_TTL).toISOString(),
    });

    console.log(`✅ [auth] Login: ${email}`);

    return res.json({
      token,
      user: {
        email: userData.email,
        name: userData.name,
        role: userData.role,
        permissions,
      },
    });
  } catch (err) {
    console.error('❌ [auth] Erro no login:', err.message);
    return res.status(500).json({ error: 'Erro no login', details: err.message });
  }
};
