// Serviço para buscar mensagens do Firestore via backend

export interface FirestoreMessage {
  id: string;
  audio: boolean;
  chat_phone: string;
  content: string;
  image: string;
  name: string;
  source: 'Contact' | 'Bot' | string;
  timestamp: string | null;
}

export interface MessagesResponse {
  messages: FirestoreMessage[];
  count: number;
}

export const firestoreMessagesService = {
  /**
   * Busca mensagens do Firestore para um telefone específico
   */
  async getMessages(phone: string, limit: number = 50): Promise<MessagesResponse> {
    if (!phone) {
      throw new Error('Telefone é obrigatório');
    }

    // Normalizar telefone
    const normalizedPhone = phone.replace(/\D/g, '');

    const response = await fetch(`/api/firestore/messages?phone=${normalizedPhone}&limit=${limit}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
      throw new Error(errorData.error || `Erro HTTP ${response.status}`);
    }

    return response.json();
  },
};
