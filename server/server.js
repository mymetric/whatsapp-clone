const path = require('path');
const fs = require('fs');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware para JSON
app.use(express.json());

// Caminho para o credentials.json na raiz do projeto
const credentialsPath = path.join(__dirname, '..', 'credentials.json');

function loadMondayApiKey() {
  try {
    const raw = fs.readFileSync(credentialsPath, 'utf-8');
    const json = JSON.parse(raw);
    // A chave do Monday está em:
    // {
    //   "monday": {
    //     "apiKey": "SUA_CHAVE_DO_MONDAY"
    //   }
    // }
    if (json.monday && json.monday.apiKey) {
      return json.monday.apiKey;
    }
    console.error('❌ Monday: monday.apiKey não encontrado em credentials.json');
    return null;
  } catch (err) {
    console.error('❌ Monday: erro ao ler credentials.json:', err.message);
    return null;
  }
}

app.get('/api/contencioso', async (req, res) => {
  const boardId = Number(req.query.boardId) || 632454515;
  const apiKey = loadMondayApiKey();

  if (!apiKey) {
    return res.status(500).json({ error: 'Monday API key não configurada no credentials.json' });
  }

  const PAGE_LIMIT = 500;

  // Monday: `items_page` é paginado via `cursor`.
  // 1) Primeira página: items_page(limit: 500)
  // 2) Próximas: items_page(limit: 500, cursor: "...")
  const firstPageQuery = `
    query ($boardId: [ID!], $limit: Int!) {
      boards (ids: $boardId) {
        id
        name
        items_page (limit: $limit) {
          cursor
          items {
            id
            name
            created_at
            column_values {
              id
              text
              type
            }
          }
        }
      }
    }
  `;

  const nextPageQuery = `
    query ($boardId: [ID!], $limit: Int!, $cursor: String!) {
      boards (ids: $boardId) {
        id
        name
        items_page (limit: $limit, cursor: $cursor) {
          cursor
          items {
            id
            name
            created_at
            column_values {
              id
              text
              type
            }
          }
        }
      }
    }
  `;

  try {
    console.log('📄 [server] Buscando itens do board no Monday (com paginação):', boardId);

    const allItems = [];
    const seenIds = new Set();
    let cursor = null;
    let page = 0;
    const MAX_PAGES = 200; // safety guard (200 * 500 = 100k itens)

    while (page < MAX_PAGES) {
      page += 1;

      const query = cursor ? nextPageQuery : firstPageQuery;
      const variables = cursor
        ? { boardId: [String(boardId)], limit: PAGE_LIMIT, cursor }
        : { boardId: [String(boardId)], limit: PAGE_LIMIT };

      console.log(
        `📄 [server] Página ${page} (limit=${PAGE_LIMIT})` + (cursor ? ' (cursor presente)' : ''),
      );

      const response = await axios.post(
        'https://api.monday.com/v2',
        { query, variables },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: apiKey,
          },
        },
      );

      const data = response.data;

      if (data?.errors?.length) {
        console.error('❌ [server] Monday GraphQL errors:', JSON.stringify(data.errors, null, 2));
        return res.status(502).json({ error: 'Erro do Monday GraphQL', details: data.errors });
      }

      const boards = data?.data?.boards;
      if (!Array.isArray(boards) || boards.length === 0) {
        return res.json([]);
      }

      const board = boards[0];
      const pageObj = board?.items_page;
      const items = Array.isArray(pageObj?.items) ? pageObj.items : [];

      for (const item of items) {
        if (!item || !item.id) continue;
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        allItems.push(item);
      }

      cursor = pageObj?.cursor || null;

      // Se não houver cursor, acabou.
      if (!cursor) break;
    }

    console.log(`✅ [server] Total de itens retornados: ${allItems.length}`);
    return res.json(allItems);
  } catch (err) {
    console.error('❌ [server] Erro ao chamar API do Monday:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao consultar board no Monday',
      details: err.response?.data || err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor backend rodando em http://localhost:${PORT}`);
});


