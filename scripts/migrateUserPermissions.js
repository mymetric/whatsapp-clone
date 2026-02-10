#!/usr/bin/env node
/**
 * Migration: Adiciona campo `permissions` a todos os usuários existentes no Firestore.
 * Idempotente — pode ser executado múltiplas vezes sem efeito colateral.
 *
 * Uso: node scripts/migrateUserPermissions.js
 */

const admin = require('firebase-admin');
require('dotenv').config();

const DEFAULT_PERMISSIONS = {
  admin: ['conversas-leads', 'file-processing', 'whatsapp', 'contencioso', 'prompts', 'admin'],
  user: ['conversas-leads'],
};

async function main() {
  // Inicializar Firebase
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.REACT_APP_FIREBASE_PROJECT_ID;
  const privateKeyId = process.env.FIREBASE_PRIVATE_KEY_ID || process.env.REACT_APP_FIREBASE_PRIVATE_KEY_ID;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || process.env.REACT_APP_FIREBASE_PRIVATE_KEY || '';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || process.env.REACT_APP_FIREBASE_CLIENT_EMAIL;

  if (!projectId || !privateKey || !clientEmail) {
    console.error('❌ Variáveis Firebase não configuradas. Configure no .env');
    process.exit(1);
  }

  privateKey = privateKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, privateKeyId, privateKey, clientEmail }),
    });
  }

  const db = admin.firestore();
  db.settings({ databaseId: 'messages' });

  console.log('🔄 Buscando usuários...');
  const snapshot = await db.collection('users').get();

  if (snapshot.empty) {
    console.log('ℹ️  Nenhum usuário encontrado.');
    process.exit(0);
  }

  let updated = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const email = doc.id;

    if (data.permissions && Array.isArray(data.permissions) && data.permissions.length > 0) {
      console.log(`⏭️  ${email} já possui permissions: [${data.permissions.join(', ')}]`);
      skipped++;
      continue;
    }

    const role = data.role || 'user';
    const permissions = DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.user;

    await doc.ref.update({ permissions });
    console.log(`✅ ${email} (${role}) → permissions: [${permissions.join(', ')}]`);
    updated++;
  }

  console.log(`\n📊 Resultado: ${updated} atualizado(s), ${skipped} já migrado(s), ${snapshot.size} total.`);
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Erro na migração:', err);
  process.exit(1);
});
