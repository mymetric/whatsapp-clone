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
    const response = await fetch('/credentials.json');
    const data: CredentialsData = await response.json();
    
    if (data.firebase?.serviceAccount) {
      return data.firebase.serviceAccount;
    }
    
    throw new Error('Service account não encontrado no credentials.json');
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

