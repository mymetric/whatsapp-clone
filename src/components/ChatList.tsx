import React, { useState, useMemo } from 'react';
import { Phone } from '../types';
import './ChatList.css';

interface ChatListProps {
  phones: Phone[];
  selectedPhone: string | null;
  onSelectPhone: (phone: Phone) => void;
  loading: boolean;
  isRefreshing?: boolean;
  lastUpdate?: Date | null;
  onManualRefresh?: () => void;
}

const ChatList: React.FC<ChatListProps> = ({ 
  phones, 
  selectedPhone, 
  onSelectPhone, 
  loading, 
  isRefreshing = false, 
  lastUpdate, 
  onManualRefresh 
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const formatPhoneNumber = (phone: string) => {
    // Remove o + e formata o número
    if (!phone) return 'Número não disponível';
    const cleanPhone = phone.replace('+', '');
    return `+${cleanPhone.slice(0, 2)} ${cleanPhone.slice(2, 4)} ${cleanPhone.slice(4, 9)}-${cleanPhone.slice(9)}`;
  };

  const filteredPhones = useMemo(() => {
    if (!searchTerm.trim()) {
      return phones;
    }
    
    const searchLower = searchTerm.toLowerCase();
    return phones.filter(phone => {
      const phoneNumber = phone._id || '';
      const lastMessage = phone.last_message || '';
      const leadName = phone.lead_name || '';
      const email = phone.email || '';
      
      return phoneNumber.toLowerCase().includes(searchLower) ||
             lastMessage.toLowerCase().includes(searchLower) ||
             leadName.toLowerCase().includes(searchLower) ||
             email.toLowerCase().includes(searchLower);
    });
  }, [phones, searchTerm]);

  const formatTime = (timestamp: string) => {
    if (!timestamp) return 'Data não disponível';
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } else if (diffInHours < 48) {
      return 'Ontem';
    } else {
      return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }
  };

  const formatLastUpdate = (date: Date | null) => {
    if (!date) return '';
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) {
      return 'Atualizado agora';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `Atualizado há ${minutes} min`;
    } else {
      return `Atualizado às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    }
  };

  if (loading) {
    return (
      <div className="chat-list">
        <div className="chat-list-header">
          <h2>Conversas</h2>
        </div>
        <div className="loading">Carregando conversas...</div>
      </div>
    );
  }

  return (
    <div className="chat-list">
      <div className="chat-list-header">
        <div className="header-top">
          <h2>Conversas</h2>
          <button 
            className={`refresh-button ${isRefreshing ? 'refreshing' : ''}`}
            onClick={onManualRefresh}
            disabled={isRefreshing}
            title="Atualizar lista de conversas"
          >
            {isRefreshing ? '⟳' : '↻'}
          </button>
        </div>
        {lastUpdate && (
          <div className="last-update">
            {formatLastUpdate(lastUpdate)}
            {isRefreshing && <span className="auto-refresh-indicator"> • Atualizando...</span>}
          </div>
        )}
        <div className="search-container">
          <input
            type="text"
            placeholder="Buscar por nome, telefone ou mensagem..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
      </div>
      <div className="chat-items">
        {filteredPhones.length === 0 && searchTerm ? (
          <div className="no-results">
            <p>Nenhuma conversa encontrada para "{searchTerm}"</p>
          </div>
        ) : (
          filteredPhones.map((phone) => (
          <div
            key={phone._id || 'unknown'}
            className={`chat-item ${selectedPhone === phone._id ? 'selected' : ''}`}
            onClick={() => onSelectPhone(phone)}
          >
            <div className="chat-avatar">
              <div className="avatar-circle">
                {phone._id ? phone._id.slice(-2).toUpperCase() : 'NA'}
              </div>
            </div>
            <div className="chat-info">
              <div className="chat-name">
                {phone.lead_name ? (
                  <div className="lead-name-container">
                    <div className="name-email-container">
                      <span className="lead-name">{phone.lead_name}</span>
                      {phone.email && <span className="client-email">{phone.email}</span>}
                    </div>
                    <span className="phone-number">{formatPhoneNumber(phone._id)}</span>
                  </div>
                ) : (
                  formatPhoneNumber(phone._id)
                )}
              </div>
              <div className="chat-last-message">
                Última mensagem: {phone.last_message || 'Nenhuma mensagem'}
              </div>
            </div>
            <div className="chat-time">
              {formatTime(phone._updateTime)}
            </div>
          </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ChatList;
