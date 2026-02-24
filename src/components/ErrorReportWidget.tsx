import React, { useState, useRef, useEffect } from 'react';
import { apiFetch } from '../services/apiClient';
import './ErrorReportWidget.css';

interface ErrorReport {
  id: string;
  role: 'user' | 'system';
  content: string;
  timestamp: Date;
}

const ErrorReportWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ErrorReport[]>([]);
  const [input, setInput] = useState('');
  const [leadId, setLeadId] = useState('');
  const [sending, setSending] = useState(false);
  const [hasNewResponse, setHasNewResponse] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (endRef.current && isOpen) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // When opening, show welcome if no messages
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([{
        id: 'welcome',
        role: 'system',
        content: 'Descreva o erro que encontrou. Se possivel, informe o nome ou ID do lead associado no campo abaixo.',
        timestamp: new Date(),
      }]);
    }
  }, [isOpen, messages.length]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;

    const userMsg: ErrorReport = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    const errorDescription = input.trim();
    const associatedLead = leadId.trim();
    setInput('');
    setSending(true);

    try {
      const res = await apiFetch('/api/error-reports', {
        method: 'POST',
        body: JSON.stringify({
          description: errorDescription,
          leadId: associatedLead || null,
          url: window.location.href,
          userAgent: navigator.userAgent,
        }),
      });

      if (res.ok) {
        setMessages(prev => [...prev, {
          id: `sys_${Date.now()}`,
          role: 'system',
          content: 'Erro registrado com sucesso! Vamos analisar o mais breve possivel. Pode enviar mais detalhes se quiser.',
          timestamp: new Date(),
        }]);
        setLeadId('');
      } else {
        throw new Error('Falha ao enviar');
      }
    } catch {
      setMessages(prev => [...prev, {
        id: `err_${Date.now()}`,
        role: 'system',
        content: 'Nao foi possivel registrar o erro. Tente novamente.',
        timestamp: new Date(),
      }]);
    } finally {
      setSending(false);
    }
  };

  const handleToggle = () => {
    setIsOpen(!isOpen);
    if (!isOpen) setHasNewResponse(false);
  };

  return (
    <>
      {/* Floating button */}
      <button
        className={`error-report-fab ${hasNewResponse ? 'has-notification' : ''}`}
        onClick={handleToggle}
        title="Reportar erro"
      >
        {isOpen ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="error-report-panel">
          <div className="error-report-header">
            <span className="error-report-title">Reportar Erro</span>
            <button className="error-report-close" onClick={() => setIsOpen(false)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>

          <div className="error-report-messages">
            {messages.map(msg => (
              <div key={msg.id} className={`error-report-msg ${msg.role}`}>
                <div className="error-report-msg-content">{msg.content}</div>
              </div>
            ))}
            {sending && (
              <div className="error-report-msg system">
                <div className="error-report-msg-content error-report-typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="error-report-input-area">
            <input
              type="text"
              className="error-report-lead-input"
              value={leadId}
              onChange={e => setLeadId(e.target.value)}
              placeholder="Lead associado (nome ou ID, opcional)"
            />
            <div className="error-report-input-row">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Descreva o erro..."
                disabled={sending}
                rows={2}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="error-report-send-btn"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ErrorReportWidget;
