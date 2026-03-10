import React, { useState } from 'react';
import './App.css';
import Login from './components/Login';
import Header from './components/Header';
import PromptsManager from './components/PromptsManager';
import ContenciosoTab from './components/ContenciosoTab';
import ConversasLeadsTab from './components/ConversasLeadsTab';
import FileProcessingTab from './components/FileProcessingTab';
import AdminPanel from './components/AdminPanel';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CurrentLeadProvider } from './contexts/CurrentLeadContext';
import ErrorReportWidget from './components/ErrorReportWidget';

const AppContent: React.FC = () => {
  const [showPromptsPage, setShowPromptsPage] = useState(false);
  const [showContenciosoPage, setShowContenciosoPage] = useState(false);
  const [showFileProcessingPage, setShowFileProcessingPage] = useState(false);
  const [showAdminPage, setShowAdminPage] = useState(false);
  const { isAuthenticated, hasPermission, user } = useAuth();

  const userPermissions = user?.permissions ?? [];

  const resetAllPages = () => {
    setShowPromptsPage(false);
    setShowContenciosoPage(false);
    setShowFileProcessingPage(false);
    setShowAdminPage(false);
  };

  const handleAdminClick = () => {
    if (!hasPermission('admin')) return;
    resetAllPages();
    setShowAdminPage(true);
  };

  const headerProps = {
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

  let activeTab: 'conversas-leads' | 'file-processing' | 'contencioso' | 'prompts' | 'admin' = 'conversas-leads';
  let pageContent: React.ReactNode = <ConversasLeadsTab />;

  if (showAdminPage) {
    activeTab = 'admin';
    pageContent = <AdminPanel />;
  } else if (showFileProcessingPage) {
    activeTab = 'file-processing';
    pageContent = <FileProcessingTab />;
  } else if (showPromptsPage) {
    activeTab = 'prompts';
    pageContent = <PromptsManager onClose={() => setShowPromptsPage(false)} />;
  } else if (showContenciosoPage) {
    activeTab = 'contencioso';
    pageContent = <ContenciosoTab />;
  }

  return (
    <div className="app fade-in">
      <Header activeTab={activeTab} {...headerProps} />
      <div className="prompts-page-container">
        {pageContent}
      </div>
      <ErrorReportWidget />
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <CurrentLeadProvider>
        <AppContent />
      </CurrentLeadProvider>
    </AuthProvider>
  );
}

export default App;
