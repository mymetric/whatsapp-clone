import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Phone, DocumentRecord } from '../types';
import { documentService } from '../services/api';
import './DocumentsTab.css';

interface DocumentsTabProps {
  selectedPhone: Phone | null;
}

const MAX_PREVIEW_LENGTH = 500;

const DocumentsTab: React.FC<DocumentsTabProps> = ({ selectedPhone }) => {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDocuments, setExpandedDocuments] = useState<Record<string, boolean>>({});

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
      setError(null);
      return;
    }

    fetchDocuments();
  }, [selectedPhone, fetchDocuments]);

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
          onClick={fetchDocuments}
          className="documents-refresh-button"
          title="Atualizar documentos"
          disabled={loading}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
          </svg>
          <span>Atualizar</span>
        </button>
      </div>

      <div className="documents-tab-content">
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

