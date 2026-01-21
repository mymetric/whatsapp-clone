const path = require('path');
const fs = require('fs');
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const pdf = require('pdf-parse');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware para JSON com limite aumentado para suportar arquivos base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Proxy simples para baixar anexos (evita CORS no browser).
// IMPORTANTE: restringe hosts para reduzir risco de SSRF.
const ALLOWED_PROXY_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  'drive.google.com',
  'docs.google.com',
]);

app.get('/api/proxy-file', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '');
    if (!rawUrl) {
      return res.status(400).json({ error: 'Parâmetro url é obrigatório' });
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: 'URL inválida' });
    }

    if (parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'Apenas URLs https são permitidas' });
    }

    if (!ALLOWED_PROXY_HOSTS.has(parsed.hostname)) {
      return res.status(403).json({ error: `Host não permitido: ${parsed.hostname}` });
    }

    const upstream = await axios.get(rawUrl, { responseType: 'arraybuffer' });
    const contentType = upstream.headers?.['content-type'] || 'application/octet-stream';
    const contentLength = upstream.headers?.['content-length'];

    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    // Não forçar download; a UI decide (aqui é só para consumo interno).
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).send(Buffer.from(upstream.data));
  } catch (err) {
    console.error('❌ [server] Erro no proxy de arquivo:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao baixar arquivo',
      details: err.response?.data || err.message,
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'backend', timestamp: new Date().toISOString() });
});

/**
 * Proxy para envio de mensagem (evita CORS no browser)
 * Body: { phone: string, message: string }
 */
app.options('/api/send-message', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(200).end();
});

app.post('/api/send-message', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const sendMessageUrl = process.env.SEND_MESSAGE_URL || process.env.REACT_APP_SEND_MESSAGE_URL;
    if (!sendMessageUrl) {
      return res.status(500).json({
        error: 'SEND_MESSAGE_URL não configurada',
        details: 'Configure SEND_MESSAGE_URL no .env (backend)',
      });
    }

    const { phone, message } = req.body || {};
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'phone é obrigatório (string)' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message é obrigatório (string)' });
    }

    console.log('📤 [server] Proxy envio mensagem:', {
      phone,
      messageLength: message.length,
      upstream: sendMessageUrl,
    });

    const upstream = await axios.post(
      sendMessageUrl,
      { phone, message },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Rosenbaum-Chat-System/1.0',
        },
        timeout: 30000,
        validateStatus: () => true,
      },
    );

    if (upstream.status < 200 || upstream.status >= 300) {
      console.error('❌ [server] Upstream erro ao enviar mensagem:', upstream.status, upstream.data);
      return res.status(upstream.status).json({
        error: 'Erro ao enviar mensagem (upstream)',
        details: upstream.data,
        upstreamStatus: upstream.status,
      });
    }

    return res.status(200).json({
      success: true,
      upstreamStatus: upstream.status,
      data: upstream.data,
    });
  } catch (err) {
    console.error('❌ [server] Erro ao enviar mensagem:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao enviar mensagem',
      details: err.response?.data || err.message,
    });
  }
});

function loadMondayApiKey() {
  const apiKey = process.env.MONDAY_API_KEY;
  if (!apiKey) {
    console.error('❌ Monday: MONDAY_API_KEY não encontrada no .env');
    return null;
  }
  return apiKey;
}

function loadGrokApiKey() {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    console.error('❌ Grok: GROK_API_KEY não encontrada no .env');
    return null;
  }
  return apiKey;
}

/**
 * DEBUG: Endpoint para buscar apenas as colunas de um board
 */
