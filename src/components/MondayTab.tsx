import React, { useState, useEffect } from 'react';
import { mondayService, MondayUpdatesResponse, MondayUpdate } from '../services/mondayService';
import { grokService } from '../services/grokService';
import { Message } from '../types';
import './MondayTab.css';

interface MondayTabProps {
  phone: string;
  messages?: Message[];
  pulseId?: string; // ID do item no Monday (se disponível, usa direto sem buscar por telefone)
}

const MondayTab: React.FC<MondayTabProps> = ({ phone, messages = [], pulseId }) => {
  const [mondayData, setMondayData] = useState<MondayUpdatesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summarySuccess, setSummarySuccess] = useState<string | null>(null);

  useEffect(() => {
    if (phone || pulseId) {
      loadMondayData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, pulseId]);

  const loadMondayData = async () => {
    setLoading(true);
    setError(null);

    try {
      let data: MondayUpdatesResponse | null = null;

      // Se temos o pulseId, busca diretamente pelo ID (mais rápido)
      if (pulseId) {
        console.log('📅 MondayTab: Buscando updates diretamente pelo pulseId:', pulseId);
        const itemData = await mondayService.getItemUpdatesForContencioso(pulseId);

        if (itemData) {
          // Formatar resposta no mesmo formato esperado
          data = {
            _name: itemData.name,
            _id: phone,
            _createTime: new Date().toISOString(),
            _updateTime: new Date().toISOString(),
            monday_updates: {
              items: [itemData],
            },
          };
          console.log('📅 MondayTab: Dados recebidos via pulseId:', data);
        }
      }

      // Se não encontrou via pulseId, busca por telefone
      if (!data && phone) {
        console.log('📅 MondayTab: Buscando dados por telefone:', phone);
        data = await mondayService.getMondayUpdates(phone);
        console.log('📅 MondayTab: Dados recebidos via telefone:', data);
      }

      setMondayData(data);

      if (!data) {
        console.log('📅 MondayTab: Nenhum dado encontrado');
        setError('Nenhum dado encontrado no Monday.com');
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

  // Função para gerar resumo da conversa e postar no Monday
  const handleGenerateSummary = async (itemId: string) => {
    if (!messages || messages.length === 0) {
      setSummaryError('Não há mensagens para resumir');
      return;
    }

    setGeneratingSummary(true);
    setSummaryError(null);
    setSummarySuccess(null);

    try {
      // Preparar histórico de conversa
      const conversationHistory = messages
        .slice(-50) // Últimas 50 mensagens
        .map((msg) => {
          const sender = msg.source === 'Member' ? 'Atendente' : msg.source === 'Bot' ? 'Sistema' : 'Cliente';
          const date = new Date(msg._updateTime).toLocaleString('pt-BR');
          return `[${date}] ${sender}: ${msg.content || '(mídia)'}`;
        })
        .join('\n');

      // Prompt para gerar resumo
      const summaryPrompt = `Você é um assistente especializado em criar resumos de conversas de WhatsApp para registro em CRM.

Analise a conversa abaixo e crie um RESUMO EXECUTIVO conciso contendo:

1. **Contexto**: Quem é o cliente e qual o motivo do contato
2. **Pontos Principais**: Os tópicos mais importantes discutidos
3. **Ações Tomadas**: O que foi feito durante o atendimento
4. **Pendências**: Se houver algo pendente ou próximos passos
5. **Status**: Se o atendimento foi concluído ou está em andamento

INSTRUÇÕES:
- Seja objetivo e conciso (máximo 500 caracteres)
- Use bullet points quando apropriado
- Não inclua informações sensíveis como CPF, RG, senhas
- Foque no que é relevante para acompanhamento do caso
- Escreva em português brasileiro

CONVERSA:
${conversationHistory}

RESUMO:`;

      // Gerar resumo usando Grok
      const summary = await grokService.generateResponse(summaryPrompt, {
        conversationHistory,
        phoneNumber: phone,
      });

      if (!summary || summary.trim().length === 0) {
        throw new Error('Não foi possível gerar o resumo');
      }

      // Formatar o update com cabeçalho
      const now = new Date().toLocaleString('pt-BR');
      const updateBody = `📋 **Resumo da Conversa WhatsApp**\n📅 Gerado em: ${now}\n\n${summary}`;

      // Postar no Monday
      await mondayService.createUpdate(itemId, updateBody);

      setSummarySuccess('Resumo postado com sucesso no Monday!');

      // Recarregar dados para mostrar o novo update
      setTimeout(() => {
        loadMondayData();
        setSummarySuccess(null);
      }, 2000);

    } catch (err: any) {
      console.error('❌ Erro ao gerar/postar resumo:', err);
      setSummaryError(err.message || 'Erro ao gerar resumo da conversa');
    } finally {
      setGeneratingSummary(false);
    }
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
    console.log('📋 Renderizando tela vazia - sem dados do Monday para este telefone');
    
    return (
      <div className="monday-tab">
        <div className="monday-empty">
          <div className="empty-icon">📋</div>
          <h3>Nenhum dado encontrado</h3>
          <p>Não há informações do Monday.com para este telefone</p>
          <div className="monday-empty-actions">
            <button onClick={loadMondayData} className="retry-button" disabled={loading}>
              Recarregar
            </button>
          </div>
          {error && (
            <div className="error-message" style={{ marginTop: '10px', color: '#e74c3c' }}>
              {error}
            </div>
          )}
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
        <div className="monday-header-actions">
          {mondayData?.monday_updates?.items?.[0] && (
            <button
              className={`summary-button header-summary-button ${generatingSummary ? 'loading' : ''}`}
              onClick={() => handleGenerateSummary(mondayData.monday_updates.items[0].id)}
              disabled={generatingSummary || messages.length === 0}
              title={messages.length === 0 ? 'Sem mensagens para resumir' : 'Gerar resumo da conversa e postar no Monday'}
            >
              {generatingSummary ? (
                <>
                  <div className="summary-loading-spinner"></div>
                  <span>Gerando...</span>
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                  </svg>
                  <span>Resumir Conversa</span>
                </>
              )}
            </button>
          )}
          <button onClick={loadMondayData} className="refresh-button" title="Atualizar dados">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
          </button>
        </div>
      </div>

      {(summaryError || summarySuccess) && (
        <div className={`summary-message header-summary-message ${summarySuccess ? 'success' : 'error'}`}>
          {summarySuccess || summaryError}
        </div>
      )}

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
          {mondayData.monday_updates.items.map((item) => (
            <div key={item.id} className="monday-item">
              <div className="item-header">
                <h3 className="item-name">{item.name}</h3>
                <span className="item-updates-count">
                  {item.updates.length} atualizações
                </span>
              </div>
              <div className="item-updates">
                {item.updates.length > 0 ? (
                  item.updates.map(renderUpdate)
                ) : (
                  <div className="no-updates-message">Nenhuma atualização ainda</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};

export default MondayTab;
