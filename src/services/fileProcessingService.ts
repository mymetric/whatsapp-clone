import { authService } from './auth';

const SERVER_BASE = '';

function getAuthHeaders(): Record<string, string> {
  const token = authService.getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function getAuthHeadersWithJson(): Record<string, string> {
  return { ...getAuthHeaders(), 'Content-Type': 'application/json' };
}

export interface MediaWebhook {
  id: string;
  from: string;
  mediaUrl: string;
  mediaFileName: string;
  mediaMimeType: string;
  mediaType: 'image' | 'audio' | 'pdf' | 'docx';
  receivedAt: string | null;
  body: string;
  thumbnailBase64?: string | null;
  source?: 'umbler' | 'email';
  attachmentIndex?: number;
  totalAttachments?: number;
}

export interface FileProcessingItem {
  id: string;
  webhookId: string;
  webhookSource?: 'umbler' | 'email';
  attachmentIndex?: number;
  sourcePhone: string;
  receivedAt: string | null;
  mediaUrl: string;
  mediaFileName: string;
  mediaMimeType: string;
  mediaType: 'image' | 'audio' | 'pdf' | 'docx' | 'video';
  status: 'queued' | 'processing' | 'done' | 'error' | 'needs_review';
  extractedText: string | null;
  error: string | null;
  processingMethod: string | null;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  gcsUrl: string | null;
  gcsPath: string | null;
  processedAt: string | null;
  createdAt: string;
  thumbnailBase64?: string | null;
}

export interface EnqueueResult {
  webhookId: string;
  queueId?: string;
  status?: string;
  error?: string;
  existingId?: string;
}

export interface WebhookRawResponse {
  queueItem: {
    id: string;
    webhookId: string;
    webhookSource: string;
    attachmentIndex?: number;
    mediaUrl: string;
    mediaFileName: string;
    mediaMimeType: string;
    mediaType: string;
  };
  webhook: Record<string, unknown>;
  collection: string;
}

export const fileProcessingService = {
  async getMediaWebhooks(options?: { limit?: number; type?: string }): Promise<MediaWebhook[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.type) params.set('type', options.type);

    const url = `${SERVER_BASE}/api/files/media-webhooks?${params.toString()}`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.webhooks || [];
  },

  async getQueue(options?: { status?: string; type?: string; limit?: number }): Promise<FileProcessingItem[]> {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.type) params.set('type', options.type);
    if (options?.limit) params.set('limit', String(options.limit));

    const url = `${SERVER_BASE}/api/files/queue?${params.toString()}`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.items || [];
  },

  async getQueueKeys(): Promise<Array<{ webhookId: string; webhookSource: string; attachmentIndex: number | null }>> {
    const res = await fetch(`${SERVER_BASE}/api/files/queue-keys`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.keys || [];
  },

  async enqueue(webhookIds: string[], source?: 'umbler' | 'email', attachmentIndex?: number): Promise<EnqueueResult[]> {
    const body: Record<string, unknown> = { webhookIds };
    if (source) body.source = source;
    if (attachmentIndex !== undefined) body.attachmentIndex = attachmentIndex;

    const res = await fetch(`${SERVER_BASE}/api/files/enqueue`, {
      method: 'POST',
      headers: getAuthHeadersWithJson(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.results || [];
  },

  async processNext(): Promise<{ processed: boolean; itemId?: string }> {
    const res = await fetch(`${SERVER_BASE}/api/files/process-next`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async processItem(id: string): Promise<{ processed: boolean; extractedText?: string }> {
    const res = await fetch(`${SERVER_BASE}/api/files/process/${id}`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async retryItem(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`${SERVER_BASE}/api/files/retry/${id}`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async removeFromQueue(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`${SERVER_BASE}/api/files/queue/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async getWebhookRaw(queueId: string): Promise<WebhookRawResponse> {
    const res = await fetch(`${SERVER_BASE}/api/files/webhook-raw/${queueId}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
};
