import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Phone, DocumentRecord } from '../types';
import { documentService, DocumentAnalysis } from '../services/api';
import './DocumentsTab.css';

interface DocumentsTabProps {
  selectedPhone: Phone | null;
}

const MAX_PREVIEW_LENGTH = 500;

const DocumentsTab: React.FC<DocumentsTabProps> = ({ selectedPhone }) => {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [generatingAnalysis, setGeneratingAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDocuments, setExpandedDocuments] = useState<Record<string, boolean>>({});
  const [expandedAnalysis, setExpandedAnalysis] = useState(false);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const fetchAnalysis = useCallback(async () => {
    if (!selectedPhone?.pulse_id) {
      setAnalysis(null);
      return;
    }

    setLoadingAnalysis(true);
    try {
      const analysisData = await documentService.getDocumentAnalysis(selectedPhone.pulse_id);
      setAnalysis(analysisData);
    } catch (err) {
      console.error('❌ Erro ao carregar análise:', err);
      setAnalysis(null);
    } finally {
      setLoadingAnalysis(false);
    }
  }, [selectedPhone]);

  const handleGenerateAnalysis = useCallback(async () => {
    if (!selectedPhone?.pulse_id) {
      window.alert('ID do Monday não disponível para este contato');
      return;
    }

    if (!window.confirm('Deseja gerar uma nova análise de documentos? Isso pode levar alguns minutos.')) {
      return;
    }

    setGeneratingAnalysis(true);
    setError(null);

    try {
      const success = await documentService.generateDocumentAnalysis(selectedPhone.pulse_id);
      if (success) {
        window.alert('Análise gerada com sucesso! A análise será atualizada automaticamente em 1 minuto.');
        
        // Limpar timers anteriores se existirem
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current);
        }
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
        }

        // Iniciar contador visual de 60 segundos
        setCountdown(60);
        
        // Timer de contagem regressiva (atualiza a cada segundo)
        countdownTimerRef.current = setInterval(() => {
          setCountdown((prev) => {
            if (prev === null || prev <= 1) {
              if (countdownTimerRef.current) {
                clearInterval(countdownTimerRef.current);
                countdownTimerRef.current = null;
              }
              return null;
            }
            return prev - 1;
          });
        }, 1000);

        // Criar timer de 1 minuto (60000ms) para atualizar a análise
        refreshTimerRef.current = setTimeout(() => {
          console.log('⏰ Timer de 1 minuto: Atualizando análise...');
          fetchAnalysis();
          setCountdown(null);
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          refreshTimerRef.current = null;
        }, 60000); // 1 minuto
      }
    } catch (err) {
      console.error('❌ Erro ao gerar análise:', err);
      setError('Erro ao gerar análise. Tente novamente.');
      window.alert('Erro ao gerar análise. Verifique o console para mais detalhes.');
    } finally {
      setGeneratingAnalysis(false);
    }
  }, [selectedPhone, fetchAnalysis]);

  const fetchDocuments = useCallback(async () => {
    if (!selectedPhone) return;

    setLoading(true);
    setError(null);

    try {
      const docs = await documentService.getDocumentsForContact(selectedPhone);
      const sortedDocs = docs.sort((a, b) => {
        const getTime = (record: DocumentRecord) => {
          const reference = record.updatedAt || record.createdAt;
          if (!reference) return 0;
          const date = new Date(reference);
          return date.getTime() || 0;
        };

        return getTime(b) - getTime(a);
      });

      setDocuments(sortedDocs);
      setExpandedDocuments({});

      if (sortedDocs.length === 0) {
        setError('Nenhum documento encontrado para este contato');
      }
    } catch (err) {
      console.error('❌ Erro ao carregar documentos:', err);
      setDocuments([]);
      setError('Erro ao carregar documentos');
    } finally {
      setLoading(false);
    }
  }, [selectedPhone]);

  useEffect(() => {
    if (!selectedPhone) {
      setDocuments([]);
      setAnalysis(null);
      setError(null);
      setCountdown(null);
      // Limpar timers ao trocar de contato
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      return;
    }

    fetchAnalysis();
    fetchDocuments();
  }, [selectedPhone, fetchAnalysis, fetchDocuments]);

  // Limpar timers ao desmontar componente
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, []);

  const handleToggleDocument = (id: string) => {
    setExpandedDocuments((prev) => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const formatDateTime = useCallback((iso?: string) => {
    if (!iso) return 'Data não disponível';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Data não disponível';
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }, []);

  const originLabels = useMemo(
    () => ({
      email: 'E-mail',
      phone: 'Telefone'
    }),
    []
  );

  const directionLabels = useMemo(
    () => ({
      sent: 'Enviado',
      received: 'Recebido'
    }),
    []
  );

  if (!selectedPhone) {
    return (
      <div className="documents-tab">
        <div className="documents-placeholder">
          <div className="placeholder-icon">📄</div>
          <p>Selecione um contato para visualizar os documentos</p>
        </div>
      </div>
    );
  }

  return (
    <div className="documents-tab">
      <div className="documents-tab-header">
        <div className="documents-tab-title">
          <span className="documents-tab-icon">📄</span>
          <div>
            <h2>Documentos do Lead</h2>
            <span className="documents-tab-subtitle">
              Fonte: integrações por e-mail e telefone •{' '}
              {selectedPhone.lead_name || formatDateTime(selectedPhone._updateTime)}
            </span>
          </div>
        </div>

        <button
          onClick={() => {
            fetchAnalysis();
            fetchDocuments();
          }}
          className="documents-refresh-button"
          title="Atualizar documentos e análise"
          disabled={loading || loadingAnalysis}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
          </svg>
          <span>Atualizar</span>
        </button>
      </div>

      <div className="documents-tab-content">
        {/* Seção de Análise */}
        {selectedPhone?.pulse_id && (
          <div className="analysis-section">
            <div className="analysis-header">
              <h3 className="analysis-title">
                <span className="analysis-icon">📊</span>
                Análise do Caso
              </h3>
              <div className="analysis-header-actions">
                {loadingAnalysis && (
                  <span className="analysis-loading">Carregando...</span>
                )}
                {countdown !== null && countdown > 0 && (
                  <span className="countdown-timer">
                    ⏱️ Atualizando em {countdown}s
                  </span>
                )}
                <button
                  onClick={handleGenerateAnalysis}
                  className="generate-analysis-button"
                  disabled={generatingAnalysis || loadingAnalysis}
                  title="Gerar nova análise de documentos"
                >
                  {generatingAnalysis ? (
                    <>
                      <span className="button-spinner"></span>
                      Gerando...
                    </>
                  ) : (
                    <>
                      <span>🔄</span>
                      Gerar Análise
                    </>
                  )}
                </button>
              </div>
            </div>

            {!loadingAnalysis && analysis && (
              <div className="analysis-card">
                <div className="analysis-meta">
                  <span>Última atualização: {formatDateTime(analysis.last_update || analysis._updateTime)}</span>
                </div>

                {analysis.checklist && (
                  <div className="analysis-content">
                    <h4 className="analysis-subtitle">Checklist de Documentos</h4>
                    <div className="analysis-text">
                      <ReactMarkdown>{analysis.checklist}</ReactMarkdown>
                    </div>
                  </div>
                )}

                {analysis.analise && (
                  <div className="analysis-content">
                    <h4 className="analysis-subtitle">Análise Completa</h4>
                    <div className={`analysis-text ${expandedAnalysis ? 'expanded' : ''}`}>
                      <ReactMarkdown>{analysis.analise}</ReactMarkdown>
                      {analysis.analise.length > 2000 && (
                        <button
                          className="analysis-toggle-button"
                          onClick={() => setExpandedAnalysis(!expandedAnalysis)}
                        >
                          {expandedAnalysis ? 'Ver menos' : 'Ver completo'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!loadingAnalysis && !analysis && (
              <div className="analysis-empty">
                <p>Nenhuma análise disponível para este caso</p>
              </div>
            )}
          </div>
        )}

        {/* Separador entre análise e documentos */}
        {selectedPhone?.pulse_id && analysis && documents.length > 0 && (
          <div className="documents-separator"></div>
        )}

        {/* Seção de Documentos */}
        {!loading && documents.length > 0 && (
          <div className="documents-section-header">
            <h3 className="documents-section-title">
              <span className="documents-section-icon">📄</span>
              Todos os Documentos
            </h3>
          </div>
        )}

        {loading && (
          <div className="documents-loading">
            <div className="loading-spinner"></div>
            <p>Carregando documentos...</p>
          </div>
        )}

        {!loading && error && (
          <div className="documents-error">
            <div className="error-icon">⚠️</div>
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && documents.length === 0 && (
          <div className="documents-empty">
            <div className="empty-icon">🗂️</div>
            <p>Nenhum documento encontrado para este contato</p>
          </div>
        )}

        {!loading && !error && documents.length > 0 && (
          <div className="documents-list">
            {documents.map((document) => {
              const isExpanded = Boolean(expandedDocuments[document.id]);
              const directionLabel = document.direction ? directionLabels[document.direction] : 'Documento';
              const originLabel = originLabels[document.origin];
              const hasLongText = document.text ? document.text.length > MAX_PREVIEW_LENGTH : false;
              const displayText =
                document.text && !isExpanded && hasLongText
                  ? `${document.text.slice(0, MAX_PREVIEW_LENGTH)}…`
                  : document.text;

              return (
                <div key={`${document.origin}-${document.id}`} className="document-card">
                  <div className="document-card-header">
                    <div className="document-card-header-left">
                      <span className={`document-pill document-pill-${document.direction ?? 'default'}`}>
                        {directionLabel}
                      </span>
                      <span className="document-origin">
                        {originLabel}
                        {document.metadata?.subject && ` • ${document.metadata.subject}`}
                      </span>
                    </div>
                    <div className="document-timestamps">
                      {document.createdAt && (
                        <span>
                          Recebido em <strong>{formatDateTime(document.createdAt)}</strong>
                        </span>
                      )}
                      {!document.createdAt && document.updatedAt && (
                        <span>
                          Atualizado em <strong>{formatDateTime(document.updatedAt)}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  {document.metadata && (
                    <div className="document-meta">
                      {document.metadata.sender && (
                        <div>
                          <strong>Remetente:</strong> {document.metadata.sender}
                        </div>
                      )}
                      {document.metadata.destination && (
                        <div>
                          <strong>Destinatário:</strong> {document.metadata.destination}
                        </div>
                      )}
                    </div>
                  )}

                  {displayText && (
                    <div className="document-text">
                      <pre>{displayText}</pre>
                      {hasLongText && (
                        <button
                          className="document-toggle-button"
                          onClick={() => handleToggleDocument(document.id)}
                        >
                          {isExpanded ? 'Ver menos' : 'Ver completo'}
                        </button>
                      )}
                    </div>
                  )}

                  {document.images.length > 0 && (
                    <div className="document-images">
                      <h4>Arquivos vinculados</h4>
                      <div className="document-images-grid">
                        {document.images.map((image, index) => (
                          <div key={`${image.fileId}-${index}`} className="document-image-item">
                            <div className="document-image-header">
                              <span className="document-image-name">📄 {image.fileId}</span>
                              <a
                                href={image.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="document-image-link"
                              >
                                Abrir
                              </a>
                            </div>
                            {image.extractedText && (
                              <div className="document-image-transcription">
                                <span className="transcription-label">Transcrição</span>
                                <pre>{image.extractedText}</pre>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentsTab;

