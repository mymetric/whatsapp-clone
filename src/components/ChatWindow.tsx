import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, Message } from '../types';
import { messageService as apiMessageService, emailService, promptService, Prompt } from '../services/api';
import { messageService } from '../services/messageService';
import { grokService } from '../services/grokService';
import MondayTab from './MondayTab';
import EmailTab from './EmailTab';
import DocumentsTab from './DocumentsTab';
import './ChatWindow.css';

interface ChatWindowProps {
  selectedPhone: Phone | null;
  onMessagesChange?: (messages: Message[]) => void;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ selectedPhone, onMessagesChange }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'emails' | 'documents' | 'monday'>('chat');
  const [isUpdating, setIsUpdating] = useState(false);
  const [nextUpdateIn, setNextUpdateIn] = useState(20);
  const [contactEmail, setContactEmail] = useState<string | undefined>(selectedPhone?.email);
  const [emailData, setEmailData] = useState<any>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [usingPrompt, setUsingPrompt] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  const scrollToBottom = useCallback((smooth = false) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: smooth ? 'smooth' : 'auto',
        block: 'end'
      });
    }
  }, []);

  // Detectar se o usuário fez scroll manual
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    
    const container = messagesContainerRef.current;
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50; // 50px de tolerância
    
    setUserScrolled(!isAtBottom);
  }, []);

  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
    }
  }, []);

  const loadMessages = useCallback(async (isAutoUpdate = false) => {
    if (!selectedPhone) return;
    
    if (isAutoUpdate) {
      setIsUpdating(true);
    } else {
      setLoading(true);
    }
    
    try {
      const phoneNumber = selectedPhone._id.replace('+', '');
      const messagesData = await apiMessageService.getMessages(phoneNumber);
      
      // Ordenar mensagens por data e hora (mais antigas primeiro)
      updateMessages(messagesData);
    } catch (error) {
      console.error('Erro ao carregar mensagens:', error);
    } finally {
      if (isAutoUpdate) {
        setIsUpdating(false);
      } else {
        setLoading(false);
      }
    }
  }, [selectedPhone]);


  // Buscar email do contato quando selecionado
  useEffect(() => {
    if (selectedPhone) {
      console.log('🎯 Contato selecionado:', {
        id: selectedPhone._id,
        name: selectedPhone.lead_name,
        existingEmail: selectedPhone.email
      });
      
      setContactEmail(selectedPhone.email);
      
      // Buscar emails trocados com o cliente
      const getEmail = async () => {
        try {
          const emailData = await emailService.getEmailForContact(selectedPhone);
          if (emailData && typeof emailData === 'object') {
            const data = emailData as any;
            let firstEmail = null;
            
            // Verificar se há emails em 'destination'
            if (Array.isArray(data.destination) && data.destination.length > 0) {
              const validEmails = data.destination.filter((email: any) => email && Object.keys(email).length > 0);
              if (validEmails.length > 0) {
                firstEmail = validEmails[0];
              }
            }
            
            // Verificar se há emails em 'sender' (caso contrário do fluxo)
            if (!firstEmail && Array.isArray(data.sender) && data.sender.length > 0) {
              const validEmails = data.sender.filter((email: any) => email && Object.keys(email).length > 0);
              if (validEmails.length > 0) {
                firstEmail = validEmails[0];
              }
            }
            
            if (firstEmail) {
              console.log('✅ Emails trocados encontrados:', data);
              // Usar o primeiro email como contato principal
              setContactEmail(firstEmail.destination || selectedPhone.email);
              setEmailData(data);
            } else {
              console.log('❌ Nenhum email válido encontrado para o contato');
              setContactEmail(selectedPhone.email);
              setEmailData(null);
            }
          } else {
            console.log('❌ Nenhum email encontrado para o contato');
            setContactEmail(selectedPhone.email);
            setEmailData(null);
          }
        } catch (error) {
          console.error('❌ Erro ao buscar emails trocados:', error);
          setContactEmail(selectedPhone.email);
          setEmailData(null);
        }
      };
      
      getEmail();
    }
  }, [selectedPhone]);

  // Scroll para o final quando carregar mensagens de um contato
  useEffect(() => {
    if (messages.length > 0 && !loading) {
      setUserScrolled(false);
      setTimeout(() => {
        scrollToBottom(false);
      }, 100);
    }
  }, [selectedPhone, loading, scrollToBottom]);

  // Scroll automático apenas quando não há scroll manual do usuário
  useEffect(() => {
    if (messages.length > 0 && !userScrolled) {
      setTimeout(() => {
        scrollToBottom(true);
      }, 100);
    }
  }, [messages.length, userScrolled, scrollToBottom]);

  // Adicionar listener de scroll
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => {
        container.removeEventListener('scroll', handleScroll);
      };
    }
  }, [handleScroll]);

  useEffect(() => {
    if (selectedPhone) {
      loadMessages();
    }
  }, [selectedPhone, loadMessages]);

  // Live updates a cada 20 segundos
  useEffect(() => {
    if (!selectedPhone) return;

    // Resetar timer quando mudar de telefone
    setNextUpdateIn(20);

    // Configurar intervalo para atualizações automáticas
    const updateInterval = setInterval(() => {
      loadMessages(true); // true = isAutoUpdate
      setNextUpdateIn(20); // Resetar timer após atualização
    }, 20000); // 20 segundos

    // Configurar timer regressivo a cada segundo
    const countdownInterval = setInterval(() => {
      setNextUpdateIn(prev => {
        if (prev <= 1) {
          return 20; // Resetar para 20 quando chegar a 0
        }
        return prev - 1;
      });
    }, 1000); // 1 segundo

    // Cleanup dos intervalos quando o componente for desmontado ou selectedPhone mudar
    return () => {
      clearInterval(updateInterval);
      clearInterval(countdownInterval);
    };
  }, [selectedPhone, loadMessages]);

  // Ajustar altura do textarea quando o texto mudar
  useEffect(() => {
    adjustTextareaHeight();
  }, [newMessage, adjustTextareaHeight]);

  // Carregar prompts quando o componente montar
  useEffect(() => {
    const loadPrompts = async () => {
      setLoadingPrompts(true);
      try {
        const promptsData = await promptService.getPrompts();
        console.log('📋 Prompts carregados:', promptsData);
        setPrompts(promptsData);
      } catch (error) {
        console.error('Erro ao carregar prompts:', error);
      } finally {
        setLoadingPrompts(false);
      }
    };
    loadPrompts();
  }, []);

  const formatPhoneNumber = (phone: string) => {
    if (!phone) return 'Número não disponível';
    const cleanPhone = phone.replace('+', '');
    return `+${cleanPhone.slice(0, 2)} ${cleanPhone.slice(2, 4)} ${cleanPhone.slice(4, 9)}-${cleanPhone.slice(9)}`;
  };

  const formatMessageTime = (timestamp: string) => {
    if (!timestamp) return 'Data não disponível';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  // Nova função para formatar data
  const formatMessageDate = (timestamp: string) => {
    if (!timestamp) return 'Data não disponível';
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Resetar horas para comparar apenas as datas
    const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const yesterdayDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
    
    if (messageDate.getTime() === todayDate.getTime()) {
      return 'Hoje';
    } else if (messageDate.getTime() === yesterdayDate.getTime()) {
      return 'Ontem';
    } else {
      return date.toLocaleDateString('pt-BR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
      });
    }
  };

  // Nova função para verificar se deve mostrar separador de data
  const shouldShowDateSeparator = (currentMessage: Message, previousMessage: Message | null) => {
    if (!previousMessage) return true;
    
    const currentDate = new Date(currentMessage._updateTime);
    const previousDate = new Date(previousMessage._updateTime);
    
    // Resetar horas para comparar apenas as datas
    const currentDateOnly = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    const previousDateOnly = new Date(previousDate.getFullYear(), previousDate.getMonth(), previousDate.getDate());
    
    return currentDateOnly.getTime() !== previousDateOnly.getTime();
  };

  // Função auxiliar para ordenar mensagens por data e hora
  const sortMessagesByTime = (messages: Message[]): Message[] => {
    return messages.sort((a, b) => {
      const dateA = new Date(a._updateTime);
      const dateB = new Date(b._updateTime);
      return dateA.getTime() - dateB.getTime();
    });
  };

  // Função auxiliar para atualizar mensagens e notificar o callback
  const updateMessages = (updater: Message[] | ((prev: Message[]) => Message[])) => {
    setMessages(prev => {
      const newMessages = typeof updater === 'function' ? updater(prev) : updater;
      const sorted = sortMessagesByTime([...newMessages]);
      if (onMessagesChange) {
        onMessagesChange(sorted);
      }
      return sorted;
    });
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedPhone) return;
    
    const messageText = newMessage.trim();
    setNewMessage('');
    
    // Criar mensagem otimista (aparece imediatamente)
    const optimisticMessage: Message = {
      _name: '',
      _id: `temp_${Date.now()}`,
      _createTime: new Date().toISOString(),
      _updateTime: new Date().toISOString(),
      chat_phone: selectedPhone._id ? selectedPhone._id.replace('+', '') : '',
      source: 'Member',
      content: messageText
    };
    
    updateMessages(prev => [...prev, optimisticMessage]);
    
    try {
      // Enviar mensagem via API real
      const result = await messageService.sendMessage(selectedPhone._id, messageText);
      
      if (result.success) {
        // Atualizar mensagem otimista com ID final
        const finalMessage: Message = {
          ...optimisticMessage,
          _id: Date.now().toString(),
          _createTime: new Date().toISOString(),
          _updateTime: new Date().toISOString(),
        };
        
        updateMessages(prev => 
            prev.map(msg => 
              msg._id === optimisticMessage._id ? finalMessage : msg
          )
        );
        
        console.log('✅ Mensagem enviada com sucesso');
        setShowInput(false); // Ocultar caixa de texto após envio bem-sucedido
      } else {
        throw new Error(result.error || 'Erro ao enviar mensagem');
      }
      
    } catch (error) {
      console.error('❌ Erro ao enviar mensagem:', error);
      // Remover mensagem otimista em caso de erro
      updateMessages(prev => prev.filter(msg => msg._id !== optimisticMessage._id));
      setNewMessage(messageText); // Restaurar texto
      
      // Mostrar erro para o usuário (opcional)
      alert(`Erro ao enviar mensagem: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(e.target.value);
    adjustTextareaHeight();
  };

  const handleShowInput = () => {
    setShowInput(true);
    // Focar no textarea após mostrar
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }, 100);
  };

  const handleHideInput = () => {
    setShowInput(false);
    setNewMessage(''); // Limpar mensagem ao ocultar
  };

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


  const handleUsePrompt = async (prompt: Prompt) => {
    if (!selectedPhone || usingPrompt === prompt.id) return;

    setUsingPrompt(prompt.id);
    try {
      // Obter contexto do lead
      const leadContext = await getLeadContext();

      // Preparar prompt para o Grok usando o prompt selecionado
      const systemContext = `${prompt.content}

${leadContext}

Instruções:
- Seja sempre profissional e prestativo
- Mantenha um tom amigável e próximo
- Responda de forma clara e objetiva
- Use emojis moderadamente para tornar a conversa mais amigável
- Mantenha as respostas concisas mas completas
- Baseie sua resposta no contexto do lead e nas últimas mensagens da conversa
- IMPORTANTE: Forneça respostas completas e detalhadas, mas NUNCA gere respostas com mais de 4000 caracteres.
Se sua resposta estiver ficando muito longa, resuma os pontos principais de forma concisa e objetiva.`;

      const lastMessage = messages.length > 0 ? messages[messages.length - 1].content : '';
      const conversationHistory = messages.slice(-10).map(msg => 
        `${msg.source === 'Member' ? 'Você' : 'Cliente'}: ${msg.content}`
      ).join('\n');

      const userPrompt = lastMessage 
        ? `Gere uma resposta profissional e adequada para a última mensagem do cliente: "${lastMessage}"`
        : `Gere uma mensagem de abertura profissional e amigável para iniciar uma conversa com este cliente.`;

      const response = await grokService.generateResponse(
        userPrompt,
        {
          systemPrompt: systemContext,
          conversationHistory,
          phoneNumber: selectedPhone._id,
          lastMessage
        }
      );

      // Colocar a resposta no campo de edição ao invés de enviar diretamente
      setNewMessage(response);
      setShowInput(true);
      
      // Ajustar altura do textarea após definir o texto
      setTimeout(() => {
        adjustTextareaHeight();
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }, 0);
      
      console.log('✅ Resposta gerada com prompt e colocada no campo de edição');
      
    } catch (error) {
      console.error('❌ Erro ao usar prompt:', error);
      alert(`Erro ao gerar resposta: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    } finally {
      setUsingPrompt(null);
    }
  };


  if (!selectedPhone) {
    return (
      <div className="chat-window">
        <div className="no-chat-selected">
          <div className="no-chat-icon">💬</div>
          <h3>Selecione uma conversa</h3>
          <p>Escolha um contato para começar a conversar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="chat-header-info">
          <div className="chat-header-avatar">
            {selectedPhone._id ? selectedPhone._id.slice(-2).toUpperCase() : 'NA'}
          </div>
          <div className="chat-header-details">
            <div className="chat-header-name">
              {selectedPhone.lead_name ? (
                <div className="header-name-container">
                  <div className="header-name-email-container">
                    <span className="header-lead-name">{selectedPhone.lead_name}</span>
                    {contactEmail && (
                      <span className="header-client-email" title={`Email: ${contactEmail}`}>
                        📧 {contactEmail}
                      </span>
                    )}
                  </div>
                  <span className="header-phone-number">{formatPhoneNumber(selectedPhone._id)}</span>
                </div>
              ) : (
                formatPhoneNumber(selectedPhone._id)
              )}
            </div>
            <div className="chat-header-status">
              online
              {isUpdating ? (
                <span className="live-update-indicator">
                  <span className="update-dot"></span>
                  Atualizando...
                </span>
              ) : (
                <span className="next-update-timer">
                  <span className="timer-icon">⏱️</span>
                  {nextUpdateIn}s
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="chat-tabs">
          <button
            className={`tab-button ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
            title="Conversa"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4l4 4 4-4h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
            </svg>
            <span>Chat</span>
          </button>
          <button
            className={`tab-button ${activeTab === 'emails' ? 'active' : ''}`}
            onClick={() => setActiveTab('emails')}
            title="Emails trocados"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
            </svg>
            <span>Emails</span>
          </button>
          <button
            className={`tab-button ${activeTab === 'documents' ? 'active' : ''}`}
            onClick={() => setActiveTab('documents')}
            title="Documentos do lead"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 2C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2H6ZM13 9V3.5L18.5 9H13Z" />
              <path d="M8 12H16V14H8V12ZM8 16H14V18H8V16Z" />
            </svg>
            <span>Documentos</span>
          </button>
          <button
            className={`tab-button ${activeTab === 'monday' ? 'active' : ''}`}
            onClick={() => setActiveTab('monday')}
            title="Dados do Monday.com"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
            </svg>
            <span>Monday</span>
          </button>
        </div>
      </div>

      {activeTab === 'chat' ? (
        <div className="chat-messages" ref={messagesContainerRef}>
          {userScrolled && (
            <button 
              className="scroll-to-bottom-btn"
              onClick={() => {
                setUserScrolled(false);
                scrollToBottom(true);
              }}
              title="Ir para a última mensagem"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
              </svg>
              <span>Nova mensagem</span>
            </button>
          )}
          {loading ? (
            <div className="loading-messages">Carregando mensagens...</div>
          ) : (
            <>
              {messages.map((message, index) => {
                const isSending = message._id.startsWith('temp_');
                const previousMessage = index > 0 ? messages[index - 1] : null;
                const showDateSeparator = shouldShowDateSeparator(message, previousMessage);
                const audioValue = message.audio;
                const isAudio =
                  audioValue === true ||
                  (typeof audioValue === 'string' && audioValue.toLowerCase() === 'true');
                const shouldShowTextContent = Boolean(message.content);
                
                return (
                  <React.Fragment key={message._id}>
                    {showDateSeparator && (
                      <div className="date-separator">
                        <span className="date-separator-text">
                          {formatMessageDate(message._updateTime)}
                        </span>
                      </div>
                    )}
                    <div
                      className={`message ${
                        message.source === 'Member' 
                          ? 'sent' 
                          : message.source === 'Bot' && !message.image && !message.audio 
                            ? 'sent bot' 
                            : 'received'
                      } ${isSending ? 'sending' : ''}`}
                    >
                      <div className="message-content">
                        {message.source === 'Bot' && !message.image && !isAudio && (
                          <div className="bot-indicator">
                            <span className="bot-icon">⚙️</span>
                            <span className="bot-label">Sistema</span>
                          </div>
                        )}
                        {(message.image || isAudio) && (
                          <div className="message-media">
                            {isAudio ? (
                              <div className="message-audio-indicator">
                                <div className="audio-icon-container">
                                  <svg className="audio-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M12 1C13.1 1 14 1.9 14 3V11C14 12.1 13.1 13 12 13C10.9 13 10 12.1 10 11V3C10 1.9 10.9 1 12 1Z" fill="currentColor"/>
                                    <path d="M19 10V12C19 15.87 15.87 19 12 19C8.13 19 5 15.87 5 12V10H7V12C7 14.76 9.24 17 12 17C14.76 17 17 14.76 17 12V10H19Z" fill="currentColor"/>
                                    <path d="M11 22H13V24H11V22Z" fill="currentColor"/>
                                    <path d="M7 22H9V24H7V22Z" fill="currentColor"/>
                                    <path d="M15 22H17V24H15V22Z" fill="currentColor"/>
                                  </svg>
                                </div>
                                <span className="audio-text">Áudio</span>
                              </div>
                            ) : (
                              <div className="message-image-indicator">
                                <div className="image-icon-container">
                                  <svg className="image-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M21 19V5C21 3.9 20.1 3 19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19ZM8.5 13.5L11 16.51L14.5 12L19 18H5L8.5 13.5Z" fill="currentColor"/>
                                  </svg>
                                </div>
                                <span className="image-text">Imagem</span>
                                <button 
                                  onClick={() => {
                                    const link = document.createElement('a');
                                    link.href = message.image!;
                                    link.download = `imagem-${message._id}.jpg`;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                  }}
                                  className="image-download-btn"
                                >
                                  <span className="download-icon">⬇️</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        {shouldShowTextContent && (
                          <div className={`message-text ${isAudio ? 'audio-transcription' : ''}`}>
                            {message.content}
                          </div>
                        )}
                        <div className="message-time">
                          {isSending ? (
                            <span className="sending-indicator">Enviando...</span>
                          ) : (
                            formatMessageTime(message._updateTime)
                          )}
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      ) : activeTab === 'emails' ? (
        <EmailTab selectedPhone={selectedPhone} />
      ) : activeTab === 'documents' ? (
        <DocumentsTab selectedPhone={selectedPhone} />
      ) : (
        <MondayTab phone={selectedPhone._id} />
      )}

      {/* Botões de prompts - apenas na aba chat */}
      {activeTab === 'chat' && (
        <div className="prompts-buttons-container">
          {prompts.length > 0 ? (
            <>
              <div className="prompts-buttons-label">Prompts cadastrados:</div>
              <div className="prompts-buttons">
                {prompts.map((prompt) => (
                  <button
                    key={prompt.id}
                    onClick={() => handleUsePrompt(prompt)}
                    disabled={usingPrompt === prompt.id || !selectedPhone}
                    className={`prompt-button ${usingPrompt === prompt.id ? 'using' : ''}`}
                    title={prompt.description || prompt.name}
                  >
                    {usingPrompt === prompt.id ? (
                      <>
                        <div className="prompt-loading"></div>
                        <span>Gerando...</span>
                      </>
                    ) : (
                      <span>{prompt.name}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="prompts-buttons-label" style={{ fontStyle: 'italic', opacity: 0.6 }}>
              Nenhum prompt cadastrado. Cadastre prompts na página de Prompts.
            </div>
          )}
        </div>
      )}

      {showInput ? (
        <div className="chat-input">
          <div className="input-container">
            <textarea
              ref={textareaRef}
              value={newMessage}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder="Digite uma mensagem..."
              rows={1}
              className="message-input"
              disabled={loading}
            />
            <button
              onClick={handleSendMessage}
              disabled={!newMessage.trim() || loading}
              className="send-button"
              title="Enviar mensagem"
            >
              {loading ? (
                <div className="send-loading"></div>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              )}
            </button>
            <button
              onClick={handleHideInput}
              className="hide-input-button"
              title="Ocultar caixa de texto"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <div className="chat-input-placeholder">
          <button
            onClick={handleShowInput}
            className="show-input-button"
            title="Escrever mensagem"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
            <span>Escrever mensagem</span>
          </button>
        </div>
      )}
      
    </div>
  );
};

export default ChatWindow;
