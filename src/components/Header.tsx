import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import './Header.css';

interface HeaderProps {
  activeTab?: 'whatsapp' | 'contencioso' | 'atendimento' | 'prompts';
  onWhatsAppClick?: () => void;
  onPromptsClick?: () => void;
  onContenciosoClick?: () => void;
  onBoard607533664Click?: () => void;
}

const Header: React.FC<HeaderProps> = ({ 
  activeTab = 'whatsapp',
  onWhatsAppClick, 
  onPromptsClick, 
  onContenciosoClick, 
  onBoard607533664Click 
}) => {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <header className="app-header">
      <div className="header-content">
        <div className="header-left">
          <div className="header-title">
            <div className="robot-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 6.5V7.5C15 8.3 14.3 9 13.5 9H10.5C9.7 9 9 8.3 9 7.5V6.5L3 7V9L9 8.5V9.5C9 10.3 9.7 11 10.5 11H13.5C14.3 11 15 10.3 15 9.5V8.5L21 9ZM7 14C8.1 14 9 14.9 9 16S8.1 18 7 18 5 17.1 5 16 5.9 14 7 14ZM17 14C18.1 14 19 14.9 19 16S18.1 18 17 18 15 17.1 15 16 15.9 14 17 14ZM12 20C13.1 20 14 20.9 14 22S13.1 24 12 24 10 23.1 10 22 10.9 20 12 20Z"/>
                <circle cx="8" cy="15" r="1.5" fill="currentColor" opacity="0.8"/>
                <circle cx="16" cy="15" r="1.5" fill="currentColor" opacity="0.8"/>
                <path d="M10 19h4v1h-4z" fill="currentColor" opacity="0.6"/>
              </svg>
            </div>
            <h1>Rosenbaum Advogados</h1>
          </div>
        </div>
        <div className="header-right">
          <button
            onClick={onWhatsAppClick}
            className={`header-prompts-button ${activeTab === 'whatsapp' ? 'active' : ''}`}
            title="Voltar ao WhatsApp"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            <span>WhatsApp</span>
          </button>
          <button
            onClick={onBoard607533664Click}
            className={`header-prompts-button ${activeTab === 'atendimento' ? 'active' : ''}`}
            title="Ver board de Atendimento"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
            </svg>
            <span>Atendimento</span>
          </button>
          <button
            onClick={onContenciosoClick}
            className={`header-prompts-button ${activeTab === 'contencioso' ? 'active' : ''}`}
            title="Ver board de contencioso"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1L3 5v6c0 5.25 3.75 10.74 9 12 5.25-1.26 9-6.75 9-12V5l-9-4zm0 2.18L18.09 6 12 9.82 5.91 6 12 3.18zM5 8.09l7 4.13 7-4.13V11c0 4.09-2.91 8.53-7 9.93C7.91 19.53 5 15.09 5 11V8.09z" />
            </svg>
            <span>Contencioso</span>
          </button>
          <button
            onClick={onPromptsClick}
            className={`header-prompts-button ${activeTab === 'prompts' ? 'active' : ''}`}
            title="Gerenciar prompts da IA"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 5h18v2H3V5zm4 6h14v2H7v-2zm-4 6h18v2H3v-2z" />
            </svg>
            <span>Prompts</span>
          </button>
          <span className="user-info">
            Olá, {user.name}
          </span>
          <span className="user-role">
            {user.role === 'admin' ? 'Administrador' : 'Usuário'}
          </span>
          <button onClick={logout} className="logout-button">
            Sair
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
