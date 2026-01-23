/**
 * Serviço de cache persistente para itens de contencioso
 * Armazena dados no IndexedDB (persistente, sem expiração automática)
 * O cache só é atualizado quando há uma atualização bem-sucedida em background
 */

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

interface CacheData {
  items: ContenciosoItem[];
  timestamp: number;
  boardId: number;
}

interface AttachmentCountsCache {
  counts: Record<string, number>;
  timestamp: number;
  boardId: number;
}

// TTL de 10 minutos para contagens de anexos
const ATTACHMENT_COUNTS_TTL = 10 * 60 * 1000;

const DB_NAME = 'contencioso_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'items';
const CACHE_KEY_PREFIX = 'board_';

class ContenciosoCacheService {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;

  /**
   * Inicializa o IndexedDB
   */
  private async initDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('❌ Cache: Erro ao abrir IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.initPromise = null;
        console.log('✅ Cache: IndexedDB inicializado');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Cria a object store se não existir
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          objectStore.createIndex('boardId', 'boardId', { unique: false });
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
          console.log('✅ Cache: Object store criado');
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Obtém a chave do cache para um board específico
   */
  private getCacheKey(boardId: number): string {
    return `${CACHE_KEY_PREFIX}${boardId}`;
  }

  /**
   * Salva itens no cache IndexedDB
   */
  async saveItems(boardId: number, items: ContenciosoItem[]): Promise<void> {
    try {
      const db = await this.initDB();
      const cacheData: CacheData = {
        items,
        timestamp: Date.now(),
        boardId,
      };
      const cacheKey = this.getCacheKey(boardId);

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put({ key: cacheKey, ...cacheData });

        request.onsuccess = () => {
          console.log(`💾 Cache: Itens de contencioso salvos no IndexedDB (${items.length} itens)`);
          resolve();
        };

        request.onerror = () => {
          console.error('❌ Cache: Erro ao salvar itens no IndexedDB:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('❌ Cache: Erro ao salvar itens no cache:', error);
      throw error;
    }
  }

  /**
   * Carrega itens do cache IndexedDB
   */
  async loadItems(boardId: number): Promise<ContenciosoItem[] | null> {
    try {
      const db = await this.initDB();
      const cacheKey = this.getCacheKey(boardId);

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(cacheKey);

        request.onsuccess = () => {
          const result = request.result;
          
          if (!result) {
            console.log('📦 Cache: Nenhum cache encontrado no IndexedDB');
            resolve(null);
            return;
          }

          const cacheData = result as CacheData;
          
          // Verifica se o cache é do board correto
          if (cacheData.boardId !== boardId) {
            console.log('📦 Cache: Cache de board diferente, ignorando');
            resolve(null);
            return;
          }

          // Cache não expira - dura indefinidamente até atualização
          const age = Date.now() - cacheData.timestamp;
          console.log(`📦 Cache: Itens carregados do IndexedDB (${cacheData.items.length} itens, ${Math.round(age / 1000)}s de idade)`);
          resolve(cacheData.items);
        };

        request.onerror = () => {
          console.error('❌ Cache: Erro ao carregar itens do IndexedDB:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('❌ Cache: Erro ao carregar itens do cache:', error);
      return null;
    }
  }

  /**
   * Verifica se existe cache válido
   */
  async hasValidCache(boardId: number): Promise<boolean> {
    const items = await this.loadItems(boardId);
    return items !== null;
  }

  /**
   * Obtém a idade do cache em milissegundos
   */
  async getCacheAge(boardId: number): Promise<number | null> {
    try {
      const db = await this.initDB();
      const cacheKey = this.getCacheKey(boardId);

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(cacheKey);

        request.onsuccess = () => {
          const result = request.result;
          if (!result) {
            resolve(null);
            return;
          }

          const cacheData = result as CacheData;
          resolve(Date.now() - cacheData.timestamp);
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      return null;
    }
  }

  /**
   * Limpa o cache de um board específico
   */
  async clearCache(boardId: number): Promise<void> {
    try {
      const db = await this.initDB();
      const cacheKey = this.getCacheKey(boardId);

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(cacheKey);

        request.onsuccess = () => {
          console.log(`🗑️ Cache: Cache limpo para board ${boardId}`);
          resolve();
        };

        request.onerror = () => {
          console.error('❌ Cache: Erro ao limpar cache:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('❌ Cache: Erro ao limpar cache:', error);
      throw error;
    }
  }

  /**
   * Limpa todos os caches de contencioso
   */
  async clearAllCaches(): Promise<void> {
    try {
      const db = await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
          console.log('🗑️ Cache: Todos os caches de contencioso removidos');
          resolve();
        };

        request.onerror = () => {
          console.error('❌ Cache: Erro ao limpar todos os caches:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('❌ Cache: Erro ao limpar todos os caches:', error);
      throw error;
    }
  }

  /**
   * Salva contagens de anexos no cache
   */
  async saveAttachmentCounts(boardId: number, counts: Record<string, number>): Promise<void> {
    try {
      const db = await this.initDB();
      const cacheData: AttachmentCountsCache = {
        counts,
        timestamp: Date.now(),
        boardId,
      };
      const cacheKey = `attachment_counts_${boardId}`;

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put({ key: cacheKey, ...cacheData });

        request.onsuccess = () => {
          console.log(`💾 Cache: Contagens de anexos salvas (${Object.keys(counts).length} itens)`);
          resolve();
        };

        request.onerror = () => {
          console.error('❌ Cache: Erro ao salvar contagens de anexos:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('❌ Cache: Erro ao salvar contagens de anexos:', error);
      throw error;
    }
  }

  /**
   * Carrega contagens de anexos do cache (com TTL de 10 minutos)
   */
  async loadAttachmentCounts(boardId: number): Promise<Record<string, number> | null> {
    try {
      const db = await this.initDB();
      const cacheKey = `attachment_counts_${boardId}`;

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(cacheKey);

        request.onsuccess = () => {
          const result = request.result;

          if (!result) {
            console.log('📦 Cache: Nenhum cache de contagens encontrado');
            resolve(null);
            return;
          }

          const cacheData = result as AttachmentCountsCache;

          // Verifica TTL - 10 minutos
          const age = Date.now() - cacheData.timestamp;
          if (age > ATTACHMENT_COUNTS_TTL) {
            console.log(`📦 Cache: Contagens expiradas (${Math.round(age / 1000)}s > ${ATTACHMENT_COUNTS_TTL / 1000}s)`);
            resolve(null);
            return;
          }

          console.log(`📦 Cache: Contagens carregadas (${Object.keys(cacheData.counts).length} itens, ${Math.round(age / 1000)}s de idade)`);
          resolve(cacheData.counts);
        };

        request.onerror = () => {
          console.error('❌ Cache: Erro ao carregar contagens de anexos:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('❌ Cache: Erro ao carregar contagens de anexos:', error);
      return null;
    }
  }
}

export const contenciosoCacheService = new ContenciosoCacheService();
export type { ContenciosoItem };
