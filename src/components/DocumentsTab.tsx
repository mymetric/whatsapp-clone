import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Phone, DocumentRecord } from '../types';
import { documentService, DocumentAnalysis } from '../services/api';
import './DocumentsTab.css';

interface ProcessedFile {
  id: string;
  fileName: string;
  mediaType: string;
  extractedText: string;
  processedAt: string;
}

interface DocumentsTabProps {
  selectedPhone: Phone | null;
}

// Valor auxiliar apenas para detectar textos muito longos.
// A exibição é limitada a 3 linhas via CSS; este valor é só um fallback.
const MAX_PREVIEW_LENGTH = 300;

const DocumentsTab: React.FC<DocumentsTabProps> = ({ selectedPhone }) => {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [generatingAnalysis, setGeneratingAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDocuments, setExpandedDocuments] = useState<Record<string, boolean>>({});
  const [expandedAnalysis, setExpandedAnalysis] = useState(false);
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);
  const [loadingProcessed, setLoadingProcessed] = useState(false);
  const [expandedProcessed, setExpandedProcessed] = useState<Record<string, boolean>>({});
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<DocumentRecord[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [expandedSearch, setExpandedSearch] = useState<Record<string, boolean>>({});

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

  const fetchProcessedFiles = useCallback(async () => {
    if (!selectedPhone?._id) {
      setProcessedFiles([]);
      return;
    }
    setLoadingProcessed(true);
    try {
      const res = await fetch(`/api/files/extracted-texts?phone=${encodeURIComponent(selectedPhone._id)}`);
      if (res.ok) {
        const files: ProcessedFile[] = await res.json();
        setProcessedFiles(files);
      } else {
        setProcessedFiles([]);
      }
    } catch (err) {
      console.error('Erro ao carregar arquivos processados:', err);
      setProcessedFiles([]);
    } finally {
      setLoadingProcessed(false);
    }
  }, [selectedPhone]);

  useEffect(() => {
    if (!selectedPhone) {
      setDocuments([]);
      setAnalysis(null);
      setProcessedFiles([]);
      setError(null);
      setCountdown(null);
      setExpandedProcessed({});
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
    fetchProcessedFiles();
  }, [selectedPhone, fetchAnalysis, fetchDocuments, fetchProcessedFiles]);

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

  const handleToggleProcessed = (id: string) => {
    setExpandedProcessed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToggleDocument = (id: string) => {
    setExpandedDocuments((prev) => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleToggleSearch = (id: string) => {
    setExpandedSearch((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;

    setSearchLoading(true);
    setSearchError(null);
    setSearchResults(null);
    setExpandedSearch({});

    try {
      const isEmail = query.includes('@');
      let docs: DocumentRecord[];

      if (isEmail) {
        docs = await documentService.getDocumentsByEmail(query);
      } else {
        docs = await documentService.getDocumentsByPhone(query);
      }

      // Também buscar arquivos processados por telefone (se não for email)
      if (!isEmail) {
        try {
          const res = await fetch(`/api/files/extracted-texts?phone=${encodeURIComponent(query)}`);
          if (res.ok) {
            const files: ProcessedFile[] = await res.json();
            // Converter para DocumentRecord para exibir junto
            const fileDocs: DocumentRecord[] = files.map(f => ({
              id: f.id,
              origin: 'phone' as const,
              direction: 'received' as const,
              text: f.extractedText,
              images: [],
              metadata: { subject: `[Arquivo Processado] ${f.fileName} (${f.mediaType})` },
              createdAt: f.processedAt,
            }));
            docs = [...docs, ...fileDocs];
          }
        } catch {
          // Ignorar erro de arquivos processados
        }
      }

      docs.sort((a, b) => {
        const getTime = (r: DocumentRecord) => {
          const ref = r.updatedAt || r.createdAt;
          return ref ? new Date(ref).getTime() || 0 : 0;
        };
        return getTime(b) - getTime(a);
      });

      setSearchResults(docs);
      if (docs.length === 0) {
        setSearchError('Nenhum documento encontrado para esta busca');
      }
    } catch (err) {
      console.error('Erro na busca de documentos:', err);
      setSearchError('Erro ao buscar documentos');
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery]);

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
            fetchProcessedFiles();
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

      {/* Busca por email ou telefone */}
      <div className="documents-search-bar">
        <input
          type="text"
          className="documents-search-input"
          placeholder="Buscar documentos por email ou telefone..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
        />
        <button
          className="documents-search-button"
          onClick={handleSearch}
          disabled={searchLoading || !searchQuery.trim()}
        >
          {searchLoading ? 'Buscando...' : 'Buscar'}
        </button>
        {searchResults !== null && (
          <button
            className="documents-search-clear"
            onClick={() => { setSearchQuery(''); setSearchResults(null); setSearchError(null); setExpandedSearch({}); }}
            title="Limpar busca"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Resultados da busca */}
      {searchResults !== null && (
        <div className="documents-tab-content">
          <div className="documents-section-header">
            <h3 className="documents-section-title">
              <span className="documents-section-icon">🔍</span>
              Resultados da Busca ({searchResults.length})
            </h3>
          </div>

          {searchError && (
            <div className="documents-error">
              <div className="error-icon">⚠️</div>
              <p>{searchError}</p>
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="documents-list">
              {searchResults.map((document) => {
                const isExpanded = Boolean(expandedSearch[document.id]);
                const directionLabel = document.direction ? directionLabels[document.direction] : 'Documento';
                const originLabel = originLabels[document.origin];
                const fullText = document.text || '';
                const lineCount = fullText.split(/\r?\n/).length;
                const hasLongText = lineCount > 3 || fullText.length > MAX_PREVIEW_LENGTH;

                return (
                  <div key={`search-${document.origin}-${document.id}`} className="document-card">
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
                          <span>Recebido em <strong>{formatDateTime(document.createdAt)}</strong></span>
                        )}
                        {!document.createdAt && document.updatedAt && (
                          <span>Atualizado em <strong>{formatDateTime(document.updatedAt)}</strong></span>
                        )}
                      </div>
                    </div>

                    {document.metadata && (
                      <div className="document-meta">
                        {document.metadata.sender && <div><strong>Remetente:</strong> {document.metadata.sender}</div>}
                        {document.metadata.destination && <div><strong>Destinatário:</strong> {document.metadata.destination}</div>}
                      </div>
                    )}

                    {fullText && (
                      <div className={`document-text ${hasLongText && !isExpanded ? 'document-text-collapsed' : ''}`}>
                        <pre>{fullText}</pre>
                        {hasLongText && (
                          <button className="document-toggle-button" onClick={() => handleToggleSearch(document.id)}>
                            {isExpanded ? 'Ver menos' : 'Ver mais'}
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
                                <a href={image.url} target="_blank" rel="noopener noreferrer" className="document-image-link">Abrir</a>
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
      )}

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
              const fullText = document.text || '';

              // Detectar se o texto é suficientemente longo para mostrar botão "Ver mais"
              const lineCount = fullText.split(/\r?\n/).length;
              const hasLongText = lineCount > 3 || fullText.length > MAX_PREVIEW_LENGTH;

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

                  {fullText && (
                    <div
                      className={`document-text ${
                        hasLongText && !isExpanded ? 'document-text-collapsed' : ''
                      }`}
                    >
                      <pre>{fullText}</pre>
                      {hasLongText && (
                        <button
                          className="document-toggle-button"
                          onClick={() => handleToggleDocument(document.id)}
                        >
                          {isExpanded ? 'Ver menos' : 'Ver mais'}
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

        {/* Seção de Arquivos Processados (file_processing_queue) */}
        {(processedFiles.length > 0 || loadingProcessed) && (
          <>
            <div className="documents-separator"></div>
            <div className="documents-section-header">
              <h3 className="documents-section-title">
                <span className="documents-section-icon">🗃️</span>
                Arquivos Processados ({processedFiles.length})
              </h3>
            </div>
          </>
        )}

        {loadingProcessed && (
          <div className="documents-loading">
            <div className="loading-spinner"></div>
            <p>Carregando arquivos processados...</p>
          </div>
        )}

        {!loadingProcessed && processedFiles.length > 0 && (
          <div className="documents-list">
            {processedFiles.map((file) => {
              const isExpanded = Boolean(expandedProcessed[file.id]);
              const lineCount = file.extractedText.split(/\r?\n/).length;
              const hasLongText = lineCount > 3 || file.extractedText.length > MAX_PREVIEW_LENGTH;

              const mediaTypeLabel: Record<string, string> = {
                pdf: 'PDF',
                docx: 'DOCX',
                image: 'Imagem',
                audio: 'Áudio',
              };

              return (
                <div key={file.id} className="document-card">
                  <div className="document-card-header">
                    <div className="document-card-header-left">
                      <span className="document-pill document-pill-default">
                        {mediaTypeLabel[file.mediaType] || file.mediaType || 'Arquivo'}
                      </span>
                      <span className="document-origin">
                        {file.fileName || 'Sem nome'}
                      </span>
                    </div>
                    <div className="document-timestamps">
                      {file.processedAt && (
                        <span>
                          Processado em <strong>{formatDateTime(file.processedAt)}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <div
                    className={`document-text ${
                      hasLongText && !isExpanded ? 'document-text-collapsed' : ''
                    }`}
                  >
                    <pre>{file.extractedText}</pre>
                    {hasLongText && (
                      <button
                        className="document-toggle-button"
                        onClick={() => handleToggleProcessed(file.id)}
                      >
                        {isExpanded ? 'Ver menos' : 'Ver mais'}
                      </button>
                    )}
                  </div>
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

