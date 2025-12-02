import axios from 'axios';
import { Phone, Message, DocumentRecord, DocumentImage } from '../types';
// Importar serviço do Firestore REST API
import { firestoreRestPromptService } from './firestoreRestService';

interface ApiConfig {
  baseUrl: string;
  apiKey: string;
}

let apiConfig: ApiConfig | null = null;

// Carregar configurações da API do credentials.json
const loadApiConfig = async (): Promise<ApiConfig> => {
  if (apiConfig) return apiConfig;
  
  try {
    console.log('Tentando carregar credentials.json...');
    const response = await fetch('/credentials.json');
    console.log('Status da resposta do credentials.json:', response.status);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Dados carregados do credentials.json:', data);
    
    if (!data.api || !data.api.baseUrl || !data.api.apiKey) {
      throw new Error('Estrutura inválida do credentials.json');
    }
    
    apiConfig = {
      baseUrl: data.api.baseUrl,
      apiKey: data.api.apiKey
    };
    console.log('Configuração da API carregada:', apiConfig);
    return apiConfig;
  } catch (error) {
    console.error('Erro ao carregar configurações da API:', error);
    console.error('Usando fallback para desenvolvimento');
    // Fallback para desenvolvimento
    return {
      baseUrl: 'https://api.exemplo.com/webhook/api',
      apiKey: 'sua-api-key-aqui'
    };
  }
};

const createApiClient = async () => {
  const config = await loadApiConfig();
  return axios.create({
    baseURL: config.baseUrl,
    headers: {
      'apikey': config.apiKey
    }
  });
};

// Interface para sugestão de IA
interface AISuggestion {
  _name: string;
  _id: string;
  _createTime: string;
  _updateTime: string;
  message: string;
  chat_phone: string;
  last_message: string;
}

// Prompts da IA
export interface Prompt {
  id: string;
  name: string;
  description?: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
}

export const phoneService = {
  async getPhones(): Promise<Phone[]> {
    try {
      const api = await createApiClient();
      const config = await loadApiConfig();
      console.log('Fazendo requisição para:', `${config.baseUrl}/phones`);
      const response = await api.get('/phones');
      console.log('Status da resposta:', response.status);
      console.log('Headers da resposta:', response.headers);
      console.log('Resposta da API (completa):', response);
      console.log('Tipo de response.data:', typeof response.data);
      console.log('É array?', Array.isArray(response.data));
      console.log('Resposta da API (data):', response.data);
      
      // Debug: Verificar estrutura dos dados
      if (Array.isArray(response.data) && response.data.length > 0) {
        console.log('Primeiro item da API:', response.data[0]);
        console.log('Campos disponíveis no primeiro item:', response.data[0]?.document?.fields);
      }
      
      // Verificar se response.data é um array
      if (!Array.isArray(response.data)) {
        console.error('Erro: response.data não é um array:', response.data);
        return [];
      }
      
      // Transformar os dados da API no formato esperado pela aplicação
      const phones: Phone[] = response.data.map((item) => {
        // Função auxiliar para extrair valor de campo (pode ser stringValue, integerValue, etc)
        const getFieldValue = (field: any): string | undefined => {
          if (!field) return undefined;
          if (field.stringValue !== undefined) return String(field.stringValue);
          if (field.integerValue !== undefined) return String(field.integerValue);
          if (field.doubleValue !== undefined) return String(field.doubleValue);
          return undefined;
        };
        
        const phone = {
          _name: item.document.name,
          _id: item.document.id,
          _createTime: item.document.createTime,
          _updateTime: item.document.updateTime,
          last_message: item.document.fields.last_message?.integerValue || '',
          lead_name: getFieldValue(item.document.fields.lead_name),
          email: getFieldValue(item.document.fields.email),
          etiqueta: getFieldValue(item.document.fields.etiqueta),
          status: getFieldValue(item.document.fields.status),
          board: getFieldValue(item.document.fields.board),
          pulse_id: getFieldValue(item.document.fields.pulse_id),
          board_id: getFieldValue(item.document.fields.board_id)
        };
        
        // Debug: Log específico para Monday.com
        if (phone.pulse_id || phone.board_id) {
          console.log(`Phone ${phone._id} tem dados do Monday:`, {
            pulse_id: phone.pulse_id,
            board_id: phone.board_id,
            lead_name: phone.lead_name
          });
        }
        
        return phone;
      });
      
      console.log('Dados transformados:', phones);
      return phones;
    } catch (error) {
      console.error('Erro na requisição da API:', error);
      
      // Verificar se é um erro do axios
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as any;
        console.error('Detalhes do erro:', {
          message: axiosError.message,
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          data: axiosError.response?.data
        });
      } else {
        console.error('Erro desconhecido:', error);
      }
      
      throw error;
    }
  }
};

