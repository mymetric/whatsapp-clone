const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Carregar service account do .env
let serviceAccount;
try {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  
  if (!serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT não encontrado no .env');
  }
  
  serviceAccount = JSON.parse(serviceAccountJson);
  console.log('✅ Firebase service account carregado do .env');
} catch (error) {
  console.error('❌ Erro ao carregar service account:', error.message);
  console.error('💡 Defina FIREBASE_SERVICE_ACCOUNT no .env');
  process.exit(1);
}

// Carregar usuários do .env (variável USERS_JSON) ou usar array vazio
let users = [];
try {
  const usersJson = process.env.USERS_JSON;
  
  if (usersJson) {
    users = JSON.parse(usersJson);
    console.log(`✅ ${users.length} usuário(s) carregado(s) do .env`);
  } else {
    console.warn('⚠️ USERS_JSON não encontrado no .env.');
    console.warn('💡 Os usuários devem estar no Firestore. Este script é usado apenas para adicionar usuários iniciais.');
    console.warn('💡 Para adicionar usuários via script, defina USERS_JSON no .env com um array JSON de usuários.');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Erro ao carregar usuários:', error.message);
  process.exit(1);
}

const projectId = serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID || 'zapy-306602';
const databaseId = 'messages'; // Database específico

// Inicializar Google Auth
const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ['https://www.googleapis.com/auth/datastore']
});

// Função para obter access token
async function getAccessToken() {
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  return accessToken.token;
}

// Função para converter valor para formato Firestore
function toFirestoreValue(value) {
  if (value === null) {
    return { nullValue: null };
  } else if (typeof value === 'string') {
    return { stringValue: value };
  } else if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { integerValue: value.toString() };
    } else {
      return { doubleValue: value };
    }
  } else if (typeof value === 'boolean') {
    return { booleanValue: value };
  } else if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  } else if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  } else if (typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toFirestoreValue(v)])) } };
  }
  return { stringValue: String(value) };
}

// Função para fazer requisição ao Firestore REST API
async function firestoreRequest(method, path, body = null) {
  const token = await getAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${path}`;
  
  const config = {
    method,
    url,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  
  if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    config.data = body;
  }
  
  try {
    const response = await axios(config);
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(`Firestore API error: ${error.response.status} ${error.response.statusText} - ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

// Função para adicionar usuários ao Firestore
async function addUsersToFirestore() {
  const collectionName = 'users';
  
  console.log(`\n📝 Adicionando ${users.length} usuário(s) ao Firestore (database: ${databaseId})...\n`);
  
  for (const user of users) {
    try {
      const documentPath = `${collectionName}/${user.email}`;
      const now = new Date().toISOString();
      
      // Preparar dados do documento
      const documentData = {
        fields: {
          email: toFirestoreValue(user.email),
          password: toFirestoreValue(user.password),
          name: toFirestoreValue(user.name),
          role: toFirestoreValue(user.role),
          updatedAt: toFirestoreValue(now)
        }
      };
      
      // Tentar obter o documento existente
      let documentExists = false;
      try {
        await firestoreRequest('GET', documentPath);
        documentExists = true;
      } catch (error) {
        // Se o erro for 404, o documento não existe
        if (error.message.includes('404') || error.message.includes('NOT_FOUND')) {
          documentExists = false;
        } else {
          throw error;
        }
      }
      
      if (documentExists) {
        // Atualizar documento existente usando PATCH
        await firestoreRequest('PATCH', documentPath, {
          fields: {
            email: toFirestoreValue(user.email),
            password: toFirestoreValue(user.password),
            name: toFirestoreValue(user.name),
            role: toFirestoreValue(user.role),
            updatedAt: toFirestoreValue(now)
          }
        });
        console.log(`✅ Usuário atualizado: ${user.email} (${user.name})`);
      } else {
        // Criar novo documento usando POST com documentId
        documentData.fields.createdAt = toFirestoreValue(now);
        // Para criar com ID específico, usamos PATCH em vez de POST
        await firestoreRequest('PATCH', documentPath, {
          fields: documentData.fields
        });
        console.log(`✅ Usuário criado: ${user.email} (${user.name})`);
      }
    } catch (error) {
      console.error(`❌ Erro ao adicionar usuário ${user.email}:`, error.message);
    }
  }
  
  console.log(`\n✨ Processo concluído! ${users.length} usuário(s) processado(s).\n`);
}

// Executar
addUsersToFirestore()
  .then(() => {
    console.log('✅ Script executado com sucesso!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Erro ao executar script:', error);
    process.exit(1);
  });
