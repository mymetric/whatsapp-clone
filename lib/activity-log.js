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
 * Extract user info from request via auth token.
 * Reads session directly from Firestore to avoid Firebase init conflicts.
 */
async function getUserFromRequest(req) {
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
