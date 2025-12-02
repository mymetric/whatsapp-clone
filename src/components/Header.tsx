import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import './Header.css';

interface HeaderProps {
  onPromptsClick?: () => void;
}

const Header: React.FC<HeaderProps> = ({ onPromptsClick }) => {
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
          {onPromptsClick && (
            <button onClick={onPromptsClick} className="header-prompts-button" title="Gerenciar prompts da IA">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 5h18v2H3V5zm4 6h14v2H7v-2zm-4 6h18v2H3v-2z" />
              </svg>
              <span>Prompts</span>
            </button>
          )}
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
