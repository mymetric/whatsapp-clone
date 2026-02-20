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

const AppContent: React.FC = () => {
  const [showPromptsPage, setShowPromptsPage] = useState(false);
  const [showContenciosoPage, setShowContenciosoPage] = useState(false);
  const [showConversasLeadsPage, setShowConversasLeadsPage] = useState(true);
  const [showFileProcessingPage, setShowFileProcessingPage] = useState(false);
  const [showAdminPage, setShowAdminPage] = useState(false);
  const { isAuthenticated, hasPermission, user } = useAuth();

  const userPermissions = user?.permissions ?? [];

  const resetAllPages = () => {
    setShowPromptsPage(false);
    setShowContenciosoPage(false);
    setShowConversasLeadsPage(false);
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

  return (
    <div className="app fade-in">
      <Header activeTab="conversas-leads" {...headerProps} />
      <div className="prompts-page-container">
        <ConversasLeadsTab />
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
