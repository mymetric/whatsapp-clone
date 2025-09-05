import { authService } from './auth';

interface SendMessageRequest {
  phone: string;
  message: string;
}

interface SendMessageResponse {
  success: boolean;
  message?: string;
  error?: string;
}

class MessageService {
  async sendMessage(phone: string, message: string): Promise<SendMessageResponse> {
    try {
      const apiConfig = authService.getApiConfig();
      
      if (!apiConfig?.sendMessageUrl) {
        throw new Error('URL da API não configurada');
      }

      const requestData: SendMessageRequest = {
        phone: phone,
        message: message
      };

      // Usar proxy durante desenvolvimento para evitar CORS
      const isDevelopment = process.env.NODE_ENV === 'development';
      const apiUrl = isDevelopment 
        ? '/webhook/enviar-com-umbler'  // Usa proxy
        : apiConfig.sendMessageUrl;     // URL completa em produção

      console.log('📤 Enviando mensagem:', requestData);
      console.log('🔗 URL da API:', apiUrl);
      console.log('🌍 Modo:', isDevelopment ? 'desenvolvimento (proxy)' : 'produção');

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Rosenbaum-Chat-System/1.0'
        },
        body: JSON.stringify(requestData)
      });

      console.log('📡 Resposta da API:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Erro na resposta da API:', errorText);
        
        // Tratar erro específico do n8n webhook
        if (response.status === 404) {
          try {
            const errorData = JSON.parse(errorText);
            if (errorData.message && errorData.message.includes('webhook')) {
              throw new Error(`Webhook não ativo: ${errorData.message}. Ative o webhook no n8n primeiro.`);
            }
          } catch (parseError) {
            // Se não conseguir fazer parse, usar erro genérico
          }
        }
        
        throw new Error(`Erro na API: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('✅ Mensagem enviada com sucesso:', result);

      return {
        success: true,
        message: 'Mensagem enviada com sucesso'
      };

    } catch (error) {
      console.error('❌ Erro ao enviar mensagem:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      };
    }
  }
}

export const messageService = new MessageService();
