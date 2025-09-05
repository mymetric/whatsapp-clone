import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import './Header.css';

const Header: React.FC = () => {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <header className="app-header">
      <div className="header-content">
        <div className="header-left">
          <h1>Rosenbaum Advogados</h1>
          <span className="user-info">
            Olá, {user.name}
          </span>
        </div>
        <div className="header-right">
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
