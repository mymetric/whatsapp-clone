import React, { useState, useEffect, useCallback } from 'react';
import { MondayBoardItem, mondayService, MondayUpdate } from '../services/mondayService';
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

  const renderWhatsAppTab = () => {
    return (
      <div className="tab-content whatsapp-tab">
        <div className="whatsapp-placeholder">
          <div className="whatsapp-icon">💬</div>
          <p>Conversa com o lead será exibida aqui</p>
        </div>
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
