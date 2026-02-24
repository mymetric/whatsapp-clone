import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { MondayBoardItem, mondayService, MondayUpdate } from '../services/mondayService';
import { firestoreMessagesService, FirestoreMessage } from '../services/firestoreMessagesService';
import { messageService } from '../services/messageService';
import { promptService, Prompt, documentService, DocumentAnalysis, emailService } from '../services/api';
import { DocumentRecord } from '../types';
import { grokService } from '../services/grokService';
import { contextCompactionService, UseCase, AdHocFile, ContextStats } from '../services/contextCompactionService';
import './LeadDetailsPanel.css';

const ATENDIMENTO_BOARD_ID = 607533664;

interface FreshData {
  messages: FirestoreMessage[];
  docs: DocumentRecord[];
  analysis: DocumentAnalysis | null;
  files: Array<{id: string; fileName: string; mediaType: string; extractedText: string; processedAt: string}>;
  emails: any[];
  mondayUpdates: MondayUpdate[];
}

interface LeadDetailsPanelProps {
  item: MondayBoardItem;
  columns: any[];
  boardId?: string | number;
  onClose: () => void;
  onLeadCreated?: () => void;
  defaultTab?: 'details' | 'updates' | 'whatsapp' | 'copilot' | 'documents' | 'emails';
}

type TabType = 'details' | 'updates' | 'whatsapp' | 'copilot' | 'documents' | 'emails';

interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const LeadDetailsPanel: React.FC<LeadDetailsPanelProps> = ({ item, columns, boardId, onClose, onLeadCreated, defaultTab = 'whatsapp' }) => {
  const [activeTab, setActiveTab] = useState<TabType>(defaultTab);
  const [updates, setUpdates] = useState<MondayUpdate[]>([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);
  const [updatesError, setUpdatesError] = useState<string | null>(null);
  const [newUpdateText, setNewUpdateText] = useState('');
  const [sendingUpdate, setSendingUpdate] = useState(false);

  // Estados do WhatsApp
  const [whatsappMessages, setWhatsappMessages] = useState<FirestoreMessage[]>([]);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const [whatsappLoaded, setWhatsappLoaded] = useState(false);

  // Estados para envio de mensagem
  const [newMessage, setNewMessage] = useState('');
  const [showMessageInput, setShowMessageInput] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [conversationChannelPhone, setConversationChannelPhone] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const allPromptsMapRef = useRef<Map<string, Prompt>>(new Map());

  // Estados para cadastro de lead
  const [showCreateLeadModal, setShowCreateLeadModal] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [leadNameInput, setLeadNameInput] = useState('');
  const [leadEmailInput, setLeadEmailInput] = useState('');
  const [createLeadError, setCreateLeadError] = useState<string | null>(null);
  const [statusOptions, setStatusOptions] = useState<Record<string, string[]>>({});
  const [statusValue, setStatusValue] = useState('');
  const [status1Value, setStatus1Value] = useState('');
  const [status14Value, setStatus14Value] = useState('');
  const [status152Value, setStatus152Value] = useState('');

  // Estados para prompts
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [analysisPrompts, setAnalysisPrompts] = useState<Prompt[]>([]);
  const [usingPrompt, setUsingPrompt] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [generatingAnalysisPrompt, setGeneratingAnalysisPrompt] = useState<string | null>(null);
  const [showEditPromptModal, setShowEditPromptModal] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [promptNameInput, setPromptNameInput] = useState('');
  const [promptContentInput, setPromptContentInput] = useState('');
  const [promptDescriptionInput, setPromptDescriptionInput] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);

  // Estados para Copiloto
  const [copilotMessages, setCopilotMessages] = useState<CopilotMessage[]>([]);
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotLoading, setCopilotLoading] = useState(false);
  const copilotEndRef = useRef<HTMLDivElement>(null);
  const [copilotFiles, setCopilotFiles] = useState<AdHocFile[]>([]);
  const copilotFileInputRef = useRef<HTMLInputElement>(null);

  // Estado para feedback visual do contexto
  const [contextStats, setContextStats] = useState<ContextStats | null>(null);
  const [showContextDetails, setShowContextDetails] = useState(false);

  // Estados para documentos (usados no contexto do Copiloto)
  const [leadDocuments, setLeadDocuments] = useState<DocumentRecord[]>([]);
  const [documentAnalysis, setDocumentAnalysis] = useState<DocumentAnalysis | null>(null);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const [processedFiles, setProcessedFiles] = useState<Array<{id: string; fileName: string; mediaType: string; extractedText: string; processedAt: string}>>([]);

  // Estados para emails
  const [leadEmails, setLeadEmails] = useState<any[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailsLoaded, setEmailsLoaded] = useState(false);

  // Estado do contexto (dados prontos para os prompts)
  const [contextReady, setContextReady] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set());

  // Verificar se é um item órfão (sem lead no Monday)
  const isOrphan = item.id.startsWith('whatsapp_');

  // Resetar estados quando o item mudar
  useEffect(() => {
    setWhatsappMessages([]);
    setWhatsappLoaded(false);
    setWhatsappError(null);
    setUpdates([]);
    setCopilotMessages([]);
    setLeadDocuments([]);
    setDocumentAnalysis(null);
    setDocumentsLoaded(false);
    setExpandedDocs(new Set());
    setLeadEmails([]);
    setEmailsLoaded(false);
    setExpandedEmails(new Set());
    setContextReady(false);
    setLoadingContext(false);
    setNewMessage('');
    setShowMessageInput(false);
    setCopilotInput('');
    setCopilotFiles([]);
    setContextStats(null);
    setShowContextDetails(false);
    setActiveTab('whatsapp');
  }, [item.id]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const loadUpdates = useCallback(async () => {
    if (isOrphan) return; // Não carregar updates para itens órfãos

    setLoadingUpdates(true);
    setUpdatesError(null);
    try {
      const itemData = await mondayService.getItemUpdatesForContencioso(item.id);
      if (itemData && itemData.updates) {
        setUpdates(itemData.updates);
      } else {
        setUpdates([]);
      }
    } catch (err) {
      console.error('Erro ao carregar updates:', err);
      setUpdatesError('Erro ao carregar updates');
      setUpdates([]);
    } finally {
      setLoadingUpdates(false);
    }
  }, [item.id, isOrphan]);

  // Função para enviar update para o Monday
  const handleSendUpdate = async () => {
    if (!newUpdateText.trim() || sendingUpdate || isOrphan) return;
    setSendingUpdate(true);
    try {
      await mondayService.createUpdate(item.id, newUpdateText.trim());
      setNewUpdateText('');
      // Recarregar updates para mostrar o novo
      await loadUpdates();
    } catch (error) {
      console.error('Erro ao enviar update:', error);
      alert('Erro ao enviar update. Tente novamente.');
    } finally {
      setSendingUpdate(false);
    }
  };

  // Carrega os updates quando a aba for selecionada
  useEffect(() => {
    if (activeTab === 'updates' && updates.length === 0 && !isOrphan) {
      loadUpdates();
    }
  }, [activeTab, updates.length, loadUpdates, isOrphan]);

  // Carrega opções de status do Monday quando o modal de criar lead é aberto
  useEffect(() => {
    if (!showCreateLeadModal) return;

    const loadStatusOptions = async () => {
      try {
        console.log('📅 Carregando opções de status do board para cadastro de lead');
        const boardColumns = await mondayService.getBoardColumns(ATENDIMENTO_BOARD_ID);

        const targetStatusIds = ['status', 'status_1', 'status_14', 'status_152'];
        const newStatusOptions: Record<string, string[]> = {};

        if (Array.isArray(boardColumns)) {
          boardColumns.forEach((col: any) => {
            if (!col || !targetStatusIds.includes(col.id) || col.type !== 'status') return;
            if (!col.settings_str) return;
            try {
              const settings = JSON.parse(col.settings_str);
              const labelsObj = settings?.labels || {};
              const labels = Object.values(labelsObj).filter((v: any) => typeof v === 'string' && v.trim().length > 0) as string[];
              newStatusOptions[col.id] = labels;
            } catch (e) {
              console.error('❌ Erro ao parsear settings_str da coluna do Monday:', col.id, e);
            }
          });
        }

        console.log('✅ Opções de status carregadas:', Object.keys(newStatusOptions).length, 'colunas');
        setStatusOptions(newStatusOptions);
      } catch (error) {
        console.error('❌ Erro ao carregar opções de status do Monday:', error);
      }
    };

    loadStatusOptions();
  }, [showCreateLeadModal]);

  // Encontra o telefone do lead nas colunas
  const getLeadPhone = useCallback((): string | null => {
    if (!item.column_values) return null;

    // Procurar coluna de telefone por ID ou título
    const phoneKeywords = ['telefone', 'phone', 'celular', 'whatsapp', 'fone', 'tel'];

    for (const col of item.column_values) {
      const colId = col.id?.toLowerCase() || '';
      const colTitle = columns.find(c => c.id === col.id)?.title?.toLowerCase() || '';

      if (phoneKeywords.some(kw => colId.includes(kw) || colTitle.includes(kw))) {
        if (col.text && col.text.trim()) {
          // Normalizar: remover caracteres não numéricos
          const phone = col.text.replace(/\D/g, '');
          if (phone.length >= 10) {
            return phone;
          }
        }
      }
    }
    return null;
  }, [item.column_values, columns]);

  // Encontra o email do lead nas colunas
  const getLeadEmail = useCallback((): string | null => {
    if (!item.column_values) return null;

    const emailKeywords = ['email', 'e_mail', 'e-mail', 'mail'];

    for (const col of item.column_values) {
      const colId = col.id?.toLowerCase() || '';
      const colTitle = columns.find(c => c.id === col.id)?.title?.toLowerCase() || '';

      if (emailKeywords.some(kw => colId.includes(kw) || colTitle.includes(kw))) {
        if (col.text && col.text.trim() && col.text.includes('@')) {
          return col.text.trim();
        }
      }
    }
    return null;
  }, [item.column_values, columns]);

  // Carrega emails do lead
  const loadLeadEmails = useCallback(async () => {
    const email = getLeadEmail();
    if (!email || emailsLoaded) return;

    setEmailsLoading(true);
    try {
      const emailData = await emailService.getEmailByEmail(email);
      if (emailData) {
        let allEmails: any[] = [];

        if (emailData._source === 'firestore' && emailData.emails) {
          // Novo formato Firestore: emails já vêm com direction
          allEmails = emailData.emails;
        } else {
          // Formato legado N8N: combinar destination + sender arrays
          if (emailData.destination && Array.isArray(emailData.destination)) {
            emailData.destination.forEach((e: any) => {
              allEmails.push({ ...e, direction: 'received' });
            });
          }
          if (emailData.sender && Array.isArray(emailData.sender)) {
            emailData.sender.forEach((e: any) => {
              allEmails.push({ ...e, direction: 'sent' });
            });
          }

          // Ordenar por data (mais recentes primeiro)
          allEmails.sort((a, b) => {
            const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return dateB - dateA;
          });
        }

        setLeadEmails(allEmails);
      }
      setEmailsLoaded(true);
    } catch (error) {
      console.error('Erro ao carregar emails:', error);
      setEmailsLoaded(true);
    } finally {
      setEmailsLoading(false);
    }
  }, [getLeadEmail, emailsLoaded]);

  // Carregar emails quando a aba for selecionada
  useEffect(() => {
    if (activeTab === 'emails' && !emailsLoaded) {
      loadLeadEmails();
    }
  }, [activeTab, emailsLoaded, loadLeadEmails]);

  // Carrega mensagens do WhatsApp
  const loadWhatsappMessages = useCallback(async () => {
    const phone = getLeadPhone();
    if (!phone) {
      setWhatsappError('Telefone não encontrado nos dados do lead');
      return;
    }

    setWhatsappLoading(true);
    setWhatsappError(null);

    try {
      const result = await firestoreMessagesService.getMessages(phone, 100);
      // Ordenar mensagens por timestamp (mais antigas primeiro)
      const sortedMessages = [...result.messages].sort((a, b) => {
        const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return dateA - dateB;
      });
      setWhatsappMessages(sortedMessages);
      setConversationChannelPhone(result.channel_phone || null);
      setWhatsappLoaded(true);
      if (result.messages.length === 0) {
        setWhatsappError('Nenhuma mensagem encontrada para este telefone');
      }
    } catch (err: any) {
      console.error('Erro ao buscar mensagens:', err);
      setWhatsappError(err.message || 'Erro ao buscar mensagens');
    } finally {
      setWhatsappLoading(false);
    }
  }, [getLeadPhone]);

  // Carrega mensagens do WhatsApp quando a aba for selecionada
  useEffect(() => {
    if (activeTab === 'whatsapp' && !whatsappLoaded) {
      loadWhatsappMessages();
    }
  }, [activeTab, whatsappLoaded, loadWhatsappMessages]);

  // Carregar documentos para o contexto do Copiloto
  const loadDocuments = useCallback(async () => {
    const phone = getLeadPhone();
    if (!phone || documentsLoaded) return;

    try {
      // Criar um objeto Phone fake para o documentService
      const phoneObj = {
        _id: phone,
        email: item.column_values?.find(c => c.id?.toLowerCase().includes('email'))?.text || undefined,
        pulse_id: !isOrphan ? item.id : undefined,
      };

      const [docs, analysis, processedRes] = await Promise.all([
        documentService.getDocumentsForContact(phoneObj as any).catch(() => []),
        phoneObj.pulse_id ? documentService.getDocumentAnalysis(phoneObj.pulse_id).catch(() => null) : Promise.resolve(null),
        fetch(`/api/files/extracted-texts?phone=${encodeURIComponent(phone)}`).then(r => r.ok ? r.json() : []).catch(() => []),
      ]);

      setLeadDocuments(docs);
      setDocumentAnalysis(analysis);
      setProcessedFiles(Array.isArray(processedRes) ? processedRes : []);
      setDocumentsLoaded(true);
      console.log(`📄 Documentos carregados para copiloto: ${docs.length} docs, análise: ${analysis ? 'sim' : 'não'}`);
    } catch (error) {
      console.error('Erro ao carregar documentos para copiloto:', error);
      setDocumentsLoaded(true);
    }
  }, [getLeadPhone, documentsLoaded, item, isOrphan]);

  // Carregar documentos e emails quando necessário para contexto
  useEffect(() => {
    const needsContext = activeTab === 'copilot' || activeTab === 'details' || activeTab === 'documents' || activeTab === 'whatsapp';
    if (needsContext && !documentsLoaded) {
      loadDocuments();
    }
    if (needsContext && !emailsLoaded) {
      loadLeadEmails();
    }
  }, [activeTab, documentsLoaded, loadDocuments, emailsLoaded, loadLeadEmails]);

  // Garante que WhatsApp, documentos e emails estão carregados e retorna dados frescos
  const ensureDataLoaded = useCallback(async (): Promise<FreshData> => {
    const phone = getLeadPhone();
    const email = getLeadEmail();

    let freshMessages = whatsappMessages;
    let freshDocs = leadDocuments;
    let freshAnalysis = documentAnalysis;
    let freshFiles = processedFiles;
    let freshEmails = leadEmails;

    const promises: Promise<void>[] = [];

    if (!whatsappLoaded) {
      if (phone) {
        promises.push(
          firestoreMessagesService.getMessages(phone, 100).then(result => {
            const sorted = [...result.messages].sort((a, b) => {
              const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
              const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
              return dateA - dateB;
            });
            freshMessages = sorted;
            setWhatsappMessages(sorted);
            setWhatsappLoaded(true);
          }).catch(err => {
            console.error('Erro ao carregar WhatsApp:', err);
            setWhatsappLoaded(true);
          })
        );
      } else {
        setWhatsappLoaded(true);
      }
    }

    if (!documentsLoaded) {
      if (phone) {
        promises.push(
          (async () => {
            try {
              const phoneObj = {
                _id: phone,
                email: item.column_values?.find(c => c.id?.toLowerCase().includes('email'))?.text || undefined,
                pulse_id: !isOrphan ? item.id : undefined,
              };
              const [docs, analysis, processedRes] = await Promise.all([
                documentService.getDocumentsForContact(phoneObj as any).catch(() => []),
                phoneObj.pulse_id ? documentService.getDocumentAnalysis(phoneObj.pulse_id).catch(() => null) : Promise.resolve(null),
                fetch(`/api/files/extracted-texts?phone=${encodeURIComponent(phone)}`).then(r => r.ok ? r.json() : []).catch(() => []),
              ]);
              freshDocs = docs;
              freshAnalysis = analysis;
              freshFiles = Array.isArray(processedRes) ? processedRes : [];
              setLeadDocuments(freshDocs);
              setDocumentAnalysis(freshAnalysis);
              setProcessedFiles(freshFiles);
              setDocumentsLoaded(true);
            } catch (error) {
              console.error('Erro ao carregar documentos:', error);
              setDocumentsLoaded(true);
            }
          })()
        );
      } else {
        setDocumentsLoaded(true);
      }
    }

    if (!emailsLoaded) {
      if (email) {
        promises.push(
          (async () => {
            try {
              const emailData = await emailService.getEmailByEmail(email);
              if (emailData) {
                let allEmails: any[] = [];
                if (emailData._source === 'firestore' && emailData.emails) {
                  allEmails = emailData.emails;
                } else {
                  if (emailData.destination && Array.isArray(emailData.destination)) {
                    emailData.destination.forEach((e: any) => allEmails.push({ ...e, direction: 'received' }));
                  }
                  if (emailData.sender && Array.isArray(emailData.sender)) {
                    emailData.sender.forEach((e: any) => allEmails.push({ ...e, direction: 'sent' }));
                  }
                  allEmails.sort((a, b) => {
                    const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                    const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                    return dateB - dateA;
                  });
                }
                freshEmails = allEmails;
                setLeadEmails(freshEmails);
              }
              setEmailsLoaded(true);
            } catch (error) {
              console.error('Erro ao carregar emails:', error);
              setEmailsLoaded(true);
            }
          })()
        );
      } else {
        setEmailsLoaded(true);
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }

    return {
      messages: freshMessages,
      docs: freshDocs,
      analysis: freshAnalysis,
      files: freshFiles,
      emails: freshEmails,
      mondayUpdates: updates,
    };
  }, [getLeadPhone, getLeadEmail, whatsappLoaded, documentsLoaded, emailsLoaded, item, isOrphan,
      whatsappMessages, leadDocuments, documentAnalysis, processedFiles, leadEmails, updates]);

  // Pré-carregar todos os dados para contexto ao abrir aba que precisa de prompts
  useEffect(() => {
    const needsPrompts = activeTab === 'whatsapp' || activeTab === 'documents';
    if (needsPrompts && !contextReady && !loadingContext) {
      setLoadingContext(true);
      ensureDataLoaded().then(() => {
        setContextReady(true);
        setLoadingContext(false);
      }).catch(() => {
        setLoadingContext(false);
      });
    }
  }, [activeTab, contextReady, loadingContext, ensureDataLoaded]);

  // Obter contexto do lead para os prompts (completo, com compactação inteligente)
  // Obter contexto compactado do lead, delegando para o contextCompactionService
  const getLeadContext = useCallback((freshData?: FreshData, useCase: UseCase = 'whatsapp_response', adhocFiles?: AdHocFile[]): string => {
    return contextCompactionService.buildCompactedContext(
      freshData, item, columns, useCase,
      { whatsappMessages, updates, documentAnalysis, leadEmails, leadDocuments, processedFiles },
      adhocFiles
    );
  }, [item, columns, whatsappMessages, updates, documentAnalysis, leadDocuments, processedFiles, leadEmails]);

  // Atualizar stats do contexto quando dados mudam
  useEffect(() => {
    if (!whatsappLoaded) return;
    const stats = contextCompactionService.getContextStats(
      undefined, item, columns, 'copilot',
      { whatsappMessages, updates, documentAnalysis, leadEmails, leadDocuments, processedFiles },
      copilotFiles
    );
    setContextStats(stats);
  }, [whatsappLoaded, item, columns, whatsappMessages, updates, documentAnalysis, leadEmails, leadDocuments, processedFiles, copilotFiles]);

  // Handler para upload de arquivos no copilot
  const handleCopilotFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    const newFiles: AdHocFile[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      try {
        const text = await file.text();
        newFiles.push({
          id: `adhoc_${Date.now()}_${i}`,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          textContent: text,
        });
        console.log(`[CopilotUpload] Arquivo adicionado: ${file.name} (${file.type}, ${Math.round(file.size / 1024)}KB)`);
      } catch (err) {
        console.error(`Erro ao ler arquivo ${file.name}:`, err);
      }
    }
    setCopilotFiles(prev => [...prev, ...newFiles]);
    event.target.value = '';
  }, []);

  const handleRemoveCopilotFile = useCallback((fileId: string) => {
    setCopilotFiles(prev => prev.filter(f => f.id !== fileId));
  }, []);

  // Scroll para o final das mensagens
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  // Scroll automático quando novas mensagens chegarem ou tab abrir
  useEffect(() => {
    if (whatsappMessages.length > 0 && activeTab === 'whatsapp') {
      // Pequeno delay para garantir que o DOM foi renderizado
      setTimeout(() => {
        scrollToBottom();
      }, 100);
    }
  }, [whatsappMessages, activeTab, scrollToBottom]);

  // Carregar prompts: "Atendimento" para copiloto, "Análise/Análises" para documentos
  useEffect(() => {
    const loadPrompts = async () => {
      try {
        const allPrompts = await promptService.getPrompts();
        const promptMap = new Map(allPrompts.map(p => [p.id, p]));
        allPromptsMapRef.current = promptMap;

        // IDs que são pai de alguém (não são folha)
        const parentIds = new Set(allPrompts.filter(p => p.parentId).map(p => p.parentId!));

        // Filtrar só folhas cujo nome contém "atendimento", exibir pelo nome do pai
        const filteredAtendimento = allPrompts
          .filter(p => p.parentId && p.name.trim().toLowerCase().includes('atendimento') && !parentIds.has(p.id))
          .map(p => {
            const parent = promptMap.get(p.parentId!);
            return { ...p, name: parent ? parent.name : p.name };
          });

        // Filtrar só folhas cujo nome contém "análise" ou "analise", exibir pelo nome do pai
        const filteredAnalise = allPrompts
          .filter(p => p.parentId && p.name.trim().toLowerCase().replace(/[áàã]/g, 'a').includes('analise') && !parentIds.has(p.id))
          .map(p => {
            const parent = promptMap.get(p.parentId!);
            return { ...p, name: parent ? parent.name : p.name };
          });

        setPrompts(filteredAtendimento);
        setAnalysisPrompts(filteredAnalise);
      } catch (error) {
        console.error('Erro ao carregar prompts:', error);
      }
    };
    loadPrompts();
  }, []);

  // Usar prompt para gerar resposta
  const handleUsePrompt = async (prompt: Prompt) => {
    const phone = getLeadPhone();
    if (!phone || usingPrompt === prompt.id) return;

    setUsingPrompt(prompt.id);
    try {
      // Garantir que todos os dados estão carregados e usar dados frescos
      const freshData = await ensureDataLoaded();
      const leadContext = getLeadContext(freshData, 'whatsapp_response');

      // Concatenar cadeia de prompts pais (avô → pai → filho)
      const promptChain: string[] = [];
      let currentPrompt: Prompt | undefined = prompt;
      while (currentPrompt) {
        if (currentPrompt.content && currentPrompt.content.trim()) {
          promptChain.unshift(currentPrompt.content.trim());
        }
        currentPrompt = currentPrompt.parentId ? allPromptsMapRef.current.get(currentPrompt.parentId) : undefined;
      }
      const fullPromptContent = promptChain.join('\n\n');

      const systemContext = `${fullPromptContent}

--- CONTEXTO DO LEAD ---
${leadContext}
--- FIM DO CONTEXTO ---

Instruções:
- Seja sempre profissional e prestativo
- Mantenha um tom amigável e próximo
- Responda de forma clara e objetiva
- Use emojis moderadamente para tornar a conversa mais amigável
- Mantenha as respostas concisas mas completas
- Baseie sua resposta no contexto do lead e nas últimas mensagens da conversa
- IMPORTANTE: Forneça respostas completas e detalhadas, mas NUNCA gere respostas com mais de 4000 caracteres.`;

      const msgs = freshData.messages;
      const lastMessage = msgs.length > 0 ? msgs[msgs.length - 1].content : '';
      const conversationHistory = msgs.slice(-10).map(msg =>
        `${msg.source === 'Contact' ? 'Cliente' : 'Atendente'}: ${msg.content}`
      ).join('\n');

      const userPrompt = lastMessage
        ? `Gere uma resposta profissional e adequada para a última mensagem do cliente: "${lastMessage}"`
        : `Gere uma mensagem de abertura profissional e amigável para iniciar uma conversa com este cliente.`;

      const response = await grokService.generateResponse(
        userPrompt,
        {
          systemPrompt: systemContext,
          conversationHistory,
          phoneNumber: phone,
          lastMessage
        }
      );

      setNewMessage(response);
      setShowMessageInput(true);

      // Múltiplos ajustes para garantir que o textarea expanda
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
          textareaRef.current.focus();
        }
      }, 100);

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
        }
      }, 300);

    } catch (error) {
      console.error('Erro ao usar prompt:', error);
      alert(`Erro ao gerar resposta: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    } finally {
      setUsingPrompt(null);
    }
  };

  // Usar prompt de análise na aba de documentos
  const handleUseAnalysisPrompt = async (prompt: Prompt) => {
    if (generatingAnalysisPrompt) return;

    setGeneratingAnalysisPrompt(prompt.id);
    setAnalysisResult(null);
    try {
      // Garantir que todos os dados estão carregados e usar dados frescos
      const freshData = await ensureDataLoaded();
      const leadContext = getLeadContext(freshData, 'document_analysis');

      // Concatenar cadeia de prompts pais (avô → pai → filho)
      const promptChain: string[] = [];
      let currentPrompt: Prompt | undefined = prompt;
      while (currentPrompt) {
        if (currentPrompt.content && currentPrompt.content.trim()) {
          promptChain.unshift(currentPrompt.content.trim());
        }
        currentPrompt = currentPrompt.parentId ? allPromptsMapRef.current.get(currentPrompt.parentId) : undefined;
      }
      const fullPromptContent = promptChain.join('\n\n');

      const systemContext = `${fullPromptContent}

--- CONTEXTO DO LEAD ---
${leadContext}
--- FIM DO CONTEXTO ---

Instruções:
- Analise todos os documentos e arquivos processados disponíveis no contexto
- Forneça uma análise detalhada e estruturada
- Use markdown para formatar a resposta
- Seja objetivo e profissional`;

      const response = await grokService.generateResponse(
        'Analise os documentos e arquivos do lead conforme as instruções do prompt.',
        {
          systemPrompt: systemContext,
          phoneNumber: getLeadPhone() || undefined,
        }
      );

      setAnalysisResult(response);
    } catch (error) {
      console.error('Erro ao gerar análise com prompt:', error);
      alert(`Erro ao gerar análise: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    } finally {
      setGeneratingAnalysisPrompt(null);
    }
  };

  // Salvar prompt editado
  const handleSavePrompt = async () => {
    if (!editingPrompt || !promptNameInput.trim() || !promptContentInput.trim()) return;

    setSavingPrompt(true);
    try {
      await promptService.updatePrompt(editingPrompt.id, {
        name: promptNameInput.trim(),
        content: promptContentInput.trim(),
        description: promptDescriptionInput.trim() || undefined
      });

      // Atualizar lista de prompts
      setPrompts(prev => prev.map(p =>
        p.id === editingPrompt.id
          ? { ...p, name: promptNameInput.trim(), content: promptContentInput.trim(), description: promptDescriptionInput.trim() }
          : p
      ));

      setShowEditPromptModal(false);
      setEditingPrompt(null);
    } catch (error) {
      console.error('Erro ao salvar prompt:', error);
      alert('Erro ao salvar prompt');
    } finally {
      setSavingPrompt(false);
    }
  };

  // Ajustar altura do textarea
  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }
  }, []);

  // Enviar mensagem
  const handleSendMessage = async () => {
    const phone = getLeadPhone();
    if (!newMessage.trim() || !phone) return;

    const messageText = newMessage.trim();
    setNewMessage('');
    setSendingMessage(true);

    // Criar mensagem otimista (aparece imediatamente)
    const optimisticMessage: FirestoreMessage = {
      id: `temp_${Date.now()}`,
      content: messageText,
      source: 'Bot', // Mensagens enviadas pelo sistema aparecem como Bot
      timestamp: new Date().toISOString(),
      name: 'Você',
      chat_phone: phone,
      audio: false,
      image: '',
    };

    setWhatsappMessages(prev => [...prev, optimisticMessage]);

    try {
      // Enviar mensagem via API - adicionar código do país se não tiver
      const phoneToSend = phone.startsWith('+') ? phone : `+${phone}`;
      const result = await messageService.sendMessage(phoneToSend, messageText, conversationChannelPhone);

      if (result.success) {
        console.log('Mensagem enviada com sucesso');
        setShowMessageInput(false);

        // Atualizar lista de mensagens após envio bem-sucedido
        setTimeout(() => {
          loadWhatsappMessages();
        }, 1000);
      } else {
        throw new Error(result.error || 'Erro ao enviar mensagem');
      }
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      // Remover mensagem otimista em caso de erro
      setWhatsappMessages(prev => prev.filter(msg => msg.id !== optimisticMessage.id));
      setNewMessage(messageText); // Restaurar texto
      alert(`Erro ao enviar mensagem: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    } finally {
      setSendingMessage(false);
    }
  };

  // Normalizar telefone
  const normalizePhone = (phone: string): string => {
    return phone.replace(/\D/g, '');
  };

  // Criar lead no Monday
  const handleCreateLead = async () => {
    const phone = getLeadPhone();

    if (creatingLead) return;
    if (!leadNameInput.trim()) {
      setCreateLeadError('Por favor, informe o nome do lead');
      return;
    }
    if (!phone) {
      setCreateLeadError('Telefone não encontrado');
      return;
    }

    setCreatingLead(true);
    setCreateLeadError(null);

    try {
      // Verificar duplicidade
      console.log('Verificando duplicidade de telefone no Monday...');
      try {
        const { items } = await mondayService.getBoardItemsWithColumns(ATENDIMENTO_BOARD_ID);
        const targetPhone = normalizePhone(phone);

        const existsNow = items.some((mondayItem) => {
          if (!mondayItem || !Array.isArray(mondayItem.column_values)) return false;
          const phoneCol = mondayItem.column_values.find((col: any) => {
            const colId = col.id || '';
            return colId === 'telefone' || colId.toLowerCase().includes('telefone');
          });
          if (!phoneCol || !phoneCol.text) return false;

          const colPhone = normalizePhone(phoneCol.text);
          if (!colPhone || !targetPhone) return false;

          return (
            colPhone === targetPhone ||
            colPhone.endsWith(targetPhone.slice(-9)) ||
            targetPhone.endsWith(colPhone.slice(-9))
          );
        });

        if (existsNow) {
          setCreateLeadError('Já existe um lead cadastrado no Monday para este telefone.');
          setCreatingLead(false);
          return;
        }
      } catch (verifyError) {
        console.error('Erro na checagem de duplicidade:', verifyError);
        // Continua mesmo com erro na verificação
      }

      const itemName = leadNameInput.trim();
      const columnValues: Record<string, any> = {};
      columnValues['telefone'] = phone;

      // Email opcional
      if (leadEmailInput.trim()) {
        columnValues['e_mail'] = { email: leadEmailInput.trim(), text: leadEmailInput.trim() };
      }

      // Campos de status
      if (statusValue) {
        columnValues['status'] = { label: statusValue };
      }
      if (status1Value) {
        columnValues['status_1'] = { label: status1Value };
      }
      if (status14Value) {
        columnValues['status_14'] = { label: status14Value };
      }
      if (status152Value) {
        columnValues['status_152'] = { label: status152Value };
      }

      console.log('Criando lead no board atendimento:', { itemName, phone });

      const result = await mondayService.createItem(ATENDIMENTO_BOARD_ID, itemName, columnValues);

      if (!result || !result.id) {
        throw new Error('Não foi possível criar o lead');
      }

      console.log('Lead criado com sucesso:', result);

      setShowCreateLeadModal(false);
      setLeadNameInput('');
      setLeadEmailInput('');
      setStatusValue('');
      setStatus1Value('');
      setStatus14Value('');
      setStatus152Value('');

      alert(`Lead "${itemName}" cadastrado com sucesso!\nID: ${result.id}`);

      // Callback para atualizar a lista
      if (onLeadCreated) {
        onLeadCreated();
      }

      // Fechar a sidebar
      handleClose();
    } catch (err: any) {
      console.error('Erro ao criar lead:', err);
      setCreateLeadError(err.message || 'Erro ao cadastrar lead no Monday.com');
    } finally {
      setCreatingLead(false);
    }
  };

  // Tecla Enter para enviar
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Mostrar input de mensagem
  const handleShowInput = () => {
    setShowMessageInput(true);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }, 100);
  };

  // Gera a URL do Monday.com para o item
  const getMondayUrl = () => {
    if (boardId) {
      return `https://rosenbaum-adv.monday.com/boards/${boardId}/pulses/${item.id}`;
    }
    return `https://rosenbaum-adv.monday.com/boards/pulses/${item.id}`;
  };

  const handleOpenInMonday = () => {
    window.open(getMondayUrl(), '_blank', 'noopener,noreferrer');
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getColumnTitle = (colId: string): string => {
    const column = columns.find(col => col.id === colId);
    return column?.title || colId.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Formatar telefone para exibição
  const formatPhone = (phone: string | null): string => {
    if (!phone) return '-';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 13) {
      return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 4)} ${cleaned.slice(4, 9)}-${cleaned.slice(9)}`;
    } else if (cleaned.length === 12) {
      return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 4)} ${cleaned.slice(4, 8)}-${cleaned.slice(8)}`;
    } else if (cleaned.length === 11) {
      return `${cleaned.slice(0, 2)} ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
    }
    return phone;
  };

  // Renderizar aba de detalhes
  const renderDetailsTab = () => {
    if (isOrphan) {
      return (
        <div className="tab-content details-tab">
          <div className="orphan-details-notice">
            <div className="notice-icon">📋</div>
            <h3>Conversa sem cadastro</h3>
            <p>Esta conversa ainda não está associada a um lead no Monday.</p>
            <button
              className="create-lead-btn-large"
              onClick={() => setShowCreateLeadModal(true)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
              Cadastrar Lead no Monday
            </button>
          </div>
        </div>
      );
    }

    const columnValues = (item.column_values || []).filter(col =>
      col.text && col.text.trim() !== '' && col.text !== '-'
    );

    return (
      <div className="tab-content details-tab">
        <div className="sidebar-info-section">
          <div className="info-row">
            <div className="info-item">
              <span className="info-icon">ID</span>
              <div className="info-content">
                <div className="info-label">ID</div>
                <div className="info-value">{item.id}</div>
              </div>
            </div>
          </div>
          {item.created_at && (
            <div className="info-row">
              <div className="info-item">
                <span className="info-icon">📅</span>
                <div className="info-content">
                  <div className="info-label">Criado em</div>
                  <div className="info-value">{formatDate(item.created_at)}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="columns-list">
          {columnValues.map((col) => (
            <div key={col.id} className="column-item">
              <div className="column-label">{getColumnTitle(col.id)}</div>
              <div className="column-value">{col.text || '-'}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Toggle para expandir/colapsar texto do documento
  const toggleDocExpanded = (docId: string) => {
    setExpandedDocs(prev => {
      const newSet = new Set(Array.from(prev));
      if (newSet.has(docId)) {
        newSet.delete(docId);
      } else {
        newSet.add(docId);
      }
      return newSet;
    });
  };

  // Toggle para expandir/colapsar texto do email
  const toggleEmailExpanded = (emailId: string) => {
    setExpandedEmails(prev => {
      const newSet = new Set(Array.from(prev));
      if (newSet.has(emailId)) {
        newSet.delete(emailId);
      } else {
        newSet.add(emailId);
      }
      return newSet;
    });
  };

  // Renderizar aba de documentos
  const renderDocumentsTab = () => {
    return (
      <div className="tab-content documents-tab">
        {/* Seção de Documentos */}
        <div className="documents-section">
          <div className="documents-section-header">
            <span className="documents-icon">📎</span>
            <h4>Documentos do Lead</h4>
            {leadDocuments.length > 0 && (
              <span className="documents-count">{leadDocuments.length}</span>
            )}
          </div>

          {!documentsLoaded ? (
            <div className="documents-loading">
              <div className="loading-spinner-small"></div>
              <span>Carregando documentos...</span>
            </div>
          ) : leadDocuments.length === 0 ? (
            <div className="documents-empty">
              <span>Nenhum documento encontrado para este lead</span>
            </div>
          ) : (
            <div className="documents-list">
              {leadDocuments.map((doc, idx) => (
                <div key={doc.id || idx} className="document-item">
                  <div className="document-icon">
                    {doc.origin === 'email' ? '📧' : '📱'}
                  </div>
                  <div className="document-content">
                    <div className="document-header">
                      <span className="document-title">
                        {doc.metadata?.subject || doc.name || `Documento ${idx + 1}`}
                      </span>
                      <span className={`document-badge ${doc.direction || 'received'}`}>
                        {doc.direction === 'sent' ? 'Enviado' : 'Recebido'}
                      </span>
                    </div>
                    {doc.createdAt && (
                      <div className="document-date">
                        {new Date(doc.createdAt).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    )}
                    {doc.text && (
                      <div
                        className={`document-preview ${expandedDocs.has(doc.id || `doc-${idx}`) ? 'expanded' : 'collapsed'}`}
                        onClick={() => toggleDocExpanded(doc.id || `doc-${idx}`)}
                      >
                        <span className="document-text">{doc.text}</span>
                        <span className="document-expand-toggle">
                          {expandedDocs.has(doc.id || `doc-${idx}`) ? '▲' : '▼'}
                        </span>
                      </div>
                    )}
                    {doc.images && doc.images.length > 0 && (
                      <div className="document-attachments">
                        {doc.images.map((img, imgIdx) => (
                          <a
                            key={img.fileId || imgIdx}
                            href={img.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="document-attachment"
                            title={img.extractedText ? 'Clique para abrir (contém texto extraído)' : 'Clique para abrir'}
                          >
                            <span className="attachment-icon">📄</span>
                            <span className="attachment-name">
                              Anexo {imgIdx + 1}
                              {img.extractedText && <span className="has-text-badge">OCR</span>}
                            </span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Arquivos Processados (file_processing_queue) */}
        {processedFiles.length > 0 && (
          <div className="documents-section" style={{ marginTop: '16px' }}>
            <div className="documents-section-header">
              <span className="documents-icon">🗃️</span>
              <h4>Arquivos Processados</h4>
              <span className="documents-count">{processedFiles.length}</span>
            </div>
            <div className="documents-list">
              {processedFiles.map((file, idx) => {
                const docId = `processed-${file.id}`;
                const isExpanded = expandedDocs.has(docId);
                const mediaTypeLabel: Record<string, string> = { pdf: 'PDF', docx: 'DOCX', image: 'Imagem', audio: 'Áudio' };
                return (
                  <div key={file.id} className="document-item">
                    <div className="document-icon">
                      {file.mediaType === 'pdf' ? '📕' : file.mediaType === 'image' ? '🖼️' : '📄'}
                    </div>
                    <div className="document-content">
                      <div className="document-header">
                        <span className="document-title">
                          {file.fileName || `Arquivo ${idx + 1}`}
                        </span>
                        <span className="document-badge received">
                          {mediaTypeLabel[file.mediaType] || file.mediaType || 'Arquivo'}
                        </span>
                      </div>
                      {file.processedAt && (
                        <div className="document-date">
                          {new Date(file.processedAt).toLocaleDateString('pt-BR', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </div>
                      )}
                      {file.extractedText && (
                        <div
                          className={`document-preview ${isExpanded ? 'expanded' : 'collapsed'}`}
                          onClick={() => toggleDocExpanded(docId)}
                        >
                          <span className="document-text">{file.extractedText}</span>
                          <span className="document-expand-toggle">
                            {isExpanded ? '▲' : '▼'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Prompts de Análise */}
        {analysisPrompts.length > 0 && (
          <div className="documents-section" style={{ marginTop: '16px' }}>
            <div className="documents-section-header">
              <span className="documents-icon">🤖</span>
              <h4>Análise por IA</h4>
            </div>
            {!contextReady ? (
              <div className="prompts-loading-context">
                <div className="prompt-loading-spinner"></div>
                <span>Carregando contexto do lead...</span>
              </div>
            ) : (
              <div className="analysis-prompts-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px 0' }}>
                {analysisPrompts.map(prompt => (
                  <button
                    key={prompt.id}
                    onClick={() => handleUseAnalysisPrompt(prompt)}
                    disabled={generatingAnalysisPrompt !== null}
                    className="prompt-button"
                    title={prompt.description || prompt.content?.substring(0, 100)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '16px',
                      border: '1px solid #d1d5db',
                      background: generatingAnalysisPrompt === prompt.id ? '#e0e7ff' : '#f9fafb',
                      cursor: generatingAnalysisPrompt ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      color: '#374151',
                      opacity: generatingAnalysisPrompt && generatingAnalysisPrompt !== prompt.id ? 0.5 : 1,
                    }}
                  >
                    {generatingAnalysisPrompt === prompt.id ? '⏳ Gerando...' : prompt.name}
                  </button>
                ))}
              </div>
            )}

            {/* Resultado da análise gerada */}
            {analysisResult && (
              <div className="analysis-block" style={{ marginTop: '12px' }}>
                <div className="analysis-label">Resultado da Análise</div>
                <div className="analysis-content">
                  <ReactMarkdown>{analysisResult}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Análise de Documentos do Monday */}
        {documentAnalysis && (
          <div className="document-analysis-section">
            <div className="documents-section-header">
              <span className="documents-icon">🔍</span>
              <h4>Análise de Documentos</h4>
            </div>
            {documentAnalysis.checklist && (
              <div className="analysis-block">
                <div className="analysis-label">Checklist</div>
                <div className="analysis-content">
                  <ReactMarkdown>{documentAnalysis.checklist}</ReactMarkdown>
                </div>
              </div>
            )}
            {documentAnalysis.analise && (
              <div className="analysis-block">
                <div className="analysis-label">Análise</div>
                <div className="analysis-content">
                  <ReactMarkdown>{documentAnalysis.analise}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Renderizar aba de emails
  const renderEmailsTab = () => {
    const email = getLeadEmail();

    if (!email) {
      return (
        <div className="tab-content emails-tab">
          <div className="emails-empty">
            <span className="empty-icon">📧</span>
            <p>Email não encontrado nos dados do lead</p>
          </div>
        </div>
      );
    }

    return (
      <div className="tab-content emails-tab">
        <div className="emails-header-info">
          <span className="emails-label">📧 {email}</span>
          <span className="emails-count">{leadEmails.length} emails</span>
          <button
            className="emails-refresh-btn"
            onClick={() => {
              setEmailsLoaded(false);
              loadLeadEmails();
            }}
            title="Atualizar emails"
          >
            🔄
          </button>
        </div>

        {emailsLoading ? (
          <div className="emails-loading">
            <div className="loading-spinner-small"></div>
            <p>Carregando emails...</p>
          </div>
        ) : leadEmails.length === 0 ? (
          <div className="emails-empty">
            <span className="empty-icon">📭</span>
            <p>Nenhum email encontrado</p>
          </div>
        ) : (
          <div className="emails-list">
            {leadEmails.map((emailItem, idx) => {
              const emailId = emailItem.id || `email-${idx}`;
              const isExpanded = expandedEmails.has(emailId);

              return (
                <div key={emailId} className={`email-item ${emailItem.direction}`}>
                  <div className="email-header">
                    <div className="email-subject">
                      {emailItem.subject || '(Sem assunto)'}
                    </div>
                    <span className={`email-badge ${emailItem.direction}`}>
                      {emailItem.direction === 'sent' ? '↑ Enviado' : '↓ Recebido'}
                    </span>
                  </div>
                  <div className="email-meta">
                    {emailItem.direction === 'sent' ? (
                      <span>Para: {emailItem.destination}</span>
                    ) : (
                      <span>De: {emailItem.sender}</span>
                    )}
                    {emailItem.timestamp && (
                      <span className="email-date">
                        {new Date(emailItem.timestamp).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    )}
                  </div>
                  {emailItem.text && (
                    <div
                      className={`email-body ${isExpanded ? 'expanded' : 'collapsed'}`}
                      onClick={() => toggleEmailExpanded(emailId)}
                    >
                      <span className="email-text">{emailItem.text}</span>
                      <span className="email-expand-toggle">
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>
                  )}
                  {emailItem.attachments && emailItem.attachments.length > 0 && (
                    <div className="email-attachments">
                      {emailItem.attachments.map((att: any, attIdx: number) => (
                        <a
                          key={attIdx}
                          href={att.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="email-attachment"
                        >
                          📎 {att.name || `Anexo ${attIdx + 1}`}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderUpdatesTab = () => {
    if (isOrphan) {
      return (
        <div className="tab-content updates-tab">
          <div className="updates-empty">
            <div className="empty-icon">📝</div>
            <p>Cadastre o lead para ver updates</p>
          </div>
        </div>
      );
    }

    if (loadingUpdates) {
      return (
        <div className="tab-content updates-tab">
          <div className="updates-loading">
            <div className="loading-spinner-small"></div>
            <p>Carregando updates...</p>
          </div>
        </div>
      );
    }

    if (updatesError) {
      return (
        <div className="tab-content updates-tab">
          <div className="updates-error">
            <p>{updatesError}</p>
            <button onClick={loadUpdates} className="retry-btn-small">
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }

    if (updates.length === 0) {
      return (
        <div className="tab-content updates-tab">
          <div className="updates-empty">
            <div className="empty-icon">📝</div>
            <p>Nenhum update encontrado</p>
          </div>
          <div className="update-input-container">
            <textarea
              value={newUpdateText}
              onChange={(e) => setNewUpdateText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendUpdate(); } }}
              placeholder="Escrever primeiro update..."
              disabled={sendingUpdate}
              rows={2}
            />
            <button onClick={handleSendUpdate} disabled={!newUpdateText.trim() || sendingUpdate} className="update-send-btn">
              {sendingUpdate ? <div className="loading-spinner-tiny"></div> : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="tab-content updates-tab">
        <div className="updates-list">
          {updates.map((update) => (
            <div key={update.id} className="update-item">
              <div className="update-header">
                <div className="update-creator">
                  {update.creator ? (
                    <>
                      <span className="creator-icon">👤</span>
                      <span className="creator-name">{update.creator.name}</span>
                    </>
                  ) : (
                    <span className="creator-unknown">Usuário desconhecido</span>
                  )}
                </div>
                <div className="update-date">
                  {mondayService.formatDate(update.created_at)}
                </div>
              </div>
              <div className="update-body markdown-content">
                <ReactMarkdown>{mondayService.formatUpdateBody(update.body)}</ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
        <div className="update-input-container">
          <textarea
            value={newUpdateText}
            onChange={(e) => setNewUpdateText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendUpdate(); } }}
            placeholder="Escrever update..."
            disabled={sendingUpdate}
            rows={2}
          />
          <button onClick={handleSendUpdate} disabled={!newUpdateText.trim() || sendingUpdate} className="update-send-btn">
            {sendingUpdate ? <div className="loading-spinner-tiny"></div> : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>}
          </button>
        </div>
      </div>
    );
  };

  // Formatar timestamp
  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderWhatsAppTab = () => {
    const phone = getLeadPhone();

    if (whatsappLoading) {
      return (
        <div className="tab-content whatsapp-tab">
          <div className="whatsapp-loading">
            <div className="loading-spinner-small"></div>
            <p>Carregando mensagens...</p>
          </div>
        </div>
      );
    }

    if (!phone) {
      return (
        <div className="tab-content whatsapp-tab">
          <div className="whatsapp-placeholder">
            <div className="whatsapp-icon">📱</div>
            <p>Telefone não encontrado nos dados do lead</p>
          </div>
        </div>
      );
    }

    return (
      <div className="tab-content whatsapp-tab">
        {whatsappMessages.length > 0 ? (
          <div className="whatsapp-messages-list">
            {whatsappMessages.map((msg) => (
              <div
                key={msg.id}
                className={`whatsapp-message ${msg.source === 'Contact' ? 'contact' : 'bot'} ${msg.id.startsWith('temp_') ? 'sending' : ''}`}
              >
                <div className="whatsapp-message-header">
                  <span className="whatsapp-message-name">
                    {msg.source === 'Contact' ? (msg.name || 'Cliente') : 'Atendente'}
                  </span>
                  <span className="whatsapp-message-time">
                    {msg.id.startsWith('temp_') ? 'Enviando...' : formatTimestamp(msg.timestamp)}
                  </span>
                </div>
                <div className="whatsapp-message-content">
                  {msg.audio && <span className="whatsapp-audio-badge">🎵 Áudio</span>}
                  {msg.image && (
                    <a href={msg.image} target="_blank" rel="noopener noreferrer" className="whatsapp-image-link">
                      📷 Imagem anexada
                    </a>
                  )}
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="whatsapp-empty">
            <div className="whatsapp-icon">💬</div>
            <p>{whatsappError || 'Nenhuma mensagem encontrada'}</p>
            {whatsappError && (
              <button onClick={loadWhatsappMessages} className="retry-btn-small" style={{ marginTop: '12px' }}>
                Tentar novamente
              </button>
            )}
          </div>
        )}

        {/* Seção de Prompts */}
        {prompts.length > 0 && contextReady && (
          <div className="prompts-section">
            <div className="prompts-header">
              <span className="prompts-label">Prompts:</span>
            </div>
            <div className="prompts-list">
              {prompts.map((prompt) => (
                <div key={prompt.id} className="prompt-item">
                  <button
                    onClick={() => handleUsePrompt(prompt)}
                    disabled={usingPrompt === prompt.id}
                    className={`prompt-use-btn ${usingPrompt === prompt.id ? 'using' : ''}`}
                    title={prompt.description || prompt.name}
                  >
                    {usingPrompt === prompt.id && (
                      <div className="prompt-loading-spinner"></div>
                    )}
                    <span className="prompt-name">{prompt.name}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input de envio de mensagem */}
        {showMessageInput ? (
          <div className="whatsapp-input-container">
            <textarea
              ref={textareaRef}
              value={newMessage}
              onChange={(e) => {
                setNewMessage(e.target.value);
                adjustTextareaHeight();
              }}
              onKeyPress={handleKeyPress}
              placeholder="Digite uma mensagem..."
              rows={6}
              className="whatsapp-input"
              disabled={sendingMessage}
            />
            <button
              onClick={handleSendMessage}
              disabled={!newMessage.trim() || sendingMessage}
              className="whatsapp-send-btn"
              title="Enviar mensagem"
            >
              {sendingMessage ? (
                <div className="loading-spinner-tiny"></div>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              )}
            </button>
            <button
              onClick={() => {
                setShowMessageInput(false);
                setNewMessage('');
              }}
              className="whatsapp-cancel-btn"
              title="Cancelar"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="whatsapp-input-placeholder">
            <button onClick={handleShowInput} className="whatsapp-write-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
              </svg>
              <span>Escrever mensagem</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  // Função para enviar mensagem ao Copiloto
  const handleCopilotSend = async () => {
    if (!copilotInput.trim() || copilotLoading) return;
    const userMessage: CopilotMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: copilotInput.trim(),
      timestamp: new Date(),
    };
    setCopilotMessages(prev => [...prev, userMessage]);
    setCopilotInput('');
    setCopilotLoading(true);
    try {
      const leadContext = getLeadContext(undefined, 'copilot', copilotFiles);

      // Histórico de conversa do copiloto para continuidade
      const copilotHistory = copilotMessages.length > 0
        ? `\n\nHistórico desta conversa com o Copiloto:\n${copilotMessages.slice(-6).map(m => `[${m.role === 'user' ? 'Usuário' : 'Assistente'}]: ${m.content}`).join('\n')}`
        : '';

      const systemPrompt = `Você é um assistente especializado em análise de leads e vendas.
Analise os dados do lead e responda às perguntas do usuário de forma útil e objetiva.

--- CONTEXTO DO LEAD ---
${leadContext}
--- FIM DO CONTEXTO ---
${copilotHistory}

Instruções:
- Responda de forma concisa e profissional
- Use as informações do contexto para dar respostas precisas
- Se não souber algo, diga claramente
- Formate a resposta de forma legível usando markdown quando apropriado`;

      const response = await grokService.generateResponse(userMessage.content, { systemPrompt });
      const assistantMessage: CopilotMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      };
      setCopilotMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Erro ao enviar mensagem ao copiloto:', error);
      const errorMessage: CopilotMessage = {
        id: `error_${Date.now()}`,
        role: 'assistant',
        content: 'Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.',
        timestamp: new Date(),
      };
      setCopilotMessages(prev => [...prev, errorMessage]);
    } finally {
      setCopilotLoading(false);
    }
  };

  useEffect(() => {
    if (copilotEndRef.current && activeTab === 'copilot') {
      copilotEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [copilotMessages, activeTab]);

  const renderCopilotTab = () => {
    const usagePercent = contextStats ? Math.round((contextStats.totalChars / contextStats.budgetChars) * 100) : 0;
    const usageColor = usagePercent > 90 ? '#ef4444' : usagePercent > 70 ? '#f59e0b' : '#10b981';

    return (
      <div className="tab-content copilot-tab">
        {/* Indicador de status do contexto com stats */}
        <div className="copilot-context-status" onClick={() => setShowContextDetails(!showContextDetails)} style={{ cursor: 'pointer' }}>
          {contextStats ? (
            <div className="context-ready">
              <span className="context-badge success">Contexto pronto</span>
              <span className="context-stats-summary">
                {Math.round(contextStats.totalChars / 1000)}K / {Math.round(contextStats.budgetChars / 1000)}K chars
                {contextStats.compressed && ' (compactado)'}
              </span>
              <div className="context-usage-bar">
                <div className="context-usage-fill" style={{ width: `${Math.min(usagePercent, 100)}%`, background: usageColor }} />
              </div>
              <span className="context-details-toggle">{showContextDetails ? '▲' : '▼'}</span>
            </div>
          ) : !whatsappLoaded ? (
            <div className="context-loading">
              <div className="loading-spinner-tiny"></div>
              <span>Carregando dados...</span>
            </div>
          ) : null}
          {showContextDetails && contextStats && (
            <div className="context-details-panel">
              {contextStats.sections.map((s, i) => (
                <div key={i} className="context-detail-row">
                  <span className="context-detail-name">{s.name}</span>
                  <span className="context-detail-count">{s.itemCount} {s.itemCount === 1 ? 'item' : 'itens'}</span>
                </div>
              ))}
              {copilotFiles.length > 0 && (
                <div className="context-detail-row context-detail-adhoc">
                  <span className="context-detail-name">Arquivos anexados</span>
                  <span className="context-detail-count">{copilotFiles.length} arquivo(s)</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="copilot-messages">
          {copilotMessages.length === 0 ? (
            <div className="copilot-welcome">
              <div className="copilot-icon">🤖</div>
              <h3>Copiloto de Vendas</h3>
              <p>Pergunte qualquer coisa sobre este lead:</p>
              <div className="copilot-suggestions">
                <button onClick={() => setCopilotInput('Resuma os dados deste lead')}>Resumir dados</button>
                <button onClick={() => setCopilotInput('Qual a melhor abordagem para este lead?')}>Sugerir abordagem</button>
                <button onClick={() => setCopilotInput('Analise a conversa do WhatsApp')}>Analisar conversa</button>
              </div>
            </div>
          ) : (
            copilotMessages.map((msg) => (
              <div key={msg.id} className={`copilot-message ${msg.role}`}>
                <div className="copilot-message-avatar">{msg.role === 'user' ? '👤' : '🤖'}</div>
                <div className="copilot-message-content"><ReactMarkdown>{msg.content}</ReactMarkdown></div>
              </div>
            ))
          )}
          {copilotLoading && (
            <div className="copilot-message assistant">
              <div className="copilot-message-avatar">🤖</div>
              <div className="copilot-message-content"><div className="copilot-typing"><span></span><span></span><span></span></div></div>
            </div>
          )}
          <div ref={copilotEndRef} />
        </div>

        {/* Arquivos anexados */}
        {copilotFiles.length > 0 && (
          <div className="copilot-files-list">
            {copilotFiles.map(f => (
              <div key={f.id} className="copilot-file-item">
                <span className="copilot-file-icon">📄</span>
                <span className="copilot-file-name">{f.fileName}</span>
                <span className="copilot-file-size">{Math.round(f.textContent.length / 1024)}KB</span>
                <button className="copilot-file-remove" onClick={() => handleRemoveCopilotFile(f.id)} title="Remover arquivo">✕</button>
              </div>
            ))}
          </div>
        )}

        <div className="copilot-input-container">
          <input
            type="file"
            ref={copilotFileInputRef}
            multiple
            accept=".txt,.csv,.json,.xml,.md,.log,.html,.pdf,.doc,.docx"
            onChange={handleCopilotFileUpload}
            style={{ display: 'none' }}
          />
          <button
            className="copilot-attach-btn"
            onClick={() => copilotFileInputRef.current?.click()}
            title="Anexar arquivo ao contexto"
            disabled={copilotLoading}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
          </button>
          <textarea value={copilotInput} onChange={(e) => setCopilotInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCopilotSend(); } }} placeholder="Pergunte sobre o lead..." disabled={copilotLoading} rows={1} />
          <button onClick={handleCopilotSend} disabled={!copilotInput.trim() || copilotLoading} className="copilot-send-btn">
            {copilotLoading ? <div className="loading-spinner-tiny"></div> : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="lead-panel">
      {/* Header */}
      <div className="panel-header">
        <div className="panel-title-section">
          <h2 className="panel-title">{item.name}</h2>
          {getLeadPhone() && (
            <div className="panel-subtitle">{formatPhone(getLeadPhone())}</div>
          )}
        </div>
        <div className="panel-header-actions">
          {isOrphan ? (
            <button
              className="panel-action-btn create"
              onClick={() => setShowCreateLeadModal(true)}
              title="Cadastrar Lead no Monday"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
              <span>Cadastrar</span>
            </button>
          ) : (
            <button
              className="panel-action-btn monday"
              onClick={handleOpenInMonday}
              title="Abrir no Monday.com"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
              </svg>
              <span>Monday</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="panel-tabs">
        <button
          className={`panel-tab ${activeTab === 'whatsapp' ? 'active' : ''}`}
          onClick={() => setActiveTab('whatsapp')}
        >
          💬 WhatsApp
        </button>
        <button
          className={`panel-tab ${activeTab === 'details' ? 'active' : ''}`}
          onClick={() => setActiveTab('details')}
        >
          📋 Detalhes
        </button>
        <button
          className={`panel-tab ${activeTab === 'updates' ? 'active' : ''}`}
          onClick={() => setActiveTab('updates')}
        >
          📝 Updates {updates.length > 0 && <span className="tab-badge">{updates.length}</span>}
        </button>
        <button
          className={`panel-tab ${activeTab === 'documents' ? 'active' : ''}`}
          onClick={() => setActiveTab('documents')}
        >
          📎 Docs
        </button>
        <button
          className={`panel-tab ${activeTab === 'emails' ? 'active' : ''}`}
          onClick={() => setActiveTab('emails')}
        >
          📧 Emails
        </button>
        <button
          className={`panel-tab ${activeTab === 'copilot' ? 'active' : ''}`}
          onClick={() => setActiveTab('copilot')}
        >
          🤖 IA
        </button>
      </div>

      {/* Body */}
      <div className="panel-body">
        {activeTab === 'details' && renderDetailsTab()}
        {activeTab === 'updates' && renderUpdatesTab()}
        {activeTab === 'whatsapp' && renderWhatsAppTab()}
        {activeTab === 'documents' && renderDocumentsTab()}
        {activeTab === 'emails' && renderEmailsTab()}
        {activeTab === 'copilot' && renderCopilotTab()}
      </div>

      {/* Modal de Edição de Prompt */}
      {showEditPromptModal && editingPrompt && ReactDOM.createPortal(
        <div
          className="edit-prompt-modal-overlay"
          onClick={() => {
            if (!savingPrompt) setShowEditPromptModal(false);
          }}
        >
          <div className="edit-prompt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="edit-prompt-modal-header">
              <h3>Editar Prompt</h3>
              <button
                className="edit-prompt-modal-close"
                onClick={() => {
                  if (!savingPrompt) setShowEditPromptModal(false);
                }}
                disabled={savingPrompt}
              >
                ×
              </button>
            </div>
            <div className="edit-prompt-modal-content">
              <div className="edit-prompt-form-group">
                <label htmlFor="prompt-name">Nome</label>
                <input
                  id="prompt-name"
                  type="text"
                  value={promptNameInput}
                  onChange={(e) => setPromptNameInput(e.target.value)}
                  placeholder="Nome do prompt"
                  disabled={savingPrompt}
                />
              </div>
              <div className="edit-prompt-form-group">
                <label htmlFor="prompt-description">Descrição (opcional)</label>
                <input
                  id="prompt-description"
                  type="text"
                  value={promptDescriptionInput}
                  onChange={(e) => setPromptDescriptionInput(e.target.value)}
                  placeholder="Breve descrição do prompt"
                  disabled={savingPrompt}
                />
              </div>
              <div className="edit-prompt-form-group">
                <label htmlFor="prompt-content">Conteúdo do Prompt</label>
                <textarea
                  id="prompt-content"
                  value={promptContentInput}
                  onChange={(e) => setPromptContentInput(e.target.value)}
                  placeholder="Digite o conteúdo do prompt..."
                  disabled={savingPrompt}
                  rows={8}
                />
              </div>
            </div>
            <div className="edit-prompt-modal-actions">
              <button
                className="edit-prompt-cancel-button"
                onClick={() => {
                  if (!savingPrompt) setShowEditPromptModal(false);
                }}
                disabled={savingPrompt}
              >
                Cancelar
              </button>
              <button
                className="edit-prompt-submit-button"
                onClick={handleSavePrompt}
                disabled={!promptNameInput.trim() || !promptContentInput.trim() || savingPrompt}
              >
                {savingPrompt ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal de Cadastro de Lead */}
      {showCreateLeadModal && ReactDOM.createPortal(
        <div
          className="create-lead-modal-overlay"
          onClick={() => {
            if (!creatingLead) setShowCreateLeadModal(false);
          }}
        >
          <div className="create-lead-modal" onClick={(e) => e.stopPropagation()}>
            <div className="create-lead-modal-header">
              <h3>Cadastrar Lead no Monday</h3>
              <button
                className="create-lead-modal-close"
                onClick={() => {
                  if (!creatingLead) setShowCreateLeadModal(false);
                }}
                disabled={creatingLead}
              >
                ×
              </button>
            </div>
            <div className="create-lead-modal-content">
              <div className="create-lead-form-group">
                <label htmlFor="lead-name">
                  Nome do Lead <span style={{ color: '#e74c3c' }}>*</span>
                </label>
                <input
                  id="lead-name"
                  type="text"
                  value={leadNameInput}
                  onChange={(e) => setLeadNameInput(e.target.value)}
                  placeholder="Digite o nome do lead"
                  disabled={creatingLead}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && leadNameInput.trim() && !creatingLead) {
                      handleCreateLead();
                    }
                  }}
                />
              </div>
              <div className="create-lead-form-group">
                <label htmlFor="lead-email">Email (opcional)</label>
                <input
                  id="lead-email"
                  type="email"
                  value={leadEmailInput}
                  onChange={(e) => setLeadEmailInput(e.target.value)}
                  placeholder="Digite o email do lead"
                  disabled={creatingLead}
                />
              </div>
              <div className="create-lead-form-group">
                <label htmlFor="lead-status">Status</label>
                <select
                  id="lead-status"
                  value={statusValue}
                  onChange={(e) => setStatusValue(e.target.value)}
                  disabled={creatingLead || !statusOptions['status'] || statusOptions['status'].length === 0}
                >
                  <option value="">Selecione...</option>
                  {(statusOptions['status'] || []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div className="create-lead-form-group">
                <label htmlFor="lead-status-1">Etiquetas</label>
                <select
                  id="lead-status-1"
                  value={status1Value}
                  onChange={(e) => setStatus1Value(e.target.value)}
                  disabled={creatingLead || !statusOptions['status_1'] || statusOptions['status_1'].length === 0}
                >
                  <option value="">Selecione...</option>
                  {(statusOptions['status_1'] || []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div className="create-lead-form-group">
                <label htmlFor="lead-status-14">Qualidade</label>
                <select
                  id="lead-status-14"
                  value={status14Value}
                  onChange={(e) => setStatus14Value(e.target.value)}
                  disabled={creatingLead || !statusOptions['status_14'] || statusOptions['status_14'].length === 0}
                >
                  <option value="">Selecione...</option>
                  {(statusOptions['status_14'] || []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div className="create-lead-form-group">
                <label htmlFor="lead-status-152">Origem</label>
                <select
                  id="lead-status-152"
                  value={status152Value}
                  onChange={(e) => setStatus152Value(e.target.value)}
                  disabled={creatingLead || !statusOptions['status_152'] || statusOptions['status_152'].length === 0}
                >
                  <option value="">Selecione...</option>
                  {(statusOptions['status_152'] || []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div className="create-lead-form-group">
                <label>Telefone</label>
                <input
                  type="text"
                  value={formatPhone(getLeadPhone())}
                  disabled
                  className="create-lead-input-disabled"
                />
              </div>
              {createLeadError && (
                <div className="create-lead-error-message">
                  {createLeadError}
                </div>
              )}
            </div>
            <div className="create-lead-modal-actions">
              <button
                className="create-lead-cancel-button"
                onClick={() => {
                  if (!creatingLead) setShowCreateLeadModal(false);
                }}
                disabled={creatingLead}
              >
                Cancelar
              </button>
              <button
                className="create-lead-submit-button"
                onClick={handleCreateLead}
                disabled={!leadNameInput.trim() || creatingLead}
              >
                {creatingLead ? 'Cadastrando...' : 'Cadastrar'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default LeadDetailsPanel;
