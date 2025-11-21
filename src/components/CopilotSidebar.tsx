import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Phone, Message } from '../types';
import { grokService } from '../services/grokService';
import { messageService } from '../services/messageService';
import { emailService } from '../services/api';
import './CopilotSidebar.css';

interface CopilotSidebarProps {
  selectedPhone: Phone | null;
  messages: Message[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const CopilotSidebar: React.FC<CopilotSidebarProps> = ({ selectedPhone, messages }) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Quando expandir do minimizado, garantir que não abra direto em fullscreen
  const handleExpandFromMinimized = () => {
    setIsMinimized(false);
    setIsFullscreen(false);
  };
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Criar som de notificação
  const playNotificationSound = () => {
    try {
      // Criar um contexto de áudio
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Criar um oscilador para gerar o som
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      // Conectar os nós
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Configurar o som (nota musical agradável)
      oscillator.frequency.value = 800; // Frequência em Hz
      oscillator.type = 'sine'; // Tipo de onda (sine = suave)
      
      // Configurar volume (envelope)
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      // Tocar o som
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (error) {
      console.log('Não foi possível tocar o som:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  useEffect(() => {
    if (textareaRef.current) {
      // Sempre garantir altura mínima primeiro
      const minHeight = 73;
      const maxHeight = 200;
      
      // Resetar altura
      textareaRef.current.style.height = minHeight + 'px';
      
      // Calcular altura baseada no conteúdo
      const scrollHeight = textareaRef.current.scrollHeight;
      
      if (scrollHeight <= minHeight) {
        // Se o conteúdo é menor que o mínimo, manter mínimo
        textareaRef.current.style.height = minHeight + 'px';
        textareaRef.current.style.overflowY = 'hidden';
      } else if (scrollHeight <= maxHeight) {
        // Se o conteúdo cabe, usar altura do scroll
        textareaRef.current.style.height = scrollHeight + 'px';
        textareaRef.current.style.overflowY = 'hidden';
      } else {
        // Se excede, usar altura máxima e habilitar scroll
        textareaRef.current.style.height = maxHeight + 'px';
        textareaRef.current.style.overflowY = 'auto';
      }
    }
  }, [inputMessage]);

  const getLeadContext = async (): Promise<string> => {
    if (!selectedPhone) return '';

    let context = `Dados do Lead:\n`;
    context += `- Nome: ${selectedPhone.lead_name || 'Não informado'}\n`;
    context += `- Telefone: ${selectedPhone._id}\n`;
    context += `- Email: ${selectedPhone.email || 'Não informado'}\n`;
    context += `- Status: ${selectedPhone.status || 'Não informado'}\n`;
    context += `- Etiqueta: ${selectedPhone.etiqueta || 'Não informado'}\n`;
    
    if (selectedPhone.board) {
      context += `- Board Monday.com: ${selectedPhone.board}\n`;
    }
    if (selectedPhone.pulse_id) {
      context += `- Pulse ID: ${selectedPhone.pulse_id}\n`;
    }

    // Adicionar últimas mensagens da conversa
    if (messages.length > 0) {
      context += `\nÚltimas mensagens da conversa:\n`;
      const recentMessages = messages.slice(-10);
      recentMessages.forEach((msg, idx) => {
        const sender = msg.source === 'Member' ? 'Você' : 'Cliente';
        const time = new Date(msg._updateTime).toLocaleString('pt-BR');
        context += `${idx + 1}. [${time}] ${sender}: ${msg.content}\n`;
      });
    }

    // Tentar buscar emails do contato
    try {
      const emailData = await emailService.getEmailForContact(selectedPhone);
      if (emailData && typeof emailData === 'object') {
        const data = emailData as any;
        const emails: any[] = [];
        
        if (Array.isArray(data.destination)) {
          emails.push(...data.destination.filter((e: any) => e && Object.keys(e).length > 0));
        }
        if (Array.isArray(data.sender)) {
          emails.push(...data.sender.filter((e: any) => e && Object.keys(e).length > 0));
        }

        if (emails.length > 0) {
          context += `\nEmails trocados (${emails.length} encontrados):\n`;
          emails.slice(0, 5).forEach((email, idx) => {
            context += `${idx + 1}. Assunto: ${email.subject || 'Sem assunto'}\n`;
            if (email.text) {
              context += `   Preview: ${email.text.substring(0, 100)}...\n`;
            }
          });
        }
      }
    } catch (error) {
      console.log('Não foi possível carregar emails para o contexto');
    }

    return context;
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !selectedPhone || isLoading) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    
    // Adicionar mensagem do usuário
    const userChatMessage: ChatMessage = {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    };
    setChatMessages(prev => [...prev, userChatMessage]);
    setIsLoading(true);

    try {
      // Obter contexto do lead
      const leadContext = await getLeadContext();

      // Preparar prompt para o Grok
      const systemContext = `Você é um assistente especializado em análise de leads e atendimento ao cliente. 
Você tem acesso aos dados completos do lead e pode ajudar o usuário a entender melhor o cliente, 
sugerir estratégias de abordagem, analisar o histórico de conversas e emails, e fornecer insights valiosos.

${leadContext}

Seja objetivo, útil e forneça insights práticos baseados nos dados disponíveis.
IMPORTANTE: Forneça respostas completas e detalhadas, mas NUNCA gere respostas com mais de 4000 caracteres. 
Se sua resposta estiver ficando muito longa, resuma os pontos principais de forma concisa e objetiva.`;

      const response = await grokService.generateResponse(
        userMessage,
        {
          systemPrompt: systemContext,
          conversationHistory: messages.slice(-10).map(msg => 
            `${msg.source === 'Member' ? 'Você' : 'Cliente'}: ${msg.content}`
          ).join('\n'),
          phoneNumber: selectedPhone._id,
          lastMessage: messages.length > 0 ? messages[messages.length - 1].content : ''
        }
      );

      // Adicionar resposta da IA
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response,
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev, assistantMessage]);
      
      // Tocar som de notificação
      playNotificationSound();

    } catch (error) {
      console.error('Erro ao gerar resposta:', error);
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: `Erro ao processar sua mensagem: ${error instanceof Error ? error.message : 'Erro desconhecido'}. Por favor, tente novamente.`,
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearConversation = () => {
    if (window.confirm('Tem certeza que deseja limpar a conversa? Esta ação não pode ser desfeita.')) {
      setChatMessages([]);
      setInputMessage('');
    }
  };

  if (!selectedPhone) {
    return (
      <div className="copilot-sidebar">
        <div className="copilot-sidebar-header">
          <div className="copilot-header-content">
            <span className="copilot-icon">🤖</span>
            <h3>Copiloto IA</h3>
          </div>
        </div>
        <div className="copilot-sidebar-content">
          <div className="copilot-empty-state">
            <div className="empty-state-icon">💬</div>
            <p>Selecione um lead para começar a conversar com o copiloto</p>
          </div>
        </div>
      </div>
    );
  }

  if (isMinimized) {
    const unreadCount = chatMessages.filter(msg => msg.role === 'assistant').length;
    return (
      <button
        className="copilot-minimize-button copilot-floating-button"
        onClick={handleExpandFromMinimized}
        title={`Expandir copiloto${unreadCount > 0 ? ` (${unreadCount} respostas)` : ''}`}
      >
        <span className="copilot-icon">🤖</span>
        {unreadCount > 0 && (
          <span className="copilot-notification-badge">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div 
      ref={sidebarRef}
      className={`copilot-sidebar ${isFullscreen ? 'copilot-sidebar-fullscreen' : ''}`}
    >
      <div className="copilot-sidebar-header">
        <div className="copilot-header-content">
          <span className="copilot-icon">🤖</span>
          <div className="copilot-header-info">
            <h3>Copiloto IA</h3>
            <p className="copilot-subtitle">Análise de dados do lead</p>
          </div>
        </div>
        <div className="copilot-header-actions">
          {chatMessages.length > 0 && (
            <button
              className="copilot-clear-toggle"
              onClick={handleClearConversation}
              title="Limpar conversa"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          )}
          <button
            className="copilot-fullscreen-toggle"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          >
            {isFullscreen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
              </svg>
            )}
          </button>
          <button
            className="copilot-minimize-toggle"
            onClick={() => setIsMinimized(true)}
            title="Minimizar copiloto"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 13H5v-2h14v2z"/>
            </svg>
          </button>
        </div>
      </div>
      
      <div className="copilot-messages-container">
        {chatMessages.length === 0 ? (
          <div className="copilot-welcome">
            <div className="welcome-icon">👋</div>
            <h4>Olá! Sou seu copiloto de IA</h4>
            <p>Posso ajudar você a:</p>
            <ul>
              <li>Analisar os dados do lead</li>
              <li>Entender o histórico de conversas</li>
              <li>Sugerir estratégias de abordagem</li>
              <li>Revisar emails trocados</li>
              <li>Fornecer insights sobre o cliente</li>
            </ul>
            <p className="welcome-hint">Faça uma pergunta para começar!</p>
          </div>
        ) : (
          <div className="copilot-messages">
            {chatMessages.map((msg, idx) => (
              <div key={idx} className={`copilot-message ${msg.role}`}>
                <div className="copilot-message-content">
                  {msg.role === 'assistant' && (
                    <div className="copilot-avatar">🤖</div>
                  )}
                  <div className="copilot-message-text">
                    {msg.role === 'assistant' ? (
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
                <div className="copilot-message-time">
                  {msg.timestamp.toLocaleTimeString('pt-BR', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="copilot-message assistant">
                <div className="copilot-message-content">
                  <div className="copilot-avatar">🤖</div>
                  <div className="copilot-message-text">
                    <div className="loading-dots">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="copilot-input-container">
          <textarea
          ref={textareaRef}
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Pergunte sobre o lead, histórico, estratégias..."
          rows={2}
          className="copilot-input"
          disabled={isLoading}
          style={{ minHeight: '73px', height: inputMessage ? 'auto' : '73px' }}
        />
        <button
          onClick={handleSendMessage}
          disabled={!inputMessage.trim() || isLoading}
          className="copilot-send-button"
          title="Enviar mensagem"
        >
          {isLoading ? (
            <div className="send-loading"></div>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
};

export default CopilotSidebar;

