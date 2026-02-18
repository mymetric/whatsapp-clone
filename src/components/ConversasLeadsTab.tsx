import React, { useState, useEffect, useCallback, useRef } from 'react';
import { mondayService, MondayBoardItem, MondayColumn } from '../services/mondayService';
import { indexedDBService } from '../services/indexedDBService';
import { authService } from '../services/auth';
import LeadDetailsPanel from './LeadDetailsPanel';
import './ConversasLeadsTab.css';

const BOARD_ATENDIMENTO = 607533664;
const BOARD_CONTENCIOSO = 632454515;
const BOARD_1624767171 = 1624767171;
const BOARD_632406700 = 632406700;

const BOARD_NAMES: Record<number, string> = {
  [BOARD_ATENDIMENTO]: 'Atendimento',
  [BOARD_CONTENCIOSO]: 'Contencioso',
  [BOARD_1624767171]: 'Não é Caso',
  [BOARD_632406700]: 'Financeiro',
};

interface UniquePhone {
  phone: string;
  messageCount: number;
  lastMessage: {
    content: string;
    timestamp: string | null;
    source: string;
  } | null;
  contactName: string | null;
}

interface MondayItemWithBoard extends MondayBoardItem {
  boardId?: number;
  boardName?: string;
}

interface MatchedConversation {
  phone: string;
  whatsapp: UniquePhone;
  monday: MondayItemWithBoard | null;
  status: 'matched' | 'orphan';
}

type FilterType = 'all' | 'with-lead' | 'without-lead';