app.get('/api/contencioso/columns', async (req, res) => {
  const boardId = Number(req.query.boardId) || 607533664;
  const apiKey = loadMondayApiKey();

  if (!apiKey) {
    return res.status(500).json({ error: 'Monday API key não configurada' });
  }

  const query = `
    query ($boardId: [ID!]) {
      boards (ids: $boardId) {
        id
        name
        columns {
          id
          title
          type
          settings_str
        }
      }
    }
  `;

  try {
    console.log('🔍 [DEBUG] Buscando apenas colunas do board:', boardId);

    const response = await axios.post(
      'https://api.monday.com/v2',
      { 
        query, 
        variables: { boardId: [String(boardId)] } 
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
      },
    );

    const data = response.data;

    if (data?.errors?.length) {
      console.error('❌ [DEBUG] Monday GraphQL errors:', data.errors);
      return res.status(502).json({ error: 'Erro do Monday GraphQL', details: data.errors });
    }

    const columns = data?.data?.boards?.[0]?.columns || [];
    
    console.log(`✅ [DEBUG] ${columns.length} colunas encontradas`);
    columns.forEach((col, idx) => {
      console.log(`   [${idx + 1}] "${col.id}" → "${col.title}" (${col.type})`);
    });

    return res.json(columns);
  } catch (err) {
    console.error('❌ [DEBUG] Erro ao buscar colunas:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Erro ao buscar colunas' });
  }
});

app.get('/api/contencioso', async (req, res) => {
  const boardId = Number(req.query.boardId) || 632454515;
  const apiKey = loadMondayApiKey();

  if (!apiKey) {
    return res.status(500).json({ error: 'Monday API key não configurada no .env (MONDAY_API_KEY)' });
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
        columns {
          id
          title
          type
          settings_str
        }
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
              column {
                id
                title
                type
              }
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
        columns {
          id
          title
          type
          settings_str
        }
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
              column {
                id
                title
                type
              }
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
    let boardColumns = null;

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
        return res.json({ columns: [], items: [] });
      }

      const board = boards[0];
      
      // Salvar colunas apenas na primeira página
      if (!boardColumns && board.columns && Array.isArray(board.columns)) {
        boardColumns = board.columns;
      }
      
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

    return res.json({
      columns: boardColumns || [],
      items: allItems
    });
  } catch (err) {
    console.error('❌ [server] Erro ao chamar API do Monday:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao consultar board no Monday',
      details: err.response?.data || err.message,
    });
  }
});

/**
 * Busca as updates de um item específico de contencioso no Monday.
 * Usado tanto pela ficha do contencioso (frontend) quanto pelo contexto do Grok.
 */
app.get('/api/contencioso/updates', async (req, res) => {
  const apiKey = loadMondayApiKey();
  const rawItemId = req.query.itemId;

  if (!apiKey) {
    return res.status(500).json({ error: 'Monday API key não configurada no .env (MONDAY_API_KEY)' });
  }

  if (!rawItemId) {
    return res.status(400).json({ error: 'itemId é obrigatório' });
  }

  const itemId = String(rawItemId);

  const query = `
    query ($itemId: [ID!]) {
      items (ids: $itemId) {
        id
        name
        updates {
          id
          body
          created_at
          creator {
            id
            name
            email
          }
        }
      }
    }
  `;

  try {
    console.log('📄 [server] Buscando updates do item de contencioso no Monday:', itemId);

    const response = await axios.post(
      'https://api.monday.com/v2',
      {
        query,
        variables: { itemId: [itemId] },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
      },
    );

    const data = response.data;

    if (data?.errors?.length) {
      console.error('❌ [server] Monday GraphQL errors (updates):', JSON.stringify(data.errors, null, 2));
      return res.status(502).json({ error: 'Erro do Monday GraphQL (updates)', details: data.errors });
    }

    const items = data?.data?.items;
    if (!Array.isArray(items) || items.length === 0) {
      console.warn('⚠️ [server] Nenhum item encontrado para itemId:', itemId);
      return res.json(null);
    }

    const item = items[0];
    const result = {
      id: item.id,
      name: item.name,
      updates: Array.isArray(item.updates) ? item.updates : [],
    };

    console.log(
      `✅ [server] Updates do item de contencioso retornadas: ${result.updates.length} update(s) para "${result.name}"`,
    );

    return res.json(result);
  } catch (err) {
    console.error('❌ [server] Erro ao buscar updates do item de contencioso no Monday:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao consultar updates do item no Monday',
      details: err.response?.data || err.message,
    });
  }
});

/**
 * Busca itens e updates do Monday por número de telefone
 * GET /api/monday/updates-by-phone?phone=+5511999999999&boardId=632454515
 */
