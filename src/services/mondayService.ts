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

// Tipos para itens genéricos de board (ex: contencioso)
interface MondayColumnValue {
  id: string;
  text: string;
  type?: string;
}

interface MondayBoardItem {
  id: string;
  name: string;
  created_at?: string;
  column_values: MondayColumnValue[];
}

interface MondayBoard {
  id: string;
  name: string;
  items_page: {
    items: MondayBoardItem[];
  };
}

interface MondayBoardResponse {
  data: {
    boards: MondayBoard[];
  };
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

class MondayService {
  private baseUrl = 'https://n8n.rosenbaum.adv.br/webhook/api/monday_updates';
  private apiKey: string | null = null;

  private async loadApiKey(): Promise<string> {
    if (this.apiKey) return this.apiKey;
    
    try {
      const apiKey = process.env.REACT_APP_API_KEY;
      
      if (!apiKey) {
        throw new Error('REACT_APP_API_KEY não encontrada no .env');
      }
      
      this.apiKey = apiKey;
      console.log('✅ Monday: API key carregada do .env com sucesso');
      return this.apiKey!; // Non-null assertion since we just assigned it
    } catch (error) {
      console.error('❌ Monday: Erro ao carregar API key do .env:', error);
      // Fallback para desenvolvimento
      this.apiKey = 'sua-api-key-aqui';
      return this.apiKey!; // Non-null assertion since we just assigned it
    }
  }

  async getMondayUpdates(phone: string): Promise<MondayUpdatesResponse | null> {
    try {
      const cleanPhone = phone.replace('+', '');
      const url = `${this.baseUrl}?phone=%2B${cleanPhone}`;
      const apiKey = await this.loadApiKey();
      
      console.log('🔄 Buscando dados do Monday para:', phone);
      console.log('📞 URL:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'insomnia/11.5.0',
          'apikey': apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('❌ Erro na resposta do Monday:', response.status, response.statusText);
        return null;
      }

      const data = await response.json();
      console.log('✅ Dados do Monday recebidos:', data);
      
      // A API retorna um array, pegamos o primeiro item
      if (Array.isArray(data) && data.length > 0) {
        return data[0];
      }
      
      return null;
    } catch (error) {
      console.error('❌ Erro ao buscar dados do Monday:', error);
      return null;
    }
  }

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
    // Chamada para o backend local (Express) em /api/contencioso,
    // que por sua vez fala com a API do Monday.
    const url = `/api/contencioso?boardId=${boardId}`;

    console.log('📄 Monday: Buscando itens do board via backend local', boardId, url);

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
    console.log('✅ Monday: Resposta do board recebida do backend local:', data);

    // Backend já retorna um array de itens no formato esperado
    if (Array.isArray(data)) {
      return data as MondayBoardItem[];
    }

    if (data && Array.isArray(data.items)) {
      return data.items as MondayBoardItem[];
    }

    console.warn('⚠️ Monday: Formato de resposta inesperado para itens do board (backend local)');
    // Retorna array vazio apenas se o formato for inesperado (não é erro HTTP)
    return [];
  }

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
}

export const mondayService = new MondayService();
export type { MondayUpdate, MondayItem, MondayUpdatesResponse, MondayBoardItem };
