import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, Message } from '../types';
import { messageService as apiMessageService, aiSuggestionService } from '../services/api';
import { messageService } from '../services/messageService';
import { grokService } from '../services/grokService';
import MondayTab from './MondayTab';
import './ChatWindow.css';

interface ChatWindowProps {
  selectedPhone: Phone | null;
}

interface AISuggestion {
  _name: string;
  _id: string;
  _createTime: string;
  _updateTime: string;
  message: string;
  chat_phone: string;
  last_message: string;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ selectedPhone }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [showFullSuggestion, setShowFullSuggestion] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'monday'>('chat');
  const [showGrokModal, setShowGrokModal] = useState(false);
  const [grokPrompt, setGrokPrompt] = useState('');
  const [grokLoading, setGrokLoading] = useState(false);
  const [grokResponse, setGrokResponse] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: smooth ? 'smooth' : 'auto',
        block: 'end'
      });
    }
  }, []);

  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
    }
  }, []);

  const loadMessages = useCallback(async () => {
    if (!selectedPhone) return;
    
    setLoading(true);
    try {
      const phoneNumber = selectedPhone._id.replace('+', '');
      const messagesData = await apiMessageService.getMessages(phoneNumber);
      
      // Ordenar mensagens por data e hora (mais antigas primeiro)
      const sortedMessages = sortMessagesByTime(messagesData);
      setMessages(sortedMessages);
    } catch (error) {
      console.error('Erro ao carregar mensagens:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedPhone]);

  const loadAISuggestion = useCallback(async () => {
    if (!selectedPhone) return;
    
    try {
      console.log('🔄 Carregando sugestão de IA para:', selectedPhone._id);
      const phoneNumber = selectedPhone._id.replace('+', '');
      console.log('📞 Número formatado:', phoneNumber);
      const suggestion = await aiSuggestionService.getLastAISuggestion(phoneNumber);
      console.log('🤖 Sugestão recebida:', suggestion);
      setAiSuggestion(suggestion);
      if (suggestion) {
        console.log('✅ Exibindo sugestão de IA');
        setShowSuggestion(true);
      } else {
        console.log('❌ Nenhuma sugestão encontrada');
        setShowSuggestion(false);
      }
    } catch (error) {
      console.error('❌ Erro ao carregar sugestão de IA:', error);
      setShowSuggestion(false);
    }
  }, [selectedPhone]);

  // Scroll para a última mensagem quando carregar mensagens de um contato
  useEffect(() => {
    if (messages.length > 0 && !loading) {
      // Pequeno delay para garantir que o DOM foi atualizado
      setTimeout(() => {
        scrollToBottom(false);
      }, 100);
    }
  }, [messages, loading, scrollToBottom]);

  // Scroll para baixo apenas quando adicionar nova mensagem
  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      // Só faz scroll se for uma mensagem nova (criada nos últimos 2 segundos)
      const isNewMessage = Date.now() - new Date(lastMessage._createTime).getTime() < 2000;
      if (isNewMessage) {
        scrollToBottom(true);
      }
    }
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (selectedPhone) {
      loadMessages();
      loadAISuggestion();
    }
  }, [selectedPhone, loadMessages, loadAISuggestion]);

  // Ajustar altura do textarea quando o texto mudar
  useEffect(() => {
    adjustTextareaHeight();
  }, [newMessage, adjustTextareaHeight]);

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
    
    setMessages(prev => sortMessagesByTime([...prev, optimisticMessage]));
    
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
        
        setMessages(prev => 
          sortMessagesByTime(
            prev.map(msg => 
              msg._id === optimisticMessage._id ? finalMessage : msg
            )
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
      setMessages(prev => prev.filter(msg => msg._id !== optimisticMessage._id));
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

  const handleUseSuggestion = () => {
    if (aiSuggestion) {
      setNewMessage(aiSuggestion.message);
      setShowSuggestion(false);
      setShowInput(true); // Mostrar caixa de texto ao editar sugestão
      
      // Ajustar altura do textarea após definir o texto
      setTimeout(() => {
        adjustTextareaHeight();
      }, 0);
    }
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

  const handleDismissSuggestion = () => {
    setShowSuggestion(false);
  };

  const handleShowFullSuggestion = () => {
    setShowFullSuggestion(true);
  };

  const handleCloseFullSuggestion = () => {
    setShowFullSuggestion(false);
  };

  const truncateText = (text: string, maxLength: number = 350) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const handleSendSuggestion = async () => {
    if (!aiSuggestion || !selectedPhone) return;
    
    const messageText = aiSuggestion.message;
    setShowSuggestion(false);
    
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
    
    setMessages(prev => sortMessagesByTime([...prev, optimisticMessage]));
    
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
        
        setMessages(prev => 
          sortMessagesByTime(
            prev.map(msg => 
              msg._id === optimisticMessage._id ? finalMessage : msg
            )
          )
        );
        
        console.log('✅ Sugestão de IA enviada com sucesso');
      } else {
        throw new Error(result.error || 'Erro ao enviar sugestão');
      }
      
    } catch (error) {
      console.error('❌ Erro ao enviar sugestão de IA:', error);
      // Remover mensagem otimista em caso de erro
      setMessages(prev => prev.filter(msg => msg._id !== optimisticMessage._id));
      
      // Mostrar erro para o usuário
      alert(`Erro ao enviar sugestão: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  };

  const handleOpenGrokModal = () => {
    setShowGrokModal(true);
    setGrokPrompt('');
    setGrokResponse('');
  };

  const handleCloseGrokModal = () => {
    setShowGrokModal(false);
    setGrokPrompt('');
    setGrokResponse('');
  };

  const handleGrokSubmit = async () => {
    if (!grokPrompt.trim() || !selectedPhone) return;
    
    setGrokLoading(true);
    try {
      // Preparar contexto da conversa
      const lastMessage = messages.length > 0 ? messages[messages.length - 1].content : '';
      const conversationHistory = messages.slice(-5).map(msg => 
        `${msg.source === 'Member' ? 'Você' : 'Cliente'}: ${msg.content}`
      ).join('\n');

      const context = {
        lastMessage,
        phoneNumber: selectedPhone._id,
        conversationHistory
      };

      const response = await grokService.generateNewSuggestion(
        aiSuggestion?.message || '',
        grokPrompt,
        context
      );

      setGrokResponse(response);
    } catch (error) {
      console.error('❌ Erro ao gerar resposta com Grok:', error);
      setGrokResponse(`Erro ao gerar resposta: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    } finally {
      setGrokLoading(false);
    }
  };

  const handleUseGrokResponse = () => {
    if (!grokResponse) return;
    
    // Atualizar a sugestão atual com a resposta do Grok
    if (aiSuggestion) {
      setAiSuggestion({
        ...aiSuggestion,
        message: grokResponse
      });
    }
    
    // Fechar modal
    handleCloseGrokModal();
  };

  const handleSendGrokResponse = async () => {
    if (!grokResponse || !selectedPhone) return;
    
    handleCloseGrokModal();
    setShowSuggestion(false);
    
    // Criar mensagem otimista
    const optimisticMessage: Message = {
      _name: '',
      _id: `temp_${Date.now()}`,
      _createTime: new Date().toISOString(),
      _updateTime: new Date().toISOString(),
      chat_phone: selectedPhone._id ? selectedPhone._id.replace('+', '') : '',
      source: 'Member',
      content: grokResponse
    };
    
    setMessages(prev => sortMessagesByTime([...prev, optimisticMessage]));
    
    try {
      const result = await messageService.sendMessage(selectedPhone._id, grokResponse);
      
      if (result.success) {
        const finalMessage: Message = {
          ...optimisticMessage,
          _id: Date.now().toString(),
          _createTime: new Date().toISOString(),
          _updateTime: new Date().toISOString(),
        };
        
        setMessages(prev => 
          sortMessagesByTime(
            prev.map(msg => 
              msg._id === optimisticMessage._id ? finalMessage : msg
            )
          )
        );
        
        console.log('✅ Resposta do Grok enviada com sucesso');
      } else {
        throw new Error(result.error || 'Erro ao enviar resposta do Grok');
      }
      
    } catch (error) {
      console.error('❌ Erro ao enviar resposta do Grok:', error);
      setMessages(prev => prev.filter(msg => msg._id !== optimisticMessage._id));
      alert(`Erro ao enviar resposta: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
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
                  <span className="header-lead-name">{selectedPhone.lead_name}</span>
                  <span className="header-phone-number">{formatPhoneNumber(selectedPhone._id)}</span>
                </div>
              ) : (
                formatPhoneNumber(selectedPhone._id)
              )}
            </div>
            <div className="chat-header-status">online</div>
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
          {loading ? (
            <div className="loading-messages">Carregando mensagens...</div>
          ) : (
            <>
              {messages.map((message, index) => {
                const isSending = message._id.startsWith('temp_');
                const previousMessage = index > 0 ? messages[index - 1] : null;
                const showDateSeparator = shouldShowDateSeparator(message, previousMessage);
                
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
                      className={`message ${message.source === 'Member' || message.source === 'Bot' ? 'sent' : 'received'} ${message.source === 'Bot' ? 'bot' : ''} ${isSending ? 'sending' : ''}`}
                    >
                      <div className="message-content">
                        {message.source === 'Bot' && (
                          <div className="bot-indicator">
                            <span className="bot-icon">⚙️</span>
                            <span className="bot-label">Sistema</span>
                          </div>
                        )}
                        <div className="message-text">{message.content}</div>
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
      ) : (
        <MondayTab phone={selectedPhone._id} />
      )}

      {showSuggestion && aiSuggestion && activeTab === 'chat' && (
        <div className="ai-suggestion">
          <div className="suggestion-header">
            <span className="suggestion-icon">🤖</span>
            <span className="suggestion-title">Sugestão de IA</span>
            <button 
              className="suggestion-close" 
              onClick={handleDismissSuggestion}
              title="Fechar sugestão"
            >
              ×
            </button>
          </div>
          <div className="suggestion-content">
            {truncateText(aiSuggestion.message)}
            {aiSuggestion.message.length > 350 && (
              <button 
                className="see-more-btn"
                onClick={handleShowFullSuggestion}
              >
                Ver mais
              </button>
            )}
          </div>
          <div className="suggestion-actions">
            <button 
              className="suggestion-use-btn" 
              onClick={handleUseSuggestion}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
              </svg>
              Editar Sugestão
            </button>
            <button 
              className="suggestion-grok-btn" 
              onClick={handleOpenGrokModal}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              Nova Resposta com Grok
            </button>
            <button 
              className="suggestion-send-btn" 
              onClick={handleSendSuggestion}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
              Enviar Sugestão
            </button>
            <button 
              className="suggestion-write-btn" 
              onClick={handleShowInput}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
              </svg>
              Escrever Mensagem
            </button>
          </div>
        </div>
      )}

      {/* Modal para texto completo da sugestão */}
      {showFullSuggestion && aiSuggestion && (
        <div className="suggestion-modal-overlay" onClick={handleCloseFullSuggestion}>
          <div className="suggestion-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Sugestão de IA Completa</h3>
              <button 
                className="modal-close" 
                onClick={handleCloseFullSuggestion}
                title="Fechar"
              >
                ×
              </button>
            </div>
            <div className="modal-content">
              {aiSuggestion.message}
            </div>
            <div className="modal-actions">
              <button 
                className="modal-use-btn" 
                onClick={() => {
                  handleUseSuggestion();
                  handleCloseFullSuggestion();
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                </svg>
                Editar Sugestão
              </button>
              <button 
                className="modal-send-btn" 
                onClick={() => {
                  handleSendSuggestion();
                  handleCloseFullSuggestion();
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
                Enviar Sugestão
              </button>
            </div>
          </div>
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
      ) : !showSuggestion && (
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

      {/* Modal do Grok */}
      {showGrokModal && (
        <div className="grok-modal-overlay" onClick={handleCloseGrokModal}>
          <div className="grok-modal" onClick={(e) => e.stopPropagation()}>
            <div className="grok-modal-header">
              <div className="grok-header-info">
                <span className="grok-icon">🤖</span>
                <h3>Nova Resposta com Grok</h3>
              </div>
              <button 
                className="grok-modal-close" 
                onClick={handleCloseGrokModal}
                title="Fechar"
              >
                ×
              </button>
            </div>
            
            <div className="grok-modal-content">
              <div className="grok-prompt-section">
                <label htmlFor="grok-prompt">Descreva o que você gostaria de uma nova resposta:</label>
                <textarea
                  id="grok-prompt"
                  value={grokPrompt}
                  onChange={(e) => setGrokPrompt(e.target.value)}
                  placeholder="Ex: Quero uma resposta mais formal, ou mais amigável, ou que mencione nossos produtos..."
                  rows={3}
                  disabled={grokLoading}
                />
                <button 
                  className="grok-submit-btn"
                  onClick={handleGrokSubmit}
                  disabled={!grokPrompt.trim() || grokLoading}
                >
                  {grokLoading ? (
                    <>
                      <div className="grok-loading"></div>
                      Gerando resposta...
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                      </svg>
                      Gerar Nova Resposta
                    </>
                  )}
                </button>
              </div>

              {grokResponse && (
                <div className="grok-response-section">
                  <label>Nova resposta gerada:</label>
                  <div className="grok-response-content">
                    {grokResponse}
                  </div>
                  <div className="grok-response-actions">
                    <button 
                      className="grok-use-btn"
                      onClick={handleUseGrokResponse}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                      </svg>
                      Usar Esta Resposta
                    </button>
                    <button 
                      className="grok-send-btn"
                      onClick={handleSendGrokResponse}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                      </svg>
                      Enviar Diretamente
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatWindow;
