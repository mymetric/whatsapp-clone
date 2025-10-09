import React from 'react';
import './EmailPanel.css';

interface EmailData {
  _name: string;
  _id: string;
  _createTime: string;
  _updateTime: string;
  images: string;
  sender: string;
  subject: string;
  destination: string;
  text: string;
}

interface EmailPanelProps {
  emails: EmailData[] | null;
  isOpen: boolean;
  onClose: () => void;
  contactName?: string;
}

const EmailPanel: React.FC<EmailPanelProps> = ({ emails, isOpen, onClose, contactName }) => {
  if (!isOpen) return null;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatText = (text: string) => {
    return text.replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
  };

  return (
    <div className="email-panel-overlay" onClick={onClose}>
      <div className="email-panel" onClick={(e) => e.stopPropagation()}>
        <div className="email-panel-header">
          <h3>Emails trocados</h3>
          <div className="email-contact-info">
            {contactName && <span className="contact-name">{contactName}</span>}
            <span className="email-count">{emails?.length || 0} email(s)</span>
          </div>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="email-panel-content">
          {emails && emails.length > 0 ? (
            emails.map((email, index) => (
              <div key={email._id || index} className="email-item">
                <div className="email-header">
                  <div className="email-subject">{email.subject}</div>
                  <div className="email-date">{formatDate(email._updateTime)}</div>
                </div>
                <div className="email-sender">
                  <strong>De:</strong> {email.sender}
                </div>
                <div className="email-destination">
                  <strong>Para:</strong> {email.destination}
                </div>
                <div className="email-text">
                  <div dangerouslySetInnerHTML={{ __html: formatText(email.text) }} />
                </div>
              </div>
            ))
          ) : (
            <div className="no-emails">
              <p>Nenhum email encontrado para este contato.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmailPanel;
