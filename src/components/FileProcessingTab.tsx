import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  fileProcessingService,
  FileProcessingItem,
  MediaWebhook,
  WebhookRawResponse,
} from '../services/fileProcessingService';
import './FileProcessingTab.css';

type ViewMode = 'queue' | 'available' | 'done';
type FilterType = 'all' | 'image' | 'audio' | 'pdf' | 'docx';
type FilterStatus = 'all' | 'queued' | 'processing' | 'done' | 'error';

const FileProcessingTab: React.FC = () => {
  // State
  const [queueItems, setQueueItems] = useState<FileProcessingItem[]>([]);
  const [mediaWebhooks, setMediaWebhooks] = useState<MediaWebhook[]>([]);
  const [selectedItem, setSelectedItem] = useState<FileProcessingItem | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('available');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [webhookRaw, setWebhookRaw] = useState<WebhookRawResponse | null>(null);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState<string>('idle');

  // Load data
  const loadQueue = useCallback(async () => {
    try {
      const items = await fileProcessingService.getQueue();
      setQueueItems(items);
    } catch (err) {
      console.error('Erro ao carregar fila:', err);
    }
  }, []);

  const loadMediaWebhooks = useCallback(async () => {
    try {
      const webhooks = await fileProcessingService.getMediaWebhooks({ limit: 200 });
      setMediaWebhooks(webhooks);
    } catch (err) {
      console.error('Erro ao carregar webhooks:', err);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadQueue(), loadMediaWebhooks()]);
    setLoading(false);
  }, [loadQueue, loadMediaWebhooks]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Auto-enqueue + auto-process
  const autoPipelineRef = useRef(false);
  const enqueuedKeysRef = useRef<Set<string>>(new Set()); // tracking de sessão

  useEffect(() => {
    const makeKey = (id: string, source?: string, attIdx?: number) =>
      source === 'email' && attIdx !== undefined ? `${id}_att${attIdx}` : id;

    const runAutoPipeline = async () => {
      if (autoPipelineRef.current) return;
      autoPipelineRef.current = true;

      try {
        // Buscar dados frescos
        const [freshWebhooks, freshQueue] = await Promise.all([
          fileProcessingService.getMediaWebhooks({ limit: 500 }),
          fileProcessingService.getQueue({ limit: 1000 }),
        ]);
        setMediaWebhooks(freshWebhooks);
        setQueueItems(freshQueue);

        // Marcar tudo que já está na fila no tracking de sessão
        for (const qi of freshQueue) {
          enqueuedKeysRef.current.add(makeKey(qi.webhookId, qi.webhookSource, qi.attachmentIndex));
        }

        // Filtrar: só enfileirar o que NUNCA foi tentado nesta sessão
        const toEnqueue = freshWebhooks.filter(w => {
          const key = makeKey(w.id, w.source, w.attachmentIndex);
          return !enqueuedKeysRef.current.has(key);
        });

        if (toEnqueue.length > 0) {
          setPipelineStatus(`enqueue:${toEnqueue.length}`);

          // Marcar como tentados ANTES de enviar (evita retry no próximo ciclo)
          for (const w of toEnqueue) {
            enqueuedKeysRef.current.add(makeKey(w.id, w.source, w.attachmentIndex));
          }

          const umblerIds = Array.from(new Set(toEnqueue.filter(w => (w.source || 'umbler') === 'umbler').map(w => w.id)));
          const emailItems = toEnqueue.filter(w => w.source === 'email');

          if (umblerIds.length > 0) {
            await fileProcessingService.enqueue(umblerIds, 'umbler');
          }
          for (const ew of emailItems) {
            await fileProcessingService.enqueue([ew.id], 'email', ew.attachmentIndex);
          }

          const updatedQueue = await fileProcessingService.getQueue({ limit: 1000 });
          setQueueItems(updatedQueue);
        }

        // Auto-process: processar em paralelo (3 de cada vez, até 50 por ciclo)
        const CONCURRENCY = 3;
        const MAX_PER_CYCLE = 50;
        const queuedCount = (toEnqueue.length > 0 ? freshQueue.length : freshQueue.filter(i => i.status === 'queued').length);
        if (queuedCount > 0) {
          let totalProcessed = 0;
          let hasMore = true;
          while (hasMore && totalProcessed < MAX_PER_CYCLE) {
            setPipelineStatus(`process:${totalProcessed}+`);
            const batchSize = Math.min(CONCURRENCY, MAX_PER_CYCLE - totalProcessed);
            const batch = Array.from({ length: batchSize }, () =>
              fileProcessingService.processNext().catch(() => ({ processed: false }))
            );
            const results = await Promise.all(batch);
            const batchProcessed = results.filter(r => r.processed).length;
            totalProcessed += batchProcessed;
            hasMore = batchProcessed > 0;
          }
          const updatedQueue = await fileProcessingService.getQueue({ limit: 1000 });
          setQueueItems(updatedQueue);
        }

        setPipelineStatus('idle');
      } catch (err) {
        console.error('Auto-pipeline error:', err);
        setPipelineStatus('idle');
      } finally {
        autoPipelineRef.current = false;
      }
    };

    const firstRun = setTimeout(runAutoPipeline, 3000);
    const interval = setInterval(runAutoPipeline, 10000);
    return () => { clearTimeout(firstRun); clearInterval(interval); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Carregar webhook raw quando item selecionado muda
  useEffect(() => {
    if (!selectedItem) {
      setWebhookRaw(null);
      return;
    }
    let cancelled = false;
    setLoadingRaw(true);
    fileProcessingService.getWebhookRaw(selectedItem.id)
      .then(data => { if (!cancelled) setWebhookRaw(data); })
      .catch(err => { console.error('Erro ao carregar webhook raw:', err); if (!cancelled) setWebhookRaw(null); })
      .finally(() => { if (!cancelled) setLoadingRaw(false); });
    return () => { cancelled = true; };
  }, [selectedItem?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Helpers
  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'image': return '\uD83D\uDDBC\uFE0F';
      case 'audio': return '\uD83C\uDFA4';
      case 'pdf': return '\uD83D\uDCC4';
      case 'docx': return '\uD83D\uDCD1';
      default: return '\uD83D\uDCC1';
    }
  };

  const formatPhone = (phone: string): string => {
    if (!phone) return '-';
    // Se parece email/sender de email, extrair só o email
    if (phone.includes('@')) {
      const match = phone.match(/<([^>]+)>/);
      return match ? match[1] : phone.replace(/["']/g, '').trim();
    }
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 13) {
      return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 4)} ${cleaned.slice(4, 9)}-${cleaned.slice(9)}`;
    }
    return phone;
  };

  const getSourceLabel = (source?: string): string => {
    return source === 'email' ? 'Email' : 'WhatsApp';
  };

  const getFileExtension = (fileName: string): string => {
    const parts = fileName.split('.');
    if (parts.length > 1) return '.' + parts.pop()!.toLowerCase();
    return '';
  };

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Helper: chave única por webhook (composta para emails com múltiplos anexos)
  const getWebhookKey = (w: MediaWebhook): string => {
    return w.source === 'email' && w.attachmentIndex !== undefined
      ? `${w.id}_att${w.attachmentIndex}`
      : w.id;
  };

  // Actions
  const handleRetry = async (itemId: string) => {
    try {
      await fileProcessingService.retryItem(itemId);
      await loadQueue();
      if (selectedItem?.id === itemId) {
        const refreshed = await fileProcessingService.getQueue();
        const item = refreshed.find(i => i.id === itemId);
        if (item) setSelectedItem(item);
      }
    } catch (err) {
      console.error('Erro ao retentar:', err);
    }
  };

  const handleRemoveFromQueue = async (itemId: string) => {
    try {
      await fileProcessingService.removeFromQueue(itemId);
      if (selectedItem?.id === itemId) {
        setSelectedItem(null);
      }
      await loadQueue();
    } catch (err) {
      console.error('Erro ao remover da fila:', err);
    }
  };

  const [clearingErrors, setClearingErrors] = useState(false);
  const handleClearErrors = async () => {
    const errorItems = queueItems.filter(i => i.status === 'error');
    if (errorItems.length === 0) return;
    setClearingErrors(true);
    try {
      for (const item of errorItems) {
        await fileProcessingService.removeFromQueue(item.id);
      }
      if (selectedItem && errorItems.some(i => i.id === selectedItem.id)) {
        setSelectedItem(null);
      }
      await loadQueue();
    } catch (err) {
      console.error('Erro ao limpar erros:', err);
    } finally {
      setClearingErrors(false);
    }
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Filter helpers — usar chave composta para email (id + attachmentIndex)
  const queuedKeys = new Set(queueItems.map(i => {
    if (i.webhookSource === 'email' && i.attachmentIndex !== undefined) {
      return `${i.webhookId}_att${i.attachmentIndex}`;
    }
    return i.webhookId;
  }));

  const getAvailableWebhooks = (): MediaWebhook[] => {
    return mediaWebhooks.filter(w => {
      const key = w.source === 'email' && w.attachmentIndex !== undefined
        ? `${w.id}_att${w.attachmentIndex}`
        : w.id;
      return !queuedKeys.has(key);
    });
  };

  const getFilteredQueue = (): FileProcessingItem[] => {
    // Aba "Fila" mostra apenas pendentes (queued, processing, error)
    let filtered = queueItems.filter(i => i.status !== 'done');

    if (filterType !== 'all') {
      filtered = filtered.filter(i => i.mediaType === filterType);
    }
    if (filterStatus !== 'all') {
      filtered = filtered.filter(i => i.status === filterStatus);
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(i =>
        i.mediaFileName.toLowerCase().includes(term) ||
        i.sourcePhone.includes(term)
      );
    }
    return filtered;
  };

  const getFilteredDone = (): FileProcessingItem[] => {
    let filtered = queueItems.filter(i => i.status === 'done');

    if (filterType !== 'all') {
      filtered = filtered.filter(i => i.mediaType === filterType);
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(i =>
        i.mediaFileName.toLowerCase().includes(term) ||
        i.sourcePhone.includes(term) ||
        (i.extractedText || '').toLowerCase().includes(term)
      );
    }
    return filtered;
  };

  const getFilteredWebhooks = (): MediaWebhook[] => {
    let filtered = getAvailableWebhooks();

    if (filterType !== 'all') {
      filtered = filtered.filter(w => w.mediaType === filterType);
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(w =>
        w.mediaFileName.toLowerCase().includes(term) ||
        w.from.includes(term)
      );
    }
    return filtered;
  };

  // Stats
  const pendingItems = queueItems.filter(i => i.status !== 'done');
  const doneItems = queueItems.filter(i => i.status === 'done');
  const stats = {
    pending: pendingItems.length,
    queued: queueItems.filter(i => i.status === 'queued').length,
    processing: queueItems.filter(i => i.status === 'processing').length,
    done: doneItems.length,
    error: queueItems.filter(i => i.status === 'error').length,
    available: getAvailableWebhooks().length,
  };

  if (loading) {
    return (
      <div className="fp-tab">
        <div className="fp-loading">
          <div className="fp-spinner"></div>
          <p>Carregando arquivos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fp-tab">
      {/* Header */}
      <div className="fp-header">
        <div className="fp-header-left">
          <div className="fp-header-row">
            <h2>Processamento de Arquivos</h2>
            <div className="fp-stats">
              <span className="fp-stat">Fila: {stats.queued}</span>
              <span className="fp-stat">Processando: {stats.processing}</span>
              <span className="fp-stat">Prontos: {stats.done}</span>
              {stats.error > 0 && <span className="fp-stat fp-stat-error">Erros: {stats.error}</span>}
              <span className="fp-stat">Disponíveis: {stats.available}</span>
            </div>
          </div>
          <div className="fp-pipeline-status">
            {pipelineStatus.startsWith('enqueue:') && (
              <span className="fp-pipeline-indicator enqueuing">
                <span className="fp-pipeline-dot"></span>
                Enfileirando {pipelineStatus.split(':')[1]} arquivo(s)...
              </span>
            )}
            {pipelineStatus.startsWith('process:') && (
              <span className="fp-pipeline-indicator processing">
                <span className="fp-pipeline-dot"></span>
                Processando arquivo #{pipelineStatus.split(':')[1]}...
              </span>
            )}
            {pipelineStatus === 'idle' && (stats.queued > 0 || stats.processing > 0) && (
              <span className="fp-pipeline-indicator waiting">
                <span className="fp-pipeline-dot"></span>
                Aguardando ciclo...
              </span>
            )}
            {pipelineStatus === 'idle' && stats.queued === 0 && stats.processing === 0 && stats.available === 0 && stats.done > 0 && (
              <span className="fp-pipeline-indicator done">
                Tudo processado
              </span>
            )}
          </div>
        </div>
        <div className="fp-header-actions">
          {viewMode === 'queue' && stats.error > 0 && (
            <button
              className="fp-btn fp-btn-danger"
              onClick={handleClearErrors}
              disabled={clearingErrors}
            >
              {clearingErrors ? 'Limpando...' : `Limpar Erros (${stats.error})`}
            </button>
          )}
          <button
            className="fp-btn fp-btn-primary"
            onClick={loadAll}
          >
            Atualizar
          </button>
        </div>
      </div>

      {/* Layout */}
      <div className="fp-layout">
        {/* List panel */}
        <div className="fp-list-panel">
          <div className="fp-filters">
            <div className="fp-search">
              <input
                type="text"
                placeholder="Buscar por telefone ou arquivo..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="fp-tabs-row">
              <button
                className={`fp-tab-btn ${viewMode === 'available' ? 'active' : ''}`}
                onClick={() => setViewMode('available')}
              >
                Disponíveis ({stats.available})
              </button>
              <button
                className={`fp-tab-btn ${viewMode === 'queue' ? 'active' : ''}`}
                onClick={() => setViewMode('queue')}
              >
                Fila ({stats.pending})
              </button>
              <button
                className={`fp-tab-btn ${viewMode === 'done' ? 'active' : ''}`}
                onClick={() => setViewMode('done')}
              >
                Processados ({stats.done})
              </button>
            </div>
            <div className="fp-filters-row">
              <select
                className="fp-filter-select"
                value={filterType}
                onChange={e => setFilterType(e.target.value as FilterType)}
              >
                <option value="all">Todos os tipos</option>
                <option value="image">Imagens</option>
                <option value="audio">Áudios</option>
                <option value="pdf">PDFs</option>
                <option value="docx">Word (DOCX)</option>
              </select>
              {viewMode === 'queue' && (
                <select
                  className="fp-filter-select"
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value as FilterStatus)}
                >
                  <option value="all">Todos os status</option>
                  <option value="queued">Na fila</option>
                  <option value="processing">Processando</option>
                  <option value="error">Com erro</option>
                </select>
              )}
            </div>
          </div>

          <div className="fp-queue-list">
            {viewMode === 'queue' ? (
              <>
                {getFilteredQueue().map(item => (
                  <div
                    key={item.id}
                    className={`fp-queue-card ${selectedItem?.id === item.id ? 'selected' : ''}`}
                    onClick={() => setSelectedItem(item)}
                  >
                    <div className={`fp-type-icon ${item.mediaType}`}>
                      {getTypeIcon(item.mediaType)}
                    </div>
                    <div className="fp-card-info">
                      <div className="fp-card-name">{item.mediaFileName}</div>
                      <div className="fp-card-meta">
                        {getFileExtension(item.mediaFileName) && (
                          <span className="fp-ext-badge">{getFileExtension(item.mediaFileName)}</span>
                        )}
                        <span className={`fp-source-badge ${item.webhookSource || 'umbler'}`}>
                          {getSourceLabel(item.webhookSource)}
                        </span>
                        <span className="fp-card-phone">{formatPhone(item.sourcePhone)}</span>
                        <span className="fp-card-time">Enviado: {formatDate(item.receivedAt || item.createdAt)}</span>
                      </div>
                    </div>
                    <div className="fp-card-right">
                      <span className={`fp-status-badge ${item.status}`}>
                        {item.status === 'queued' && 'Na fila'}
                        {item.status === 'processing' && 'Processando...'}
                        {item.status === 'error' && 'Erro'}
                      </span>
                      {item.attempts > 0 && (
                        <span className="fp-attempts">{item.attempts}/{item.maxAttempts}</span>
                      )}
                    </div>
                  </div>
                ))}
                {getFilteredQueue().length === 0 && (
                  <div className="fp-empty">
                    <p>Nenhum item na fila</p>
                    <p>Vá para "Disponíveis" para enfileirar arquivos</p>
                  </div>
                )}
              </>
            ) : viewMode === 'done' ? (
              <>
                {getFilteredDone().map(item => (
                  <div
                    key={item.id}
                    className={`fp-queue-card ${selectedItem?.id === item.id ? 'selected' : ''}`}
                    onClick={() => setSelectedItem(item)}
                  >
                    <div className={`fp-type-icon ${item.mediaType}`}>
                      {getTypeIcon(item.mediaType)}
                    </div>
                    <div className="fp-card-info">
                      <div className="fp-card-name">{item.mediaFileName}</div>
                      <div className="fp-card-meta">
                        {getFileExtension(item.mediaFileName) && (
                          <span className="fp-ext-badge">{getFileExtension(item.mediaFileName)}</span>
                        )}
                        <span className={`fp-source-badge ${item.webhookSource || 'umbler'}`}>
                          {getSourceLabel(item.webhookSource)}
                        </span>
                        <span className="fp-card-phone">{formatPhone(item.sourcePhone)}</span>
                        <span className="fp-card-time">Enviado: {formatDate(item.receivedAt || item.createdAt)}</span>
                      </div>
                    </div>
                    <div className="fp-card-right">
                      <span className="fp-status-badge done">Pronto</span>
                      {item.processingMethod && (
                        <span className="fp-result-method">{item.processingMethod}</span>
                      )}
                    </div>
                  </div>
                ))}
                {getFilteredDone().length === 0 && (
                  <div className="fp-empty">
                    <p>Nenhum arquivo processado</p>
                    <p>Os arquivos concluídos aparecerão aqui</p>
                  </div>
                )}
              </>
            ) : (
              <>
                {getFilteredWebhooks().map(webhook => {
                  const wKey = getWebhookKey(webhook);
                  return (
                  <div
                    key={wKey}
                    className="fp-queue-card"
                  >
                    <div className={`fp-type-icon ${webhook.mediaType}`}>
                      {getTypeIcon(webhook.mediaType)}
                    </div>
                    <div className="fp-card-info">
                      <div className="fp-card-name">{webhook.mediaFileName}</div>
                      <div className="fp-card-meta">
                        {getFileExtension(webhook.mediaFileName) && (
                          <span className="fp-ext-badge">{getFileExtension(webhook.mediaFileName)}</span>
                        )}
                        <span className={`fp-source-badge ${webhook.source || 'umbler'}`}>
                          {getSourceLabel(webhook.source)}
                        </span>
                        <span className="fp-card-phone">{formatPhone(webhook.from)}</span>
                        <span className="fp-card-time">{formatDate(webhook.receivedAt)}</span>
                      </div>
                    </div>
                    <div className="fp-card-right">
                      <span className="fp-status-badge queued">Aguardando</span>
                    </div>
                  </div>
                  );
                })}
                {getFilteredWebhooks().length === 0 && (
                  <div className="fp-empty">
                    <p>Nenhum arquivo pendente</p>
                    <p>Todos já foram enfileirados automaticamente</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div className="fp-detail-panel">
          {selectedItem ? (
            <div className="fp-detail-content">
              {/* Header */}
              <div className="fp-detail-header">
                <h3>
                  {selectedItem.mediaFileName}
                  {getFileExtension(selectedItem.mediaFileName) && (
                    <span className="fp-ext-badge">{getFileExtension(selectedItem.mediaFileName)}</span>
                  )}
                </h3>
                <div className="fp-detail-meta">
                  <span>{getTypeIcon(selectedItem.mediaType)} {selectedItem.mediaType.toUpperCase()}</span>
                  <span className={`fp-source-badge ${selectedItem.webhookSource || 'umbler'}`}>
                    {getSourceLabel(selectedItem.webhookSource)}
                  </span>
                  <span>{formatPhone(selectedItem.sourcePhone)}</span>
                  <span className="fp-card-time">Enviado: {formatDate(selectedItem.receivedAt || selectedItem.createdAt)}</span>
                  <span className={`fp-status-badge ${selectedItem.status}`}>
                    {selectedItem.status === 'queued' && 'Na fila'}
                    {selectedItem.status === 'processing' && 'Processando...'}
                    {selectedItem.status === 'done' && 'Pronto'}
                    {selectedItem.status === 'error' && 'Erro'}
                  </span>
                  {selectedItem.processingMethod && (
                    <span className="fp-result-method">{selectedItem.processingMethod}</span>
                  )}
                </div>
              </div>

              {/* Preview */}
              <div className="fp-preview">
                <h4>Preview</h4>
                {selectedItem.mediaType === 'image' && (selectedItem.gcsUrl || selectedItem.mediaUrl) && (
                  <img
                    src={selectedItem.gcsUrl || selectedItem.mediaUrl}
                    alt={selectedItem.mediaFileName}
                    className="fp-preview-image"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                {selectedItem.mediaType === 'audio' && (
                  <audio
                    controls
                    className="fp-preview-audio"
                    src={selectedItem.gcsUrl || selectedItem.mediaUrl}
                  />
                )}
                {selectedItem.mediaType === 'pdf' && (
                  <div className="fp-preview-pdf">
                    {getTypeIcon('pdf')} Documento PDF
                  </div>
                )}
                {selectedItem.mediaType === 'docx' && (
                  <div className="fp-preview-pdf">
                    {getTypeIcon('docx')} Documento Word
                  </div>
                )}
                {selectedItem.mediaUrl && (
                  <a
                    href={selectedItem.mediaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="fp-preview-link"
                  >
                    Abrir URL original
                  </a>
                )}
              </div>

              {/* GCS link */}
              {selectedItem.gcsUrl && (
                <div className="fp-gcs-link">
                  <h4>Arquivo no Cloud Storage</h4>
                  <a href={selectedItem.gcsUrl} target="_blank" rel="noopener noreferrer">
                    {selectedItem.gcsPath || selectedItem.gcsUrl}
                  </a>
                </div>
              )}

              {/* Webhook raw + URL interpretada */}
              <div className="fp-webhook-raw-section">
                <h4>URL interpretada do arquivo</h4>
                {selectedItem.mediaUrl ? (
                  <a
                    href={selectedItem.mediaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="fp-interpreted-url"
                  >
                    {selectedItem.mediaUrl}
                  </a>
                ) : (
                  <p className="fp-no-text">Nenhuma URL encontrada</p>
                )}

                <h4 style={{ marginTop: 16 }}>
                  Webhook completo
                  {webhookRaw && (
                    <span className="fp-result-method">{webhookRaw.collection}</span>
                  )}
                </h4>
                {loadingRaw ? (
                  <div className="fp-webhook-raw-loading">Carregando...</div>
                ) : webhookRaw ? (
                  <pre className="fp-webhook-raw-json">
                    {JSON.stringify(webhookRaw.webhook, null, 2)}
                  </pre>
                ) : (
                  <p className="fp-no-text">Não foi possível carregar o webhook</p>
                )}
              </div>

              {/* Extracted text */}
              <div className="fp-result-text">
                <h4>
                  Texto Extraído
                  {selectedItem.processingMethod && (
                    <span className="fp-result-method">{selectedItem.processingMethod}</span>
                  )}
                </h4>
                {selectedItem.extractedText ? (
                  <div className="fp-extracted-text">
                    {selectedItem.extractedText}
                  </div>
                ) : (
                  <p className="fp-no-text">
                    {selectedItem.status === 'done'
                      ? 'Nenhum texto extraído'
                      : 'Texto será exibido após o processamento'}
                  </p>
                )}
              </div>

              {/* Attempts log */}
              {(selectedItem.attempts > 0 || selectedItem.error) && (
                <div className="fp-attempts-log">
                  <h4>Tentativas: {selectedItem.attempts}/{selectedItem.maxAttempts}</h4>
                  {selectedItem.lastAttemptAt && (
                    <div className="fp-attempt-entry">
                      Última tentativa: {formatDate(selectedItem.lastAttemptAt)}
                    </div>
                  )}
                  {selectedItem.nextRetryAt && (
                    <div className="fp-attempt-entry">
                      Próxima tentativa: {formatDate(selectedItem.nextRetryAt)}
                    </div>
                  )}
                  {selectedItem.error && (
                    <div className="fp-error-message">
                      {selectedItem.error}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="fp-actions">
                {selectedItem.status === 'error' && (
                  <button
                    className="fp-btn fp-btn-warning"
                    onClick={() => handleRetry(selectedItem.id)}
                  >
                    Retentar
                  </button>
                )}
                {selectedItem.extractedText && (
                  <button
                    className="fp-btn fp-btn-secondary"
                    onClick={() => handleCopyText(selectedItem.extractedText!)}
                  >
                    Copiar Texto
                  </button>
                )}
                <button
                  className="fp-btn fp-btn-danger"
                  onClick={() => handleRemoveFromQueue(selectedItem.id)}
                >
                  Remover da Fila
                </button>
              </div>
            </div>
          ) : (
            <div className="fp-detail-placeholder">
              <div className="fp-detail-placeholder-icon">{getTypeIcon('image')}</div>
              <h3>Processamento de Arquivos</h3>
              <p>Selecione um item da fila para ver os detalhes</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FileProcessingTab;