export const messageService = {
  async getMessages(phone: string): Promise<Message[]> {
    try {
      const api = await createApiClient();
      console.log('Fazendo requisição para mensagens do telefone:', phone);
      const response = await api.get<Message[]>(`/messages?phone=%2B${phone}`);
      console.log('Resposta da API de mensagens:', response.data);
      return response.data;
    } catch (error) {
      console.error('Erro na requisição de mensagens:', error);
      throw error;
    }
  }
};

export const emailService = {
  async getEmailByEmail(email: string): Promise<any> {
    try {
      console.log('🔍 Buscando email por email:', email);
      console.log('📡 URL da requisição:', `https://n8n.rosenbaum.adv.br/webhook/api/emails?email=${encodeURIComponent(email)}`);
      const response = await axios.get(`https://n8n.rosenbaum.adv.br/webhook/api/emails?email=${encodeURIComponent(email)}`, {
        headers: {
          'apikey': 'YY2pHUzcGUFKBmZ'
        }
      });
      console.log('✅ Resposta da API de email:', response.data);
      // A API retorna um objeto com destination e sender
      const data = response.data as any;
      if (data && data.destination && Array.isArray(data.destination) && data.destination.length > 0) {
        console.log('📧 Emails encontrados:', data.destination.length);
        return data; // Retorna a resposta completa da API
      }
      return undefined;
    } catch (error) {
      console.error('❌ Erro ao buscar email:', error);
      // Retorna undefined em caso de erro para não quebrar a aplicação
      return undefined;
    }
  },

  async getEmailByPhone(phone: string): Promise<any> {
    try {
      console.log('🔍 Buscando email por telefone:', phone);
      console.log('📡 URL da requisição:', `https://n8n.rosenbaum.adv.br/webhook/api/emails?phone=${encodeURIComponent(phone)}`);
      const response = await axios.get(`https://n8n.rosenbaum.adv.br/webhook/api/emails?phone=${encodeURIComponent(phone)}`, {
        headers: {
          'apikey': 'YY2pHUzcGUFKBmZ'
        }
      });
      console.log('✅ Resposta da API de email por telefone:', response.data);
      // A API retorna um objeto com destination e sender
      const data = response.data as any;
      if (data && data.destination && Array.isArray(data.destination) && data.destination.length > 0) {
        const email = data.destination[0].destination;
        console.log('📧 Email encontrado por telefone:', email);
        return email; // Retorna apenas o email
      }
      return undefined;
    } catch (error) {
      console.error('❌ Erro ao buscar email por telefone:', error);
      return undefined;
    }
  },

  async getEmailForContact(phone: Phone): Promise<string | undefined> {
    try {
      console.log('📞 Iniciando busca de email para contato:', {
        id: phone._id,
        name: phone.lead_name,
        existingEmail: phone.email
      });

      // Se já tem email nos dados, buscar emails trocados
      if (phone.email) {
        console.log('📧 Email encontrado, buscando emails trocados:', phone.email);
        try {
          const emailData = await this.getEmailByEmail(phone.email);
          if (emailData) {
            console.log('✅ Emails trocados encontrados:', emailData);
            // Retorna a resposta completa da API (com destination e sender)
            return emailData;
          }
        } catch (error) {
          console.error('❌ Erro ao buscar emails trocados:', error);
        }
        return phone.email; // Fallback para email original
      }

      console.log('❌ Nenhum email encontrado para o contato');
      return undefined;
    } catch (error) {
      console.error('❌ Erro ao buscar email para contato:', error);
      return undefined;
    }
  }
};

export const aiSuggestionService = {
  async getLastAISuggestion(phone: string): Promise<AISuggestion | null> {
    try {
      const api = await createApiClient();
      console.log('Fazendo requisição para sugestão de IA do telefone:', phone);
      const response = await api.get<AISuggestion[]>(`/last_ai_suggestion?phone=%2B${phone}`);
      console.log('Resposta da API de sugestão de IA:', response.data);
      
      // Retorna a primeira sugestão se existir, senão null
      return response.data.length > 0 ? response.data[0] : null;
    } catch (error) {
      console.error('Erro na requisição de sugestão de IA:', error);
      return null;
    }
  }
};

