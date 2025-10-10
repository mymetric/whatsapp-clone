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
  const [filterBoard, setFilterBoard] = useState('');
  const [filterEtiqueta, setFilterEtiqueta] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const hasActiveFilters = searchTerm || filterBoard || filterEtiqueta || filterStatus;

  const clearAllFilters = () => {
    setSearchTerm('');
    setFilterBoard('');
    setFilterEtiqueta('');
    setFilterStatus('');
  };

  const formatPhoneNumber = (phone: string) => {
    // Remove o + e formata o número
    if (!phone) return 'Número não disponível';
    const cleanPhone = phone.replace('+', '');
    return `+${cleanPhone.slice(0, 2)} ${cleanPhone.slice(2, 4)} ${cleanPhone.slice(4, 9)}-${cleanPhone.slice(9)}`;
  };

  // Obter valores únicos para os dropdowns
  const uniqueBoards = useMemo(() => {
    const boards = phones.map(p => p.board).filter(Boolean) as string[];
    return Array.from(new Set(boards)).sort();
  }, [phones]);

  const uniqueEtiquetas = useMemo(() => {
    const etiquetas = phones.map(p => p.etiqueta).filter(Boolean) as string[];
    return Array.from(new Set(etiquetas)).sort();
  }, [phones]);

  const uniqueStatus = useMemo(() => {
    const statuses = phones.map(p => p.status).filter(Boolean) as string[];
    return Array.from(new Set(statuses)).sort();
  }, [phones]);

  const filteredPhones = useMemo(() => {
    return phones.filter(phone => {
      // Filtro de texto
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm.trim() || (
        (phone._id || '').toLowerCase().includes(searchLower) ||
        (phone.lead_name || '').toLowerCase().includes(searchLower) ||
        (phone.email || '').toLowerCase().includes(searchLower) ||
        (phone.etiqueta || '').toLowerCase().includes(searchLower) ||
        (phone.status || '').toLowerCase().includes(searchLower) ||
        (phone.board || '').toLowerCase().includes(searchLower)
      );

      // Filtros de dropdown
      const matchesBoard = !filterBoard || phone.board === filterBoard;
      const matchesEtiqueta = !filterEtiqueta || phone.etiqueta === filterEtiqueta;
      const matchesStatus = !filterStatus || phone.status === filterStatus;

      return matchesSearch && matchesBoard && matchesEtiqueta && matchesStatus;
    });
  }, [phones, searchTerm, filterBoard, filterEtiqueta, filterStatus]);

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
            placeholder="Buscar por nome, telefone, email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="filters-row">
          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="clear-filters-button"
              title="Limpar todos os filtros"
            >
              ✕
            </button>
          )}
          <div className="filters-container">
            <select
              value={filterBoard}
              onChange={(e) => setFilterBoard(e.target.value)}
              className="filter-select"
            >
              <option value="">📋 Board</option>
              {uniqueBoards.map(board => (
                <option key={board} value={board}>{board}</option>
              ))}
            </select>
            <select
              value={filterEtiqueta}
              onChange={(e) => setFilterEtiqueta(e.target.value)}
              className="filter-select"
            >
              <option value="">🏷️ Etiqueta</option>
              {uniqueEtiquetas.map(etiqueta => (
                <option key={etiqueta} value={etiqueta}>{etiqueta}</option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="filter-select"
            >
              <option value="">📊 Status</option>
              {uniqueStatus.map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="chat-items">
        {filteredPhones.length === 0 && (searchTerm || filterBoard || filterEtiqueta || filterStatus) ? (
          <div className="no-results">
            <p>Nenhuma conversa encontrada com os filtros aplicados</p>
          </div>
        ) : (
          filteredPhones.map((phone) => (
          <div
            key={phone._id || 'unknown'}
            className={`chat-item ${selectedPhone === phone._id ? 'selected' : ''}`}
            onClick={() => onSelectPhone(phone)}
          >
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
                  <div className="lead-name-container">
                    <span className="phone-number">{formatPhoneNumber(phone._id)}</span>
                    <span className="monday-not-found">⚠️ Telefone não encontrado no Monday</span>
                  </div>
                )}
              </div>
              <div className="chat-metadata">
                {phone.etiqueta && (
                  <span className="metadata-tag etiqueta">
                    🏷️ {phone.etiqueta}
                  </span>
                )}
                {phone.status && (
                  <span className="metadata-tag status">
                    📊 {phone.status}
                  </span>
                )}
                {phone.board && (
                  <span className="metadata-tag board">
                    📋 {phone.board}
                  </span>
                )}
              </div>
            </div>
            <div className="chat-metadata-right">
              <div className="chat-time">
                {formatTime(phone._updateTime)}
              </div>
              {phone.last_message && (
                <div className="message-count">
                  {phone.last_message}
                </div>
              )}
            </div>
          </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ChatList;
