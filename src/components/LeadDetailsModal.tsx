import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MondayBoardItem, mondayService, MondayUpdate } from '../services/mondayService';
import { firestoreMessagesService, FirestoreMessage } from '../services/firestoreMessagesService';
import { messageService } from '../services/messageService';
import './LeadDetailsModal.css';

interface LeadDetailsModalProps {
  item: MondayBoardItem;
  columns: any[];
  boardId?: string | number;
  onClose: () => void;
}

type TabType = 'details' | 'updates' | 'whatsapp';

const LeadDetailsModal: React.FC<LeadDetailsModalProps> = ({ item, columns, boardId, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [updates, setUpdates] = useState<MondayUpdate[]>([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);
  const [updatesError, setUpdatesError] = useState<string | null>(null);

  // Estados do WhatsApp
  const [whatsappMessages, setWhatsappMessages] = useState<FirestoreMessage[]>([]);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const [whatsappLoaded, setWhatsappLoaded] = useState(false);

  // Estados para envio de mensagem
  const [newMessage, setNewMessage] = useState('');
  const [showMessageInput, setShowMessageInput] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadUpdates = useCallback(async () => {
    setLoadingUpdates(true);
    setUpdatesError(null);
    try {
      const itemData = await mondayService.getItemUpdatesForContencioso(item.id);
      if (itemData && itemData.updates) {
        setUpdates(itemData.updates);
      } else {
        setUpdates([]);
      }
    } catch (err) {
      console.error('Erro ao carregar updates:', err);
      setUpdatesError('Erro ao carregar updates');
      setUpdates([]);
    } finally {
      setLoadingUpdates(false);
    }
  }, [item.id]);

  // Carrega os updates quando a aba for selecionada
  useEffect(() => {
    if (activeTab === 'updates' && updates.length === 0) {
      loadUpdates();
    }
  }, [activeTab, updates.length, loadUpdates]);

  // Encontra o telefone do lead nas colunas
  const getLeadPhone = useCallback((): string | null => {
    if (!item.column_values) return null;

    // Procurar coluna de telefone por ID ou título
    const phoneKeywords = ['telefone', 'phone', 'celular', 'whatsapp', 'fone', 'tel'];

    for (const col of item.column_values) {
      const colId = col.id?.toLowerCase() || '';
      const colTitle = columns.find(c => c.id === col.id)?.title?.toLowerCase() || '';

      if (phoneKeywords.some(kw => colId.includes(kw) || colTitle.includes(kw))) {
        if (col.text && col.text.trim()) {
          // Normalizar: remover caracteres não numéricos
          const phone = col.text.replace(/\D/g, '');
          if (phone.length >= 10) {
            return phone;
          }
        }
      }
    }
    return null;
  }, [item.column_values, columns]);

  // Carrega mensagens do WhatsApp
  const loadWhatsappMessages = useCallback(async () => {
    const phone = getLeadPhone();
    if (!phone) {
      setWhatsappError('Telefone não encontrado nos dados do lead');
      return;
    }

    setWhatsappLoading(true);
    setWhatsappError(null);

    try {
      const result = await firestoreMessagesService.getMessages(phone, 100);
      setWhatsappMessages(result.messages);
      setWhatsappLoaded(true);
      if (result.messages.length === 0) {
        setWhatsappError('Nenhuma mensagem encontrada para este telefone');
      }
    } catch (err: any) {
      console.error('Erro ao buscar mensagens:', err);
      setWhatsappError(err.message || 'Erro ao buscar mensagens');
    } finally {
      setWhatsappLoading(false);
    }
  }, [getLeadPhone]);

  // Carrega mensagens do WhatsApp quando a aba for selecionada
  useEffect(() => {
    if (activeTab === 'whatsapp' && !whatsappLoaded) {
      loadWhatsappMessages();
    }
  }, [activeTab, whatsappLoaded, loadWhatsappMessages]);

  // Scroll para o final das mensagens
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  // Scroll automático quando novas mensagens chegarem
  useEffect(() => {
    if (whatsappMessages.length > 0) {
      scrollToBottom();
    }
  }, [whatsappMessages, scrollToBottom]);

  // Ajustar altura do textarea
  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
    }
  }, []);

  // Enviar mensagem
  const handleSendMessage = async () => {
    const phone = getLeadPhone();
    if (!newMessage.trim() || !phone) return;

    const messageText = newMessage.trim();
    setNewMessage('');
    setSendingMessage(true);

    // Criar mensagem otimista (aparece imediatamente)
    const optimisticMessage: FirestoreMessage = {
      id: `temp_${Date.now()}`,
      content: messageText,
      source: 'Bot', // Mensagens enviadas pelo sistema aparecem como Bot
      timestamp: new Date().toISOString(),
      name: 'Você',
      chat_phone: phone,
      audio: false,
      image: '',
    };

    setWhatsappMessages(prev => [...prev, optimisticMessage]);

    try {
      // Enviar mensagem via API - adicionar código do país se não tiver
      const phoneToSend = phone.startsWith('+') ? phone : `+${phone}`;
      const result = await messageService.sendMessage(phoneToSend, messageText);

      if (result.success) {
        console.log('✅ Mensagem enviada com sucesso');
        setShowMessageInput(false);

        // Atualizar lista de mensagens após envio bem-sucedido
        setTimeout(() => {
          loadWhatsappMessages();
        }, 1000);
      } else {
        throw new Error(result.error || 'Erro ao enviar mensagem');
      }
    } catch (error) {
      console.error('❌ Erro ao enviar mensagem:', error);
      // Remover mensagem otimista em caso de erro
      setWhatsappMessages(prev => prev.filter(msg => msg.id !== optimisticMessage.id));
      setNewMessage(messageText); // Restaurar texto
      alert(`Erro ao enviar mensagem: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    } finally {
      setSendingMessage(false);
    }
  };

  // Tecla Enter para enviar
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Mostrar input de mensagem
  const handleShowInput = () => {
    setShowMessageInput(true);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }, 100);
  };

  // Gera a URL do Monday.com para o item
  const getMondayUrl = () => {
    // URL padrão do Monday.com (pode ser ajustada conforme o workspace)
    // Formato: https://rosenbaum.monday.com/boards/[boardId]/pulses/[itemId]
    if (boardId) {
      return `https://rosenbaum.monday.com/boards/${boardId}/pulses/${item.id}`;
    }
    // Fallback para URL genérica
    return `https://rosenbaum.monday.com/boards/pulses/${item.id}`;
  };

  const handleOpenInMonday = () => {
    window.open(getMondayUrl(), '_blank', 'noopener,noreferrer');
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getColumnTitle = (colId: string): string => {
    const column = columns.find(col => col.id === colId);
    return column?.title || colId.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Agrupar colunas em grupos de informação
  const renderDetailsTab = () => {
    // Filtrar apenas colunas com valor preenchido
    const columnValues = (item.column_values || []).filter(col => 
      col.text && col.text.trim() !== '' && col.text !== '-'
    );
    
    // Dividir as colunas em três colunas para melhor organização
    const columnGroups: Array<Array<typeof item.column_values[0] | null>> = [];
    
    for (let i = 0; i < columnValues.length; i += 3) {
      columnGroups.push([
        columnValues[i],
        columnValues[i + 1] || null,
        columnValues[i + 2] || null
      ]);
    }

    return (
      <div className="tab-content details-tab">
        <div className="modal-info-compact">
          <div className="info-item">
            <span className="info-icon">🆔</span>
            <div>
              <div className="info-label">ID</div>
              <div className="info-value">{item.id}</div>
            </div>
          </div>
          {item.created_at && (
            <div className="info-item">
              <span className="info-icon">📅</span>
              <div>
                <div className="info-label">Criado em</div>
                <div className="info-value">{formatDate(item.created_at)}</div>
              </div>
            </div>
          )}
        </div>
        
        <div className="columns-compact">
          {columnGroups.map((group, index) => (
            <div key={index} className="column-row">
              {group.map((col, colIndex) => (
                col && (
                  <div key={colIndex} className="column-detail-compact">
                    <div className="column-label">{getColumnTitle(col.id)}</div>
                    <div className="column-value">{col.text || '-'}</div>
                  </div>
                )
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderUpdatesTab = () => {
    if (loadingUpdates) {
      return (
        <div className="tab-content updates-tab">
          <div className="updates-loading">
            <div className="loading-spinner-small"></div>
            <p>Carregando updates...</p>
          </div>
        </div>
      );
    }

    if (updatesError) {
      return (
        <div className="tab-content updates-tab">
          <div className="updates-error">
            <p>❌ {updatesError}</p>
            <button onClick={loadUpdates} className="retry-btn-small">
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }

    if (updates.length === 0) {
      return (
        <div className="tab-content updates-tab">
          <div className="updates-empty">
            <div className="empty-icon">📝</div>
            <p>Nenhum update encontrado</p>
          </div>
        </div>
      );
    }

    return (
      <div className="tab-content updates-tab">
        <div className="updates-list">
          {updates.map((update) => (
            <div key={update.id} className="update-item">
              <div className="update-header">
                <div className="update-creator">
                  {update.creator ? (
                    <>
                      <span className="creator-icon">👤</span>
                      <span className="creator-name">{update.creator.name}</span>
                    </>
                  ) : (
                    <span className="creator-unknown">Usuário desconhecido</span>
                  )}
                </div>
                <div className="update-date">
                  {mondayService.formatDate(update.created_at)}
                </div>
              </div>
              <div className="update-body">
                {mondayService.formatUpdateBody(update.body)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Formatar timestamp
  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderWhatsAppTab = () => {
    const phone = getLeadPhone();

    if (whatsappLoading) {
      return (
        <div className="tab-content whatsapp-tab">
          <div className="whatsapp-loading">
            <div className="loading-spinner-small"></div>
            <p>Carregando mensagens...</p>
          </div>
        </div>
      );
    }

    if (!phone) {
      return (
        <div className="tab-content whatsapp-tab">
          <div className="whatsapp-placeholder">
            <div className="whatsapp-icon">📱</div>
            <p>Telefone não encontrado nos dados do lead</p>
          </div>
        </div>
      );
    }

    return (
      <div className="tab-content whatsapp-tab">
        <div className="whatsapp-header-info">
          <span className="whatsapp-phone-label">📱 {phone}</span>
          {whatsappMessages.length > 0 && (
            <span className="whatsapp-count">{whatsappMessages.length} mensagem(s)</span>
          )}
          <button onClick={loadWhatsappMessages} className="whatsapp-refresh-btn" title="Atualizar mensagens">
            🔄
          </button>
        </div>

        {whatsappMessages.length > 0 ? (
          <div className="whatsapp-messages-list">
            {whatsappMessages.map((msg) => (
              <div
                key={msg.id}
                className={`whatsapp-message ${msg.source === 'Contact' ? 'contact' : 'bot'} ${msg.id.startsWith('temp_') ? 'sending' : ''}`}
              >
                <div className="whatsapp-message-header">
                  <span className="whatsapp-message-name">{msg.name || 'Desconhecido'}</span>
                  <span className="whatsapp-message-source">
                    {msg.source === 'Contact' ? 'Cliente' : 'Bot'}
                  </span>
                  <span className="whatsapp-message-time">
                    {msg.id.startsWith('temp_') ? 'Enviando...' : formatTimestamp(msg.timestamp)}
                  </span>
                </div>
                <div className="whatsapp-message-content">
                  {msg.audio && <span className="whatsapp-audio-badge">Audio</span>}
                  {msg.image && (
                    <img src={msg.image} alt="Imagem" className="whatsapp-message-image" />
                  )}
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="whatsapp-empty">
            <div className="whatsapp-icon">💬</div>
            <p>{whatsappError || 'Nenhuma mensagem encontrada'}</p>
            {whatsappError && (
              <button onClick={loadWhatsappMessages} className="retry-btn-small" style={{ marginTop: '12px' }}>
                Tentar novamente
              </button>
            )}
          </div>
        )}

        {/* Input de envio de mensagem */}
        {showMessageInput ? (
          <div className="whatsapp-input-container">
            <textarea
              ref={textareaRef}
              value={newMessage}
              onChange={(e) => {
                setNewMessage(e.target.value);
                adjustTextareaHeight();
              }}
              onKeyPress={handleKeyPress}
              placeholder="Digite uma mensagem..."
              rows={1}
              className="whatsapp-input"
              disabled={sendingMessage}
            />
            <button
              onClick={handleSendMessage}
              disabled={!newMessage.trim() || sendingMessage}
              className="whatsapp-send-btn"
              title="Enviar mensagem"
            >
              {sendingMessage ? (
                <div className="loading-spinner-tiny"></div>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              )}
            </button>
            <button
              onClick={() => {
                setShowMessageInput(false);
                setNewMessage('');
              }}
              className="whatsapp-cancel-btn"
              title="Cancelar"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="whatsapp-input-placeholder">
            <button onClick={handleShowInput} className="whatsapp-write-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
              </svg>
              <span>Escrever mensagem</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-content modal-content-large">
        <div className="modal-header">
          <div className="modal-title-section">
            <h2>{item.name}</h2>
          </div>
          <div className="modal-header-actions">
            <button 
              className="monday-link-btn" 
              onClick={handleOpenInMonday}
              title="Abrir no Monday.com"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
              </svg>
            </button>
            <button className="modal-close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        
        <div className="modal-tabs">
          <button 
            className={`tab-button ${activeTab === 'details' ? 'active' : ''}`}
            onClick={() => setActiveTab('details')}
          >
            <span className="tab-icon">📋</span>
            Detalhes
          </button>
          <button 
            className={`tab-button ${activeTab === 'updates' ? 'active' : ''}`}
            onClick={() => setActiveTab('updates')}
          >
            <span className="tab-icon">📝</span>
            Updates
            {updates.length > 0 && <span className="tab-badge">{updates.length}</span>}
          </button>
          <button 
            className={`tab-button ${activeTab === 'whatsapp' ? 'active' : ''}`}
            onClick={() => setActiveTab('whatsapp')}
          >
            <span className="tab-icon">💬</span>
            WhatsApp
          </button>
        </div>

        <div className="modal-body">
          {activeTab === 'details' && renderDetailsTab()}
          {activeTab === 'updates' && renderUpdatesTab()}
          {activeTab === 'whatsapp' && renderWhatsAppTab()}
        </div>

        <div className="modal-footer">
          <button className="modal-btn-close" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

export default LeadDetailsModal;
