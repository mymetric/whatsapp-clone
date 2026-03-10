const { getDb, validateAuth } = require('./firebase-admin');

/**
 * Log an activity to Firestore collection 'activity_logs'
 *
 * @param {object} params
 * @param {string} params.action - 'message_sent' | 'ai_suggestion' | 'ai_contencioso' | 'login' | 'logout'
 * @param {string} params.userEmail - email of the user
 * @param {string} params.userName - name of the user
 * @param {object} [params.metadata] - extra data (phone, messageLength, model, etc.)
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
    // Never let logging break the main flow
    console.error('⚠️ [activity-log] Erro ao salvar log:', err.message);
  }
}

/**
 * Extract user info from request via auth token
 */
async function getUserFromRequest(req) {
  try {
    const session = await validateAuth(req);
    if (session) {
      return { email: session.email, name: session.name };
    }
  } catch { /* ignore */ }
  return { email: 'unknown', name: 'unknown' };
}

module.exports = { logActivity, getUserFromRequest };