// CRUD de prompts (coleção "prompts" no backend/messages - Firestore database "messages")
const STORAGE_KEY = 'ai_prompts';

export const promptService = {
  async getPrompts(): Promise<Prompt[]> {
    // Usar Firestore REST API diretamente com as credenciais do service account
    try {
      return await firestoreRestPromptService.getPrompts();
    } catch (error: any) {
      console.error('❌ Erro ao carregar prompts do Firestore:', error);
      // Fallback para localStorage
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          return JSON.parse(stored);
        }
      } catch (storageError) {
        console.error('Erro ao ler prompts do localStorage:', storageError);
      }
      return [];
    }
  },

  async createPrompt(data: Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>): Promise<Prompt> {
    // Usar Firestore REST API diretamente
    try {
      return await firestoreRestPromptService.createPrompt(data);
    } catch (error: any) {
      console.error('❌ Erro ao salvar prompt no Firestore:', error);
      throw new Error(`Erro ao salvar prompt: ${error.message || 'Erro desconhecido'}`);
    }
  },

  async updatePrompt(
    id: string,
    data: Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Prompt> {
    // Usar Firestore REST API diretamente
    try {
      return await firestoreRestPromptService.updatePrompt(id, data);
    } catch (error: any) {
      console.error('❌ Erro ao atualizar prompt no Firestore:', error);
      throw new Error(`Erro ao atualizar prompt: ${error.message || 'Erro desconhecido'}`);
    }
  },

  async deletePrompt(id: string): Promise<void> {
    // Usar Firestore REST API diretamente
    try {
      return await firestoreRestPromptService.deletePrompt(id);
    } catch (error: any) {
      console.error('❌ Erro ao deletar prompt do Firestore:', error);
      throw new Error(`Erro ao deletar prompt: ${error.message || 'Erro desconhecido'}`);
    }
  }
};

const DOCUMENTS_BASE_URL = 'https://n8n.rosenbaum.adv.br/webhook/api/documents';
const EXTERNAL_API_HEADERS = {
  apikey: 'YY2pHUzcGUFKBmZ'
};

const buildDriveUrl = (fileId: string) => {
  if (!fileId) return '';
  if (fileId.startsWith('http')) return fileId;
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
};

const parseImagesFromField = (field: any): DocumentImage[] => {
  if (!field) return [];

  const normalizeArray = (value: any): any[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'object') return [value];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') return [parsed];
      } catch {
        // Quando é apenas uma URL/ID simples, tratamos como um objeto com campo file
        return [{ file: trimmed }];
      }
    }
    return [];
  };

  const items = normalizeArray(field);

  return items
    .map((item) => {
      if (!item) return null;
      // Para exibição, priorizamos sempre o campo `file`
      const fileId = item.file || item.fileId || item.id || item.url || item.link;
      if (!fileId) return null;
      return {
        fileId: String(fileId),
        url: buildDriveUrl(String(fileId)),
        extractedText: typeof item.extracted_text === 'string' ? item.extracted_text : undefined,
        raw: item
      } as DocumentImage;
    })
    .filter((image): image is DocumentImage => Boolean(image));
};

