import React, { useState, useEffect } from 'react';
import { mondayService, MondayUpdatesResponse, MondayItem, MondayUpdate } from '../services/mondayService';
import './MondayTab.css';

interface MondayTabProps {
  phone: string;
}

const MondayTab: React.FC<MondayTabProps> = ({ phone }) => {
  const [mondayData, setMondayData] = useState<MondayUpdatesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (phone) {
      loadMondayData();
    }
  }, [phone]);

  const loadMondayData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('📅 MondayTab: Carregando dados para telefone:', phone);
      const data = await mondayService.getMondayUpdates(phone);
      console.log('📅 MondayTab: Dados recebidos:', data);
      setMondayData(data);
      
      if (!data) {
        console.log('📅 MondayTab: Nenhum dado encontrado');
        setError('Nenhum dado encontrado no Monday.com para este telefone');
      }
    } catch (err) {
      console.error('Erro ao carregar dados do Monday:', err);
      setError('Erro ao carregar dados do Monday.com');
    } finally {
      setLoading(false);
    }
  };

  const renderUpdate = (update: MondayUpdate) => {
    const formattedBody = mondayService.formatUpdateBody(update.body);
    const formattedDate = mondayService.formatDate(update.created_at);
    
    return (
      <div key={update.id} className="monday-update">
        <div className="update-header">
          <div className="update-meta">
            <span className="update-date">{formattedDate}</span>
            {update.creator && (
              <span className="update-creator">
                por {update.creator.name}
              </span>
            )}
          </div>
        </div>
        <div className="update-content">
          {formattedBody}
        </div>
      </div>
    );
  };

  const renderItem = (item: MondayItem) => {
    return (
      <div key={item.id} className="monday-item">
        <div className="item-header">
          <h3 className="item-name">{item.name}</h3>
          <span className="item-updates-count">
            {item.updates.length} atualizações
          </span>
        </div>
        <div className="item-updates">
          {item.updates.map(renderUpdate)}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="monday-tab">
        <div className="monday-loading">
          <div className="loading-spinner"></div>
          <p>Carregando dados do Monday.com...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="monday-tab">
        <div className="monday-error">
          <div className="error-icon">⚠️</div>
          <h3>Erro ao carregar dados</h3>
          <p>{error}</p>
          <button onClick={loadMondayData} className="retry-button">
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  if (!mondayData || !mondayData.monday_updates?.items?.length) {
    return (
      <div className="monday-tab">
        <div className="monday-empty">
          <div className="empty-icon">📋</div>
          <h3>Nenhum dado encontrado</h3>
          <p>Não há informações do Monday.com para este telefone</p>
          <button onClick={loadMondayData} className="retry-button">
            Recarregar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="monday-tab">
      <div className="monday-header">
        <div className="monday-title">
          <span className="monday-icon">📋</span>
          <h2>Dados do Monday.com</h2>
        </div>
        <button onClick={loadMondayData} className="refresh-button" title="Atualizar dados">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
        </button>
      </div>

      <div className="monday-content">
        <div className="monday-info">
          <div className="info-item">
            <span className="info-label">Telefone:</span>
            <span className="info-value">{mondayData._id}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Última atualização:</span>
            <span className="info-value">
              {mondayService.formatDate(mondayData._updateTime)}
            </span>
          </div>
        </div>

        <div className="monday-items">
          {mondayData.monday_updates.items.map(renderItem)}
        </div>
      </div>
    </div>
  );
};

export default MondayTab;
