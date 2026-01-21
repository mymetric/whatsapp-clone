/**
 * Serviço para gerenciar dados no IndexedDB
 */

const DB_NAME = 'WhatsAppCloneDB';
const DB_VERSION = 1;
const BOARD_STORE = 'boardItems';
const PREFERENCES_STORE = 'preferences';

interface BoardData {
  boardId: string;
  items: any[];
  columns: any[];
  lastUpdate: string;
}

interface ColumnPreferences {
  boardId: string;
  visibleColumns: string[];
  columnOrder: string[];
}

class IndexedDBService {
  private db: IDBDatabase | null = null;

  /**
   * Inicializa o banco de dados
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('❌ IndexedDB: Erro ao abrir banco de dados', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ IndexedDB: Banco de dados inicializado');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Criar object store para itens do board
        if (!db.objectStoreNames.contains(BOARD_STORE)) {
          db.createObjectStore(BOARD_STORE, { keyPath: 'boardId' });
          console.log('✅ IndexedDB: Object store criado:', BOARD_STORE);
        }

        // Criar object store para preferências
        if (!db.objectStoreNames.contains(PREFERENCES_STORE)) {
          db.createObjectStore(PREFERENCES_STORE, { keyPath: 'boardId' });
          console.log('✅ IndexedDB: Object store criado:', PREFERENCES_STORE);
        }
      };
    });
  }

  /**
   * Garante que o banco está inicializado
   */
  private async ensureDB(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.init();
    }
    return this.db!;
  }

  /**
   * Salva dados do board no IndexedDB
   */
  async saveBoardData(boardId: string, items: any[], columns: any[]): Promise<void> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([BOARD_STORE], 'readwrite');
      const store = transaction.objectStore(BOARD_STORE);

      const data: BoardData = {
        boardId: String(boardId),
        items,
        columns,
        lastUpdate: new Date().toISOString(),
      };

      const request = store.put(data);

      request.onsuccess = () => {
        console.log('✅ IndexedDB: Dados do board salvos:', boardId);
        resolve();
      };

      request.onerror = () => {
        console.error('❌ IndexedDB: Erro ao salvar dados do board:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Carrega dados do board do IndexedDB
   */
  async loadBoardData(boardId: string): Promise<BoardData | null> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([BOARD_STORE], 'readonly');
      const store = transaction.objectStore(BOARD_STORE);
      const request = store.get(String(boardId));

      request.onsuccess = () => {
        if (request.result) {
          console.log('✅ IndexedDB: Dados do board carregados:', boardId);
          resolve(request.result as BoardData);
        } else {
          console.log('ℹ️ IndexedDB: Nenhum dado encontrado para o board:', boardId);
          resolve(null);
        }
      };

      request.onerror = () => {
        console.error('❌ IndexedDB: Erro ao carregar dados do board:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Salva preferências de colunas no IndexedDB
   */
  async saveColumnPreferences(boardId: string, visibleColumns: string[], columnOrder: string[]): Promise<void> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([PREFERENCES_STORE], 'readwrite');
      const store = transaction.objectStore(PREFERENCES_STORE);

      const preferences: ColumnPreferences = {
        boardId: String(boardId),
        visibleColumns,
        columnOrder,
      };

      const request = store.put(preferences);

      request.onsuccess = () => {
        console.log('✅ IndexedDB: Preferências de colunas salvas:', boardId);
        resolve();
      };

      request.onerror = () => {
        console.error('❌ IndexedDB: Erro ao salvar preferências:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Carrega preferências de colunas do IndexedDB
   */
  async loadColumnPreferences(boardId: string): Promise<ColumnPreferences | null> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([PREFERENCES_STORE], 'readonly');
      const store = transaction.objectStore(PREFERENCES_STORE);
      const request = store.get(String(boardId));

      request.onsuccess = () => {
        if (request.result) {
          console.log('✅ IndexedDB: Preferências de colunas carregadas:', boardId);
          resolve(request.result as ColumnPreferences);
        } else {
          console.log('ℹ️ IndexedDB: Nenhuma preferência encontrada para o board:', boardId);
          resolve(null);
        }
      };

      request.onerror = () => {
        console.error('❌ IndexedDB: Erro ao carregar preferências:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Limpa todos os dados do board
   */
  async clearBoardData(boardId: string): Promise<void> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([BOARD_STORE], 'readwrite');
      const store = transaction.objectStore(BOARD_STORE);
      const request = store.delete(String(boardId));

      request.onsuccess = () => {
        console.log('✅ IndexedDB: Dados do board limpos:', boardId);
        resolve();
      };

      request.onerror = () => {
        console.error('❌ IndexedDB: Erro ao limpar dados do board:', request.error);
        reject(request.error);
      };
    });
  }
}

export const indexedDBService = new IndexedDBService();
export type { BoardData, ColumnPreferences };
