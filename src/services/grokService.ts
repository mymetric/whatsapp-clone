interface GrokConfig {
  apiKey: string;
}

interface GrokMessage {
  role: 'user' | 'assistant' | 'system';
  content: any;
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
      
      // Construir system prompt
      const systemPrompt = context?.systemPrompt || `Você é um assistente especializado em atendimento ao cliente via WhatsApp. 
Sua função é gerar respostas profissionais, amigáveis e úteis para clientes.

${context?.phoneNumber ? `Cliente: ${context.phoneNumber}` : ''}

Instruções:
- Seja sempre profissional e prestativo
- Mantenha um tom amigável e próximo
- Responda de forma clara e objetiva
- Se não souber algo, seja honesto e ofereça alternativas
- Use emojis moderadamente para tornar a conversa mais amigável
- Mantenha as respostas concisas mas completas
- IMPORTANTE: NUNCA gere respostas com mais de 4000 caracteres. Se sua resposta estiver ficando muito longa, resuma os pontos principais de forma concisa.`;

      // Construir array de mensagens incluindo histórico
      const messages: GrokMessage[] = [
        {
          role: 'system',
          content: systemPrompt
        }
      ];

      // Adicionar histórico de conversa como mensagens
      if (context?.conversationHistory) {
        // Parsear o histórico que vem no formato "Você: mensagem\nCliente: mensagem"
        const historyLines = context.conversationHistory.split('\n').filter(line => line.trim());
        historyLines.forEach(line => {
          if (line.startsWith('Você:') || line.match(/^\d+\.\s*\[.*\]\s*Você:/)) {
            const content = line.replace(/^\d+\.\s*\[.*\]\s*/, '').replace(/^Você:\s*/, '').trim();
            if (content) {
              messages.push({
                role: 'assistant',
                content: content
              });
            }
          } else if (line.startsWith('Cliente:') || line.match(/^\d+\.\s*\[.*\]\s*Cliente:/)) {
            const content = line.replace(/^\d+\.\s*\[.*\]\s*/, '').replace(/^Cliente:\s*/, '').trim();
            if (content) {
              messages.push({
                role: 'user',
                content: content
              });
            }
          }
        });
      }

      // Adicionar última mensagem se não estiver no histórico
      if (context?.lastMessage) {
        const lastMessageInHistory = context?.conversationHistory?.includes(context.lastMessage);
        if (!lastMessageInHistory) {
          messages.push({
            role: 'user',
            content: context.lastMessage
          });
        }
      }

      // Adicionar prompt do usuário
      messages.push({
        role: 'user',
        content: userPrompt
      });

      console.log('🤖 Enviando payload para Grok:');
      console.log('📝 System Prompt:', systemPrompt.substring(0, 200) + '...');
      console.log('💬 Total de mensagens:', messages.length);
      console.log('📞 Contexto:', {
        hasHistory: !!context?.conversationHistory,
        hasLastMessage: !!context?.lastMessage,
        hasSystemPrompt: !!context?.systemPrompt
      });

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'grok-4-fast',
          messages: messages,
          max_tokens: context?.systemPrompt ? 40000 : 1000, // Mais tokens para o copiloto
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

      let generatedText = data.choices[0].message.content;
      console.log('📝 Texto gerado:', generatedText);

      // Limitar resposta a 40000 caracteres como segurança (apenas para copiloto)
      if (context?.systemPrompt && generatedText.length > 40000) {
        console.warn('⚠️ Resposta excedeu 40000 caracteres, truncando...');
        generatedText = generatedText.substring(0, 40000).trim() + '...';
      }

      return generatedText.trim();

    } catch (error) {
      console.error('❌ Erro ao gerar resposta com Grok:', error);
      throw error;
    }
  }

  /**
   * Envia texto + arquivos para o Grok usando o formato multimodal (quando suportado).
   * Observação: alguns tipos podem não ser aceitos pelo modelo/endpoint; nesse caso, a chamada pode falhar.
   */
  async generateResponseWithFiles(
    userPrompt: string,
    files: Array<{
      filename: string;
      mimeType: string;
      base64: string; // sem prefixo data:
    }>,
    context?: {
      lastMessage?: string;
      phoneNumber?: string;
      conversationHistory?: string;
      systemPrompt?: string;
    },
  ): Promise<string> {
    try {
      const apiKey = await this.loadApiKey();

      const systemPrompt = context?.systemPrompt || `Você é um assistente especializado.`;

      const messages: GrokMessage[] = [
        { role: 'system', content: systemPrompt },
      ];

      if (context?.conversationHistory) {
        const historyLines = context.conversationHistory.split('\n').filter((line) => line.trim());
        historyLines.forEach((line) => {
          if (line.startsWith('Você:') || line.match(/^\d+\.\s*\[.*\]\s*Você:/)) {
            const content = line
              .replace(/^\d+\.\s*\[.*\]\s*/, '')
              .replace(/^Você:\s*/, '')
              .trim();
            if (content) messages.push({ role: 'assistant', content });
          } else if (line.startsWith('Cliente:') || line.match(/^\d+\.\s*\[.*\]\s*Cliente:/)) {
            const content = line
              .replace(/^\d+\.\s*\[.*\]\s*/, '')
              .replace(/^Cliente:\s*/, '')
              .trim();
            if (content) messages.push({ role: 'user', content });
          }
        });
      }

      if (context?.lastMessage) {
        const lastMessageInHistory = context?.conversationHistory?.includes(context.lastMessage);
        if (!lastMessageInHistory) {
          messages.push({ role: 'user', content: context.lastMessage });
        }
      }

      const userContentParts: any[] = [
        { type: 'text', text: userPrompt },
      ];

      // Tenta mandar arquivos como "input_file" (estilo OpenAI). Se a API não suportar, retornará erro.
      files.forEach((f) => {
        userContentParts.push({
          type: 'input_file',
          filename: f.filename,
          mime_type: f.mimeType,
          file_data: f.base64,
        });
      });

      messages.push({ role: 'user', content: userContentParts });

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-4-fast',
          messages,
          max_tokens: 40000,
          temperature: 0.7,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Erro na resposta do Grok (com arquivos):', response.status, errorText);
        throw new Error(`Erro na API do Grok (arquivos): ${response.status} - ${errorText}`);
      }

      const data: GrokResponse = await response.json();
      if (!data.choices || data.choices.length === 0) {
        throw new Error('Nenhuma resposta gerada pelo Grok');
      }

      let generatedText = data.choices[0].message.content;
      if (typeof generatedText !== 'string') generatedText = String(generatedText ?? '');

      if (generatedText.length > 40000) {
        generatedText = generatedText.substring(0, 40000).trim() + '...';
      }

      return generatedText.trim();
    } catch (error) {
      console.error('❌ Erro ao gerar resposta com Grok (arquivos):', error);
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
