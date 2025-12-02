interface GrokConfig {
  apiKey: string;
}

interface GrokMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface GrokResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

class GrokService {
  private apiKey: string | null = null;
  private baseUrl = 'https://api.x.ai/v1/chat/completions';

  private async loadApiKey(): Promise<string> {
    if (this.apiKey) return this.apiKey;
    
    try {
      console.log('🔑 Tentando carregar Grok API key...');
      const response = await fetch('/credentials.json');
      console.log('📡 Resposta do credentials.json:', response.status, response.statusText);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('📄 Dados carregados:', data);
      console.log('🤖 Seção Grok:', data.grok);
      
      if (!data.grok || !data.grok.apiKey) {
        console.error('❌ Grok API key não encontrada na estrutura:', data);
        throw new Error('Grok API key não encontrada no credentials.json');
      }
      
      this.apiKey = data.grok.apiKey;
      console.log('✅ Grok API key carregada com sucesso');
      return this.apiKey!; // Non-null assertion since we just assigned it
    } catch (error) {
      console.error('❌ Erro ao carregar Grok API key:', error);
      throw new Error('Grok API key não configurada');
    }
  }

  async generateResponse(
    userPrompt: string, 
    context?: {
      lastMessage?: string;
      phoneNumber?: string;
      conversationHistory?: string;
      systemPrompt?: string;
    }
  ): Promise<string> {
    try {
      const apiKey = await this.loadApiKey();
      
      // Construir contexto para o Grok
      // Se um systemPrompt personalizado foi fornecido, use-o como base; caso contrário, use o padrão
      const baseSystemPrompt = context?.systemPrompt || `Você é um assistente especializado em atendimento ao cliente via WhatsApp. 
Sua função é gerar respostas profissionais, amigáveis e úteis para clientes.

Instruções:
- Seja sempre profissional e prestativo
- Mantenha um tom amigável e próximo
- Responda de forma clara e objetiva
- Se não souber algo, seja honesto e ofereça alternativas
- Use emojis moderadamente para tornar a conversa mais amigável
- Mantenha as respostas concisas mas completas`;

      // Sempre adicionar contexto da conversa, mesmo quando systemPrompt personalizado é fornecido
      const conversationContext = `
Contexto da conversa:
${context?.conversationHistory ? `Histórico: ${context.conversationHistory}` : ''}
${context?.lastMessage ? `Última mensagem do cliente: ${context.lastMessage}` : ''}
${context?.phoneNumber ? `Cliente: ${context.phoneNumber}` : ''}`;

      const systemPrompt = baseSystemPrompt + conversationContext;

      const messages: GrokMessage[] = [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ];

      console.log('🤖 Enviando prompt para Grok:', userPrompt);
      console.log('📞 Contexto:', context);

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'grok-3',
          messages: messages,
          max_tokens: 500,
          temperature: 0.7,
          stream: false
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Erro na resposta do Grok:', response.status, errorText);
        throw new Error(`Erro na API do Grok: ${response.status} - ${errorText}`);
      }

      const data: GrokResponse = await response.json();
      console.log('✅ Resposta do Grok recebida:', data);

      if (!data.choices || data.choices.length === 0) {
        throw new Error('Nenhuma resposta gerada pelo Grok');
      }

      const generatedText = data.choices[0].message.content;
      console.log('📝 Texto gerado:', generatedText);

      return generatedText.trim();

    } catch (error) {
      console.error('❌ Erro ao gerar resposta com Grok:', error);
      throw error;
    }
  }

  async generateNewSuggestion(
    originalSuggestion: string,
    userRequest: string,
    context?: {
      lastMessage?: string;
      phoneNumber?: string;
      conversationHistory?: string;
      systemPrompt?: string;
    }
  ): Promise<string> {
    const prompt = `O cliente não gostou da sugestão anterior e pediu uma nova resposta.

Sugestão anterior: "${originalSuggestion}"

Pedido do cliente: "${userRequest}"

Por favor, gere uma nova resposta melhorada baseada no pedido do cliente.`;

    return this.generateResponse(prompt, context);
  }
}

export const grokService = new GrokService();
