import { Prompt } from './api';
import { KJUR } from 'jsrsasign';

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

let accessToken: string | null = null;
let tokenExpiry: number = 0;

// Tipo básico para anexos de processo. Ajuste os campos conforme a estrutura real dos documentos.
export interface Attachment {
  id: string;
  lawsuitId: string;
  file_url?: string;
  attachment_name?: string;
  // Campos adicionais permanecem abertos
  [key: string]: any;
}

// Carregar credenciais do Firebase
const loadFirebaseCredentials = async (): Promise<ServiceAccount> => {
  try {
    // Tentar primeiro com variáveis individuais (novo formato)
    const projectId = process.env.REACT_APP_FIREBASE_PROJECT_ID;
    const privateKeyId = process.env.REACT_APP_FIREBASE_PRIVATE_KEY_ID;
    const privateKey = process.env.REACT_APP_FIREBASE_PRIVATE_KEY;
    const clientEmail = process.env.REACT_APP_FIREBASE_CLIENT_EMAIL;
    
    // Debug: verificar quais variáveis estão disponíveis
    console.log('🔍 Debug Firebase credentials:', {
      hasProjectId: !!projectId,
      hasPrivateKeyId: !!privateKeyId,
      hasPrivateKey: !!privateKey,
      hasClientEmail: !!clientEmail,
      projectId: projectId || 'undefined',
      privateKeyId: privateKeyId || 'undefined',
      privateKeyPreview: privateKey ? privateKey.substring(0, 50) + '...' : 'undefined',
      clientEmail: clientEmail || 'undefined'
    });
    
    if (projectId && privateKeyId && privateKey && clientEmail) {
      // Processar private_key: remover aspas e converter \n para quebras de linha reais
      let processedPrivateKey = privateKey.trim();
      // Remove aspas no início e fim (pode ter aspas simples ou duplas)
      processedPrivateKey = processedPrivateKey.replace(/^["']+|["']+$/g, '');
      // Converte \n para quebra de linha real
      processedPrivateKey = processedPrivateKey.replace(/\\n/g, '\n');
      
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

// Obter access token usando JWT e OAuth2
const getAccessToken = async (serviceAccount: ServiceAccount): Promise<string> => {
  // Se o token ainda é válido, retornar
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  try {
    // Criar JWT
    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };

    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: serviceAccount.client_email,
      sub: serviceAccount.client_email,
      aud: serviceAccount.token_uri,
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/datastore'
    };

    // Assinar JWT usando jsrsasign (funciona em HTTP e HTTPS)
    const signedJWT = signJWT(header, claim, serviceAccount.private_key);

    // Trocar JWT por access token
    const response = await fetch(serviceAccount.token_uri, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signedJWT
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao obter token: ${response.status} ${errorText}`);
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

// Assinar JWT usando jsrsasign (funciona em qualquer contexto, incluindo HTTP)
const signJWT = (header: any, payload: any, privateKey: string): string => {
  try {
    // Criar JWT usando jsrsasign
    const sHeader = JSON.stringify(header);
    const sPayload = JSON.stringify(payload);
    
    // Assinar JWT
    const sJWT = KJUR.jws.JWS.sign('RS256', sHeader, sPayload, privateKey);
    
    return sJWT;
  } catch (error) {
    console.error('Erro ao assinar JWT:', error);
    throw new Error('Falha ao assinar JWT');
  }
};

// Fazer requisição ao Firestore REST API (endpoint documents)
const firestoreRequest = async (method: string, path: string, body?: any): Promise<any> => {
  const serviceAccount = await loadFirebaseCredentials();
  const projectId = serviceAccount.project_id;
  const token = await getAccessToken(serviceAccount);
  
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/messages/documents/${path}`;
  
  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  
  if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Firestore API error: ${response.status} ${response.statusText} - ${errorText}`);
  }
  
  if (method === 'DELETE') {
    return null;
  }
  
  return await response.json();
};

// Endpoint genérico de consultas (runQuery) no Firestore
const firestoreRunQuery = async (structuredQuery: any): Promise<any[]> => {
  const serviceAccount = await loadFirebaseCredentials();
  const projectId = serviceAccount.project_id;
  const token = await getAccessToken(serviceAccount);

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/messages/documents:runQuery`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ structuredQuery })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Firestore runQuery error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
};

// Converter documento do Firestore para Prompt
const firestoreDocToPrompt = (doc: any): Prompt => {
  const fields = doc.fields || {};
  const docId = doc.name.split('/').pop() || '';
  
  return {
    id: docId,
    name: fields.name?.stringValue || '',
    description: fields.description?.stringValue || '',
    content: fields.content?.stringValue || '',
    createdAt: fields.createdAt?.stringValue || new Date().toISOString(),
    updatedAt: fields.updatedAt?.stringValue || new Date().toISOString()
  };
};

// Converter Prompt para documento do Firestore
const promptToFirestoreDoc = (prompt: Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>): any => {
  return {
    fields: {
      name: { stringValue: prompt.name },
      description: prompt.description ? { stringValue: prompt.description } : { nullValue: null },
      content: { stringValue: prompt.content },
      createdAt: { stringValue: new Date().toISOString() },
      updatedAt: { stringValue: new Date().toISOString() }
    }
  };
};

// Serviço para gerenciar prompts no Firestore usando REST API
export const firestoreRestPromptService = {
  async getPrompts(): Promise<Prompt[]> {
    try {
      const data = await firestoreRequest('GET', 'prompts');
      
      const prompts: Prompt[] = [];
      if (data.documents) {
        data.documents.forEach((doc: any) => {
          prompts.push(firestoreDocToPrompt(doc));
        });
      }
      
      console.log('✅ Prompts carregados do Firestore (database: messages):', prompts);
      return prompts;
    } catch (error) {
      console.error('❌ Erro ao carregar prompts do Firestore:', error);
      throw error;
    }
  },

  async createPrompt(data: Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>): Promise<Prompt> {
    try {
      const docData = promptToFirestoreDoc(data);
      const response = await firestoreRequest('POST', 'prompts', docData);
      
      const newPrompt = firestoreDocToPrompt(response);
      console.log('✅ Prompt criado no Firestore (database: messages):', newPrompt);
      return newPrompt;
    } catch (error) {
      console.error('❌ Erro ao criar prompt no Firestore:', error);
      throw error;
    }
  },

  async updatePrompt(id: string, data: Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>): Promise<Prompt> {
    try {
      const docData = promptToFirestoreDoc(data);
      docData.fields.updatedAt = { stringValue: new Date().toISOString() };
      
      // Firestore REST API usa PATCH com updateMask como query parameter
      const serviceAccount = await loadFirebaseCredentials();
      const projectId = serviceAccount.project_id;
      const token = await getAccessToken(serviceAccount);
      
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/messages/documents/prompts/${id}?updateMask.fieldPaths=name&updateMask.fieldPaths=description&updateMask.fieldPaths=content&updateMask.fieldPaths=updatedAt`;
      
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(docData)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Firestore API error: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const result = await response.json();
      const updatedPrompt = firestoreDocToPrompt(result);
      console.log('✅ Prompt atualizado no Firestore (database: messages):', updatedPrompt);
      return updatedPrompt;
    } catch (error) {
      console.error('❌ Erro ao atualizar prompt no Firestore:', error);
      throw error;
    }
  },

  async deletePrompt(id: string): Promise<void> {
    try {
      await firestoreRequest('DELETE', `prompts/${id}`);
      console.log('✅ Prompt deletado do Firestore (database: messages)');
    } catch (error) {
      console.error('❌ Erro ao deletar prompt do Firestore:', error);
      throw error;
    }
  }
};

// Converter documento do Firestore para Attachment
const firestoreDocToAttachment = (doc: any): Attachment => {
  const fields = doc.fields || {};
  const docId = doc.name.split('/').pop() || '';

  return {
    id: docId,
    lawsuitId: fields.lawsuit_id?.stringValue || '',
    // Mantém todos os campos originais disponíveis
    ...Object.keys(fields).reduce((acc: any, key: string) => {
      const value = fields[key];
      if ('stringValue' in value) acc[key] = value.stringValue;
      else if ('integerValue' in value) acc[key] = Number(value.integerValue);
      else if ('booleanValue' in value) acc[key] = value.booleanValue;
      else if ('doubleValue' in value) acc[key] = value.doubleValue;
      else acc[key] = value;
      return acc;
    }, {})
  };
};

// Serviço para anexos (coleção attachments no database messages)
export const firestoreRestAttachmentService = {
  // Buscar anexos de um processo pelo campo lawsuit_id
  async getAttachmentsByLawsuitId(lawsuitId: string): Promise<Attachment[]> {
    if (!lawsuitId) {
      return [];
    }

    const structuredQuery = {
      from: [{ collectionId: 'attachments' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'lawsuit_id' },
          op: 'EQUAL',
          value: { stringValue: lawsuitId }
        }
      }
    };

    const results = await firestoreRunQuery(structuredQuery);

    const attachments: Attachment[] = [];
    for (const row of results) {
      if (row.document) {
        attachments.push(firestoreDocToAttachment(row.document));
      }
    }

    return attachments;
  }
};

// Serviço para gerenciar prompts de contencioso (coleção contencioso_prompts no database messages)
export const firestoreRestContenciosoPromptService = {
  async getPrompts(): Promise<Prompt[]> {
    try {
      const data = await firestoreRequest('GET', 'contencioso_prompts');
      
      const prompts: Prompt[] = [];
      if (data.documents) {
        data.documents.forEach((doc: any) => {
          prompts.push(firestoreDocToPrompt(doc));
        });
      }
      
      console.log('✅ Prompts de contencioso carregados do Firestore (database: messages):', prompts);
      return prompts;
    } catch (error) {
      console.error('❌ Erro ao carregar prompts de contencioso do Firestore:', error);
      throw error;
    }
  },

  async createPrompt(data: Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>): Promise<Prompt> {
    try {
      const docData = promptToFirestoreDoc(data);
      const response = await firestoreRequest('POST', 'contencioso_prompts', docData);
      
      const newPrompt = firestoreDocToPrompt(response);
      console.log('✅ Prompt de contencioso criado no Firestore (database: messages):', newPrompt);
      return newPrompt;
    } catch (error) {
      console.error('❌ Erro ao criar prompt de contencioso no Firestore:', error);
      throw error;
    }
  },

  async updatePrompt(id: string, data: Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>): Promise<Prompt> {
    try {
      const docData = promptToFirestoreDoc(data);
      docData.fields.updatedAt = { stringValue: new Date().toISOString() };
      
      const serviceAccount = await loadFirebaseCredentials();
      const projectId = serviceAccount.project_id;
      const token = await getAccessToken(serviceAccount);
      
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/messages/documents/contencioso_prompts/${id}?updateMask.fieldPaths=name&updateMask.fieldPaths=description&updateMask.fieldPaths=content&updateMask.fieldPaths=updatedAt`;
      
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(docData)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Firestore API error: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const result = await response.json();
      const updatedPrompt = firestoreDocToPrompt(result);
      console.log('✅ Prompt de contencioso atualizado no Firestore (database: messages):', updatedPrompt);
      return updatedPrompt;
    } catch (error) {
      console.error('❌ Erro ao atualizar prompt de contencioso no Firestore:', error);
      throw error;
    }
  },

  async deletePrompt(id: string): Promise<void> {
    try {
      await firestoreRequest('DELETE', `contencioso_prompts/${id}`);
      console.log('✅ Prompt de contencioso deletado do Firestore (database: messages)');
    } catch (error) {
      console.error('❌ Erro ao deletar prompt de contencioso do Firestore:', error);
      throw error;
    }
  }
};

// Converter documento do Firestore para User
const firestoreDocToUser = (doc: any): any => {
  const fields = doc.fields || {};
  const docId = doc.name.split('/').pop() || '';
  
  return {
    email: fields.email?.stringValue || docId, // Usa docId como fallback (que é o email)
    password: fields.password?.stringValue || '',
    name: fields.name?.stringValue || '',
    role: (fields.role?.stringValue || 'user') as 'admin' | 'user'
  };
};

// Serviço para buscar usuários do Firestore
export const firestoreRestUserService = {
  async getUsers(): Promise<any[]> {
    try {
      const data = await firestoreRequest('GET', 'users');
      
      const users: any[] = [];
      if (data.documents) {
        data.documents.forEach((doc: any) => {
          users.push(firestoreDocToUser(doc));
        });
      }
      
      console.log('✅ Usuários carregados do Firestore (database: messages):', users.length);
      return users;
    } catch (error) {
      console.error('❌ Erro ao carregar usuários do Firestore:', error);
      throw error;
    }
  },

  async getUserByEmail(email: string): Promise<any | null> {
    try {
      const data = await firestoreRequest('GET', `users/${email}`);
      return firestoreDocToUser(data);
    } catch (error: any) {
      // Se o documento não existir (404), retorna null
      if (error.message?.includes('404') || error.message?.includes('NOT_FOUND')) {
        return null;
      }
      console.error('❌ Erro ao buscar usuário do Firestore:', error);
      throw error;
    }
  }
};

// Serviço para gerenciar estado de IA dos telefones (collection phones_answered_by_ai)
export const firestoreRestPhoneAIService = {
  // Normalizar número de telefone para usar como document ID
  normalizePhoneNumber(phone: string): string {
    // Remove o + e caracteres especiais, mantém apenas números
    return phone.replace(/[^0-9]/g, '');
  },

  // Buscar estado de IA de um telefone
  async getAIStatus(phone: string): Promise<boolean | null> {
    try {
      const phoneId = this.normalizePhoneNumber(phone);
      const data = await firestoreRequest('GET', `phones_answered_by_ai/${phoneId}`);
      
      const fields = data.fields || {};
      const aiActive = fields.ai_active?.booleanValue;
      
      return aiActive === true || aiActive === false ? aiActive : null;
    } catch (error: any) {
      // Se o documento não existir (404), retorna null
      if (error.message?.includes('404') || error.message?.includes('NOT_FOUND')) {
        return null;
      }
      console.error('❌ Erro ao buscar estado de IA do telefone:', error);
      throw error;
    }
  },

  // Salvar/atualizar estado de IA de um telefone
  async setAIStatus(phone: string, aiActive: boolean): Promise<void> {
    try {
      const phoneId = this.normalizePhoneNumber(phone);
      
      const docData = {
        fields: {
          ai_active: { booleanValue: aiActive },
          updatedAt: { stringValue: new Date().toISOString() }
        }
      };

      // Tentar atualizar primeiro (PATCH)
      try {
        const serviceAccount = await loadFirebaseCredentials();
        const projectId = serviceAccount.project_id;
        const token = await getAccessToken(serviceAccount);
        
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/messages/documents/phones_answered_by_ai/${phoneId}?updateMask.fieldPaths=ai_active&updateMask.fieldPaths=updatedAt`;
        
        const response = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(docData)
        });

        if (response.ok) {
          console.log(`✅ Estado de IA atualizado para telefone ${phoneId}: ${aiActive}`);
          return;
        }
      } catch (updateError) {
        // Se falhar, tentar criar (POST)
        console.log(`⚠️ Tentando criar documento para telefone ${phoneId}`);
      }

      // Se não existir, criar novo documento (POST)
      await firestoreRequest('POST', `phones_answered_by_ai`, {
        documentId: phoneId,
        ...docData
      });
      
      console.log(`✅ Estado de IA criado para telefone ${phoneId}: ${aiActive}`);
    } catch (error) {
      console.error('❌ Erro ao salvar estado de IA do telefone:', error);
      throw error;
    }
  }
};