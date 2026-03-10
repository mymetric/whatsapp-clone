interface SendMessageRequest {
  phone: string;
  message: string;
  channel_phone?: string | null;
}

interface SendMessageResponse {
  success: boolean;
  message?: string;
  error?: string;
}

class MessageService {
  async sendMessage(phone: string, message: string, channelPhone?: string | null): Promise<SendMessageResponse> {
    try {
      const requestData: SendMessageRequest = {
        phone: phone,
        message: message,
        channel_phone: channelPhone || null,
      };

      // Sempre usar proxy same-origin para evitar CORS em produção
      // No dev (CRA), o package.json "proxy" encaminha /api/* para http://localhost:4000
      const apiUrl = '/api/send-message';

      console.log('📤 Enviando mensagem:', requestData);
      console.log('🔗 URL da API:', apiUrl);
      console.log('🌍 Modo:', process.env.NODE_ENV);

      // Include auth token for activity logging
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Rosenbaum-Chat-System/1.0'
      };
      try {
        const sessionStr = localStorage.getItem('auth_session');
        if (sessionStr) {
          const session = JSON.parse(sessionStr);
          if (session.token) headers['Authorization'] = `Bearer ${session.token}`;
        }
      } catch { /* ignore */ }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestData)
      });

      console.log('📡 Resposta da API:', response.status, response.statusText);

      if (!response.ok) {
        let details = '';
        try {
          const maybeJson = await response.json();
          details = JSON.stringify(maybeJson);
        } catch {
          try {
            details = await response.text();
          } catch {
            details = '';
          }
        }
        console.error('❌ Erro na resposta da API:', details);
        throw new Error(`Erro na API (${response.status}): ${details || response.statusText}`);
      }

      const result = await response.json().catch(() => ({}));
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
