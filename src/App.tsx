import React, { useState, useEffect } from 'react';
import './App.css';
import ChatList from './components/ChatList';
import ChatWindow from './components/ChatWindow';
import Login from './components/Login';
import Header from './components/Header';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Phone } from './types';
import { phoneService } from './services/api';

const AppContent: React.FC = () => {
  const [phones, setPhones] = useState<Phone[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<Phone | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      loadPhones();
    }
  }, [isAuthenticated]);

  const loadPhones = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('Carregando telefones...');
      const phonesData = await phoneService.getPhones();
      console.log('Telefones carregados:', phonesData);
      setPhones(phonesData);
    } catch (err) {
      console.error('Erro ao carregar telefones:', err);
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(`Erro ao carregar conversas: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPhone = (phone: Phone) => {
    setSelectedPhone(phone);
  };

  if (!isAuthenticated) {
    return <Login />;
  }

  if (error) {
    return (
      <div className="app">
        <Header />
        <div className="error-container fade-in">
          <div className="error-icon">⚠️</div>
          <h3>Erro de Conexão</h3>
          <p>{error}</p>
          <button onClick={loadPhones} className="retry-button">
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app fade-in">
      <Header />
      <div className="app-main">
        <ChatList
          phones={phones}
          selectedPhone={selectedPhone?._id || null}
          onSelectPhone={handleSelectPhone}
          loading={loading}
        />
        <ChatWindow selectedPhone={selectedPhone} />
      </div>
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
