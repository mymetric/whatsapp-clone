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

  const query = `
    query ($boardId: [ID!]) {
      boards (ids: $boardId) {
        id
        name
        items_page (limit: 500) {
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
    console.log('📄 [server] Buscando itens do board no Monday:', boardId);

    const response = await axios.post(
      'https://api.monday.com/v2',
      {
        query,
        variables: { boardId },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
      }
    );

    const data = response.data;
    console.log('✅ [server] Resposta bruta do Monday:', JSON.stringify(data, null, 2));

    if (
      !data ||
      !data.data ||
      !Array.isArray(data.data.boards) ||
      data.data.boards.length === 0
    ) {
      return res.json([]);
    }

    const board = data.data.boards[0];
    const items =
      board.items_page &&
      Array.isArray(board.items_page.items)
        ? board.items_page.items
        : [];

    // Já devolvemos no formato que o front espera
    return res.json(items);
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


