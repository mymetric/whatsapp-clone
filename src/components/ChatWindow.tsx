import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, Message } from '../types';
import { messageService as apiMessageService, aiSuggestionService } from '../services/api';
import { messageService } from '../services/messageService';
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
      setMessages(messagesData);
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
    
    setMessages(prev => [...prev, optimisticMessage]);
    
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
    
    setMessages(prev => [...prev, optimisticMessage]);
    
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
          prev.map(msg => 
            msg._id === optimisticMessage._id ? finalMessage : msg
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
            <div className="chat-header-name">{formatPhoneNumber(selectedPhone._id)}</div>
            <div className="chat-header-status">online</div>
          </div>
        </div>
      </div>

      <div className="chat-messages" ref={messagesContainerRef}>
        {loading ? (
          <div className="loading-messages">Carregando mensagens...</div>
        ) : (
          <>
            {messages.map((message) => {
              const isSending = message._id.startsWith('temp_');
              return (
                <div
                  key={message._id}
                  className={`message ${message.source === 'Member' ? 'sent' : 'received'} ${isSending ? 'sending' : ''}`}
                >
                  <div className="message-content">
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
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {showSuggestion && aiSuggestion && (
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
              className="suggestion-send-btn" 
              onClick={handleSendSuggestion}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
              Enviar Sugestão
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
