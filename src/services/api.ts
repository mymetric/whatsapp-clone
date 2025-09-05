import axios from 'axios';
import { Phone, Message } from '../types';

const API_BASE_URL = 'https://n8n.rosenbaum.adv.br/webhook/api';
const API_KEY = 'YY2pHUzcGUFKBmZ';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'apikey': API_KEY
  }
});

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
      console.log('Fazendo requisição para:', `${API_BASE_URL}/phones`);
      const response = await api.get<RawPhoneData[]>('/phones');
      console.log('Resposta da API:', response.data);
      
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
      throw error;
    }
  }
};

export const messageService = {
  async getMessages(phone: string): Promise<Message[]> {
    try {
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
