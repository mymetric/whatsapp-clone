import React, { useState, useEffect } from 'react';
import { Phone } from '../types';
import { emailService } from '../services/api';
import './EmailTab.css';

interface EmailImage {
  extracted_text: string;
  file: string;
}

interface Email {
  _name: string;
  _id: string;
  _createTime: string;
  _updateTime: string;
  images?: string;
  sender: string;
  subject: string;
  destination: string;
  text: string;
}

interface EmailTabProps {
  selectedPhone: Phone | null;
}

const EmailTab: React.FC<EmailTabProps> = ({ selectedPhone }) => {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [showFullEmail, setShowFullEmail] = useState(false);

  const loadEmails = async () => {
    if (!selectedPhone) return;

    setLoading(true);
    setError(null);

    try {
      console.log('📧 EmailTab: Carregando emails para:', selectedPhone.lead_name || selectedPhone._id);
      const emailData = await emailService.getEmailForContact(selectedPhone);
      
      if (emailData && typeof emailData === 'object') {
        const data = emailData as any;
        let emailsArray: Email[] = [];
        
        // Verificar se há emails em 'destination'
        if (Array.isArray(data.destination) && data.destination.length > 0) {
          // Filtrar objetos vazios
          emailsArray = data.destination.filter((email: any) => email && Object.keys(email).length > 0);
          console.log('📧 EmailTab: Emails encontrados em destination:', emailsArray.length);
        }
        
        // Verificar se há emails em 'sender' (caso contrário do fluxo)
        if (Array.isArray(data.sender) && data.sender.length > 0) {
          // Filtrar objetos vazios
          const senderEmails = data.sender.filter((email: any) => email && Object.keys(email).length > 0);
          emailsArray = [...emailsArray, ...senderEmails];
          console.log('📧 EmailTab: Emails encontrados em sender:', senderEmails.length);
        }
        
        if (emailsArray.length > 0) {
          console.log('📧 EmailTab: Total de emails encontrados:', emailsArray.length);
          setEmails(emailsArray);
        } else {
          console.log('📧 EmailTab: Nenhum email válido encontrado');
          setEmails([]);
          setError('Nenhum email encontrado para este contato');
        }
      } else {
        console.log('📧 EmailTab: Nenhum email encontrado');
        setEmails([]);
        setError('Nenhum email encontrado para este contato');
      }
    } catch (err) {
      console.error('Erro ao carregar emails:', err);
      setError('Erro ao carregar emails trocados');
      setEmails([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedPhone) {
      loadEmails();
    } else {
      setEmails([]);
      setError(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhone]);

  const formatEmailDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('pt-BR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const parseEmailImages = (imagesString: string): EmailImage[] => {
    try {
      return JSON.parse(imagesString);
    } catch (error) {
      console.error('Erro ao fazer parse das imagens:', error);
      return [];
    }
  };

  const formatEmailContent = (text: string) => {
    // Replace common email reply indicators and clean up
    let cleanedText = text
      .replace(/_{5,}/g, '') // Remove lines with many underscores
      .replace(/^-{5,}/g, '') // Remove lines with many hyphens
      .replace(/De:.*?\n/g, '') // Remove "De: " lines
      .replace(/Enviado:.*?\n/g, '') // Remove "Enviado: " lines
      .replace(/Para:.*?\n/g, '') // Remove "Para: " lines
      .replace(/Assunto:.*?\n/g, '') // Remove "Assunto: " lines
      .replace(/\[cid:.*?\]/g, '') // Remove [cid:...]
      .trim();

    // Remove quoted replies (e.g., lines starting with >)
    cleanedText = cleanedText.split('\n').filter(line => !line.startsWith('>')).join('\n');

    return cleanedText;
  };


  const getImageUrl = (fileId: string) => {
    // Construir URL da imagem baseada no file ID
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  };

  const handleOpenFullEmail = (email: Email) => {
    setSelectedEmail(email);
    setShowFullEmail(true);
  };

  const handleCloseFullEmail = () => {
    setShowFullEmail(false);
    setSelectedEmail(null);
  };

  const renderEmailContent = (email: Email) => {
    const content = formatEmailContent(email.text);
    const images = email.images ? parseEmailImages(email.images) : [];

    return (
      <div className="email-content-container">
        {/* Imagens e transcrições */}
        {images.length > 0 && (
          <div className="email-images-section">
            <h4 className="section-title">📎 Anexos e Imagens</h4>
            {images.map((image, index) => (
              <div key={index} className="email-image-item">
                <div className="image-meta">
                  <span className="image-file-name">📄 {image.file}</span>
                  <a
                    href={getImageUrl(image.file)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="image-link"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
                    </svg>
                    Ver imagem
                  </a>
                </div>
                {image.extracted_text && (
                  <div className="image-transcription">
                    <div className="transcription-header">
                      <span className="transcription-label">📝 Transcrição:</span>
                    </div>
                    <div className="transcription-content">
                      {image.extracted_text}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Conteúdo do email */}
        <div className="email-text-content">
          {content}
        </div>
      </div>
    );
  };

  if (!selectedPhone) {
    return (
      <div className="email-tab">
        <div className="email-tab-placeholder">
          <div className="placeholder-icon">📧</div>
          <p>Selecione um contato para ver os emails trocados</p>
        </div>
      </div>
    );
  }

  return (
    <div className="email-tab">
      <div className="email-tab-header">
        <div className="email-tab-title">
          <span className="email-tab-icon">📧</span>
          <h2>Emails Trocados</h2>
        </div>
        <button onClick={loadEmails} className="refresh-button" title="Atualizar emails">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
        </button>
      </div>

      <div className="email-tab-content">
        {loading && (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Carregando emails...</p>
          </div>
        )}

        {error && (
          <div className="error-container">
            <div className="error-icon">⚠️</div>
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && emails.length === 0 && (
          <div className="no-emails-container">
            <div className="no-emails-icon">📭</div>
            <p>Nenhum email encontrado para este contato</p>
          </div>
        )}

        {!loading && !error && emails.length > 0 && (
          <div className="emails-list">
            {emails.map((email, index) => (
              <div key={email._id || index} className="email-item">
                <div className="email-meta">
                  <div className="email-subject">
                    <strong>Assunto:</strong> {email.subject || 'Sem assunto'}
                  </div>
                  <div className="email-participants">
                    <span><strong>De:</strong> {email.sender || 'Desconhecido'}</span>
                    <span><strong>Para:</strong> {email.destination || 'Desconhecido'}</span>
                  </div>
                  <div className="email-date">
                    <strong>Data:</strong> {formatEmailDate(email._createTime)}
                  </div>
                  <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-start' }}>
                    <button 
                      className="view-full-email-btn"
                      onClick={() => {
                        console.log('🔍 Botão Ver completo clicado para email:', email.subject);
                        handleOpenFullEmail(email);
                      }}
                      title="Ver email completo"
                      style={{
                        background: '#007bff',
                        color: 'white',
                        border: 'none',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '500',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                      </svg>
                      Ver completo
                    </button>
                  </div>
                </div>
                <div className="email-body">
                  {renderEmailContent(email)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal de email em tela cheia */}
        {showFullEmail && selectedEmail && (
          <div className="full-email-modal-overlay" onClick={handleCloseFullEmail}>
            <div className="full-email-modal" onClick={(e) => e.stopPropagation()}>
              <div className="full-email-header">
                <div className="full-email-title">
                  <h2>{selectedEmail.subject || 'Sem assunto'}</h2>
                  <div className="full-email-meta">
                    <div className="full-email-participants">
                      <span><strong>De:</strong> {selectedEmail.sender || 'Desconhecido'}</span>
                      <span><strong>Para:</strong> {selectedEmail.destination || 'Desconhecido'}</span>
                    </div>
                    <div className="full-email-date">
                      <strong>Data:</strong> {formatEmailDate(selectedEmail._createTime)}
                    </div>
                  </div>
                </div>
                <button 
                  className="close-full-email-btn" 
                  onClick={handleCloseFullEmail}
                  title="Fechar"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              </div>
              <div className="full-email-content">
                <div className="full-email-body">
                  {renderEmailContent(selectedEmail)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmailTab;
