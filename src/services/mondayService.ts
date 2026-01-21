// ============================================================================
// INTERFACES - Tipos de dados do Monday.com
// ============================================================================

// Updates (comentários/atualizações)
interface MondayUpdate {
  id: string;
  body: string;
  created_at: string;
  creator: {
    id: string;
    name: string;
    email: string;
  } | null;
}

interface MondayItem {
  id: string;
  name: string;
  updates: MondayUpdate[];
}

interface MondayUpdatesResponse {
  _name: string;
  _id: string;
  _createTime: string;
  _updateTime: string;
  monday_updates: {
    items: MondayItem[];
  };
}

// Board, colunas e valores
interface MondayColumnValue {
  id: string;
  text: string;
  type?: string;
  column?: {
    id: string;
    title: string;
    type?: string;
  };
}

interface MondayColumn {
  id: string;
  title: string;
  type?: string;
  // JSON string com configurações da coluna (inclui labels para status)
  settings_str?: string;
}

interface MondayBoardItem {
  id: string;
  name: string;
  created_at?: string;
  column_values: MondayColumnValue[];
}

interface MondayBoardItemsResponse {
  columns: MondayColumn[];
  items: MondayBoardItem[];
}

interface MondayBoard {
  id: string;
  name: string;
  items_page: {
    items: MondayBoardItem[];
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface MondayBoardResponse {
  data: {
    boards: MondayBoard[];
  };
}

// ============================================================================
// MONDAY SERVICE - Serviço para interação com Monday.com
// ============================================================================

class MondayService {
  // --------------------------------------------------------------------------
  // Métodos públicos - Buscar updates por telefone
  // --------------------------------------------------------------------------
  async getMondayUpdates(phone: string, boardId?: string): Promise<MondayUpdatesResponse | null> {
    try {
      const url = `/api/monday/updates-by-phone?phone=${encodeURIComponent(phone)}${boardId ? `&boardId=${boardId}` : ''}`;

      console.log('🔄 Buscando dados do Monday para:', phone);
      console.log('📞 URL:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('❌ Erro na resposta do Monday:', response.status, response.statusText);
        return null;
      }

      const data = await response.json();
      console.log('✅ Dados do Monday recebidos:', data);

      return data;
    } catch (error) {
      console.error('❌ Erro ao buscar dados do Monday:', error);
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Métodos públicos - Buscar boards e itens
  // --------------------------------------------------------------------------

  /**
   * Busca as updates de um item específico (por ID) do board de contencioso.
   * A chamada é feita via backend local para não expor a API key do Monday.
   */
  async getItemUpdatesForContencioso(itemId: string): Promise<MondayItem | null> {
    if (!itemId) return null;

    try {
      const url = `/api/contencioso/updates?itemId=${encodeURIComponent(itemId)}`;
      console.log('📄 Monday: Buscando updates do item de contencioso via backend local', itemId, url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Erro desconhecido');
        console.error('❌ Erro HTTP ao buscar updates do item do Monday:', response.status, response.statusText, errorText);
        return null;
      }

      const data = await response.json();
      console.log('✅ Monday: Updates do item de contencioso recebidas do backend local:', data);

      if (data && data.id && Array.isArray(data.updates)) {
        return data as MondayItem;
      }

      console.warn('⚠️ Monday: Formato de resposta inesperado para updates do item de contencioso');
      return null;
    } catch (error) {
      console.error('❌ Monday: Erro ao buscar updates do item de contencioso:', error);
      return null;
    }
  }

  /**
   * Busca itens de um board específico do Monday (ex: board de contencioso)
   * via backend local (server/server.js), evitando CORS e exposição da API key.
   */
  async getBoardItems(boardId: number | string): Promise<MondayBoardItem[]> {
    const result = await this.getBoardItemsWithColumns(boardId);
    return result.items;
  }

  /**
   * Busca itens e colunas de um board específico do Monday
   * via backend local (server/server.js), evitando CORS e exposição da API key.
   */
  async getBoardItemsWithColumns(boardId: number | string): Promise<MondayBoardItemsResponse> {
    // Chamada para o backend local (Express) em /api/contencioso,
    // que por sua vez fala com a API do Monday.
    const url = `/api/contencioso?boardId=${boardId}`;

    console.log('📄 Monday: Buscando itens e colunas do board via backend local', boardId, url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Erro desconhecido');
      console.error('❌ Erro HTTP ao buscar board do Monday:', response.status, response.statusText, errorText);
      throw new Error(`Erro HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Verificar se retorna novo formato (objeto com columns e items)
    if (data && typeof data === 'object' && 'columns' in data && 'items' in data) {
      return data as MondayBoardItemsResponse;
    }

    // Compatibilidade com formato antigo (apenas array de itens)
    if (Array.isArray(data)) {
      return { columns: [], items: data as MondayBoardItem[] };
    }

    // Formato com items dentro do objeto
    if (data && Array.isArray(data.items)) {
      return { columns: data.columns || [], items: data.items as MondayBoardItem[] };
    }

    console.warn('⚠️ Monday: Formato de resposta inesperado para itens do board (backend local)');
    return { columns: [], items: [] };
  }

  // --------------------------------------------------------------------------
  // Métodos públicos - Utilitários de formatação
  // --------------------------------------------------------------------------

  // Função para formatar HTML do Monday para texto limpo
  formatUpdateBody(htmlBody: string): string {
    // Remove tags HTML e decodifica entidades
    let text = htmlBody
      .replace(/<[^>]*>/g, '') // Remove todas as tags HTML
      .replace(/&nbsp;/g, ' ') // Substitui &nbsp; por espaço
      .replace(/&amp;/g, '&') // Decodifica &
      .replace(/&lt;/g, '<') // Decodifica <
      .replace(/&gt;/g, '>') // Decodifica >
      .replace(/&quot;/g, '"') // Decodifica "
      .replace(/&#39;/g, "'") // Decodifica '
      .trim();

    return text;
  }

  // Função para formatar data
  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // --------------------------------------------------------------------------
  // Métodos públicos - Criar updates e itens
  // --------------------------------------------------------------------------

  /**
   * Cria um update (comentário) em um item do Monday
   * via backend local para não expor a API key
   */
  async createUpdate(itemId: string, body: string): Promise<{ id: string }> {
    if (!itemId || !body) {
      throw new Error('itemId e body são obrigatórios');
    }

    try {
      const url = `/api/monday/update`;
      console.log('📝 Monday: Criando update via backend local', itemId);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          itemId,
          body: body.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        console.error('❌ Erro HTTP ao criar update no Monday:', response.status, errorData);
        throw new Error(errorData.error || `Erro HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Monday: Update criado com sucesso:', data);
      return data;
    } catch (error) {
      console.error('❌ Monday: Erro ao criar update:', error);
      throw error;
    }
  }

  /**
   * Cria um item (lead) em um board do Monday
   * via backend local para não expor a API key
   */
  async createItem(boardId: number | string, itemName: string, columnValues?: Record<string, any>): Promise<{ id: string; name: string; boardId?: string; boardName?: string }> {
    if (!boardId || !itemName) {
      throw new Error('boardId e itemName são obrigatórios');
    }

    try {
      const url = `/api/monday/create-item`;
      console.log('📝 Monday: Criando item via backend local', { boardId, itemName });
      console.log('📝 Column values sendo enviados:', JSON.stringify(columnValues, null, 2));

      const payload = {
        boardId: String(boardId),
        itemName: itemName.trim(),
        columnValues: columnValues || {},
      };
      console.log('📝 Payload completo:', JSON.stringify(payload, null, 2));

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        console.error('❌ Erro HTTP ao criar item no Monday:', response.status, errorData);
        throw new Error(errorData.error || `Erro HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Monday: Item criado com sucesso:', data);
      return data;
    } catch (error) {
      console.error('❌ Monday: Erro ao criar item:', error);
      throw error;
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const mondayService = new MondayService();
export type { 
  MondayUpdate, 
  MondayItem, 
  MondayUpdatesResponse, 
  MondayBoardItem, 
  MondayColumn, 
  MondayBoardItemsResponse 
};