app.get('/api/monday/updates-by-phone', async (req, res) => {
  const apiKey = loadMondayApiKey();
  const phone = req.query.phone;
  const boardId = req.query.boardId || '607533664'; // Board padrão de leads

  if (!apiKey) {
    return res.status(500).json({ error: 'Monday API key não configurada no .env (MONDAY_API_KEY)' });
  }

  if (!phone) {
    return res.status(400).json({ error: 'phone é obrigatório' });
  }

  // Limpar o telefone para busca (remover caracteres especiais)
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const phoneVariations = [
    phone,
    cleanPhone,
    `+${cleanPhone}`,
    cleanPhone.replace(/^55/, ''), // Sem código do país
  ];

  // Query para buscar itens do board (sem updates - será buscado separadamente)
  const firstPageQuery = `
    query ($boardId: [ID!], $limit: Int!) {
      boards (ids: $boardId) {
        items_page (limit: $limit) {
          cursor
          items {
            id
            name
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
        items_page (limit: $limit, cursor: $cursor) {
          cursor
          items {
            id
            name
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

  // Query para buscar updates de um item específico
  const updatesQuery = `
    query ($itemId: [ID!]) {
      items (ids: $itemId) {
        id
        name
        updates {
          id
          body
          created_at
          creator {
            id
            name
            email
          }
        }
      }
    }
  `;

  try {
    console.log('📞 [server] Buscando itens no Monday por telefone:', phone);

    const PAGE_LIMIT = 500;
    let allItems = [];
    let cursor = null;
    let pageNumber = 0;

    // Buscar todos os itens com paginação
    while (true) {
      pageNumber++;
      const query = cursor ? nextPageQuery : firstPageQuery;
      const variables = cursor
        ? { boardId: [String(boardId)], limit: PAGE_LIMIT, cursor }
        : { boardId: [String(boardId)], limit: PAGE_LIMIT };

      console.log(`📞 [server] Buscando página ${pageNumber}...`);

      const itemsResponse = await axios.post(
        'https://api.monday.com/v2',
        { query, variables },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: apiKey,
          },
        },
      );

      const itemsData = itemsResponse.data;

      if (itemsData?.errors?.length) {
        console.error('❌ [server] Monday GraphQL errors (items):', JSON.stringify(itemsData.errors, null, 2));
        return res.status(502).json({ error: 'Erro do Monday GraphQL', details: itemsData.errors });
      }

      const boards = itemsData?.data?.boards;
      if (!Array.isArray(boards) || boards.length === 0) {
        break;
      }

      const itemsPage = boards[0]?.items_page;
      const pageItems = itemsPage?.items || [];
      allItems = allItems.concat(pageItems);

      console.log(`📞 [server] Página ${pageNumber}: ${pageItems.length} itens (total: ${allItems.length})`);

      // Se não há mais páginas, sair do loop
      cursor = itemsPage?.cursor;
      if (!cursor || pageItems.length < PAGE_LIMIT) {
        break;
      }
    }

    if (allItems.length === 0) {
      console.warn('⚠️ [server] Nenhum item encontrado no board');
      return res.json(null);
    }

    console.log(`📞 [server] Total de itens carregados: ${allItems.length}`);

    // Filtrar itens que têm o telefone em alguma coluna
    const matchingItems = allItems.filter((item) => {
      const phoneColumns = item.column_values?.filter((col) =>
        col.text && phoneVariations.some((pv) => col.text.includes(pv) || col.text.replace(/[^0-9]/g, '').includes(cleanPhone))
      );
      return phoneColumns && phoneColumns.length > 0;
    });

    if (matchingItems.length === 0) {
      console.log('📞 [server] Nenhum item encontrado para telefone:', phone);
      return res.json(null);
    }

    console.log(`📞 [server] Encontrados ${matchingItems.length} item(s), buscando updates...`);

    // Buscar updates para cada item encontrado
    const itemsWithUpdates = await Promise.all(
      matchingItems.map(async (item) => {
        try {
          const updatesResponse = await axios.post(
            'https://api.monday.com/v2',
            {
              query: updatesQuery,
              variables: { itemId: [String(item.id)] },
            },
            {
              headers: {
                'Content-Type': 'application/json',
                Authorization: apiKey,
              },
            },
          );

          const updatesData = updatesResponse.data;
          const itemWithUpdates = updatesData?.data?.items?.[0];

          return {
            id: item.id,
            name: item.name,
            updates: Array.isArray(itemWithUpdates?.updates) ? itemWithUpdates.updates : [],
          };
        } catch (err) {
          console.warn(`⚠️ [server] Erro ao buscar updates do item ${item.id}:`, err.message);
          return {
            id: item.id,
            name: item.name,
            updates: [],
          };
        }
      })
    );

    // Formatar resposta no mesmo formato que getMondayUpdates espera
    const result = {
      _name: matchingItems[0]?.name || 'Lead',
      _id: phone,
      _createTime: new Date().toISOString(),
      _updateTime: new Date().toISOString(),
      monday_updates: {
        items: itemsWithUpdates,
      },
    };

    console.log(`✅ [server] Retornando ${itemsWithUpdates.length} item(s) para telefone ${phone}`);
    return res.json(result);
  } catch (err) {
    console.error('❌ [server] Erro ao buscar updates por telefone no Monday:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao consultar Monday por telefone',
      details: err.response?.data || err.message,
    });
  }
});

// Função para extrair texto de arquivos
async function extractTextFromFile(file) {
  try {
    const fileBuffer = Buffer.from(file.base64, 'base64');
    const mimeType = (file.mimeType || '').toLowerCase();
    const filename = (file.filename || '').toLowerCase();
    
    console.log(`🔍 Tentando extrair texto: filename="${file.filename}", mimeType="${file.mimeType}", size=${fileBuffer.length} bytes`);
    
    // PDF - verificar por MIME type ou extensão
    if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
      console.log(`📄 Detectado como PDF: ${file.filename}`);
      try {
        // pdf-parse é uma função que recebe um buffer
        const result = await pdf(fileBuffer);
        const extractedText = result.text || '';
        console.log(`✅ PDF processado: ${extractedText.length} caracteres extraídos`);
        if (extractedText.length === 0) {
          console.warn(`⚠️ PDF ${file.filename} não contém texto extraível (pode ser imagem escaneada)`);
        }
        return extractedText;
      } catch (pdfError) {
        console.error(`❌ Erro ao processar PDF ${file.filename}:`, pdfError.message);
        console.error(`❌ Stack:`, pdfError.stack);
        return null;
      }
    }
    
    // Texto simples - verificar por MIME type ou extensão
    if (mimeType.startsWith('text/') || 
        filename.match(/\.(txt|md|json|csv|log|xml|html|htm)$/)) {
      console.log(`📄 Detectado como arquivo de texto: ${file.filename}`);
      try {
        const text = fileBuffer.toString('utf-8');
        console.log(`✅ Texto extraído: ${text.length} caracteres`);
        return text;
      } catch (textError) {
        console.error(`❌ Erro ao ler arquivo de texto ${file.filename}:`, textError.message);
        return null;
      }
    }
    
    // Tentar como texto UTF-8 se não for reconhecido (fallback)
    console.log(`⚠️ Tipo não reconhecido (${mimeType}), tentando como texto UTF-8...`);
    try {
      const text = fileBuffer.toString('utf-8');
      // Verificar se parece ser texto válido (não muitos caracteres de controle)
      const controlChars = (text.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g) || []).length;
      if (controlChars < text.length * 0.1) { // Menos de 10% caracteres de controle
        console.log(`✅ Texto extraído (fallback): ${text.length} caracteres`);
        return text;
      } else {
        console.warn(`⚠️ Arquivo ${file.filename} não parece ser texto válido`);
        return null;
      }
    } catch (fallbackError) {
      console.error(`❌ Erro no fallback para ${file.filename}:`, fallbackError.message);
    }
    
    // Se não conseguir extrair, retornar null
    console.warn(`⚠️ Tipo de arquivo não suportado para extração de texto: ${mimeType} - ${file.filename}`);
    return null;
  } catch (error) {
    console.error(`❌ Erro geral ao extrair texto de ${file.filename}:`, error.message);
    console.error(`❌ Stack:`, error.stack);
    return null;
  }
}

// Endpoint para conversas genéricas com o Grok
app.post('/api/grok/chat', async (req, res) => {
  const apiKey = loadGrokApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'Grok API key não configurada no .env (GROK_API_KEY)' });
  }

  const { messages, model, max_tokens, temperature } = req.body || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array é obrigatório' });
  }

  console.log(`\n📥 ========== REQUISIÇÃO GROK CHAT RECEBIDA ==========`);
  console.log(`  - model: ${model || 'grok-4-fast'}`);
  console.log(`  - messages count: ${messages.length}`);
  console.log(`  - max_tokens: ${max_tokens}`);

  try {
    const response = await axios.post(
      'https://api.x.ai/v1/chat/completions',
      {
        model: model || 'grok-4-fast',
        messages,
        max_tokens: max_tokens || 1000,
        temperature: temperature || 0.7,
        stream: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    const data = response.data;
    console.log(`✅ Resposta do Grok recebida com sucesso`);
    return res.json(data);
  } catch (err) {
    console.error('❌ [server] Erro ao chamar Grok:', err.response?.status, err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao conversar com o Grok',
      details: err.response?.data || err.message,
    });
  }
});

// Endpoint para conversar com o Grok usando contexto de contencioso
app.post('/api/grok/contencioso', async (req, res) => {
  const apiKey = loadGrokApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'Grok API key não configurada no .env (GROK_API_KEY)' });
  }

  const { question, numeroProcesso, itemName, itemId, attachments, files } = req.body || {};

  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'question é obrigatório' });
  }

  const processo = numeroProcesso || 'desconhecido';
  const item = itemName || 'desconhecido';
  const anexos = Array.isArray(attachments) ? attachments : [];
  const downloadedFiles = Array.isArray(files) ? files : [];
  
  console.log(`\n📥 ========== REQUISIÇÃO RECEBIDA ==========`);
  console.log(`  - question: ${question?.substring(0, 50)}...`);
  console.log(`  - numeroProcesso: ${numeroProcesso}`);
  console.log(`  - itemName: ${itemName}`);
  console.log(`  - attachments (array): ${Array.isArray(attachments)}, length: ${anexos.length}`);
  console.log(`  - files (array): ${Array.isArray(files)}, length: ${downloadedFiles.length}`);
  console.log(`  - typeof files: ${typeof files}`);
  console.log(`  - files value:`, files ? JSON.stringify(files).substring(0, 200) : 'null/undefined');
  
  if (downloadedFiles.length > 0) {
    console.log(`\n📦 ARQUIVOS RECEBIDOS:`);
    downloadedFiles.forEach((file, idx) => {
      console.log(`  [${idx + 1}] Arquivo:`);
      console.log(`    - filename: ${file?.filename || 'NÃO DEFINIDO'}`);
      console.log(`    - mimeType: ${file?.mimeType || 'NÃO DEFINIDO'}`);
      console.log(`    - base64 presente: ${!!file?.base64}`);
      console.log(`    - base64 length: ${file?.base64 ? file.base64.length : 0} caracteres`);
      console.log(`    - base64 preview: ${file?.base64 ? file.base64.substring(0, 50) + '...' : 'N/A'}`);
    });
  } else {
    console.warn(`\n⚠️ ⚠️ ⚠️ NENHUM ARQUIVO BAIXADO RECEBIDO NO SERVIDOR! ⚠️ ⚠️ ⚠️`);
    console.warn(`  - req.body.files:`, req.body.files);
    console.warn(`  - req.body keys:`, Object.keys(req.body || {}));
  }
  console.log(`==========================================\n`);

  const anexosDescricao =
    anexos.length === 0
      ? 'Nenhum anexo foi explicitamente selecionado para o copiloto.'
      : anexos
          .map(
            (att, idx) =>
              `${idx + 1}. ${att.attachment_name || 'Anexo sem nome'}`,
          )
          .join('\n');

  const contextText = `Contexto do processo:
- Número do processo: ${processo}
- Item do board: ${item}

Anexos selecionados para análise:
${anexosDescricao}

Use esse contexto para responder perguntas sobre o processo, andamentos e riscos. Se faltar informação nos anexos, seja claro sobre as limitações.`;

  const systemPrompt = `Você é um copiloto jurídico especializado em processos de contencioso.
Analise o contexto abaixo (número do processo, item do Monday e anexos) e responda em português,
de forma clara, objetiva e com foco prático para advogados.`;

  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  // Extrair texto dos arquivos e incluir na mensagem
  let extractedTexts = [];
  if (downloadedFiles.length > 0) {
    console.log(`📄 Iniciando extração de texto de ${downloadedFiles.length} arquivo(s)...`);
    
    for (let i = 0; i < downloadedFiles.length; i++) {
      const file = downloadedFiles[i];
      console.log(`\n📄 [${i + 1}/${downloadedFiles.length}] Processando arquivo:`);
      console.log(`   - filename: ${file.filename || 'NÃO DEFINIDO'}`);
      console.log(`   - mimeType: ${file.mimeType || 'NÃO DEFINIDO'}`);
      console.log(`   - base64 presente: ${!!file.base64}`);
      console.log(`   - base64 length: ${file.base64 ? file.base64.length : 0} caracteres`);
      
      if (!file.base64) {
        console.error(`❌ Arquivo ${file.filename} não tem base64!`);
        continue;
      }
      
      if (!file.filename) {
        console.warn(`⚠️ Arquivo sem nome, tentando processar mesmo assim...`);
      }
      
      try {
        const text = await extractTextFromFile(file);
        if (text && text.trim().length > 0) {
          extractedTexts.push({
            filename: file.filename || `arquivo_${i + 1}`,
            text: text,
            size: text.length,
          });
          console.log(`✅ Texto extraído de ${file.filename}: ${text.length} caracteres`);
          console.log(`📝 Primeiros 300 caracteres: ${text.substring(0, 300)}...`);
        } else {
          console.warn(`⚠️ Não foi possível extrair texto de ${file.filename} (texto vazio ou null)`);
          console.warn(`   - text é null: ${text === null}`);
          console.warn(`   - text é undefined: ${text === undefined}`);
          console.warn(`   - text.trim().length: ${text ? text.trim().length : 'N/A'}`);
        }
      } catch (extractErr) {
        console.error(`❌ Erro ao extrair texto de ${file.filename}:`, extractErr.message);
        console.error(`❌ Stack:`, extractErr.stack);
      }
    }
    
    console.log(`\n✅ Extração concluída: ${extractedTexts.length} de ${downloadedFiles.length} arquivo(s) processado(s) com sucesso`);
  } else {
    console.log(`ℹ️ Nenhum arquivo para processar (downloadedFiles.length = 0)`);
  }

  // Construir mensagem do usuário com texto extraído dos arquivos
  let userMessageText = contextText;
  
  // Adicionar textos extraídos dos arquivos
  if (extractedTexts.length > 0) {
    userMessageText += `\n\n=== CONTEÚDO DOS ANEXOS ===\n\n`;
    
    extractedTexts.forEach((extracted, index) => {
      userMessageText += `\n--- Anexo ${index + 1}: ${extracted.filename} ---\n`;
      userMessageText += extracted.text;
      userMessageText += `\n\n`;
    });
    
    userMessageText += `=== FIM DOS ANEXOS ===\n\n`;
  }
  
  userMessageText += `Pergunta do usuário: ${question}`;
  
  messages.push({ role: 'user', content: userMessageText });
  
  console.log(`📋 Mensagem final (${userMessageText.length} caracteres)`);
  console.log(`📋 Primeiros 1000 caracteres:`, userMessageText.substring(0, 1000));
  console.log(`📋 Últimos 500 caracteres:`, userMessageText.substring(Math.max(0, userMessageText.length - 500)));
  console.log(`📋 Total de arquivos processados: ${extractedTexts.length}`);

  try {
    console.log(`💬 Enviando mensagem para o Grok com ${extractedTexts.length} arquivo(s) processado(s)`);
    
    // Calcular max_tokens baseado no tamanho do texto
    const estimatedTokens = Math.ceil(userMessageText.length / 4); // Aproximação: 1 token ≈ 4 caracteres
    const maxTokens = Math.min(Math.max(estimatedTokens * 2, 2000), 40000); // Mínimo 2000, máximo 40000
    
    console.log(`📊 Texto estimado: ${estimatedTokens} tokens, usando max_tokens: ${maxTokens}`);
    
    const response = await axios.post(
      'https://api.x.ai/v1/chat/completions',
      {
        model: 'grok-4-fast',
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
        stream: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    const data = response.data;
    const answer = data?.choices?.[0]?.message?.content || '';
    
    // Retornar resposta com payload para análise
    return res.json({ 
      answer: answer.trim(),
      payload: {
        model: 'grok-4-fast',
        messages: messages.map(msg => ({
          role: msg.role,
          content: typeof msg.content === 'string' 
            ? msg.content.substring(0, 5000) + (msg.content.length > 5000 ? '... [truncado para visualização]' : '')
            : msg.content
        })),
        max_tokens: maxTokens,
        temperature: 0.7,
        stream: false,
      },
      payloadSize: {
        messagesLength: messages.length,
        userMessageLength: userMessageText.length,
        extractedFilesCount: extractedTexts.length,
        extractedTextsSummary: extractedTexts.map(et => ({
          filename: et.filename,
          size: et.size,
          preview: et.text.substring(0, 200) + '...'
        }))
      },
      fullUserMessage: userMessageText // Mensagem completa para análise
    });
  } catch (err) {
    console.error('❌ [server] Erro ao chamar Grok:');
    console.error('❌ Status:', err.response?.status);
    console.error('❌ Headers:', JSON.stringify(err.response?.headers, null, 2));
    console.error('❌ Data:', JSON.stringify(err.response?.data, null, 2));
    console.error('❌ Message:', err.message);
    console.error('❌ Stack:', err.stack);
    
    // Se o erro for com arquivos, tentar fallback sem arquivos
    if (downloadedFiles.length > 0 && err.response?.status === 500) {
      console.log(`⚠️ Tentando fallback: enviar mensagem sem arquivos anexados, apenas mencionando que foram enviados`);
      
      try {
        const fallbackMessage = `${userMessageText}\n\nNota: ${downloadedFiles.length} arquivo(s) foram enviados para análise, mas houve um problema ao anexá-los diretamente. Por favor, analise com base nas informações do contexto.`;
        
        const fallbackMessages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fallbackMessage },
        ];
        
        const fallbackResponse = await axios.post(
          'https://api.x.ai/v1/chat/completions',
          {
            model: 'grok-4-fast',
            messages: fallbackMessages,
            max_tokens: 2000,
            temperature: 0.7,
            stream: false,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
          },
        );
        
        const fallbackData = fallbackResponse.data;
        const fallbackAnswer = fallbackData?.choices?.[0]?.message?.content || '';
        return res.json({ answer: fallbackAnswer.trim() });
      } catch (fallbackErr) {
        console.error('❌ [server] Erro no fallback também:', fallbackErr.response?.data || fallbackErr.message);
      }
    }
    
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao conversar com o Grok',
      details: err.response?.data || err.message,
    });
  }
});

/**
 * Cria um update (comentário) em um item do Monday
 */
app.post('/api/monday/update', async (req, res) => {
  const apiKey = loadMondayApiKey();
  const { itemId, body } = req.body || {};

  if (!apiKey) {
    return res.status(500).json({ error: 'Monday API key não configurada no .env (MONDAY_API_KEY)' });
  }

  if (!itemId) {
    return res.status(400).json({ error: 'itemId é obrigatório' });
  }

  if (!body || !body.trim()) {
    return res.status(400).json({ error: 'body é obrigatório' });
  }

  const mutation = `
    mutation ($itemId: ID!, $body: String!) {
      create_update (item_id: $itemId, body: $body) {
        id
      }
    }
  `;

  try {
    console.log('📝 [server] Criando update no Monday:', itemId);

    const response = await axios.post(
      'https://api.monday.com/v2',
      {
        query: mutation,
        variables: {
          itemId: String(itemId),
          body: String(body).trim(),
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
      },
    );

    const data = response.data;

    if (data?.errors?.length) {
      console.error('❌ [server] Monday GraphQL errors (create_update):', JSON.stringify(data.errors, null, 2));
      return res.status(502).json({ error: 'Erro do Monday GraphQL (create_update)', details: data.errors });
    }

    const update = data?.data?.create_update;
    if (!update || !update.id) {
      console.warn('⚠️ [server] Resposta do Monday sem ID de update');
      return res.status(502).json({ error: 'Resposta inválida do Monday' });
    }

    console.log(`✅ [server] Update criado com sucesso: ${update.id}`);
    return res.json({ id: update.id });
  } catch (err) {
    console.error('❌ [server] Erro ao criar update no Monday:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao criar update no Monday',
      details: err.response?.data || err.message,
    });
  }
});

/**
 * Cria um item (lead) em um board do Monday
 */
app.post('/api/monday/create-item', async (req, res) => {
  const apiKey = loadMondayApiKey();
  const { boardId, itemName, columnValues } = req.body || {};

  if (!apiKey) {
    return res.status(500).json({ error: 'Monday API key não configurada no .env (MONDAY_API_KEY)' });
  }

  if (!boardId) {
    return res.status(400).json({ error: 'boardId é obrigatório' });
  }

  if (!itemName || !itemName.trim()) {
    return res.status(400).json({ error: 'itemName é obrigatório' });
  }

  // Construir a string de column_values no formato JSON do Monday
  // O Monday aceita column_values como JSON string, mesmo que vazio
  let columnValuesJson = '{}';
  if (columnValues && typeof columnValues === 'object' && Object.keys(columnValues).length > 0) {
    columnValuesJson = JSON.stringify(columnValues);
  }

  const mutation = `
    mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item (board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
        name
        board {
          id
          name
        }
      }
    }
  `;

  try {
    console.log('📝 [server] Criando item no Monday:', { boardId, itemName, columnValuesJson });
    console.log('📝 [server] columnValues recebidos (raw):', JSON.stringify(columnValues, null, 2));
    console.log('📝 [server] columnValuesJson (string):', columnValuesJson);

    const variables = {
      boardId: String(boardId),
      itemName: String(itemName).trim(),
      columnValues: columnValuesJson,
    };
    
    console.log('📝 [server] Variables para GraphQL:', JSON.stringify(variables, null, 2));

    const response = await axios.post(
      'https://api.monday.com/v2',
      {
        query: mutation,
        variables,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
      },
    );

    const data = response.data;

    if (data?.errors?.length) {
      console.error('❌ [server] Monday GraphQL errors (create_item):', JSON.stringify(data.errors, null, 2));
      return res.status(502).json({ error: 'Erro do Monday GraphQL (create_item)', details: data.errors });
    }

    const item = data?.data?.create_item;
    if (!item || !item.id) {
      console.warn('⚠️ [server] Resposta do Monday sem ID de item');
      return res.status(502).json({ error: 'Resposta inválida do Monday' });
    }

    console.log(`✅ [server] Item criado com sucesso: ${item.id}`);
    return res.json({ 
      id: item.id,
      name: item.name,
      boardId: item.board?.id,
      boardName: item.board?.name
    });
  } catch (err) {
    console.error('❌ [server] Erro ao criar item no Monday:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao criar item no Monday',
      details: err.response?.data || err.message,
    });
  }
});

// Verificar se as variáveis de ambiente estão configuradas (aviso apenas, não bloqueia)
const mondayKey = loadMondayApiKey();
const grokKey = loadGrokApiKey();

if (!mondayKey) {
  console.warn('⚠️ AVISO: MONDAY_API_KEY não encontrada no .env');
}
if (!grokKey) {
  console.warn('⚠️ AVISO: GROK_API_KEY não encontrada no .env');
}
if (mondayKey && grokKey) {
  console.log('✅ Variáveis de ambiente (.env) carregadas com sucesso');
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor backend rodando em http://0.0.0.0:${PORT}`);
  console.log(`📁 Carregando variáveis de ambiente de: .env`);
});


