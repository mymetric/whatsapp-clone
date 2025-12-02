import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import ChatList from './components/ChatList';
import ChatWindow from './components/ChatWindow';
import CopilotSidebar from './components/CopilotSidebar';
import Login from './components/Login';
import Header from './components/Header';
import PromptsManager from './components/PromptsManager';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Phone, Message } from './types';
import { phoneService } from './services/api';

const AppContent: React.FC = () => {
  const [phones, setPhones] = useState<Phone[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<Phone | null>(null);
  const [currentMessages, setCurrentMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showPromptsPage, setShowPromptsPage] = useState(false);
  const { isAuthenticated } = useAuth();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<Date>(new Date());

  const stopAutoRefresh = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startAutoRefresh = useCallback(() => {
    stopAutoRefresh(); // Limpar qualquer intervalo existente
    intervalRef.current = setInterval(() => {
      // Verificar se a aba está visível e se houve atividade recente
      const timeSinceActivity = Date.now() - lastActivityRef.current.getTime();
      const isTabVisible = !document.hidden;
      const hasRecentActivity = timeSinceActivity < 5 * 60 * 1000; // 5 minutos
      
      if (isTabVisible && hasRecentActivity) {
        loadPhones(true); // true indica que é uma atualização automática
      }
    }, 30000); // 30 segundos
  }, [stopAutoRefresh]);

  useEffect(() => {
    if (isAuthenticated) {
      loadPhones();
      // Iniciar polling automático a cada 30 segundos
      startAutoRefresh();
      
      // Adicionar listeners para otimização
      const handleActivity = () => {
        lastActivityRef.current = new Date();
      };

      const handleVisibilityChange = () => {
        if (document.hidden) {
          stopAutoRefresh();
        } else {
          // Verificar se passou tempo suficiente desde a última atividade
          const timeSinceActivity = Date.now() - lastActivityRef.current.getTime();
          if (timeSinceActivity < 5 * 60 * 1000) { // 5 minutos
            startAutoRefresh();
          }
        }
      };

      // Adicionar listeners para atividade do usuário
      document.addEventListener('mousedown', handleActivity);
      document.addEventListener('keydown', handleActivity);
      document.addEventListener('scroll', handleActivity);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        stopAutoRefresh();
        document.removeEventListener('mousedown', handleActivity);
        document.removeEventListener('keydown', handleActivity);
        document.removeEventListener('scroll', handleActivity);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    } else {
      stopAutoRefresh();
    }
  }, [isAuthenticated, startAutoRefresh, stopAutoRefresh]);

  const loadPhones = async (isAutoRefresh = false) => {
    try {
      if (isAutoRefresh) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      console.log('Carregando telefones...', isAutoRefresh ? '(atualização automática)' : '');
      const phonesData = await phoneService.getPhones();
      console.log('Telefones carregados:', phonesData);
      setPhones(phonesData);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Erro ao carregar telefones:', err);
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(`Erro ao carregar conversas: ${errorMessage}`);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleManualRefresh = useCallback(() => {
    loadPhones(false);
  }, []);

  const handleRetry = useCallback(() => {
    loadPhones(false);
  }, []);

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
          <button onClick={handleRetry} className="retry-button">
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  if (showPromptsPage) {
    return (
      <div className="app fade-in">
        <Header onPromptsClick={() => setShowPromptsPage(false)} />
        <div className="prompts-page-container">
          <PromptsManager onClose={() => setShowPromptsPage(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="app fade-in">
      <Header onPromptsClick={() => setShowPromptsPage(true)} />
      <div className="app-main">
        <ChatList
          phones={phones}
          selectedPhone={selectedPhone?._id || null}
          onSelectPhone={handleSelectPhone}
          loading={loading}
          isRefreshing={isRefreshing}
          lastUpdate={lastUpdate}
          onManualRefresh={handleManualRefresh}
        />
        <ChatWindow 
          selectedPhone={selectedPhone} 
          onMessagesChange={setCurrentMessages}
        />
        <CopilotSidebar 
          selectedPhone={selectedPhone}
          messages={currentMessages}
        />
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
