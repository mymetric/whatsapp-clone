import React, { useEffect, useState } from 'react';
import { mondayService } from '../services/mondayService';
import { firestoreRestAttachmentService, Attachment } from '../services/firestoreRestService';
import { Prompt } from '../services/api';
import ContenciosoPromptsManager from './ContenciosoPromptsManager';
import { contenciosoCacheService } from '../services/contenciosoCacheService';
import './MondayTab.css';

interface ContenciosoItem {
  id: string;
  name: string;
  created_at?: string;
  column_values?: {
    id: string;
    text: string;
    type?: string;
  }[];
}

const CONTENCIOSO_BOARD_ID = 632454515;

const ContenciosoTab: React.FC = () => {
  const [items, setItems] = useState<ContenciosoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingInBackground, setUpdatingInBackground] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<ContenciosoItem | null>(null);
  const [selectedNumeroProcesso, setSelectedNumeroProcesso] = useState<string | null>(null);
  const [selectedItemAttachments, setSelectedItemAttachments] = useState<Attachment[] | null>(null);
  const [selectedItemLoading, setSelectedItemLoading] = useState(false);
  const [selectedItemError, setSelectedItemError] = useState<string | null>(null);
  const [attachmentsSearch, setAttachmentsSearch] = useState('');
  const [copilotAttachments, setCopilotAttachments] = useState<Attachment[]>([]);
  const [copilotDragOver, setCopilotDragOver] = useState(false);
  const [copilotMessages, setCopilotMessages] = useState<
    { role: 'user' | 'assistant'; content: string; timestamp: Date }[]
  >([]);
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [showPromptsManager, setShowPromptsManager] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [attachmentCounts, setAttachmentCounts] = useState<Record<string, number>>({});
  const [loadingAttachmentCounts, setLoadingAttachmentCounts] = useState(false);
  const [attachmentFilter, setAttachmentFilter] = useState<'all' | 'with' | 'without'>('all');

  /**
   * Carrega itens do cache IndexedDB (assíncrono)
   */
  const loadItemsFromCache = async (): Promise<ContenciosoItem[] | null> => {
    const cachedItems = await contenciosoCacheService.loadItems(CONTENCIOSO_BOARD_ID);
    if (cachedItems && cachedItems.length > 0) {
      console.log('📦 ContenciosoTab: Carregando itens do cache');
      setItems(cachedItems);
      return cachedItems;
    }
    return null;
  };

  /**
   * Busca contagens de anexos para todos os itens
   */
  const loadAttachmentCounts = async (itemsToLoad: ContenciosoItem[]) => {
    setLoadingAttachmentCounts(true);
    const counts: Record<string, number> = {};

    try {
      // Busca contagens em paralelo para todos os itens que têm numeroProcesso
      const countPromises = itemsToLoad.map(async (item) => {
        const numeroProcesso = item.column_values?.find(
          (col) => col.id === 'numero_do_processo'
        )?.text;

        if (!numeroProcesso) {
          return { itemId: item.id, count: 0 };
        }

        try {
          const attachments = await firestoreRestAttachmentService.getAttachmentsByLawsuitId(
            numeroProcesso
          );
          return { itemId: item.id, count: attachments.length };
        } catch (err) {
          console.error(`Erro ao buscar contagem de anexos para item ${item.id}:`, err);
          return { itemId: item.id, count: 0 };
        }
      });

      const results = await Promise.all(countPromises);
      results.forEach(({ itemId, count }) => {
        counts[itemId] = count;
      });

      setAttachmentCounts(counts);
    } catch (err) {
      console.error('Erro ao carregar contagens de anexos:', err);
    } finally {
      setLoadingAttachmentCounts(false);
    }
  };

  /**
   * Atualiza itens do servidor e salva no cache
   * Só atualiza o cache se houver dados válidos (não vazios)
   */
  const updateItemsFromServer = async (showLoading = false) => {
    if (showLoading) {
      setLoading(true);
    } else {
      setUpdatingInBackground(true);
    }
    setError(null);

    try {
      console.log('📑 ContenciosoTab: Atualizando itens do board', CONTENCIOSO_BOARD_ID);
      const boardItems = await mondayService.getBoardItems(CONTENCIOSO_BOARD_ID);
      
      // Só salva no cache e atualiza o estado se houver dados válidos
      // Se retornar array vazio, pode ser erro - não atualiza o cache
      if (boardItems && boardItems.length > 0) {
        // Salva no cache IndexedDB (persistente, sem expiração)
        await contenciosoCacheService.saveItems(CONTENCIOSO_BOARD_ID, boardItems);
        
        // Atualiza o estado
        setItems(boardItems);

        // Carrega contagens de anexos em background
        loadAttachmentCounts(boardItems);
      } else {
        // Array vazio pode indicar erro - não atualiza cache nem estado
        // Mantém os dados do cache existente
        console.warn('⚠️ ContenciosoTab: Resposta vazia do servidor, mantendo cache existente');
        if (showLoading) {
          // Se foi uma atualização forçada e retornou vazio, mostra erro
          setError('Nenhum item encontrado no board de contencioso');
        }
        // Se for atualização em background, não mostra erro (mantém dados do cache)
      }
    } catch (err) {
      console.error('Erro ao carregar itens do board de contencioso:', err);
      // Em caso de erro, não atualiza cache nem estado - mantém dados existentes
      if (showLoading) {
        setError('Erro ao carregar itens do board de contencioso');
      }
      // Se for atualização em background, não mostra erro (mantém dados do cache)
    } finally {
      if (showLoading) {
        setLoading(false);
      } else {
        setUpdatingInBackground(false);
      }
    }
  };

  /**
   * Carrega itens: primeiro do cache, depois atualiza em background
   */
  const loadItems = async (forceRefresh = false) => {
    if (forceRefresh) {
      // Atualização forçada também em background (não bloqueia interface)
      // Só mostra loading se não houver dados no cache e não houver fichas abertas
      const cachedItems = await loadItemsFromCache();
      if (!cachedItems || cachedItems.length === 0) {
        // Se não há cache, mostra loading apenas se não houver ficha aberta
        if (!selectedItem) {
          await updateItemsFromServer(true);
        } else {
          // Se há ficha aberta, atualiza em background mesmo sem cache
          updateItemsFromServer(false);
        }
      } else {
        // Se há cache, sempre atualiza em background (não interrompe fichas)
        updateItemsFromServer(false);
      }
    } else {
      // Tenta carregar do cache primeiro
      const cachedItems = await loadItemsFromCache();
      
      // Se carregou do cache, busca contagens de anexos
      if (cachedItems) {
        loadAttachmentCounts(cachedItems);
      }
      
      // Sempre atualiza em background para manter cache atualizado
      // O cache só será substituído quando houver uma atualização bem-sucedida
      updateItemsFromServer(false);
    }
  };

  /**
   * Atualiza itens em background (não bloqueia interface)
   */
  const refreshItems = () => {
    updateItemsFromServer(false);
  };

  useEffect(() => {
    loadItems();
  }, []);

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Data não disponível';
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const openItemFicha = async (item: ContenciosoItem, numeroProcesso: string) => {
    setSelectedItem(item);
    setSelectedNumeroProcesso(numeroProcesso);
    setSelectedItemLoading(true);
    setSelectedItemError(null);
    setSelectedItemAttachments(null);
    setAttachmentsSearch('');
    setCopilotAttachments([]);

    try {
      const attachments = await firestoreRestAttachmentService.getAttachmentsByLawsuitId(
        numeroProcesso
      );
      setSelectedItemAttachments(attachments);
    } catch (err) {
      console.error('Erro ao carregar anexos do processo no Firestore:', err);
      setSelectedItemError('Erro ao carregar anexos do processo. Veja o console para mais detalhes.');
    } finally {
      setSelectedItemLoading(false);
    }
  };

  const closeItemFicha = () => {
    setSelectedItem(null);
    setSelectedNumeroProcesso(null);
    setSelectedItemAttachments(null);
    setSelectedItemLoading(false);
    setSelectedItemError(null);
    setAttachmentsSearch('');
    setCopilotAttachments([]);
    setCopilotDragOver(false);
    setCopilotMessages([]);
    setCopilotInput('');
    setCopilotError(null);
  };

  const handleAttachmentDragStart = (attachment: Attachment, event: React.DragEvent<HTMLLIElement>) => {
    try {
      event.dataTransfer.setData('application/json', JSON.stringify(attachment));
    } catch {
      // fallback simples
      event.dataTransfer.setData('text/plain', attachment.id);
    }
  };

  const handleCopilotDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setCopilotDragOver(true);
  };

  const handleCopilotDragLeave = () => {
    setCopilotDragOver(false);
  };

  const handleCopilotDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setCopilotDragOver(false);

    const jsonData = event.dataTransfer.getData('application/json');
    if (jsonData) {
      try {
        const parsed = JSON.parse(jsonData) as Attachment;
        // Adiciona o anexo ao array se ainda não estiver presente
        setCopilotAttachments((prev) => {
          const exists = prev.some((att) => att.id === parsed.id);
          if (exists) return prev;
          return [...prev, parsed];
        });
        return;
      } catch {
        // ignora parse error e tenta fallback
      }
    }
  };

  const handleRemoveCopilotAttachment = (attachmentId: string) => {
    setCopilotAttachments((prev) => prev.filter((att) => att.id !== attachmentId));
  };

  const getFilteredAttachments = (): Attachment[] => {
    if (!selectedItemAttachments) return [];
    const term = attachmentsSearch.trim().toLowerCase();
    if (!term) return selectedItemAttachments;
    return selectedItemAttachments.filter((att) => {
      const name = (att.attachment_name || '').toLowerCase();
      const url = (att.file_url || '').toLowerCase();
      return name.includes(term) || url.includes(term) || att.id.toLowerCase().includes(term);
    });
  };

  const buildCopilotContext = () => {
    const processo = selectedNumeroProcesso || 'desconhecido';
    const anexosDescricao =
      copilotAttachments.length === 0
        ? 'Nenhum anexo foi explicitamente selecionado para o copiloto.'
        : copilotAttachments
            .map(
              (att, idx) =>
                `${idx + 1}. ${
                  att.attachment_name || 'Anexo sem nome'
                }${att.file_url ? ` (URL: ${att.file_url})` : ''}`,
            )
            .join('\n');

    return `Contexto do processo:
- Número do processo: ${processo}
- Item do board: ${selectedItem?.name || 'desconhecido'}

Anexos selecionados para análise:
${anexosDescricao}

Use esse contexto para responder perguntas sobre o processo, andamentos e riscos. Se faltar informação nos anexos, seja claro sobre as limitações.`;
  };

  const inferFilename = (att: Attachment): string => {
    if (att.attachment_name && att.attachment_name.trim()) return att.attachment_name.trim();
    if (att.file_url) {
      try {
        const u = new URL(att.file_url);
        const last = u.pathname.split('/').filter(Boolean).pop();
        if (last) return decodeURIComponent(last);
      } catch {
        // ignore
      }
    }
    return `${att.id}.bin`;
  };

  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    // Evita spread em Uint8Array (compatibilidade com target antigo do TS/CRA)
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const downloadAttachmentForGrok = async (att: Attachment) => {
    if (!att.file_url) {
      throw new Error(`Anexo sem URL: ${att.attachment_name || att.id}`);
    }

    // Usa proxy do backend para evitar CORS
    const proxyUrl = `/api/proxy-file?url=${encodeURIComponent(att.file_url)}`;
    const resp = await fetch(proxyUrl);
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Falha ao baixar anexo (${resp.status}): ${txt}`);
    }

    const mimeType = resp.headers.get('content-type') || 'application/octet-stream';
    const buf = await resp.arrayBuffer();

    // Limite simples pra evitar explodir payload
    const MAX_BYTES = 8 * 1024 * 1024; // 8MB por anexo
    if (buf.byteLength > MAX_BYTES) {
      throw new Error(
        `Anexo muito grande (${Math.round(buf.byteLength / 1024 / 1024)}MB): ${inferFilename(att)} (limite 8MB)`,
      );
    }

    return {
      filename: inferFilename(att),
      mimeType,
      base64: arrayBufferToBase64(buf),
    };
  };

  const handleSendCopilotMessage = async () => {
    if (!copilotInput.trim() || copilotLoading) return;
    const question = copilotInput.trim();
    setCopilotInput('');
    setCopilotError(null);

    const userMsg = { role: 'user' as const, content: question, timestamp: new Date() };
    setCopilotMessages((prev) => [...prev, userMsg]);
    setCopilotLoading(true);

    try {
      // Baixar anexos antes de enviar para o Grok
      console.log(`📥 Baixando ${copilotAttachments.length} anexo(s)...`);
      const downloadedFiles = await Promise.all(
        copilotAttachments.map((att) => downloadAttachmentForGrok(att))
      );

      console.log(`✅ ${downloadedFiles.length} arquivo(s) baixado(s):`);
      downloadedFiles.forEach((file, idx) => {
        console.log(`  [${idx + 1}] ${file.filename}: ${file.mimeType}, base64 length: ${file.base64.length}`);
      });

      const attachmentsPayload = copilotAttachments.map((att) => ({
        attachment_name: att.attachment_name,
        file_url: att.file_url,
        id: att.id,
      }));

      const payload = {
        question,
        numeroProcesso: selectedNumeroProcesso,
        itemName: selectedItem?.name,
        attachments: attachmentsPayload,
        files: downloadedFiles, // Enviar arquivos baixados em base64
        promptId: selectedPrompt?.id || null,
      };

      console.log(`📤 Enviando payload para o servidor:`);
      console.log(`  - files array length: ${payload.files.length}`);
      console.log(`  - payload size (approx): ${JSON.stringify(payload).length} caracteres`);

      const response = await fetch('/api/grok/contencioso', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const answer = data.answer || '';

      const assistantMsg = {
        role: 'assistant' as const,
        content: answer,
        timestamp: new Date(),
      };
      setCopilotMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error('Erro no copiloto de contencioso:', err);
      setCopilotError(
        err instanceof Error
          ? `Erro ao consultar o copiloto: ${err.message}`
          : 'Erro desconhecido ao consultar o copiloto.',
      );
    } finally {
      setCopilotLoading(false);
    }
  };

  const renderItem = (item: ContenciosoItem) => {
    const numeroProcesso = item.column_values?.find(
      (col) => col.id === 'numero_do_processo'
    )?.text;

    const attachmentCount = attachmentCounts[item.id] ?? null;

    return (
      <div key={item.id} className="monday-item">
        <div className="item-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
            <h3 className="item-name">{item.name}</h3>
            {attachmentCount !== null && (
              <span className="contencioso-attachment-count-badge" title={`${attachmentCount} anexo(s) nesta ficha`}>
                📎 {attachmentCount}
              </span>
            )}
            {loadingAttachmentCounts && attachmentCount === null && (
              <span className="contencioso-attachment-count-loading" title="Carregando contagem de anexos...">
                ...
              </span>
            )}
          </div>
          {item.created_at && (
            <span className="item-updates-count">
              Criado em: {formatDate(item.created_at)}
            </span>
          )}
        </div>
        {numeroProcesso && (
          <div className="item-updates">
            <div className="monday-update">
              <div className="update-header">
                <div className="update-meta">
                  <span className="update-date">Número do processo</span>
                </div>
              </div>
              <div className="update-content">
                {numeroProcesso}
              </div>
            </div>
            <div className="monday-update">
              <div className="update-header">
                <div className="update-meta">
                  <span className="update-date">Ficha do processo</span>
                </div>
              <button
                className="retry-button"
                  style={{ padding: '4px 8px', fontSize: 12 }}
                  onClick={() => openItemFicha(item, numeroProcesso)}
              >
                  Abrir ficha
              </button>
              </div>
              <div className="update-content">
                <span style={{ fontSize: 12, color: '#6c757d' }}>
                  Clique em &quot;Abrir ficha&quot; para ver detalhes e anexos do processo.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const filteredItems = items
    .filter((item) => {
      // Filtro de busca por texto
      if (searchTerm.trim()) {
        const numeroProcesso = item.column_values?.find(
          (col) => col.id === 'numero_do_processo'
        )?.text;

        const term = searchTerm.toLowerCase();
        const matchesSearch = (
          item.name.toLowerCase().includes(term) ||
          (numeroProcesso && numeroProcesso.toLowerCase().includes(term))
        );
        if (!matchesSearch) return false;
      }

      // Filtro de anexos
      if (attachmentFilter !== 'all') {
        const attachmentCount = attachmentCounts[item.id] ?? null;
        // Se ainda está carregando, não filtra (mostra todos até carregar)
        if (attachmentCount === null && loadingAttachmentCounts) {
          return true;
        }
        
        const hasAttachments = (attachmentCount ?? 0) > 0;
        
        if (attachmentFilter === 'with' && !hasAttachments) {
          return false;
        }
        if (attachmentFilter === 'without' && hasAttachments) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      // Ordena por data de criação (mais recente primeiro).
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });

  // Só mostra loading completo se não houver ficha aberta
  // Se houver ficha aberta, permite continuar lendo enquanto carrega
  if (loading && !selectedItem) {
    return (
      <div className="monday-tab">
        <div className="monday-loading">
          <div className="loading-spinner"></div>
          <p>Carregando itens do contencioso...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="monday-tab">
        <div className="monday-error">
          <div className="error-icon">⚠️</div>
          <h3>Erro ao carregar dados</h3>
          <p>{error}</p>
          <button onClick={() => loadItems(true)} className="retry-button">
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="monday-tab">
        <div className="monday-empty">
          <div className="empty-icon">📋</div>
          <h3>Nenhum dado encontrado</h3>
          <p>Não há itens cadastrados no board de contencioso</p>
          <button onClick={() => loadItems(true)} className="retry-button">
            Recarregar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="monday-tab">
      <div className="monday-header">
        <div className="monday-title">
          <span className="monday-icon">⚖️</span>
          <h2>Contencioso - Itens do Board</h2>
          <span
            className="item-updates-count"
            title="Total de itens baixados (carregados do board)"
          >
            Baixados: {items.length}
          </span>
          <span className="item-updates-count" title="Total de itens exibidos (após filtro)">
            Exibindo: {filteredItems.length}
          </span>
        </div>
        <div className="monday-search">
          <input
            type="text"
            placeholder="Buscar por nome ou número do processo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="monday-filter">
          <select
            value={attachmentFilter}
            onChange={(e) => setAttachmentFilter(e.target.value as 'all' | 'with' | 'without')}
            className="attachment-filter-select"
            title="Filtrar por anexos"
          >
            <option value="all">Todos</option>
            <option value="with">Com anexos</option>
            <option value="without">Sem anexos</option>
          </select>
        </div>
        <div className="monday-header-actions">
          {updatingInBackground && (
            <span 
              className="contencioso-updating-indicator" 
              title="Atualizando dados em segundo plano"
            >
              <span className="contencioso-updating-spinner"></span>
              Atualizando...
            </span>
          )}
          <button
            onClick={() => setShowPromptsManager(true)}
            className="refresh-button"
            title="Gerenciar prompts de contencioso"
            style={{ padding: '8px 12px', fontSize: 13 }}
          >
            📝 Prompts
          </button>
          <button 
            onClick={refreshItems} 
            className="refresh-button" 
            title="Atualizar dados em segundo plano (não interrompe a leitura)"
            disabled={updatingInBackground}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="monday-content">
          <div className="monday-items">
          {filteredItems.map(renderItem)}
        </div>
      </div>

      {selectedItem && selectedNumeroProcesso && (
        <div className="contencioso-ficha-overlay">
          <div className="contencioso-ficha">
            <div className="contencioso-ficha-header">
              <div className="contencioso-ficha-title">
                <h2>{selectedItem.name}</h2>
                <div className="contencioso-ficha-subtitle">
                  Número do processo: <strong>{selectedNumeroProcesso}</strong>
                </div>
              </div>
              <button
                onClick={closeItemFicha}
                className="contencioso-ficha-close"
                aria-label="Fechar ficha"
              >
                ✕
              </button>
            </div>

            <div className="contencioso-ficha-body">
              <div className="contencioso-ficha-column contencioso-ficha-attachments">
                <h3>Anexos do processo</h3>

                <div className="contencioso-attachments-search">
                  <input
                    type="text"
                    placeholder="Buscar anexo por nome ou URL..."
                    value={attachmentsSearch}
                    onChange={(e) => setAttachmentsSearch(e.target.value)}
                  />
                </div>

                {selectedItemLoading && (
                  <p className="contencioso-ficha-muted">Carregando anexos...</p>
                )}

                {selectedItemError && (
                  <p className="contencioso-ficha-error">{selectedItemError}</p>
                )}

                {!selectedItemLoading &&
                  !selectedItemError &&
                  getFilteredAttachments().length === 0 && (
                    <p className="contencioso-ficha-muted">
                      Nenhum anexo encontrado para este processo.
                    </p>
                  )}

                {!selectedItemLoading &&
                  !selectedItemError &&
                  getFilteredAttachments().length > 0 && (
                    <div className="contencioso-attachments-scroll">
                      <ul className="contencioso-attachments-list">
                        {getFilteredAttachments().map((att) => (
                          <li
                            key={att.id}
                            className="contencioso-attachment-item"
                            draggable
                            onDragStart={(event) => handleAttachmentDragStart(att, event)}
                          >
                            <div className="contencioso-attachment-drag-hint">
                              ⇅
                            </div>
                          <div className="contencioso-attachment-name">
                            <strong>{att.attachment_name || 'Anexo sem nome'}</strong>
                          </div>
                          {att.file_url ? (
                            <a
                              href={att.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="contencioso-attachment-link"
                            >
                              Abrir arquivo
                            </a>
                          ) : (
                            <span className="contencioso-ficha-muted">
                              URL do arquivo não disponível
                            </span>
                          )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
              </div>

              <div className="contencioso-ficha-column contencioso-ficha-copilot">
                <div className="contencioso-copilot-badge">IA</div>
                <h3>Copiloto IA do processo</h3>
                <p className="contencioso-ficha-muted">
                  Arraste anexos para cá e faça perguntas para o copiloto sobre este processo.
                </p>
                <div
                  className={
                    'contencioso-copilot-placeholder' +
                    (copilotDragOver ? ' contencioso-copilot-placeholder--active' : '')
                  }
                  onDragOver={handleCopilotDragOver}
                  onDragLeave={handleCopilotDragLeave}
                  onDrop={handleCopilotDrop}
                >
                  <div className="contencioso-copilot-examples">
                    <p>Exemplos de perguntas:</p>
                    <ul>
                      <li>“Resuma os principais andamentos deste processo.”</li>
                      <li>“Quais são os próximos prazos relevantes?”</li>
                      <li>“Existe algum risco processual relevante aqui?”</li>
                    </ul>
                  </div>
                  {copilotAttachments.length > 0 && (
                    <div className="contencioso-copilot-selected-list">
                      <div className="contencioso-copilot-selected-label">
                        Anexos selecionados para o copiloto ({copilotAttachments.length}):
                      </div>
                      {copilotAttachments.map((att) => (
                        <div key={att.id} className="contencioso-copilot-selected-item">
                          <div className="contencioso-copilot-selected-name">
                            {att.attachment_name || att.id}
                          </div>
                          <button
                            className="contencioso-copilot-remove-btn"
                            onClick={() => handleRemoveCopilotAttachment(att.id)}
                            title="Remover anexo"
                            aria-label="Remover anexo"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="contencioso-copilot-chat">
                  <div className="contencioso-copilot-chat-messages">
                    {copilotMessages.length === 0 ? (
                      <div className="contencioso-copilot-chat-empty">
                        <div className="contencioso-copilot-chat-icon">🤖</div>
                        <p>Comece fazendo uma pergunta sobre o processo.</p>
                        <p className="contencioso-ficha-muted">
                          Quanto mais anexos você selecionar, mais contexto o copiloto terá.
                        </p>
                      </div>
                    ) : (
                      copilotMessages.map((msg, idx) => (
                        <div
                          key={idx}
                          className={
                            'contencioso-copilot-message ' +
                            (msg.role === 'user'
                              ? 'contencioso-copilot-message-user'
                              : 'contencioso-copilot-message-assistant')
                          }
                        >
                          <div className="contencioso-copilot-message-content">
                            {msg.role === 'assistant' && (
                              <span className="contencioso-copilot-avatar">🤖</span>
                            )}
                            <div className="contencioso-copilot-message-text">
                              {msg.content}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                    {copilotLoading && (
                      <div className="contencioso-copilot-message contencioso-copilot-message-assistant">
                        <div className="contencioso-copilot-message-content">
                          <span className="contencioso-copilot-avatar">🤖</span>
                          <div className="contencioso-copilot-message-text">
                            <span className="contencioso-copilot-typing-dot"></span>
                            <span className="contencioso-copilot-typing-dot"></span>
                            <span className="contencioso-copilot-typing-dot"></span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {copilotError && (
                    <div className="contencioso-copilot-error">
                      {copilotError}
                    </div>
                  )}

                  {selectedPrompt && (
                    <div className="contencioso-copilot-selected-prompt">
                      <span>Prompt ativo: <strong>{selectedPrompt.name}</strong></span>
                      <button
                        onClick={() => setSelectedPrompt(null)}
                        className="contencioso-copilot-remove-btn"
                        title="Remover prompt"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                  <div className="contencioso-copilot-input-row">
                    <button
                      className="contencioso-copilot-prompt-btn"
                      onClick={() => setShowPromptsManager(true)}
                      title="Selecionar prompt"
                    >
                      📝
                    </button>
                    <textarea
                      value={copilotInput}
                      onChange={(e) => setCopilotInput(e.target.value)}
                      placeholder="Digite uma pergunta sobre o processo..."
                      rows={2}
                      className="contencioso-copilot-input"
                      disabled={copilotLoading}
                    />
                    <button
                      className="contencioso-copilot-send"
                      onClick={handleSendCopilotMessage}
                      disabled={!copilotInput.trim() || copilotLoading}
                      title="Enviar pergunta para o copiloto"
                    >
                      {copilotLoading ? '...' : 'Enviar'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPromptsManager && (
        <div className="contencioso-ficha-overlay">
          <div className="contencioso-ficha" style={{ maxWidth: '90%', maxHeight: '90vh' }}>
            <ContenciosoPromptsManager
              onClose={() => setShowPromptsManager(false)}
              onSelectPrompt={(prompt) => {
                setSelectedPrompt(prompt);
                setShowPromptsManager(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ContenciosoTab;


