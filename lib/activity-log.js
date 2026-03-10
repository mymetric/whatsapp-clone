const { getDb } = require('./firebase-admin');

/**
 * Log an activity to Firestore collection 'activity_logs'
 */
async function logActivity({ action, userEmail, userName, metadata = {} }) {
  try {
    const db = getDb();
    if (!db) {
      console.warn('⚠️ [activity-log] Firebase não disponível, log ignorado');
      return;
    }

    await db.collection('activity_logs').add({
      action,
      userEmail: userEmail || 'unknown',
      userName: userName || 'unknown',
      metadata,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('⚠️ [activity-log] Erro ao salvar log:', err.message);
  }
}

/**
 * Extract user info from request.
 * 1) Try _user from request body (sent by frontend)
 * 2) Fallback to auth token -> Firestore session lookup
 */
async function getUserFromRequest(req) {
  // 1) Check _user in body (most reliable, sent by frontend)
  const bodyUser = req.body && req.body._user;
  if (bodyUser && bodyUser.email && bodyUser.email !== 'unknown') {
    return { email: bodyUser.email, name: bodyUser.name || 'unknown' };
  }

  // 2) Fallback: auth token -> Firestore session
  try {
    const authHeader = req.headers && req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { email: 'unknown', name: 'unknown' };
    }

    const token = authHeader.substring(7);
    const db = getDb();
    if (!db) return { email: 'unknown', name: 'unknown' };

    const sessionDoc = await db.collection('sessions').doc(token).get();
    if (!sessionDoc.exists) return { email: 'unknown', name: 'unknown' };

    const session = sessionDoc.data();
    return { email: session.email || 'unknown', name: session.name || 'unknown' };
  } catch (err) {
    console.error('⚠️ [activity-log] Erro ao buscar usuário:', err.message);
    return { email: 'unknown', name: 'unknown' };
  }
}

module.exports = { logActivity, getUserFromRequest };