const normalizeDocumentRecord = (
  doc: any,
  origin: 'email' | 'phone',
  direction?: 'sent' | 'received'
): DocumentRecord | null => {
  if (!doc || typeof doc !== 'object' || Object.keys(doc).length === 0) {
    return null;
  }

  const audioValue = doc.audio;
  if (
    audioValue === true ||
    (typeof audioValue === 'string' && audioValue.toLowerCase() === 'true')
  ) {
    return null;
  }

  const images: DocumentImage[] = [
    ...parseImagesFromField(doc.images),
    ...parseImagesFromField(doc.image),
    ...parseImagesFromField(doc.files),
    // Novo formato da API de documentos: usamos apenas o campo processado `file`
    ...parseImagesFromField(doc.file)
  ];

  const metadata: Record<string, any> = {};

  ['sender', 'destination', 'subject', 'email', 'phone', 'timestamp'].forEach((key) => {
    if (doc[key] !== undefined) {
      metadata[key] = doc[key];
    }
  });

  const id =
    doc._id ||
    doc._name ||
    doc.id ||
    doc.name ||
    `${origin}-${direction ?? 'document'}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    id: String(id),
    name: doc.name || doc.subject || doc._name,
    createdAt: doc._createTime || doc.createTime || doc.createdAt,
    updatedAt: doc._updateTime || doc.updateTime || doc.updatedAt,
    text:
      typeof doc.text === 'string'
        ? doc.text
        : typeof doc.content === 'string'
        ? doc.content
        : typeof doc.extracted_text === 'string'
        ? doc.extracted_text
        : undefined,
    origin,
    direction,
    images,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    raw: doc
  };
};

const sanitizePhone = (phone: string) => {
  if (!phone) return phone;
  return phone.startsWith('+') ? phone : `+${phone}`;
};

export interface DocumentAnalysis {
  _name: string;
  _id: string;
  _createTime: string;
  _updateTime: string;
  last_update: string;
  analise: string;
  checklist: string;
}

export const documentService = {
  async getDocumentAnalysis(pulseId: string): Promise<DocumentAnalysis | null> {
    if (!pulseId) return null;

    try {
      const response = await axios.get(`${DOCUMENTS_BASE_URL}/analysis`, {
        params: { id: pulseId },
        headers: EXTERNAL_API_HEADERS
      });

      if (Array.isArray(response.data) && response.data.length > 0) {
        return response.data[0] as DocumentAnalysis;
      }

      return null;
    } catch (error) {
      console.error('❌ Erro ao buscar análise de documentos:', error);
      return null;
    }
  },

  async generateDocumentAnalysis(pulseId: string): Promise<boolean> {
    if (!pulseId) return false;

    try {
      // Usa URL completa como outras requisições externas
      const response = await axios.post(
        'https://n8n.rosenbaum.adv.br/webhook/entrou-em-analises',
        {
          event: {
            pulseId: pulseId
          }
        },
        {
          headers: {
            ...EXTERNAL_API_HEADERS,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('✅ Análise gerada com sucesso:', response.data);
      return true;
    } catch (error) {
      console.error('❌ Erro ao gerar análise de documentos:', error);
      throw error;
    }
  },

  async getDocumentsByEmail(email: string): Promise<DocumentRecord[]> {
    if (!email) return [];

    try {
      const response = await axios.get(`${DOCUMENTS_BASE_URL}/email`, {
        params: { email },
        headers: EXTERNAL_API_HEADERS
      });

      const payload = response.data;
      if (!Array.isArray(payload)) {
        return [];
      }

      const documents: DocumentRecord[] = [];

      payload.forEach((item: any) => {
        if (!item || typeof item !== 'object') return;

        const processField = (field: any, direction: 'sent' | 'received') => {
          if (!field) return;
          if (Array.isArray(field)) {
            field.forEach((docItem) => {
              const normalized = normalizeDocumentRecord(docItem, 'email', direction);
              if (normalized) documents.push(normalized);
            });
          } else {
            const normalized = normalizeDocumentRecord(field, 'email', direction);
            if (normalized) documents.push(normalized);
          }
        };

        processField(item.sent, 'sent');
        processField(item.received, 'received');
      });

      return documents;
    } catch (error) {
      console.error('❌ Erro ao buscar documentos por email:', error);
      throw error;
    }
  },

  async getDocumentsByPhone(phone: string): Promise<DocumentRecord[]> {
    if (!phone) return [];

    const normalizedPhone = sanitizePhone(phone);

    try {
      const response = await axios.get(`${DOCUMENTS_BASE_URL}/phone`, {
        params: { phone: normalizedPhone },
        headers: EXTERNAL_API_HEADERS
      });

      const payload = response.data;
      if (!Array.isArray(payload)) {
        return [];
      }

      return payload
        .map((item: any) => normalizeDocumentRecord(item, 'phone'))
        .filter((doc): doc is DocumentRecord => Boolean(doc));
    } catch (error) {
      console.error('❌ Erro ao buscar documentos por telefone:', error);
      throw error;
    }
  },

  async getDocumentsForContact(phone: Phone): Promise<DocumentRecord[]> {
    if (!phone) return [];

    const tasks: Promise<DocumentRecord[]>[] = [];

    if (phone.email) {
      tasks.push(
        this.getDocumentsByEmail(phone.email).catch((error) => {
          console.error('❌ Falha ao carregar documentos via email:', error);
          return [];
        })
      );
    }

    tasks.push(
      this.getDocumentsByPhone(phone._id).catch((error) => {
        console.error('❌ Falha ao carregar documentos via telefone:', error);
        return [];
      })
    );

    const results = await Promise.all(tasks);
    const merged = results.flat();

    const uniqueMap = new Map<string, DocumentRecord>();

    merged.forEach((doc) => {
      const key = `${doc.origin}-${doc.id}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, doc);
      }
    });

    return Array.from(uniqueMap.values());
  }
};
