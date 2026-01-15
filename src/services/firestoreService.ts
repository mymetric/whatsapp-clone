import { Prompt } from './api';

interface ServiceAccount {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
  universe_domain: string;
}

interface CredentialsData {
  users?: any[];
  api?: any;
  firebase?: {
    projectId: string;
    serviceAccount: ServiceAccount;
  };
  grok?: any;
}

let accessToken: string | null = null;
let tokenExpiry: number = 0;

// Obter access token usando as credenciais do service account
const getAccessToken = async (serviceAccount: ServiceAccount): Promise<string> => {
  // Se o token ainda é válido, retornar
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  try {
    // Criar JWT para autenticação
    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };

    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: serviceAccount.token_uri,
      exp: now + 3600,
      iat: now
    };

    // Codificar JWT (simplificado - em produção use uma biblioteca)
    const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const encodedClaim = btoa(JSON.stringify(claim)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    
    // Para assinar o JWT, precisamos usar uma biblioteca ou fazer via API
    // Vou usar uma abordagem mais simples: fazer requisição direta ao Firestore REST API
    // usando autenticação via OAuth2
    
    // Por enquanto, vou usar uma abordagem que faz a autenticação via fetch
    const response = await fetch(serviceAccount.token_uri, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: await createJWT(serviceAccount)
      })
    });

    if (!response.ok) {
      throw new Error(`Erro ao obter token: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error('Access token não retornado na resposta');
    }
    const token: string = data.access_token;
    accessToken = token;
    tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // 1 minuto antes do expiry
    
    return token;
  } catch (error) {
    console.error('Erro ao obter access token:', error);
    throw error;
  }
};

// Criar JWT assinado (simplificado - em produção use crypto.subtle)
const createJWT = async (serviceAccount: ServiceAccount): Promise<string> => {
  // Para assinar JWT no navegador, precisamos usar Web Crypto API
  // Mas isso é complexo. Vou usar uma abordagem diferente:
  // Fazer requisições diretas ao Firestore REST API usando uma autenticação mais simples
  
  // Por enquanto, vou usar o Firebase Client SDK com as credenciais do projeto
  // e fazer as requisições ao database "messages" via REST API
  
  throw new Error('JWT signing not implemented in browser. Use Firebase Client SDK instead.');
};

// Carregar credenciais do Firebase
const loadFirebaseCredentials = async (): Promise<ServiceAccount> => {
  try {
    // Tentar primeiro com variáveis individuais (novo formato)
    const projectId = process.env.REACT_APP_FIREBASE_PROJECT_ID;
    const privateKeyId = process.env.REACT_APP_FIREBASE_PRIVATE_KEY_ID;
    const privateKey = process.env.REACT_APP_FIREBASE_PRIVATE_KEY;
    const clientEmail = process.env.REACT_APP_FIREBASE_CLIENT_EMAIL;
    
    if (projectId && privateKeyId && privateKey && clientEmail) {
      // Processar private_key: remover aspas e converter \n para quebras de linha reais
      const processedPrivateKey = privateKey
        .replace(/^["']|["']$/g, '') // Remove aspas no início e fim
        .replace(/\\n/g, '\n'); // Converte \n para quebra de linha real
      
      const serviceAccount: ServiceAccount = {
        type: 'service_account',
        project_id: projectId,
        private_key_id: privateKeyId,
        private_key: processedPrivateKey,
        client_email: clientEmail,
        client_id: '', // Não obrigatório para autenticação
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(clientEmail)}`,
        universe_domain: 'googleapis.com'
      };
      
      console.log('✅ Firebase service account carregado do .env (variáveis individuais)');
      return serviceAccount;
    }
    
    // Fallback: tentar com JSON completo (formato antigo)
    const serviceAccountJson = process.env.REACT_APP_FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
      const serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;
      console.log('✅ Firebase service account carregado do .env (JSON completo)');
      return serviceAccount;
    }
    
    throw new Error('Variáveis do Firebase não encontradas no .env. Configure REACT_APP_FIREBASE_PROJECT_ID, REACT_APP_FIREBASE_PRIVATE_KEY_ID, REACT_APP_FIREBASE_PRIVATE_KEY e REACT_APP_FIREBASE_CLIENT_EMAIL');
  } catch (error) {
    console.error('Erro ao carregar credenciais do Firebase:', error);
    throw error;
  }
};

// Fazer requisição ao Firestore REST API
const firestoreRequest = async (method: string, path: string, body?: any): Promise<any> => {
  try {
    const serviceAccount = await loadFirebaseCredentials();
    const projectId = serviceAccount.project_id;
    
    // Usar o Firestore REST API
    // Database: messages
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/messages/documents/${path}`;
    
    // Para autenticação, vamos usar o Firebase Client SDK que já instalamos
    // Mas como o Client SDK não suporta múltiplos databases, vou criar uma solução híbrida
    
    // Por enquanto, vou retornar um erro indicando que precisa usar o Client SDK
    // e salvar no database default, ou configurar um proxy backend
    
    throw new Error('Firestore REST API com service account requer backend. Use Firebase Client SDK ou configure um endpoint backend.');
  } catch (error) {
    console.error('Erro na requisição ao Firestore:', error);
    throw error;
  }
};

// Serviço simplificado usando Firebase Client SDK (database default)
// Nota: Para usar database "messages", é necessário backend com Admin SDK
export const firestorePromptService = {
  async getPrompts(): Promise<Prompt[]> {
    // Por enquanto, retornar erro indicando que precisa de backend
    // ou usar o database default
    throw new Error('Para salvar no database "messages", configure um backend com Firebase Admin SDK. Ou use o database default com Firebase Client SDK.');
  },

  async createPrompt(data: Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>): Promise<Prompt> {
    throw new Error('Para salvar no database "messages", configure um backend com Firebase Admin SDK.');
  },

  async updatePrompt(id: string, data: Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>): Promise<Prompt> {
    throw new Error('Para atualizar no database "messages", configure um backend com Firebase Admin SDK.');
  },

  async deletePrompt(id: string): Promise<void> {
    throw new Error('Para deletar no database "messages", configure um backend com Firebase Admin SDK.');
  }
};