const ConversasLeadsTab: React.FC = () => {
  // Estados principais
  const [whatsappPhones, setWhatsappPhones] = useState<UniquePhone[]>([]);
  const [mondayItems, setMondayItems] = useState<MondayBoardItem[]>([]);
  const [columns, setColumns] = useState<MondayColumn[]>([]);
  const [matchedData, setMatchedData] = useState<MatchedConversation[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBoard, setFilterBoard] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterEtiquetas, setFilterEtiquetas] = useState<string>('all');
  const [filterQualidade, setFilterQualidade] = useState<string>('all');

  // Estados de carregamento
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setLastUpdate] = useState<string | null>(null);
  const [hasMoreItems, setHasMoreItems] = useState(false);

  // Configuração de paginação (200 leads por board = 800 total inicial)
  const ITEMS_PER_BOARD = 200;

  // Ref para controlar auto-load em background (evitar re-trigger)
  const backgroundLoadRef = useRef(false);

  // Item selecionado (painel direito)
  const [selectedItem, setSelectedItem] = useState<MondayItemWithBoard | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<MatchedConversation | null>(null);

  // Normalizar telefone para comparação
  const normalizePhone = (phone: string): string => {
    return phone.replace(/\D/g, '');
  };

  // Combinar dados do WhatsApp e Monday
  const matchData = useCallback(() => {
    if (whatsappPhones.length === 0) return;

    const phoneKeywords = ['telefone', 'phone', 'celular', 'whatsapp', 'fone', 'tel', 'contato'];

    // Função para extrair últimos 8-9 dígitos (número local sem DDD completo)
    const getLocalNumber = (phone: string): string => {
      const cleaned = phone.replace(/\D/g, '');
      return cleaned.length >= 9 ? cleaned.slice(-9) : cleaned.slice(-8);
    };

    // [STEP 2] Extrair TODAS as colunas de telefone de cada item (não só a primeira)
    const getAllPhonesFromItem = (item: MondayBoardItem): string[] => {
      const phones: string[] = [];
      for (const col of item.column_values || []) {
        const colId = col.id?.toLowerCase() || '';
        const colTitle = columns.find(c => c.id === col.id)?.title?.toLowerCase() || '';
        if (phoneKeywords.some(kw => colId.includes(kw) || colTitle.includes(kw))) {
          if (col.text && col.text.trim()) {
            const normalized = normalizePhone(col.text);
            if (normalized.length >= 8 && !phones.includes(normalized)) {
              phones.push(normalized);
            }
          }
        }
      }
      return phones;
    };

    // [STEP 4] Gerar variantes do 9o dígito brasileiro
    const get9thDigitVariants = (phone: string): string[] => {
      const variants: string[] = [phone];
      const cleaned = phone.replace(/\D/g, '');

      // Formato com código de país: 55 + DDD(2) + número(8 ou 9)
      if (cleaned.startsWith('55') && cleaned.length === 13) {
        // 13 dígitos = 55 + DD + 9XXXXXXXX -> gerar sem o 9o dígito
        const withoutNinth = cleaned.slice(0, 4) + cleaned.slice(5);
        variants.push(withoutNinth);
      } else if (cleaned.startsWith('55') && cleaned.length === 12) {
        // 12 dígitos = 55 + DD + XXXXXXXX -> gerar com o 9o dígito
        const withNinth = cleaned.slice(0, 4) + '9' + cleaned.slice(4);
        variants.push(withNinth);
      }

      // Sem código de país: DDD(2) + número(8 ou 9)
      if (!cleaned.startsWith('55')) {
        if (cleaned.length === 11) {
          // DD + 9XXXXXXXX -> DD + XXXXXXXX
          const withoutNinth = cleaned.slice(0, 2) + cleaned.slice(3);
          variants.push(withoutNinth);
        } else if (cleaned.length === 10) {
          // DD + XXXXXXXX -> DD + 9XXXXXXXX
          const withNinth = cleaned.slice(0, 2) + '9' + cleaned.slice(2);
          variants.push(withNinth);
        }
      }

      return variants;
    };

    // [STEP 3] Map com array para suportar múltiplos itens por telefone
    const mondayPhoneMap = new Map<string, MondayItemWithBoard[]>();

    const addToPhoneMap = (key: string, item: MondayItemWithBoard) => {
      const existing = mondayPhoneMap.get(key);
      if (existing) {
        if (!existing.some(e => e.id === item.id)) {
          existing.push(item);
        }
      } else {
        mondayPhoneMap.set(key, [item]);
      }
    };

    const matched: MatchedConversation[] = [];

    // Popular mapa com todos os telefones de todos os itens
    mondayItems.forEach(item => {
      const phones = getAllPhonesFromItem(item);
      const itemWithBoard = item as MondayItemWithBoard;

      phones.forEach(phone => {
        if (phone.length >= 8) {
          // Gerar todas as variantes (com/sem 9o dígito)
          const variants = get9thDigitVariants(phone);

          variants.forEach(variant => {
            // Telefone completo
            addToPhoneMap(variant, itemWithBoard);
            // Sem código do país (55)
            if (variant.startsWith('55') && variant.length > 10) {
              addToPhoneMap(variant.substring(2), itemWithBoard);
            }
            // Com código do país
            if (!variant.startsWith('55') && variant.length >= 10) {
              addToPhoneMap('55' + variant, itemWithBoard);
            }
            // Número local (últimos 8-9 dígitos)
            const localNum = getLocalNumber(variant);
            if (localNum.length >= 8) {
              addToPhoneMap(localNum, itemWithBoard);
            }
          });
        }
      });
    });

    console.log('📱 Monday phones map:', mondayPhoneMap.size, 'entries from', mondayItems.length, 'items');

    // Lookup: tentar todas as variantes do telefone do WhatsApp
    const lookupPhone = (phone: string): MondayItemWithBoard | null => {
      const normalizedPhone = normalizePhone(phone);
      const localNum = getLocalNumber(normalizedPhone);

      // Gerar variantes do telefone do WhatsApp também
      const whatsappVariants = get9thDigitVariants(normalizedPhone);

      for (const variant of whatsappVariants) {
        let items = mondayPhoneMap.get(variant);
        if (items) return items[0];

        // Tentar sem código do país
        if (variant.startsWith('55')) {
          items = mondayPhoneMap.get(variant.substring(2));
          if (items) return items[0];
        }
        // Tentar com código do país
        if (!variant.startsWith('55')) {
          items = mondayPhoneMap.get('55' + variant);
          if (items) return items[0];
        }
      }

      // Tentar pelo número local
      const items = mondayPhoneMap.get(localNum);
      if (items) return items[0];

      // Tentar variante local com/sem 9o dígito
      if (localNum.length === 9) {
        const without9 = localNum.slice(1);
        const items8 = mondayPhoneMap.get(without9);
        if (items8) return items8[0];
      } else if (localNum.length === 8) {
        const with9 = '9' + localNum;
        const items9 = mondayPhoneMap.get(with9);
        if (items9) return items9[0];
      }

      return null;
    };

    // Para cada telefone do WhatsApp, buscar match no Monday
    whatsappPhones.forEach(wp => {
      const mondayItem = lookupPhone(wp.phone);
      matched.push({
        phone: wp.phone,
        whatsapp: wp,
        monday: mondayItem || null,
        status: mondayItem ? 'matched' : 'orphan',
      });
    });

    // [STEP 5] Logs de diagnóstico
    const matchedCount = matched.filter(m => m.status === 'matched').length;
    const orphanCount = matched.filter(m => m.status === 'orphan').length;
    console.log(`✅ Match result: ${matchedCount}/${matched.length} matched, ${orphanCount} orphans`);
    console.log(`📊 Monday items: ${mondayItems.length}, Phone map entries: ${mondayPhoneMap.size}`);

    if (orphanCount > 0) {
      const orphans = matched.filter(m => m.status === 'orphan').slice(0, 10);
      console.log('🔍 First 10 orphans:', orphans.map(o => ({
        phone: o.phone,
        normalized: normalizePhone(o.phone),
        local: getLocalNumber(normalizePhone(o.phone)),
        name: o.whatsapp.contactName,
      })));
    }

    setMatchedData(matched);
  }, [whatsappPhones, mondayItems, columns]);

  // Executar match quando dados mudarem
  useEffect(() => {
    matchData();
  }, [matchData]);

  // Buscar telefones únicos do WhatsApp
  const fetchWhatsappPhones = async () => {
    try {
      const phonesHeaders: Record<string, string> = {};
      const phonesToken = authService.getToken();
      if (phonesToken) phonesHeaders['Authorization'] = `Bearer ${phonesToken}`;
      const response = await fetch('/api/firestore/unique-phones', { headers: phonesHeaders });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      const phones = data.phones || [];
      setWhatsappPhones(phones);

      // Salvar no cache
      await indexedDBService.saveWhatsAppPhones(phones);
      console.log('✅ Telefones do WhatsApp carregados e salvos no cache:', data.count);
    } catch (err) {
      console.error('❌ Erro ao buscar telefones do WhatsApp:', err);
      throw err;
    }
  };

  // Buscar itens do Monday (todos os boards) - com suporte a paginação
  const fetchMondayItems = async (loadAll = false) => {
    // Opções de paginação: carregar apenas os mais recentes ou todos
    const paginationOptions = loadAll
      ? undefined // Carregar todos
      : { maxItems: ITEMS_PER_BOARD, orderByRecent: true }; // Carregar apenas os mais recentes

    // Buscar de todos os boards em paralelo (com tolerância a falhas)
    // Ordem: Atendimento, Contencioso, Financeiro, Não é Caso
    const results = await Promise.allSettled([
      mondayService.getBoardItemsWithColumns(BOARD_ATENDIMENTO, paginationOptions),
      mondayService.getBoardItemsWithColumns(BOARD_CONTENCIOSO, paginationOptions),
      mondayService.getBoardItemsWithColumns(BOARD_632406700, paginationOptions),
      mondayService.getBoardItemsWithColumns(BOARD_1624767171, paginationOptions),
    ]);

    const allItems: MondayItemWithBoard[] = [];
    const allColumns: MondayColumn[] = [];
    const cachePromises: Promise<void>[] = [];
    let anyBoardHasMore = false;

    // Processar cada resultado (mesma ordem das chamadas acima)
    const boardConfigs = [
      { boardId: BOARD_ATENDIMENTO, name: 'Atendimento' },
      { boardId: BOARD_CONTENCIOSO, name: 'Contencioso' },
      { boardId: BOARD_632406700, name: 'Financeiro' },
      { boardId: BOARD_1624767171, name: 'Não é Caso' },
    ];

    results.forEach((result, index) => {
      const config = boardConfigs[index];
      if (result.status === 'fulfilled') {
        const items: MondayItemWithBoard[] = result.value.items.map(item => ({
          ...item,
          boardId: config.boardId,
          boardName: BOARD_NAMES[config.boardId],
        }));
        allItems.push(...items);
        allColumns.push(...result.value.columns);
        cachePromises.push(indexedDBService.saveBoardData(String(config.boardId), items, result.value.columns));
        console.log(`✅ Board ${config.name}: ${items.length} itens${result.value.hasMore ? ' (mais disponíveis)' : ''}`);
        if (result.value.hasMore) {
          anyBoardHasMore = true;
        }
      } else {
        console.error(`❌ Erro ao carregar board ${config.name}:`, result.reason);
      }
    });

    // Remover colunas duplicadas
    const uniqueColumns = allColumns.filter((col, index, self) =>
      index === self.findIndex(c => c.id === col.id)
    );

    setMondayItems(allItems);
    setColumns(uniqueColumns);
    setHasMoreItems(anyBoardHasMore && !loadAll);

    // Salvar no cache
    await Promise.allSettled(cachePromises);

    console.log(`✅ Total de itens do Monday: ${allItems.length}${anyBoardHasMore ? ' (mais disponíveis)' : ''}`);
  };

  // Carregar dados iniciais
  const loadData = useCallback(async (forceRefresh = false) => {
    // Reset para permitir auto-load após refresh
    backgroundLoadRef.current = false;
    let hasCache = false;

    if (!forceRefresh) {
      setLoading(true);

      // Tentar carregar cache do Monday (todos os boards) e WhatsApp
      // Ordem: Atendimento, Contencioso, Financeiro, Não é Caso
      try {
        const [cachedAtendimento, cachedContencioso, cachedFinanceiro, cachedNaoECaso, cachedWhatsappData] = await Promise.all([
          indexedDBService.loadBoardData(String(BOARD_ATENDIMENTO)),
          indexedDBService.loadBoardData(String(BOARD_CONTENCIOSO)),
          indexedDBService.loadBoardData(String(BOARD_632406700)),
          indexedDBService.loadBoardData(String(BOARD_1624767171)),
          indexedDBService.loadWhatsAppPhones(),
        ]);

        const allCachedItems: MondayItemWithBoard[] = [];
        const allCachedColumns: MondayColumn[] = [];

        if (cachedAtendimento) {
          const items = cachedAtendimento.items.map((item: MondayBoardItem) => ({
            ...item,
            boardId: BOARD_ATENDIMENTO,
            boardName: BOARD_NAMES[BOARD_ATENDIMENTO],
          }));
          allCachedItems.push(...items);
          allCachedColumns.push(...cachedAtendimento.columns);
          setLastUpdate(cachedAtendimento.lastUpdate);
          hasCache = true;
        }

        if (cachedContencioso) {
          const items = cachedContencioso.items.map((item: MondayBoardItem) => ({
            ...item,
            boardId: BOARD_CONTENCIOSO,
            boardName: BOARD_NAMES[BOARD_CONTENCIOSO],
          }));
          allCachedItems.push(...items);
          allCachedColumns.push(...cachedContencioso.columns);
          if (cachedContencioso.lastUpdate) {
            setLastUpdate(cachedContencioso.lastUpdate);
          }
          hasCache = true;
        }

        if (cachedFinanceiro) {
          const items = cachedFinanceiro.items.map((item: MondayBoardItem) => ({
            ...item,
            boardId: BOARD_632406700,
            boardName: BOARD_NAMES[BOARD_632406700],
          }));
          allCachedItems.push(...items);
          allCachedColumns.push(...cachedFinanceiro.columns);
          hasCache = true;
        }

        if (cachedNaoECaso) {
          const items = cachedNaoECaso.items.map((item: MondayBoardItem) => ({
            ...item,
            boardId: BOARD_1624767171,
            boardName: BOARD_NAMES[BOARD_1624767171],
          }));
          allCachedItems.push(...items);
          allCachedColumns.push(...cachedNaoECaso.columns);
          hasCache = true;
        }

        if (allCachedItems.length > 0) {
          // Remover colunas duplicadas
          const uniqueColumns = allCachedColumns.filter((col, index, self) =>
            index === self.findIndex(c => c.id === col.id)
          );
          setMondayItems(allCachedItems);
          setColumns(uniqueColumns);
        }

        if (cachedWhatsappData) {
          setWhatsappPhones(cachedWhatsappData.phones);
          if (cachedWhatsappData.lastUpdate) {
            setLastUpdate(cachedWhatsappData.lastUpdate);
          }
          hasCache = true;
        }

        // Se temos cache, mostrar dados e atualizar em background
        if (hasCache) {
          setLoading(false);
          setUpdating(true);
        }
      } catch (err) {
        console.error('⚠️ Erro ao carregar cache:', err);
      }
    } else {
      setUpdating(true);
    }

    setError(null);

    try {
      // Buscar dados em paralelo
      await Promise.all([
        fetchWhatsappPhones(),
        fetchMondayItems(),
      ]);

      setLastUpdate(new Date().toISOString());
    } catch (err) {
      console.error('❌ Erro ao carregar dados:', err);
      // Só mostrar erro se não temos cache
      if (!hasCache) {
        setError('Erro ao carregar dados. Verifique a conexão.');
      }
    } finally {
      setLoading(false);
      setUpdating(false);
    }
  }, []);

  // Carregar dados ao montar
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Atualizar automaticamente a cada 10 minutos
  useEffect(() => {
    const AUTO_REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutos

    const interval = setInterval(() => {
      console.log('🔄 Atualização automática (10 min)...');
      loadData(true);
    }, AUTO_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [loadData]);

  // Auto-carregar TODOS os itens em background após o load inicial
  useEffect(() => {
    if (!loading && !updating && hasMoreItems && mondayItems.length > 0 && !backgroundLoadRef.current) {
      backgroundLoadRef.current = true;
      setLoadingMore(true);
      console.log('🔄 Auto-carregando todos os itens do Monday em background...');
      const autoLoad = async () => {
        try {
          await fetchMondayItems(true);
          console.log('✅ Auto-load completo — todos os itens carregados');
        } catch (err) {
          console.error('❌ Auto-load falhou:', err);
          backgroundLoadRef.current = false; // Permitir retry
        } finally {
          setLoadingMore(false);
        }
      };
      autoLoad();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, updating, hasMoreItems, mondayItems.length]);

  // Filtrar dados
  const getFilteredData = (): MatchedConversation[] => {
    let filtered = matchedData;

    // Filtrar por status de lead (com/sem lead)
    if (filter === 'with-lead') {
      filtered = filtered.filter(d => d.status === 'matched');
    } else if (filter === 'without-lead') {
      filtered = filtered.filter(d => d.status === 'orphan');
    }

    // Filtrar por board
    if (filterBoard !== 'all') {
      filtered = filtered.filter(d => d.monday?.boardName === filterBoard);
    }

    // Filtrar por status Monday
    if (filterStatus !== 'all') {
      filtered = filtered.filter(d => getStatus(d.monday) === filterStatus);
    }

    // Filtrar por etiquetas
    if (filterEtiquetas !== 'all') {
      filtered = filtered.filter(d => getEtiquetas(d.monday) === filterEtiquetas);
    }

    // Filtrar por qualidade
    if (filterQualidade !== 'all') {
      filtered = filtered.filter(d => getQualidade(d.monday) === filterQualidade);
    }

    // Filtrar por busca
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(d => {
        const phoneMatch = (d.phone || '').includes(term);
        const nameMatch = (typeof d.whatsapp?.contactName === 'string' ? d.whatsapp.contactName : '').toLowerCase().includes(term);
        const mondayNameMatch = (typeof d.monday?.name === 'string' ? d.monday.name : '').toLowerCase().includes(term);
        return phoneMatch || nameMatch || mondayNameMatch;
      });
    }

    return filtered;
  };

  // Formatar telefone para exibição
  const formatPhone = (phone: string): string => {
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

  // Buscar etiquetas de um item do Monday
  const getEtiquetas = (item: MondayBoardItem | null): string | null => {
    if (!item || !item.column_values) return null;

    // Primeiro, buscar especificamente por "etiquetas"
    for (const col of item.column_values) {
      const colId = col.id?.toLowerCase() || '';
      const colTitle = columns.find(c => c.id === col.id)?.title?.toLowerCase() || '';

      if (colId === 'etiquetas' || colTitle === 'etiquetas' || colId.includes('etiqueta') || colTitle.includes('etiqueta')) {
        console.log('🏷️ Campo etiquetas encontrado:', { colId, colTitle, text: col.text, col });
        if (col.text && col.text.trim() && col.text !== '-') {
          return col.text;
        }
      }
    }

    // Fallback para outros keywords
    const etiquetasKeywords = ['etiqueta', 'tag', 'label'];

    for (const col of item.column_values) {
      const colId = col.id?.toLowerCase() || '';
      const colTitle = columns.find(c => c.id === col.id)?.title?.toLowerCase() || '';

      if (etiquetasKeywords.some(kw => colId.includes(kw) || colTitle.includes(kw))) {
        if (col.text && col.text.trim() && col.text !== '-') {
          return col.text;
        }
      }
    }
    return null;
  };

  // Buscar qualidade de um item do Monday
  const getQualidade = (item: MondayBoardItem | null): string | null => {
    if (!item || !item.column_values) return null;

    for (const col of item.column_values) {
      const colId = col.id?.toLowerCase() || '';
      const colTitle = columns.find(c => c.id === col.id)?.title?.toLowerCase() || '';

      if (colId === 'qualidade' || colTitle === 'qualidade' || colId.includes('qualidade') || colTitle.includes('qualidade')) {
        if (col.text && col.text.trim() && col.text !== '-') {
          return col.text;
        }
      }
    }
    return null;
  };

  // Buscar status de um item do Monday
  const getStatus = (item: MondayBoardItem | null): string | null => {
    if (!item || !item.column_values) return null;

    for (const col of item.column_values) {
      const colId = col.id?.toLowerCase() || '';
      const colTitle = columns.find(c => c.id === col.id)?.title?.toLowerCase() || '';

      if (colId === 'status' || colTitle === 'status') {
        if (col.text && col.text.trim() && col.text !== '-') {
          return col.text;
        }
      }
    }
    return null;
  };

  // Formatar tempo relativo
  const formatRelativeTime = (timestamp: string | null): string => {
    if (!timestamp) return '-';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'agora';
    if (diffMins < 60) return `${diffMins}min`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;

    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  // Selecionar conversa
  const handleSelectConversation = (data: MatchedConversation) => {
    setSelectedConversation(data);

    if (data.monday) {
      setSelectedItem(data.monday);
    } else {
      // Criar um item "fake" para abrir o painel de WhatsApp
      const fakeItem: MondayItemWithBoard = {
        id: `whatsapp_${data.phone}`,
        name: data.whatsapp.contactName || `WhatsApp ${formatPhone(data.phone)}`,
        column_values: [
          {
            id: 'telefone',
            text: data.phone,
            type: 'text',
          }
        ],
      };
      setSelectedItem(fakeItem);
    }
  };

  // Fechar painel
  const handleClosePanel = () => {
    setSelectedItem(null);
    setSelectedConversation(null);
  };

  // Callback quando lead é criado
  const handleLeadCreated = () => {
    loadData(true);
    setSelectedItem(null);
    setSelectedConversation(null);
  };

  const filteredData = getFilteredData();

  // Contadores
  const totalCount = matchedData.length;
  const withLeadCount = matchedData.filter(d => d.status === 'matched').length;
  const withoutLeadCount = matchedData.filter(d => d.status === 'orphan').length;

  // Valores únicos para filtros
  const uniqueBoards = Array.from(new Set(matchedData.map(d => d.monday?.boardName).filter(Boolean))) as string[];
  const uniqueStatus = Array.from(new Set(matchedData.map(d => getStatus(d.monday)).filter(Boolean))) as string[];
  const uniqueEtiquetas = Array.from(new Set(matchedData.map(d => getEtiquetas(d.monday)).filter(Boolean))) as string[];
  const uniqueQualidade = Array.from(new Set(matchedData.map(d => getQualidade(d.monday)).filter(Boolean))) as string[];

  if (loading && matchedData.length === 0) {
    return (
      <div className="conversas-leads-tab">
        <div className="conversas-loading">
          <div className="loading-spinner"></div>
          <p>Carregando conversas...</p>
        </div>
      </div>
    );
  }

  if (error && matchedData.length === 0) {
    return (
      <div className="conversas-leads-tab">
        <div className="conversas-error">
          <div className="error-icon">⚠️</div>
          <h3>Erro ao carregar dados</h3>
          <p>{error}</p>
          <button onClick={() => loadData(true)} className="retry-button">
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="conversas-leads-tab">
      <div className="conversas-layout">
        {/* Lista de conversas (esquerda) */}
        <div className="conversas-list-panel">
          <div className="conversas-list-header">
            <div className="conversas-search">
              <input
                type="text"
                placeholder="Buscar..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="conversas-filters-row">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as FilterType)}
                className="filter-select-small"
              >
                <option value="all">Todos ({totalCount})</option>
                <option value="with-lead">Com Lead ({withLeadCount})</option>
                <option value="without-lead">Sem Lead ({withoutLeadCount})</option>
              </select>
              <select
                value={filterBoard}
                onChange={(e) => setFilterBoard(e.target.value)}
                className="filter-select-small"
              >
                <option value="all">Board</option>
                {uniqueBoards.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="filter-select-small"
              >
                <option value="all">Status</option>
                {uniqueStatus.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                onClick={() => loadData(true)}
                className="refresh-btn"
                title="Atualizar"
                disabled={updating}
              >
                {updating ? '...' : '↻'}
              </button>
            </div>
            <div className="conversas-filters-row">
              <select
                value={filterEtiquetas}
                onChange={(e) => setFilterEtiquetas(e.target.value)}
                className="filter-select-small"
              >
                <option value="all">Etiquetas</option>
                {uniqueEtiquetas.map(e => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
              <select
                value={filterQualidade}
                onChange={(e) => setFilterQualidade(e.target.value)}
                className="filter-select-small"
              >
                <option value="all">Qualidade</option>
                {uniqueQualidade.map(q => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="conversas-list">
            {filteredData.map((data) => (
              <div
                key={data.phone}
                className={`conversa-item ${data.status} ${selectedConversation?.phone === data.phone ? 'selected' : ''}`}
                onClick={() => handleSelectConversation(data)}
              >
                <div className="conversa-avatar">
                  {data.status === 'matched' ? '✓' : '?'}
                </div>
                <div className="conversa-info">
                  <div className="conversa-name">
                    {data.status === 'matched'
                      ? data.monday?.name
                      : (data.whatsapp.contactName || formatPhone(data.phone))
                    }
                  </div>
                  <div className="conversa-meta-info">
                    {data.monday?.boardName && (
                      <span className="conversa-board">{data.monday.boardName}</span>
                    )}
                    {getStatus(data.monday) && (
                      <span className="conversa-status">{getStatus(data.monday)}</span>
                    )}
                    {getEtiquetas(data.monday) && (
                      <span className="conversa-etiquetas">{getEtiquetas(data.monday)}</span>
                    )}
                    {getQualidade(data.monday) && (
                      <span className="conversa-qualidade">{getQualidade(data.monday)}</span>
                    )}
                  </div>
                  <div className="conversa-preview">
                    {data.whatsapp.lastMessage?.content?.slice(0, 40) || 'Sem mensagens'}
                    {(data.whatsapp.lastMessage?.content?.length || 0) > 40 ? '...' : ''}
                  </div>
                </div>
                <div className="conversa-meta">
                  <div className="conversa-time">
                    {formatRelativeTime(data.whatsapp.lastMessage?.timestamp || null)}
                  </div>
                  <div className="conversa-count">{data.whatsapp.messageCount}</div>
                </div>
              </div>
            ))}
            {filteredData.length === 0 && (
              <div className="conversas-empty">
                <p>Nenhuma conversa encontrada</p>
              </div>
            )}
            {loadingMore && (
              <div className="load-more-container">
                <span className="load-more-info">
                  Carregando todos os leads em segundo plano...
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Painel de detalhes (direita) */}
        <div className="conversas-detail-panel">
          {selectedItem ? (
            <LeadDetailsPanel
              item={selectedItem}
              columns={columns}
              boardId={selectedItem.boardId || BOARD_ATENDIMENTO}
              onClose={handleClosePanel}
              onLeadCreated={handleLeadCreated}
            />
          ) : (
            <div className="detail-placeholder">
              <div className="placeholder-icon">💬</div>
              <h3>Conversas & Leads</h3>
              <p>Selecione uma conversa para ver os detalhes</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConversasLeadsTab;
