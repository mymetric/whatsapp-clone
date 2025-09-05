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
    const response = await fetch('/credentials.json');
    const data = await response.json();
    apiConfig = {
      baseUrl: data.api.baseUrl,
      apiKey: data.api.apiKey
    };
    return apiConfig;
  } catch (error) {
    console.error('Erro ao carregar configurações da API:', error);
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

// Interface para os dados brutos da API
interface RawPhoneData {
  document: {
    name: string;
    fields: {
      last_message: {
        integerValue: string;
      };
    };
    createTime: string;
    updateTime: string;
    id: string;
  };
  readTime: string;
}

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
        last_message: item.document.fields.last_message.integerValue
      }));
      
      console.log('Dados transformados:', phones);
      return phones;
    } catch (error) {
      console.error('Erro na requisição da API:', error);
      console.error('Detalhes do erro:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
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
