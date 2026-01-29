import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, Message } from '../types';
import { messageService as apiMessageService, emailService, promptService, Prompt } from '../services/api';
import { messageService } from '../services/messageService';
import { grokService } from '../services/grokService';
import { firestoreRestPhoneAIService } from '../services/firestoreRestService';
import { mondayService } from '../services/mondayService';
import MondayTab from './MondayTab';
import EmailTab from './EmailTab';
import DocumentsTab from './DocumentsTab';
import './ChatWindow.css';

interface ChatWindowProps {
  selectedPhone: Phone | null;
  onMessagesChange?: (messages: Message[]) => void;
}

const ATENDIMENTO_BOARD_ID = 607533664;

const ChatWindow: React.FC<ChatWindowProps> = ({ selectedPhone, onMessagesChange }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'emails' | 'documents' | 'monday'>('chat');
  const [isUpdating, setIsUpdating] = useState(false);
  const [nextUpdateIn, setNextUpdateIn] = useState(20);
  const [contactEmail, setContactEmail] = useState<string | undefined>(selectedPhone?.email);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [emailData, setEmailData] = useState<any>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [usingPrompt, setUsingPrompt] = useState<string | null>(null);
  const [aiLeadName, setAiLeadName] = useState<string | null>(null);
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const [aiActive, setAiActive] = useState<boolean | null>(null);
  const [loadingAIStatus, setLoadingAIStatus] = useState(false);

  const scrollToBottom = useCallback((smooth = false) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: smooth ? 'smooth' : 'auto',
        block: 'end'
      });
    }
  }, []);

  // Detectar se o usuário fez scroll manual
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    
    const container = messagesContainerRef.current;
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50; // 50px de tolerância
    
    setUserScrolled(!isAtBottom);
  }, []);

  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }
  }, []);

  const loadMessages = useCallback(async (isAutoUpdate = false) => {
    if (!selectedPhone) return;
    
    if (isAutoUpdate) {
      setIsUpdating(true);
    } else {
      setLoading(true);
    }
    
    try {
      const phoneNumber = selectedPhone._id.replace('+', '');
      const messagesData = await apiMessageService.getMessages(phoneNumber);
      
      // Ordenar mensagens por data e hora (mais antigas primeiro)
      updateMessages(messagesData);
    } catch (error) {
      console.error('Erro ao carregar mensagens:', error);
    } finally {
      if (isAutoUpdate) {
        setIsUpdating(false);
      } else {
        setLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhone]);


  // Buscar email do contato quando selecionado
  useEffect(() => {
    if (selectedPhone) {
      console.log('🎯 Contato selecionado:', {
        id: selectedPhone._id,
        name: selectedPhone.lead_name,
        existingEmail: selectedPhone.email
      });
      
      setContactEmail(selectedPhone.email);
      
      // Buscar emails trocados com o cliente
      const getEmail = async () => {
        try {
          const emailData = await emailService.getEmailForContact(selectedPhone);
          if (emailData && typeof emailData === 'object') {
            const data = emailData as any;
            let firstEmail = null;
            
            // Verificar se há emails em 'destination'
            if (Array.isArray(data.destination) && data.destination.length > 0) {
              const validEmails = data.destination.filter((email: any) => email && Object.keys(email).length > 0);
              if (validEmails.length > 0) {
                firstEmail = validEmails[0];
              }
            }
            
            // Verificar se há emails em 'sender' (caso contrário do fluxo)
            if (!firstEmail && Array.isArray(data.sender) && data.sender.length > 0) {
              const validEmails = data.sender.filter((email: any) => email && Object.keys(email).length > 0);
              if (validEmails.length > 0) {
                firstEmail = validEmails[0];
              }
            }
            
            if (firstEmail) {
              console.log('✅ Emails trocados encontrados:', data);
              // Usar o primeiro email como contato principal
              setContactEmail(firstEmail.destination || selectedPhone.email);
              setEmailData(data);
            } else {
              console.log('❌ Nenhum email válido encontrado para o contato');
              setContactEmail(selectedPhone.email);
              setEmailData(null);
            }
          } else {
            console.log('❌ Nenhum email encontrado para o contato');
            setContactEmail(selectedPhone.email);
            setEmailData(null);
          }
        } catch (error) {
          console.error('❌ Erro ao buscar emails trocados:', error);
          setContactEmail(selectedPhone.email);
          setEmailData(null);
        }
      };
      
      getEmail();

      // Buscar estado de IA do telefone
      const getAIStatus = async () => {
        setLoadingAIStatus(true);
        try {
          const status = await firestoreRestPhoneAIService.getAIStatus(selectedPhone._id);
          setAiActive(status !== null ? status : false);
        } catch (error) {
          console.error('❌ Erro ao buscar estado de IA:', error);
          setAiActive(false);
        } finally {
          setLoadingAIStatus(false);
        }
      };
      
      getAIStatus();

      // Resetar nome de lead gerado por IA e opções de status ao trocar de contato
      setAiLeadName(null);
      setStatusOptions({});
      setStatusValue('');
      setStatus1Value('');
      setStatus14Value('');
      setStatus152Value('');
    }
  }, [selectedPhone]);

  // Buscar nome na conversa usando padrões e IA
  useEffect(() => {
    const extractNameFromConversation = async () => {
      if (!selectedPhone) return;
      // Se já existe nome de lead cadastrado, não sobrescreve
      if (selectedPhone.lead_name && selectedPhone.lead_name.trim()) return;
      // Precisa ter pelo menos algumas mensagens para ter contexto
      if (!messages || messages.length === 0) return;

      try {
        // PRIMEIRO: Tentar extrair nome usando padrões regex comuns
        const clientMessages = messages.filter(msg => msg.source !== 'Member');
        
        // Padrões comuns de apresentação em português
        const namePatterns = [
          /(?:meu nome (?:é|eh)|me chamo|sou (?:o|a))\s+([A-ZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ][a-zàáâãäåçèéêëìíîïñòóôõöùúûüý]+(?:\s+[A-ZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ][a-zàáâãäåçèéêëìíîïñòóôõöùúûüý]+)+)/i,
          /(?:aqui (?:é|eh) (?:o|a))\s+([A-ZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ][a-zàáâãäåçèéêëìíîïñòóôõöùúûüý]+(?:\s+[A-ZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ][a-zàáâãäåçèéêëìíîïñòóôõöùúûüý]+)+)/i,
          /^(?:oi|olá|ola|bom dia|boa tarde|boa noite)[,.]?\s+(?:meu nome é|me chamo|sou)\s+([A-ZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ][a-zàáâãäåçèéêëìíîïñòóôõöùúûüý]+(?:\s+[A-ZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ][a-zàáâãäåçèéêëìíîïñòóôõöùúûüý]+)+)/i,
          // Nome no início da mensagem após saudação
          /^(?:oi|olá|ola|bom dia|boa tarde|boa noite)[,.]?\s+([A-ZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ][a-zàáâãäåçèéêëìíîïñòóôõöùúûüý]+(?:\s+[A-ZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ][a-zàáâãäåçèéêëìíîïñòóôõöùúûüý]+)+)/i,
        ];

        let extractedName = '';
        
        // Buscar nas primeiras 20 mensagens do cliente (geralmente se apresentam no início)
        for (const msg of clientMessages.slice(0, 20)) {
          const content = msg.content || '';
          for (const pattern of namePatterns) {
            const match = content.match(pattern);
            if (match && match[1]) {
              const name = match[1].trim();
              // Validar que tem pelo menos 2 palavras (nome e sobrenome)
              const words = name.split(/\s+/);
              if (words.length >= 2 && words.every(w => w.length >= 2)) {
                extractedName = name;
                console.log('✅ Nome extraído por padrão regex:', extractedName);
                setAiLeadName(extractedName);
                return;
              }
            }
          }
        }

        // SEGUNDO: Se não encontrou por regex, usar IA
        console.log('🤖 Nome não encontrado por padrões, usando IA...');
        
        // Montar histórico de conversa em formato legível
        const recentMessages = messages.slice(-30); // usa até 30 últimas mensagens
        const conversationHistory = recentMessages
          .map((msg) => {
            const sender = msg.source === 'Member' ? 'Você' : 'Cliente';
            const time = new Date(msg._updateTime).toLocaleString('pt-BR');
            return `[${time}] ${sender}: ${msg.content || ''}`;
          })
          .join('\n');

        const userPrompt = `Você é um assistente especializado em identificar nomes em conversas de WhatsApp.

Abaixo está o histórico recente de uma conversa entre "Você" (atendente) e "Cliente" (pessoa que está falando com o escritório).

TAREFA: Identifique o NOME COMPLETO da pessoa que está como "Cliente".

INSTRUÇÕES IMPORTANTES:
1. O cliente pode se apresentar de várias formas:
   - "Meu nome é João da Silva"
   - "Aqui é Maria Pereira"
   - "Olá, sou Pedro Santos"
   - "Bom dia, João Silva falando"
   
2. Priorize nomes que aparecem no início da conversa (primeiras mensagens do cliente)

3. O nome deve ter pelo menos NOME e SOBRENOME (mínimo 2 palavras)

4. Se encontrar apenas primeiro nome, tente inferir o sobrenome se mencionado posteriormente

5. Se NÃO conseguir identificar nenhum nome completo com certeza, responda: DESCONHECIDO

RESPONDA APENAS COM O NOME COMPLETO (sem aspas, sem explicações, sem texto adicional).

Histórico da conversa:
${conversationHistory}`;

        const response = await grokService.generateResponse(userPrompt, {
          conversationHistory,
          phoneNumber: selectedPhone._id,
          lastMessage: messages[messages.length - 1]?.content,
        });

        const rawName = (response || '').trim();
        if (!rawName) return;

        // Normalizar resposta
        const cleaned = rawName
          .replace(/^["'«»]+|["'«»]+$/g, '') // remove aspas e similares nas pontas
          .replace(/\.$/, '') // remove ponto final
          .trim();

        if (!cleaned || cleaned.toUpperCase() === 'DESCONHECIDO') {
          console.log('⚠️ IA não conseguiu identificar nome na conversa');
          return;
        }

        // Validar que tem pelo menos 2 palavras
        const words = cleaned.split(/\s+/);
        if (words.length < 2) {
          console.log('⚠️ Nome identificado pela IA tem apenas uma palavra:', cleaned);
          return;
        }

        console.log('✅ Nome extraído pela IA:', cleaned);
        setAiLeadName(cleaned);
      } catch (error) {
        console.error('❌ Erro ao extrair nome do lead:', error);
      }
    };

    extractNameFromConversation();
  }, [selectedPhone, messages]);
  
  // Função utilitária para normalizar telefone (mantém só dígitos)
  const normalizePhone = (phone: string | undefined | null): string => {
    if (!phone) return '';
    return phone.replace(/[^0-9]/g, '');
  };

  // Carregar opções de status das colunas do board ao selecionar telefone
  useEffect(() => {
    const loadStatusOptions = async () => {
      if (!selectedPhone) {
        setStatusOptions({});
        return;
      }

      try {
        console.log('📅 Carregando opções de status do board para telefone:', selectedPhone._id);
        const columns = await mondayService.getBoardColumns(ATENDIMENTO_BOARD_ID);

        // Extrair opções de labels dos status da configuração da coluna (settings_str)
        const targetStatusIds = ['status', 'status_1', 'status_14', 'status_152'];
        const newStatusOptions: Record<string, string[]> = {};

        if (Array.isArray(columns)) {
          columns.forEach((col: any) => {
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
  }, [selectedPhone]);

  // Scroll para o final quando carregar mensagens de um contato
  useEffect(() => {
    if (messages.length > 0 && !loading) {
      setUserScrolled(false);
      setTimeout(() => {
        scrollToBottom(false);
      }, 100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhone, loading, scrollToBottom]);

  // Scroll automático apenas quando não há scroll manual do usuário
  useEffect(() => {
    if (messages.length > 0 && !userScrolled) {
      setTimeout(() => {
        scrollToBottom(true);
      }, 100);
    }
  }, [messages.length, userScrolled, scrollToBottom]);

  // Adicionar listener de scroll
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => {
        container.removeEventListener('scroll', handleScroll);
      };
    }
  }, [handleScroll]);

  useEffect(() => {
    if (selectedPhone) {
      loadMessages();
    }
  }, [selectedPhone, loadMessages]);

  // Live updates a cada 20 segundos
  useEffect(() => {
    if (!selectedPhone) return;

    // Resetar timer quando mudar de telefone
    setNextUpdateIn(20);

    // Configurar intervalo para atualizações automáticas
    const updateInterval = setInterval(() => {
      loadMessages(true); // true = isAutoUpdate
      setNextUpdateIn(20); // Resetar timer após atualização
    }, 20000); // 20 segundos

    // Configurar timer regressivo a cada segundo
    const countdownInterval = setInterval(() => {
      setNextUpdateIn(prev => {
        if (prev <= 1) {
          return 20; // Resetar para 20 quando chegar a 0
        }
        return prev - 1;
      });
    }, 1000); // 1 segundo

    // Cleanup dos intervalos quando o componente for desmontado ou selectedPhone mudar
    return () => {
      clearInterval(updateInterval);
      clearInterval(countdownInterval);
    };
  }, [selectedPhone, loadMessages]);

  // Ajustar altura do textarea quando o texto mudar
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [newMessage]);

  // Carregar prompts quando o componente montar
  useEffect(() => {
    const loadPrompts = async () => {
      setLoadingPrompts(true);
      try {
        const promptsData = await promptService.getPrompts();
        console.log('📋 Prompts carregados:', promptsData);
        setPrompts(promptsData);
      } catch (error) {
        console.error('Erro ao carregar prompts:', error);
      } finally {
        setLoadingPrompts(false);
      }
    };
    loadPrompts();
  }, []);

  const formatPhoneNumber = (phone: string) => {
    if (!phone) return 'Número não disponível';
    const cleanPhone = phone.replace('+', '');
    return `+${cleanPhone.slice(0, 2)} ${cleanPhone.slice(2, 4)} ${cleanPhone.slice(4, 9)}-${cleanPhone.slice(9)}`;
  };

  const formatMessageTime = (timestamp: string) => {
    if (!timestamp) return 'Data não disponível';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  // Nova função para formatar data
  const formatMessageDate = (timestamp: string) => {
    if (!timestamp) return 'Data não disponível';
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Resetar horas para comparar apenas as datas
    const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const yesterdayDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
    
    if (messageDate.getTime() === todayDate.getTime()) {
      return 'Hoje';
    } else if (messageDate.getTime() === yesterdayDate.getTime()) {
      return 'Ontem';
    } else {
      return date.toLocaleDateString('pt-BR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
      });
    }
  };

  // Nova função para verificar se deve mostrar separador de data
  const shouldShowDateSeparator = (currentMessage: Message, previousMessage: Message | null) => {
    if (!previousMessage) return true;
    
    const currentDate = new Date(currentMessage._updateTime);
    const previousDate = new Date(previousMessage._updateTime);
    
    // Resetar horas para comparar apenas as datas
    const currentDateOnly = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    const previousDateOnly = new Date(previousDate.getFullYear(), previousDate.getMonth(), previousDate.getDate());
    
    return currentDateOnly.getTime() !== previousDateOnly.getTime();
  };

  // Função auxiliar para ordenar mensagens por data e hora
  const sortMessagesByTime = (messages: Message[]): Message[] => {
    return messages.sort((a, b) => {
      const dateA = new Date(a._updateTime);
      const dateB = new Date(b._updateTime);
      return dateA.getTime() - dateB.getTime();
    });
  };

  // Função auxiliar para atualizar mensagens e notificar o callback
  const updateMessages = (updater: Message[] | ((prev: Message[]) => Message[])) => {
    setMessages(prev => {
      const newMessages = typeof updater === 'function' ? updater(prev) : updater;
      const sorted = sortMessagesByTime([...newMessages]);
      if (onMessagesChange) {
        onMessagesChange(sorted);
      }
      return sorted;
    });
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedPhone) return;
    
    const messageText = newMessage.trim();
    setNewMessage('');
    
    // Criar mensagem otimista (aparece imediatamente)
    const optimisticMessage: Message = {
      _name: '',
      _id: `temp_${Date.now()}`,
      _createTime: new Date().toISOString(),
      _updateTime: new Date().toISOString(),
      chat_phone: selectedPhone._id ? selectedPhone._id.replace('+', '') : '',
      source: 'Member',
      content: messageText
    };
    
    updateMessages(prev => [...prev, optimisticMessage]);
    
    try {
      // Enviar mensagem via API real
      const result = await messageService.sendMessage(selectedPhone._id, messageText);
      
      if (result.success) {
        // Atualizar mensagem otimista com ID final
        const finalMessage: Message = {
          ...optimisticMessage,
          _id: Date.now().toString(),
          _createTime: new Date().toISOString(),
          _updateTime: new Date().toISOString(),
        };
        
        updateMessages(prev => 
            prev.map(msg => 
              msg._id === optimisticMessage._id ? finalMessage : msg
          )
        );
        
        console.log('✅ Mensagem enviada com sucesso');
        setShowInput(false); // Ocultar caixa de texto após envio bem-sucedido
      } else {
        throw new Error(result.error || 'Erro ao enviar mensagem');
      }
      
    } catch (error) {
      console.error('❌ Erro ao enviar mensagem:', error);
      // Remover mensagem otimista em caso de erro
      updateMessages(prev => prev.filter(msg => msg._id !== optimisticMessage._id));
      setNewMessage(messageText); // Restaurar texto
      
      // Mostrar erro para o usuário (opcional)
      alert(`Erro ao enviar mensagem: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(e.target.value);
    adjustTextareaHeight();
  };

  const handleShowInput = () => {
    setShowInput(true);
    // Focar no textarea após mostrar
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }, 100);
  };

  const handleHideInput = () => {
    setShowInput(false);
    setNewMessage(''); // Limpar mensagem ao ocultar
  };

  const handleToggleAI = async () => {
    if (!selectedPhone || loadingAIStatus) return;
    
    const newStatus = !aiActive;
    setLoadingAIStatus(true);
    
    try {
      await firestoreRestPhoneAIService.setAIStatus(selectedPhone._id, newStatus);
      setAiActive(newStatus);
      console.log(`✅ Estado de IA atualizado: ${newStatus ? 'ON' : 'OFF'}`);
    } catch (error) {
      console.error('❌ Erro ao atualizar estado de IA:', error);
      alert('Erro ao atualizar estado de IA. Tente novamente.');
    } finally {
      setLoadingAIStatus(false);
    }
  };

  // Gerar nome sugerido para o lead (prioriza IA, depois dados existentes)
  const generateSuggestedLeadName = (): string => {
    // 0) Nome extraído pela IA da conversa
    if (aiLeadName && aiLeadName.trim()) {
      return aiLeadName.trim();
    }

    // 1) Nome já cadastrado no backend, se existir
    if (selectedPhone?.lead_name && selectedPhone.lead_name.trim()) {
      return selectedPhone.lead_name.trim();
    }

    // 2) Possíveis campos extras (name, contactName)
    // @ts-ignore - campos adicionais que possam existir
    const displayName = (selectedPhone as any)?.name || (selectedPhone as any)?.contactName;
    if (displayName && typeof displayName === 'string' && displayName.trim()) {
      return displayName.trim();
    }

    // 3) Fallback: nome descritivo com data/hora
    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const timeStr = now.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return `Lead WhatsApp - ${dateStr} ${timeStr}`;
  };

  const handleOpenCreateLeadModal = () => {
    if (!selectedPhone) return;

    const suggestedName = generateSuggestedLeadName();
    setLeadNameInput(suggestedName);
    setLeadEmailInput(selectedPhone.email || '');
    // Inicializar selects de status sem seleção (usuário escolhe)
    setStatusValue('');
    setStatus1Value('');
    setStatus14Value('');
    setStatus152Value('');
    setCreateLeadError(null);
    setShowCreateLeadModal(true);
  };

  const handleCreateLead = async () => {
    console.log('🚀 handleCreateLead chamado');
    
    if (!selectedPhone) {
      console.error('❌ selectedPhone é null');
      return;
    }
    
    if (creatingLead) {
      console.warn('⚠️ Já está criando lead, ignorando...');
      return;
    }

    if (!leadNameInput.trim()) {
      console.error('❌ Nome do lead está vazio');
      setCreateLeadError('Por favor, informe o nome do lead');
      return;
    }

    console.log('✅ Validações iniciais passaram, iniciando criação...');
    setCreatingLead(true);
    setCreateLeadError(null);

    try {
      // Checagem em tempo real no Monday (board) para evitar duplicidade - movida para cá para não atrasar o botão
      console.log('🔍 Verificando duplicidade de telefone no Monday antes de cadastrar...');
      try {
        const { items } = await mondayService.getBoardItemsWithColumns(ATENDIMENTO_BOARD_ID);
        const targetPhone = normalizePhone(selectedPhone._id);

        const existsNow = items.some((item) => {
          if (!item || !Array.isArray(item.column_values)) return false;
          const phoneCol = item.column_values.find((col: any) => {
            const colId = col.id || col?.column?.id || '';
            const colTitle = col?.column?.title || '';
            return (
              colId === 'telefone' ||
              colTitle.toLowerCase().includes('telefone')
            );
          });
          if (!phoneCol || !phoneCol.text) return false;

          const colPhone = normalizePhone(phoneCol.text);
          if (!colPhone || !targetPhone) return false;

          return (
            colPhone === targetPhone ||
            colPhone.endsWith(targetPhone) ||
            targetPhone.endsWith(colPhone)
          );
        });

        if (existsNow) {
          setCreateLeadError('Já existe um lead cadastrado no Monday para este telefone.');
          return;
        }
        console.log('✅ Telefone não duplicado, prosseguindo com cadastro...');
      } catch (verifyError) {
        console.error('❌ Erro na checagem de duplicidade do board do Monday:', verifyError);
        // Continua o fluxo mesmo com erro na verificação
      }

      const phone = selectedPhone._id;
      const itemName = leadNameInput.trim();

      // Telefone sempre vai na coluna "telefone"
      const columnValues: Record<string, any> = {};
      columnValues['telefone'] = phone;

      // Email opcional, configurável via .env
      const emailColumnId = process.env.REACT_APP_MONDAY_EMAIL_COLUMN_ID;
      if (emailColumnId && leadEmailInput.trim()) {
        columnValues[emailColumnId] = leadEmailInput.trim();
      }

      // Colunas de status (valores fechados - usamos label retornado pela API)
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

      console.log('📝 Criando lead no board atendimento (via Chat):', {
        boardId: ATENDIMENTO_BOARD_ID,
        itemName,
        email: leadEmailInput,
        phone,
        columnValues,
      });

      console.log('⏳ Chamando mondayService.createItem...');
      const result = await mondayService.createItem(ATENDIMENTO_BOARD_ID, itemName, columnValues);
      console.log('📦 Resultado recebido do createItem:', result);

      if (!result || !result.id) {
        throw new Error('createItem não retornou um resultado válido');
      }

      console.log('✅ Lead criado com sucesso (via Chat):', result);

      setShowCreateLeadModal(false);
      setLeadNameInput('');
      setLeadEmailInput('');

      // Mudar para aba Monday para visualizar o lead recém-criado
      setActiveTab('monday');

      alert(`Lead "${itemName}" cadastrado com sucesso no board atendimento!\nID: ${result.id}`);
    } catch (err: any) {
      console.error('❌ Erro ao criar lead (via Chat):', err);

      let errorMessage = 'Erro desconhecido ao cadastrar lead no Monday.com';

      if (err.message) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      } else if (err.response?.data) {
        const errorData = err.response.data;
        if (errorData.error) {
          errorMessage = errorData.error;
          if (errorData.details) {
            if (Array.isArray(errorData.details)) {
              errorMessage +=
                ': ' +
                errorData.details.map((d: any) => d.message || JSON.stringify(d)).join(', ');
            } else if (typeof errorData.details === 'string') {
              errorMessage += ': ' + errorData.details;
            }
          }
        } else {
          errorMessage = JSON.stringify(errorData);
        }
      } else if (err.toString && err.toString() !== '[object Object]') {
        errorMessage = err.toString();
      }

      setCreateLeadError(errorMessage);
    } finally {
      setCreatingLead(false);
    }
  };

  const getLeadContext = async (): Promise<string> => {
    if (!selectedPhone) return '';

    let context = `Dados do Lead:\n`;
    context += `- Nome: ${selectedPhone.lead_name || 'Não informado'}\n`;
    context += `- Telefone: ${selectedPhone._id}\n`;
    context += `- Email: ${selectedPhone.email || 'Não informado'}\n`;
    context += `- Status: ${selectedPhone.status || 'Não informado'}\n`;
    context += `- Etiqueta: ${selectedPhone.etiqueta || 'Não informado'}\n`;
    
    if (selectedPhone.board) {
      context += `- Board Monday.com: ${selectedPhone.board}\n`;
    }
    if (selectedPhone.pulse_id) {
      context += `- Pulse ID: ${selectedPhone.pulse_id}\n`;
    }

    // Adicionar últimas mensagens da conversa
    if (messages.length > 0) {
      context += `\nÚltimas mensagens da conversa:\n`;
      const recentMessages = messages.slice(-10);
      recentMessages.forEach((msg, idx) => {
        const sender = msg.source === 'Member' ? 'Você' : 'Cliente';
        const time = new Date(msg._updateTime).toLocaleString('pt-BR');
        context += `${idx + 1}. [${time}] ${sender}: ${msg.content}\n`;
      });
    }

    // Tentar buscar emails do contato
    try {
      const emailData = await emailService.getEmailForContact(selectedPhone);
      if (emailData && typeof emailData === 'object') {
        const data = emailData as any;
        const emails: any[] = [];
        
        if (Array.isArray(data.destination)) {
          emails.push(...data.destination.filter((e: any) => e && Object.keys(e).length > 0));
        }
        if (Array.isArray(data.sender)) {
          emails.push(...data.sender.filter((e: any) => e && Object.keys(e).length > 0));
        }

        if (emails.length > 0) {
          context += `\nEmails trocados (${emails.length} encontrados):\n`;
          emails.slice(0, 5).forEach((email, idx) => {
            context += `${idx + 1}. Assunto: ${email.subject || 'Sem assunto'}\n`;
            if (email.text) {
              context += `   Preview: ${email.text.substring(0, 100)}...\n`;
            }
          });
        }
      }
    } catch (error) {
      console.log('Não foi possível carregar emails para o contexto');
    }

    return context;
  };


  const handleUsePrompt = async (prompt: Prompt) => {
    if (!selectedPhone || usingPrompt === prompt.id) return;

    setUsingPrompt(prompt.id);
    try {
      // Obter contexto do lead
      const leadContext = await getLeadContext();

      // Preparar prompt para o Grok usando o prompt selecionado
      const systemContext = `${prompt.content}

${leadContext}

Instruções:
- Seja sempre profissional e prestativo
- Mantenha um tom amigável e próximo
- Responda de forma clara e objetiva
- Use emojis moderadamente para tornar a conversa mais amigável
- Mantenha as respostas concisas mas completas
- Baseie sua resposta no contexto do lead e nas últimas mensagens da conversa
- IMPORTANTE: Forneça respostas completas e detalhadas, mas NUNCA gere respostas com mais de 4000 caracteres.
Se sua resposta estiver ficando muito longa, resuma os pontos principais de forma concisa e objetiva.`;

      const lastMessage = messages.length > 0 ? messages[messages.length - 1].content : '';
      const conversationHistory = messages.slice(-10).map(msg => 
        `${msg.source === 'Member' ? 'Você' : 'Cliente'}: ${msg.content}`
      ).join('\n');

      const userPrompt = lastMessage 
        ? `Gere uma resposta profissional e adequada para a última mensagem do cliente: "${lastMessage}"`
        : `Gere uma mensagem de abertura profissional e amigável para iniciar uma conversa com este cliente.`;

      const response = await grokService.generateResponse(
        userPrompt,
        {
          systemPrompt: systemContext,
          conversationHistory,
          phoneNumber: selectedPhone._id,
          lastMessage
        }
      );

      // Colocar a resposta no campo de edição ao invés de enviar diretamente
      setNewMessage(response);
      setShowInput(true);

      // Ajustar altura do textarea após definir o texto (múltiplos timeouts para garantir)
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

      console.log('✅ Resposta gerada com prompt e colocada no campo de edição');
      
    } catch (error) {
      console.error('❌ Erro ao usar prompt:', error);
      alert(`Erro ao gerar resposta: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    } finally {
      setUsingPrompt(null);
    }
  };


  if (!selectedPhone) {
    return (
      <div className="chat-window">
        <div className="no-chat-selected">
          <div className="no-chat-icon">💬</div>
          <h3>Selecione uma conversa</h3>
          <p>Escolha um contato para começar a conversar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="chat-header-info">
          <div className="chat-header-avatar">
            {selectedPhone._id ? selectedPhone._id.slice(-2).toUpperCase() : 'NA'}
          </div>
          <div className="chat-header-details">
            <div className="chat-header-name">
              {selectedPhone.lead_name ? (
                <div className="header-name-container">
                  <div className="header-name-email-container">
                    <span className="header-lead-name">{selectedPhone.lead_name}</span>
                    {contactEmail && (
                      <span className="header-client-email" title={`Email: ${contactEmail}`}>
                        📧 {contactEmail}
                      </span>
                    )}
                  </div>
                  <span className="header-phone-number">{formatPhoneNumber(selectedPhone._id)}</span>
                </div>
              ) : (
                formatPhoneNumber(selectedPhone._id)
              )}
            </div>
            <div className="chat-header-status">
              online
              {isUpdating ? (
                <span className="live-update-indicator">
                  <span className="update-dot"></span>
                  Atualizando...
                </span>
              ) : (
                <span className="next-update-timer">
                  <span className="timer-icon">⏱️</span>
                  {nextUpdateIn}s
                </span>
              )}
            </div>
            <button
              className={`ai-toggle-button ${aiActive ? 'active' : ''} ${loadingAIStatus ? 'loading' : ''}`}
              onClick={handleToggleAI}
              disabled={loadingAIStatus || !selectedPhone}
              title={aiActive ? 'IA Ativa - Clique para desativar' : 'IA Inativa - Clique para ativar'}
            >
              {loadingAIStatus ? (
                <span className="ai-loading">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="23.562" fill="none" opacity="0.4"/>
                  </svg>
                </span>
              ) : aiActive ? (
                <span className="ai-icon">🤖</span>
              ) : (
                <span className="ai-icon">⚪</span>
              )}
              <span className="ai-label">{loadingAIStatus ? '...' : (aiActive ? 'ON' : 'OFF')}</span>
            </button>
          </div>
        </div>
        <div className="chat-tabs">
          <button
            className={`tab-button ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
            title="Conversa"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4l4 4 4-4h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
            </svg>
            <span>Chat</span>
          </button>
          <button
            className={`tab-button ${activeTab === 'emails' ? 'active' : ''}`}
            onClick={() => setActiveTab('emails')}
            title="Emails trocados"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
            </svg>
            <span>Emails</span>
          </button>
          <button
            className={`tab-button ${activeTab === 'documents' ? 'active' : ''}`}
            onClick={() => setActiveTab('documents')}
            title="Documentos do lead"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 2C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2H6ZM13 9V3.5L18.5 9H13Z" />
              <path d="M8 12H16V14H8V12ZM8 16H14V18H8V16Z" />
            </svg>
            <span>Documentos</span>
          </button>
          <button
            className={`tab-button ${activeTab === 'monday' ? 'active' : ''}`}
            onClick={() => setActiveTab('monday')}
            title="Dados do Monday.com"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
            </svg>
            <span>Monday</span>
          </button>
        </div>
      </div>

      {/* Botão de cadastro de lead - só aparece se não tem pulse_id (não está no Monday) */}
      {activeTab === 'chat' && selectedPhone && !selectedPhone.pulse_id && (
          <div className="chat-header-actions">
            <button
              onClick={handleOpenCreateLeadModal}
              className="create-lead-button"
              type="button"
              style={{ margin: '8px 16px' }}
            >
              📝 Cadastrar Lead no Board Atendimento
            </button>
          </div>
        )}

      {activeTab === 'chat' ? (
        <div className="chat-messages" ref={messagesContainerRef}>
          {userScrolled && (
            <button 
              className="scroll-to-bottom-btn"
              onClick={() => {
                setUserScrolled(false);
                scrollToBottom(true);
              }}
              title="Ir para a última mensagem"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
              </svg>
              <span>Nova mensagem</span>
            </button>
          )}
          {loading ? (
            <div className="loading-messages">Carregando mensagens...</div>
          ) : (
            <>
              {messages.map((message, index) => {
                const isSending = message._id.startsWith('temp_');
                const previousMessage = index > 0 ? messages[index - 1] : null;
                const showDateSeparator = shouldShowDateSeparator(message, previousMessage);
                const audioValue = message.audio;
                const isAudio =
                  audioValue === true ||
                  (typeof audioValue === 'string' && audioValue.toLowerCase() === 'true');
                const shouldShowTextContent = Boolean(message.content);
                
                return (
                  <React.Fragment key={message._id}>
                    {showDateSeparator && (
                      <div className="date-separator">
                        <span className="date-separator-text">
                          {formatMessageDate(message._updateTime)}
                        </span>
                      </div>
                    )}
                    <div
                      className={`message ${
                        message.source === 'Member' 
                          ? 'sent' 
                          : message.source === 'Bot' && !message.image && !message.audio 
                            ? 'sent bot' 
                            : 'received'
                      } ${isSending ? 'sending' : ''}`}
                    >
                      <div className="message-content">
                        {message.source === 'Bot' && !message.image && !isAudio && (
                          <div className="bot-indicator">
                            <span className="bot-icon">⚙️</span>
                            <span className="bot-label">Sistema</span>
                          </div>
                        )}
                        {(message.image || isAudio) && (
                          <div className="message-media">
                            {isAudio ? (
                              <div className="message-audio-indicator">
                                <div className="audio-icon-container">
                                  <svg className="audio-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M12 1C13.1 1 14 1.9 14 3V11C14 12.1 13.1 13 12 13C10.9 13 10 12.1 10 11V3C10 1.9 10.9 1 12 1Z" fill="currentColor"/>
                                    <path d="M19 10V12C19 15.87 15.87 19 12 19C8.13 19 5 15.87 5 12V10H7V12C7 14.76 9.24 17 12 17C14.76 17 17 14.76 17 12V10H19Z" fill="currentColor"/>
                                    <path d="M11 22H13V24H11V22Z" fill="currentColor"/>
                                    <path d="M7 22H9V24H7V22Z" fill="currentColor"/>
                                    <path d="M15 22H17V24H15V22Z" fill="currentColor"/>
                                  </svg>
                                </div>
                                <span className="audio-text">Áudio</span>
                              </div>
                            ) : (
                              <div className="message-image-indicator">
                                <div className="image-icon-container">
                                  <svg className="image-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M21 19V5C21 3.9 20.1 3 19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19ZM8.5 13.5L11 16.51L14.5 12L19 18H5L8.5 13.5Z" fill="currentColor"/>
                                  </svg>
                                </div>
                                <span className="image-text">Imagem</span>
                                <button 
                                  onClick={() => {
                                    const link = document.createElement('a');
                                    link.href = message.image!;
                                    link.download = `imagem-${message._id}.jpg`;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                  }}
                                  className="image-download-btn"
                                >
                                  <span className="download-icon">⬇️</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        {shouldShowTextContent && (
                          <div className={`message-text ${isAudio ? 'audio-transcription' : ''}`}>
                            {message.content}
                          </div>
                        )}
                        <div className="message-time">
                          {isSending ? (
                            <span className="sending-indicator">Enviando...</span>
                          ) : (
                            formatMessageTime(message._updateTime)
                          )}
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      ) : activeTab === 'emails' ? (
        <EmailTab selectedPhone={selectedPhone} />
      ) : activeTab === 'documents' ? (
        <DocumentsTab selectedPhone={selectedPhone} />
      ) : (
        <MondayTab phone={selectedPhone._id} messages={messages} pulseId={selectedPhone.pulse_id} />
      )}

      {/* Botões de prompts - apenas na aba chat */}
      {activeTab === 'chat' && (
        <div className="prompts-buttons-container">
          {prompts.length > 0 ? (
            <>
              <div className="prompts-buttons-label">Prompts cadastrados:</div>
              <div className="prompts-buttons">
                {prompts.map((prompt) => (
                  <button
                    key={prompt.id}
                    onClick={() => handleUsePrompt(prompt)}
                    disabled={usingPrompt === prompt.id || !selectedPhone}
                    className={`prompt-button ${usingPrompt === prompt.id ? 'using' : ''}`}
                    title={prompt.description || prompt.name}
                  >
                    {usingPrompt === prompt.id ? (
                      <>
                        <div className="prompt-loading"></div>
                        <span>Gerando...</span>
                      </>
                    ) : (
                      <span>{prompt.name}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="prompts-buttons-label" style={{ fontStyle: 'italic', opacity: 0.6 }}>
              Nenhum prompt cadastrado. Cadastre prompts na página de Prompts.
            </div>
          )}
        </div>
      )}

      {showInput ? (
        <div className="chat-input">
          <div className="input-container">
            <textarea
              ref={textareaRef}
              value={newMessage}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder="Digite uma mensagem..."
              rows={6}
              className="message-input"
              disabled={loading}
            />
            <button
              onClick={handleSendMessage}
              disabled={!newMessage.trim() || loading}
              className="send-button"
              title="Enviar mensagem"
            >
              {loading ? (
                <div className="send-loading"></div>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              )}
            </button>
            <button
              onClick={handleHideInput}
              className="hide-input-button"
              title="Ocultar caixa de texto"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <div className="chat-input-placeholder">
          <button
            onClick={handleShowInput}
            className="show-input-button"
            title="Escrever mensagem"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
            <span>Escrever mensagem</span>
          </button>
        </div>
      )}

      {/* Modal para cadastrar lead no Monday acionado a partir do chat */}
      {showCreateLeadModal && (
        <div
          className="create-lead-modal-overlay"
          onClick={() => {
            if (!creatingLead) {
              setShowCreateLeadModal(false);
            }
          }}
        >
          <div className="create-lead-modal" onClick={(e) => e.stopPropagation()}>
            <div className="create-lead-modal-header">
              <h3>Cadastrar Lead no Board Atendimento</h3>
              <button
                className="create-lead-modal-close"
                onClick={() => {
                  if (!creatingLead) {
                    setShowCreateLeadModal(false);
                  }
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
                  {aiLeadName && leadNameInput === aiLeadName && (
                    <span className="ai-extracted-badge" title="Nome extraído automaticamente da conversa">
                      🤖 Extraído da conversa
                    </span>
                  )}
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
              {/* Colunas de status / etiquetas / qualidade / origem */}
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
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
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
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
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
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
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
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              {selectedPhone && (
                <div className="create-lead-form-group">
                  <label>Telefone</label>
                  <input
                    type="text"
                    value={selectedPhone._id}
                    disabled
                    className="create-lead-input-disabled"
                  />
                </div>
              )}
              {createLeadError && (
                <div className="create-lead-error-message">
                  ⚠️ {createLeadError}
                </div>
              )}
            </div>
            <div className="create-lead-modal-actions">
              <button
                className="create-lead-cancel-button"
                onClick={() => {
                  if (!creatingLead) {
                    setShowCreateLeadModal(false);
                  }
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
        </div>
      )}
    </div>
  );
};

export default ChatWindow;
