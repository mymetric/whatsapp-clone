const { setCors } = require('../lib/firebase-admin');
const crypto = require('crypto');

module.exports = async (req, res) => {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.REACT_APP_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || process.env.REACT_APP_FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || process.env.REACT_APP_FIREBASE_PRIVATE_KEY || '';

  // Mostrar info da chave sem expor a chave em si
  const rawLen = privateKey.length;
  privateKey = privateKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
  const processedLen = privateKey.length;
  const hasBegin = privateKey.includes('-----BEGIN');
  const hasEnd = privateKey.includes('-----END');
  const lineCount = privateKey.split('\n').length;
  const first50 = privateKey.substring(0, 50).replace(/[A-Za-z0-9+/=]/g, 'X');

  let keyValid = false;
  let keyError = '';
  try {
    const keyObj = crypto.createPrivateKey(privateKey);
    keyObj.export({ type: 'pkcs8', format: 'pem' });
    keyValid = true;
  } catch (e) {
    keyError = e.message;
  }

  const nodeVersion = process.version;
  const opensslVersion = crypto.constants ? 'OpenSSL 3+' : 'OpenSSL 1.x';

  res.json({
    nodeVersion,
    opensslVersion,
    projectId: projectId ? projectId.substring(0, 5) + '...' : 'MISSING',
    clientEmail: clientEmail ? clientEmail.substring(0, 10) + '...' : 'MISSING',
    privateKey: {
      rawLen,
      processedLen,
      hasBegin,
      hasEnd,
      lineCount,
      first50,
      keyValid,
      keyError: keyError || null,
    },
    envVarsPresent: {
      FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
      FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
      FIREBASE_PRIVATE_KEY_ID: !!process.env.FIREBASE_PRIVATE_KEY_ID,
      FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
      REACT_APP_FIREBASE_PROJECT_ID: !!process.env.REACT_APP_FIREBASE_PROJECT_ID,
      REACT_APP_FIREBASE_PRIVATE_KEY: !!process.env.REACT_APP_FIREBASE_PRIVATE_KEY,
    }
  });
};
