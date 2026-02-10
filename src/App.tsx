import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import ChatList from './components/ChatList';
import ChatWindow from './components/ChatWindow';
import CopilotSidebar from './components/CopilotSidebar';
import Login from './components/Login';
import Header from './components/Header';
import PromptsManager from './components/PromptsManager';
import ContenciosoTab from './components/ContenciosoTab';
import ConversasLeadsTab from './components/ConversasLeadsTab';
import FileProcessingTab from './components/FileProcessingTab';
import AdminPanel from './components/AdminPanel';
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
  const [showContenciosoPage, setShowContenciosoPage] = useState(false);
  const [showConversasLeadsPage, setShowConversasLeadsPage] = useState(true);
  const [showFileProcessingPage, setShowFileProcessingPage] = useState(false);
  const [showAdminPage, setShowAdminPage] = useState(false);
  const { isAuthenticated, hasPermission, user } = useAuth();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<Date>(new Date());

  const userPermissions = user?.permissions ?? [];

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

  const resetAllPages = () => {
    setShowPromptsPage(false);
    setShowContenciosoPage(false);
    setShowConversasLeadsPage(false);
    setShowFileProcessingPage(false);
    setShowAdminPage(false);
  };

  const handleWhatsAppClick = () => {
    if (!hasPermission('whatsapp')) return;
    resetAllPages();
  };

  const handleAdminClick = () => {
    if (!hasPermission('admin')) return;
    resetAllPages();
    setShowAdminPage(true);
  };

  const headerProps = {
    onWhatsAppClick: handleWhatsAppClick,
    onPromptsClick: () => {
      if (!hasPermission('prompts')) return;
      resetAllPages();
      setShowPromptsPage(true);
    },
    onContenciosoClick: () => {
      if (!hasPermission('contencioso')) return;
      resetAllPages();
      setShowContenciosoPage(true);
    },
    onConversasLeadsClick: () => {
      if (!hasPermission('conversas-leads')) return;
      resetAllPages();
      setShowConversasLeadsPage(true);
    },
    onFileProcessingClick: () => {
      if (!hasPermission('file-processing')) return;
      resetAllPages();
      setShowFileProcessingPage(true);
    },
    onAdminClick: handleAdminClick,
    userPermissions,
  };

  if (!isAuthenticated) {
    return <Login />;
  }

  if (error) {
    return (
      <div className="app">
        <Header userPermissions={userPermissions} onAdminClick={handleAdminClick} />
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

  if (showAdminPage) {
    return (
      <div className="app fade-in">
        <Header activeTab="admin" {...headerProps} />
        <div className="prompts-page-container">
          <AdminPanel />
        </div>
      </div>
    );
  }

  if (showFileProcessingPage) {
    return (
      <div className="app fade-in">
        <Header activeTab="file-processing" {...headerProps} />
        <div className="prompts-page-container">
          <FileProcessingTab />
        </div>
      </div>
    );
  }

  if (showPromptsPage) {
    return (
      <div className="app fade-in">
        <Header activeTab="prompts" {...headerProps} />
        <div className="prompts-page-container">
          <PromptsManager onClose={() => setShowPromptsPage(false)} />
        </div>
      </div>
    );
  }

  if (showContenciosoPage) {
    return (
      <div className="app fade-in">
        <Header activeTab="contencioso" {...headerProps} />
        <div className="prompts-page-container">
          <ContenciosoTab />
        </div>
      </div>
    );
  }

  if (showConversasLeadsPage) {
    return (
      <div className="app fade-in">
        <Header activeTab="conversas-leads" {...headerProps} />
        <div className="prompts-page-container">
          <ConversasLeadsTab />
        </div>
      </div>
    );
  }

  return (
    <div className="app fade-in">
      <Header activeTab="whatsapp" {...headerProps} />
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
