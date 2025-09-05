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
        last_message: item.document.fields.last_message.integerValue
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
