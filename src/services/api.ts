import axios from 'axios';
import { Phone, Message } from '../types';

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
      
      // Verificar se response.data é um array
      if (!Array.isArray(response.data)) {
        console.error('Erro: response.data não é um array:', response.data);
        return [];
      }
      
      // Transformar os dados da API no formato esperado pela aplicação
      const phones: Phone[] = response.data.map((item) => ({
        _name: item.document.name,
        _id: item.document.id,
        _createTime: item.document.createTime,
        _updateTime: item.document.updateTime,
        last_message: item.document.fields.last_message.integerValue,
        lead_name: item.document.fields.lead_name?.stringValue || undefined,
        email: item.document.fields.email?.stringValue || undefined,
        etiqueta: item.document.fields.etiqueta?.stringValue || undefined,
        status: item.document.fields.status?.stringValue || undefined,
        board: item.document.fields.board?.stringValue || undefined
      }));
      
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
