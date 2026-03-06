const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');

// Polyfills para pdf-parse no Node.js (requer APIs de browser)
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
  };
}
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
  };
}
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D { };
}

const { PDFParse } = require('pdf-parse');
const { getDocumentProxy, renderPageAsImage } = require('unpdf');
const mammoth = require('mammoth');
const WordExtractor = require('word-extractor');
const admin = require('firebase-admin');
const multer = require('multer');
require('dotenv').config();

// MailerSend para 2FA
const { MailerSend, EmailParams, Sender, Recipient } = require('mailersend');
const mailerSend = new MailerSend({ apiKey: process.env.MAILERSEND_API_KEY || '' });

const uploadMulter = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Inicializar Firebase Admin SDK
let firestoreDb = null;
const initFirebase = () => {
  try {
    if (admin.apps.length === 0) {
      const projectId = process.env.FIREBASE_PROJECT_ID || process.env.REACT_APP_FIREBASE_PROJECT_ID;
      const privateKeyId = process.env.FIREBASE_PRIVATE_KEY_ID || process.env.REACT_APP_FIREBASE_PRIVATE_KEY_ID;
      let privateKey = process.env.FIREBASE_PRIVATE_KEY || process.env.REACT_APP_FIREBASE_PRIVATE_KEY || '';
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || process.env.REACT_APP_FIREBASE_CLIENT_EMAIL;

      if (!projectId || !privateKey || !clientEmail) {
        console.warn('⚠️ Firebase não configurado. Configure FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY e FIREBASE_CLIENT_EMAIL no .env');
        return null;
      }

      // Processar a private key: remover aspas e converter \\n para quebras de linha reais
      privateKey = privateKey
        .replace(/^["']|["']$/g, '') // Remove aspas no início e fim
        .replace(/\\n/g, '\n'); // Converte \n literais para quebras de linha

      // Verificar se a chave parece válida
      if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        console.warn('⚠️ FIREBASE_PRIVATE_KEY não parece estar no formato PEM correto');
        return null;
      }

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          privateKeyId,
          privateKey,
          clientEmail,
        }),
      });
      console.log('✅ Firebase Admin SDK inicializado');
    }
    // Conectar ao database "messages"
    firestoreDb = admin.firestore();
    firestoreDb.settings({ databaseId: 'messages' });
    return firestoreDb;
  } catch (err) {
    console.error('❌ Erro ao inicializar Firebase:', err.message);
    return null;
  }
};

// Inicializar Firebase ao carregar o servidor
initFirebase();

// Cache em memória para mensagens do WhatsApp
const messagesCache = {
  data: null,           // Map de phone -> messages[]
  lastUpdate: null,     // Timestamp da última atualização
  ttl: 60000,           // 1 minuto de TTL
  updating: false,      // Flag para evitar múltiplas atualizações simultâneas
};

// Função para atualizar o cache de mensagens
const updateMessagesCache = async () => {
  if (!firestoreDb || messagesCache.updating) return;

  messagesCache.updating = true;
  try {
    console.log('🔄 [cache] Atualizando cache de mensagens...');
    const messagesRef = firestoreDb.collection('messages');
    const snapshot = await messagesRef.orderBy('timestamp', 'desc').get();

    const phoneMap = new Map();

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const rawPhone = String(data.chat_phone || '').replace(/\D/g, '');

      if (!rawPhone || rawPhone.length < 8) return;

      // Criar variantes do telefone para busca
      const variants = [rawPhone];
      if (rawPhone.startsWith('55') && rawPhone.length > 10) {
        variants.push(rawPhone.substring(2));
      }
      if (!rawPhone.startsWith('55') && rawPhone.length >= 10) {
        variants.push('55' + rawPhone);
      }
      // Número local (últimos 8-9 dígitos)
      const localNum = rawPhone.length >= 9 ? rawPhone.slice(-9) : rawPhone.slice(-8);
      variants.push(localNum);

      const message = {
        id: doc.id,
        audio: data.audio || false,
        chat_phone: String(data.chat_phone),
        content: data.content || '',
        image: data.image || '',
        name: data.name || '',
        source: data.source || '',
        timestamp: data.timestamp?.toDate?.() || data.timestamp || null,
      };

      // Adicionar mensagem para todas as variantes do telefone
      variants.forEach(variant => {
        if (!phoneMap.has(variant)) {
          phoneMap.set(variant, []);
        }
        // Evitar duplicatas
        const existing = phoneMap.get(variant);
        if (!existing.find(m => m.id === message.id)) {
          existing.push(message);
        }
      });
    });

    messagesCache.data = phoneMap;
    messagesCache.lastUpdate = Date.now();
    console.log(`✅ [cache] Cache atualizado: ${phoneMap.size} variantes de telefone`);
  } catch (err) {
    console.error('❌ [cache] Erro ao atualizar cache:', err.message);
  } finally {
    messagesCache.updating = false;
  }
};

// Função para obter mensagens do cache
const getMessagesFromCache = async (phone, limit = 50) => {
  const normalizedPhone = String(phone).replace(/\D/g, '');

  // Verificar se o cache precisa ser atualizado
  const cacheAge = Date.now() - (messagesCache.lastUpdate || 0);
  if (!messagesCache.data || cacheAge > messagesCache.ttl) {
    await updateMessagesCache();
  }

  if (!messagesCache.data) return [];

  // Tentar encontrar mensagens por diferentes variantes do telefone
  const variants = [normalizedPhone];
  if (normalizedPhone.startsWith('55') && normalizedPhone.length > 10) {
    variants.push(normalizedPhone.substring(2));
  }
  if (!normalizedPhone.startsWith('55') && normalizedPhone.length >= 10) {
    variants.push('55' + normalizedPhone);
  }
  const localNum = normalizedPhone.length >= 9 ? normalizedPhone.slice(-9) : normalizedPhone.slice(-8);
  variants.push(localNum);

  for (const variant of variants) {
    const messages = messagesCache.data.get(variant);
    if (messages && messages.length > 0) {
      return messages.slice(0, limit);
    }
  }

  return [];
};

// =====================================================
// WEBHOOK MESSAGES — Parse e cache de umbler_webhooks
// =====================================================

/**
 * Detecta a direção/source de uma mensagem a partir do webhook Umbler.
 * Retorna 'Contact' (mensagem recebida do cliente) ou 'Member' (mensagem enviada pelo escritório).
 *
 * Heurísticas (verificadas em cascata):
 *  1. Message.IsFromMe / LastMessage.IsFromMe (booleano direto)
 *  2. Payload.Content.Message.IsFromMe (formato aninhado)
 *  3. EventName contendo padrões como "message-received" vs "message-sent"
 *  4. Presença de campo Trigger == "agent" ou "contact"
 *  5. Fallback: 'Contact' (a maioria dos webhooks são mensagens recebidas)
 */
function detectSourceFromWebhook(data) {
  const payload = data.Payload || {};
  const content = payload.Content || {};
  const message = content.Message || data.Message || {};
  const lastMessage = content.LastMessage || data.LastMessage || {};

  // 1. Campo IsFromMe direto na mensagem
  if (typeof message.IsFromMe === 'boolean') {
    return message.IsFromMe ? 'Member' : 'Contact';
  }
  if (typeof lastMessage.IsFromMe === 'boolean') {
    return lastMessage.IsFromMe ? 'Member' : 'Contact';
  }

  // 2. IsFromMe no nível raiz do payload
  if (typeof data.IsFromMe === 'boolean') {
    return data.IsFromMe ? 'Member' : 'Contact';
  }
  if (typeof content.IsFromMe === 'boolean') {
    return content.IsFromMe ? 'Member' : 'Contact';
  }

  // 3. EventName patterns
  const eventName = (data.EventName || data.eventName || payload.EventName || '').toLowerCase();
  if (eventName.includes('sent') || eventName.includes('outgoing') || eventName.includes('outbound')) {
    return 'Member';
  }
  if (eventName.includes('received') || eventName.includes('incoming') || eventName.includes('inbound')) {
    return 'Contact';
  }

  // 4. Trigger field
  const trigger = (data.Trigger || data.trigger || '').toLowerCase();
  if (trigger === 'agent' || trigger === 'member' || trigger === 'operator') {
    return 'Member';
  }
  if (trigger === 'contact' || trigger === 'customer' || trigger === 'client') {
    return 'Contact';
  }

  // 5. Direction field
  const direction = data.Direction || data.direction || content.Direction || '';
  if (typeof direction === 'string') {
    const dirLower = direction.toLowerCase();
    if (dirLower === 'out' || dirLower === 'outgoing' || dirLower === 'sent') return 'Member';
    if (dirLower === 'in' || dirLower === 'incoming' || dirLower === 'received') return 'Contact';
  }

  // 6. Participant vs Contact — se Message.Participant existe e é diferente do Contact, é membro
  const participant = message.Participant || lastMessage.Participant || '';
  const contactPhone = (content.Contact || data.Contact || {}).PhoneNumber || '';
  if (participant && contactPhone && participant !== contactPhone) {
    return 'Member';
  }

  // Fallback: maioria dos webhooks são mensagens recebidas
  return 'Contact';
}

/**
 * Transforma um documento da collection umbler_webhooks no formato FirestoreMessage
 * compatível com o frontend (mesmo formato do messagesCache).
 */
function parseUmblerWebhookToMessage(docId, data) {
  const payload = data.Payload || {};
  const content = payload.Content || {};
  const message = content.Message || data.Message || {};
  const lastMessage = content.LastMessage || data.LastMessage || {};
  const contact = content.Contact || data.Contact || {};

  const msgContent = message.Content || lastMessage.Content || '';
  const messageType = message.MessageType || lastMessage.MessageType || 'Text';
  const phoneNumber = (contact.PhoneNumber || '').replace(/\D/g, '');

  const msgFile = message.File || {};
  const lmFile = lastMessage.File || {};
  const mediaUrl = msgFile.Url || lmFile.Url || '';
  const fileName = msgFile.OriginalName || lmFile.OriginalName || '';
  const isAudio = messageType === 'Audio';
  const isImage = messageType === 'Image' || messageType === 'Video';
  const isFile = messageType === 'File' || messageType === 'Document';
  const isMedia = isAudio || isImage || isFile;

  // Webhook de status/leitura: tem MessageType de mídia mas sem URL = descartar
  if (isMedia && !mediaUrl && !msgContent) return null;

  const timestamp = data._receivedAtISO
    || (data._receivedAt?.toDate ? data._receivedAt.toDate().toISOString() : null)
    || null;

  const channel = content.Channel || {};
  const channelPhone = (channel.PhoneNumber || '').replace(/\D/g, '') || null;

  // Extrair IDs do Umbler para link direto
  const umblerOrgId = (content.Organization || {}).Id || null;
  const umblerChatId = content.Id || (content.Chat || lastMessage.Chat || {}).Id || null;

  const source = detectSourceFromWebhook(data);

  let displayContent = msgContent;
  if (isAudio) displayContent = '[Áudio]';
  else if (isImage) displayContent = msgContent || '[Imagem]';
  else if (isFile) displayContent = msgContent || `[Arquivo: ${fileName}]`;

  return {
    id: docId,
    audio: isAudio,
    chat_phone: phoneNumber,
    content: displayContent,
    image: isImage ? mediaUrl : '',
    file: isFile ? mediaUrl : '',
    fileName: isFile ? fileName : '',
    name: contact.Name || contact.DisplayName || '',
    source,
    timestamp,
    channel_phone: channelPhone,
    umbler_org_id: umblerOrgId,
    umbler_chat_id: umblerChatId,
    _fromWebhook: true,
  };
}

// Cache em memória para mensagens de webhook do Umbler
const webhookMessagesCache = {
  data: null,           // Map de phone variant -> messages[]
  lastUpdate: null,
  ttl: 60000,           // 1 minuto (mesmo padrão do messagesCache)
  updating: false,
};

// Função para atualizar o cache de mensagens de webhook
const updateWebhookMessagesCache = async () => {
  if (!firestoreDb || webhookMessagesCache.updating) return;

  webhookMessagesCache.updating = true;
  try {
    console.log('🔄 [webhook-cache] Atualizando cache de mensagens de webhook...');
    const snapshot = await firestoreDb
      .collection('umbler_webhooks')
      .orderBy('_receivedAt', 'desc')
      .limit(2000)
      .get();

    const phoneMap = new Map();

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const parsed = parseUmblerWebhookToMessage(doc.id, data);

      // Descartar webhooks sem conteúdo útil (incluindo status/leitura retornados como null)
      if (!parsed) return;
      if (!parsed.content && !parsed.audio && !parsed.image && !parsed.file) return;
      // Descartar se não tem telefone válido
      if (!parsed.chat_phone || parsed.chat_phone.length < 8) return;

      const rawPhone = parsed.chat_phone;

      // Criar variantes do telefone para busca (mesma lógica do messagesCache)
      const variants = [rawPhone];
      if (rawPhone.startsWith('55') && rawPhone.length > 10) {
        variants.push(rawPhone.substring(2));
      }
      if (!rawPhone.startsWith('55') && rawPhone.length >= 10) {
        variants.push('55' + rawPhone);
      }
      const localNum = rawPhone.length >= 9 ? rawPhone.slice(-9) : rawPhone.slice(-8);
      variants.push(localNum);

      variants.forEach(variant => {
        if (!phoneMap.has(variant)) {
          phoneMap.set(variant, []);
        }
        const existing = phoneMap.get(variant);
        if (!existing.find(m => m.id === parsed.id)) {
          existing.push(parsed);
        }
      });
    });

    webhookMessagesCache.data = phoneMap;
    webhookMessagesCache.lastUpdate = Date.now();
    console.log(`✅ [webhook-cache] Cache atualizado: ${phoneMap.size} variantes de telefone`);
  } catch (err) {
    console.error('❌ [webhook-cache] Erro ao atualizar cache:', err.message);
  } finally {
    webhookMessagesCache.updating = false;
  }
};

// Função para obter mensagens de webhook do cache
const getWebhookMessagesFromCache = async (phone) => {
  const normalizedPhone = String(phone).replace(/\D/g, '');

  const cacheAge = Date.now() - (webhookMessagesCache.lastUpdate || 0);
  if (!webhookMessagesCache.data || cacheAge > webhookMessagesCache.ttl) {
    await updateWebhookMessagesCache();
  }

  if (!webhookMessagesCache.data) return [];

  const variants = [normalizedPhone];
  if (normalizedPhone.startsWith('55') && normalizedPhone.length > 10) {
    variants.push(normalizedPhone.substring(2));
  }
  if (!normalizedPhone.startsWith('55') && normalizedPhone.length >= 10) {
    variants.push('55' + normalizedPhone);
  }
  const localNum = normalizedPhone.length >= 9 ? normalizedPhone.slice(-9) : normalizedPhone.slice(-8);
  variants.push(localNum);

  for (const variant of variants) {
    const messages = webhookMessagesCache.data.get(variant);
    if (messages && messages.length > 0) {
      return messages;
    }
  }

  return [];
};

/**
 * Mescla mensagens da collection `messages` (antigas) com mensagens de `umbler_webhooks`.
 * Usa o timestamp mais antigo dos webhooks como cutoff: mensagens antigas antes desse cutoff
 * são mantidas; a partir dele, usa apenas os webhooks.
 * Deduplicação por conteúdo + timestamp próximo (<2s).
 */
const getMergedMessages = async (phone, limit = 50) => {
  // Buscar ambas as fontes em paralelo
  const [oldMessages, webhookMessages] = await Promise.all([
    getMessagesFromCache(phone, 9999),
    getWebhookMessagesFromCache(phone),
  ]);

  // Se não há webhooks, retornar mensagens antigas normalmente
  if (!webhookMessages.length) {
    return oldMessages.slice(0, limit);
  }

  // Se não há mensagens antigas, retornar webhooks ordenados
  if (!oldMessages.length) {
    const sorted = [...webhookMessages].sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });
    return sorted.slice(-limit);
  }

  // Auto-detectar cutoff: timestamp mais antigo dos webhooks para este telefone
  let oldestWebhookTs = Infinity;
  for (const wm of webhookMessages) {
    if (wm.timestamp) {
      const ts = new Date(wm.timestamp).getTime();
      if (ts < oldestWebhookTs) oldestWebhookTs = ts;
    }
  }

  // Filtrar mensagens antigas: manter apenas as que são anteriores ao cutoff
  const oldBeforeCutoff = oldestWebhookTs < Infinity
    ? oldMessages.filter(m => {
        if (!m.timestamp) return true; // manter msgs sem timestamp (seguro)
        const ts = new Date(m.timestamp).getTime();
        return ts < oldestWebhookTs;
      })
    : oldMessages;

  // Concatenar e ordenar por timestamp crescente
  const merged = [...oldBeforeCutoff, ...webhookMessages].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });

  // Deduplicação: remover msgs com mesmo conteúdo e timestamp próximo (<2s)
  // Para mídia (imagem/áudio), comparar também a URL para não descartar mídias diferentes
  const deduplicated = [];
  for (const msg of merged) {
    const dupIndex = deduplicated.findIndex(existing => {
      if (existing.content !== msg.content) return false;
      if (!existing.timestamp || !msg.timestamp) return false;
      const timeDiff = Math.abs(
        new Date(existing.timestamp).getTime() - new Date(msg.timestamp).getTime()
      );
      if (timeDiff >= 2000) return false;
      // Para mensagens de mídia com URLs diferentes, não são duplicatas
      if (msg.image && existing.image && msg.image !== existing.image) return false;
      if (msg.file && existing.file && msg.file !== existing.file) return false;
      return true;
    });
    if (dupIndex === -1) {
      deduplicated.push(msg);
    } else {
      // Se o novo msg tem mais dados (ex: image URL), substituir o existente
      const existing = deduplicated[dupIndex];
      if ((!existing.image && msg.image) || (!existing.audio && msg.audio) || (!existing.file && msg.file)) {
        deduplicated[dupIndex] = msg;
      }
    }
  }

  // Retornar os últimos N registros
  return deduplicated.slice(-limit);
};

const app = express();
const PORT = process.env.PORT || 4000;

// =====================================================
// SSE + Polling — Event stream para processamento em tempo real
// =====================================================
const sseClients = new Set();
const recentEvents = []; // buffer circular de eventos recentes
let eventSeq = 0;

function emitSSE(event, data) {
  const entry = { seq: ++eventSeq, event, ...data, timestamp: new Date().toISOString() };
  recentEvents.push(entry);
  if (recentEvents.length > 200) recentEvents.splice(0, recentEvents.length - 200);
  const payload = `event: ${event}\ndata: ${JSON.stringify(entry)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// Middleware para JSON com limite aumentado para suportar arquivos base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// SSE endpoint — stream de eventos de processamento
app.get('/api/files/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('event: connected\ndata: {}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Polling endpoint — retorna eventos após um dado seq
app.get('/api/files/recent-events', (req, res) => {
  const afterSeq = parseInt(req.query.after) || 0;
  const events = recentEvents.filter(e => e.seq > afterSeq);
  res.json({ events, lastSeq: eventSeq });
});

// =====================================================
// AUTH — Middleware de autenticação e permissões
// =====================================================

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 horas

const ALL_PERMISSIONS = ['conversas-leads', 'file-processing', 'whatsapp', 'contencioso', 'prompts', 'admin'];

const DEFAULT_PERMISSIONS = {
  admin: ALL_PERMISSIONS,
  user: ['conversas-leads'],
};

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido' });
  }

  const token = authHeader.substring(7);

  if (!firestoreDb) {
    return res.status(500).json({ error: 'Firebase não configurado' });
  }

  try {
    const sessionDoc = await firestoreDb.collection('sessions').doc(token).get();
    if (!sessionDoc.exists) {
      return res.status(401).json({ error: 'Sessão inválida' });
    }

    const session = sessionDoc.data();

    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      await firestoreDb.collection('sessions').doc(token).delete();
      return res.status(401).json({ error: 'Sessão expirada' });
    }

    req.user = {
      email: session.email,
      name: session.name,
      role: session.role,
      permissions: session.permissions || DEFAULT_PERMISSIONS[session.role] || [],
    };

    // Sliding session: renovar expiresAt a cada requisição autenticada
    const newExpires = new Date(Date.now() + SESSION_TTL).toISOString();
    firestoreDb.collection('sessions').doc(token).update({ expiresAt: newExpires }).catch(() => {});

    next();
  } catch (err) {
    console.error('❌ Erro na autenticação:', err.message);
    return res.status(500).json({ error: 'Erro na autenticação' });
  }
}

function requirePermission(tabId) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    if (req.user.role === 'admin') {
      return next();
    }
    if (!req.user.permissions.includes(tabId)) {
      return res.status(403).json({ error: 'Sem permissão para acessar este recurso' });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }
  next();
}

// =====================================================
// AUTH — Endpoints de login/logout
// =====================================================

app.post('/api/auth/login', async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado' });
    }

    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    const userDoc = await firestoreDb.collection('users').doc(email).get();
    if (!userDoc.exists) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const userData = userDoc.data();
    if (userData.password !== password) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const permissions = userData.permissions || DEFAULT_PERMISSIONS[userData.role] || [];

    // Gerar código 2FA de 6 dígitos
    const code2fa = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

    // Salvar pending 2FA no Firestore
    await firestoreDb.collection('pending_2fa').doc(email).set({
      code: code2fa,
      name: userData.name,
      role: userData.role,
      permissions,
      expiresAt,
    });

    // Enviar email com código via MailerSend
    const fromEmail = process.env.MAILERSEND_FROM_EMAIL || 'noreply@seudominio.com';
    const emailParams = new EmailParams()
      .setFrom(new Sender(fromEmail, process.env.MAILERSEND_FROM_NAME || 'Rosenbaum Advogados'))
      .setTo([new Recipient(email, userData.name)])
      .setSubject('Código de verificação - Rosenbaum Advogados')
      .setHtml(`<h2>Seu código de verificação</h2><p style="font-size:32px;letter-spacing:8px;font-weight:bold">${code2fa}</p><p>Este código expira em 5 minutos.</p>`)
      .setText(`Seu código de verificação: ${code2fa}. Este código expira em 5 minutos.`);

    try {
      await mailerSend.email.send(emailParams);
      console.log(`✅ [auth] Código 2FA enviado para: ${email}`);
    } catch (mailErr) {
      console.error('❌ [auth] Erro ao enviar email 2FA:', mailErr.message);
      return res.status(500).json({ error: 'Erro ao enviar código de verificação' });
    }

    return res.json({ requires2FA: true, email });
  } catch (err) {
    console.error('❌ [auth] Erro no login:', err.message);
    return res.status(500).json({ error: 'Erro no login', details: err.message });
  }
});

app.post('/api/auth/verify-2fa', async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado' });
    }

    const { email, code } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ error: 'Email e código são obrigatórios' });
    }

    const pendingDoc = await firestoreDb.collection('pending_2fa').doc(email).get();
    if (!pendingDoc.exists) {
      return res.status(401).json({ error: 'Código inválido ou expirado' });
    }

    const pendingData = pendingDoc.data();

    // Verificar expiração
    if (new Date(pendingData.expiresAt) < new Date()) {
      await firestoreDb.collection('pending_2fa').doc(email).delete();
      return res.status(401).json({ error: 'Código expirado. Faça login novamente.' });
    }

    // Verificar código
    if (pendingData.code !== code) {
      return res.status(401).json({ error: 'Código inválido' });
    }

    // Código válido — deletar pending e criar sessão
    await firestoreDb.collection('pending_2fa').doc(email).delete();

    const token = crypto.randomBytes(32).toString('hex');
    await firestoreDb.collection('sessions').doc(token).set({
      email,
      name: pendingData.name,
      role: pendingData.role,
      permissions: pendingData.permissions,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_TTL).toISOString(),
    });

    console.log(`✅ [auth] 2FA verificado, login completo: ${email}`);

    // Usage log: login (fire-and-forget)
    firestoreDb.collection('usage_logs').add({
      type: 'login',
      email,
      name: pendingData.name,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    return res.json({
      token,
      user: {
        email,
        name: pendingData.name,
        role: pendingData.role,
        permissions: pendingData.permissions,
      },
    });
  } catch (err) {
    console.error('❌ [auth] Erro no verify-2fa:', err.message);
    return res.status(500).json({ error: 'Erro na verificação', details: err.message });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado' });
    }

    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    const userDoc = await firestoreDb.collection('users').doc(email).get();
    if (!userDoc.exists) {
      // Não revelar se o email existe ou não
      return res.json({ success: true });
    }

    const userData = userDoc.data();

    // Gerar nova senha temporária
    const newPassword = crypto.randomBytes(4).toString('hex').toUpperCase();

    // Salvar nova senha no Firestore
    await firestoreDb.collection('users').doc(email).update({ password: newPassword });

    // Invalidar sessões ativas
    const sessions = await firestoreDb.collection('sessions').where('email', '==', email).get();
    if (!sessions.empty) {
      const batch = firestoreDb.batch();
      sessions.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }

    // Enviar email com nova senha via MailerSend
    const fromEmail = process.env.MAILERSEND_FROM_EMAIL || 'noreply@seudominio.com';
    const emailParams = new EmailParams()
      .setFrom(new Sender(fromEmail, process.env.MAILERSEND_FROM_NAME || 'Rosenbaum Advogados'))
      .setTo([new Recipient(email, userData.name)])
      .setSubject('Recuperação de senha - Rosenbaum Advogados')
      .setHtml(`<h2>Recuperação de senha</h2><p>Olá ${userData.name},</p><p>Sua nova senha temporária é:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px;background:#f0f0f0;padding:12px;display:inline-block;border-radius:8px">${newPassword}</p><p>Recomendamos que solicite a troca da senha após o login.</p>`)
      .setText(`Olá ${userData.name}, sua nova senha temporária é: ${newPassword}`);

    await mailerSend.email.send(emailParams);
    console.log(`✅ [auth] Senha resetada e enviada para: ${email}`);

    return res.json({ success: true });
  } catch (err) {
    console.error('❌ [auth] Erro no forgot-password:', err.message);
    return res.status(500).json({ error: 'Erro ao recuperar senha' });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    const token = req.headers.authorization.substring(7);
    await firestoreDb.collection('sessions').doc(token).delete();
    console.log(`✅ [auth] Logout: ${req.user.email}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ [auth] Erro no logout:', err.message);
    return res.status(500).json({ error: 'Erro no logout' });
  }
});

// =====================================================
// USERS — Gestão de usuários (admin only)
// =====================================================

app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const snapshot = await firestoreDb.collection('users').get();
    const users = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        email: data.email,
        name: data.name,
        role: data.role,
        permissions: data.permissions || DEFAULT_PERMISSIONS[data.role] || [],
      };
    });
    return res.json(users);
  } catch (err) {
    console.error('❌ [users] Erro ao listar usuários:', err.message);
    return res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, name, password, role } = req.body || {};
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'email, name e password são obrigatórios' });
    }

    const existing = await firestoreDb.collection('users').doc(email).get();
    if (existing.exists) {
      return res.status(409).json({ error: 'Usuário já existe' });
    }

    const userRole = role === 'admin' ? 'admin' : 'user';
    const permissions = DEFAULT_PERMISSIONS[userRole];

    await firestoreDb.collection('users').doc(email).set({
      email,
      name,
      password,
      role: userRole,
      permissions,
    });

    console.log(`✅ [users] Usuário criado: ${email}`);
    return res.json({ email, name, role: userRole, permissions });
  } catch (err) {
    console.error('❌ [users] Erro ao criar usuário:', err.message);
    return res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

app.put('/api/users/:email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email } = req.params;
    const userDoc = await firestoreDb.collection('users').doc(email).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const updates = {};
    const { name, role, password } = req.body || {};
    if (name) updates.name = name;
    if (role && (role === 'admin' || role === 'user')) updates.role = role;
    if (password) updates.password = password;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    await firestoreDb.collection('users').doc(email).update(updates);

    const updated = (await firestoreDb.collection('users').doc(email).get()).data();
    console.log(`✅ [users] Usuário atualizado: ${email}`);
    return res.json({
      email: updated.email,
      name: updated.name,
      role: updated.role,
      permissions: updated.permissions || DEFAULT_PERMISSIONS[updated.role] || [],
    });
  } catch (err) {
    console.error('❌ [users] Erro ao atualizar usuário:', err.message);
    return res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

app.put('/api/users/:email/permissions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email } = req.params;
    const { permissions } = req.body || {};

    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'permissions deve ser um array' });
    }

    const valid = permissions.filter(p => ALL_PERMISSIONS.includes(p));

    const userDoc = await firestoreDb.collection('users').doc(email).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    await firestoreDb.collection('users').doc(email).update({ permissions: valid });

    // Invalidar sessões ativas deste usuário
    const sessions = await firestoreDb.collection('sessions').where('email', '==', email).get();
    const batch = firestoreDb.batch();
    sessions.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    console.log(`✅ [users] Permissões atualizadas para ${email}: ${valid.join(', ')} (${sessions.size} sessão(ões) invalidada(s))`);
    return res.json({ email, permissions: valid, sessionsInvalidated: sessions.size });
  } catch (err) {
    console.error('❌ [users] Erro ao atualizar permissões:', err.message);
    return res.status(500).json({ error: 'Erro ao atualizar permissões' });
  }
});

app.delete('/api/users/:email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email } = req.params;

    if (email === req.user.email) {
      return res.status(400).json({ error: 'Não é possível deletar seu próprio usuário' });
    }

    const userDoc = await firestoreDb.collection('users').doc(email).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Deletar sessões ativas
    const sessions = await firestoreDb.collection('sessions').where('email', '==', email).get();
    const batch = firestoreDb.batch();
    sessions.docs.forEach(doc => batch.delete(doc.ref));
    batch.delete(firestoreDb.collection('users').doc(email));
    await batch.commit();

    console.log(`✅ [users] Usuário deletado: ${email}`);
    return res.json({ success: true, email });
  } catch (err) {
    console.error('❌ [users] Erro ao deletar usuário:', err.message);
    return res.status(500).json({ error: 'Erro ao deletar usuário' });
  }
});

// Proxy simples para baixar anexos (evita CORS no browser).
// IMPORTANTE: restringe hosts para reduzir risco de SSRF.
const ALLOWED_PROXY_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  'drive.google.com',
  'docs.google.com',
]);

app.get('/api/proxy-file', requireAuth, async (req, res) => {
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
 * Busca mensagens do Firestore (database "messages")
 * Query params:
 *   - phone: telefone do chat (obrigatório)
 *   - limit: número máximo de mensagens (opcional, default 50)
 */
app.get('/api/firestore/messages', requireAuth, requirePermission('conversas-leads'), async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado no servidor' });
    }

    const phone = req.query.phone;
    const limitParam = parseInt(req.query.limit) || 50;

    if (!phone) {
      return res.status(400).json({ error: 'Parâmetro phone é obrigatório' });
    }

    const normalizedPhone = String(phone).replace(/\D/g, '');
    console.log(`📱 [server] Buscando mensagens para telefone: ${normalizedPhone}`);

    // Usar cache mesclado: messages (antigos) + umbler_webhooks (novos)
    const messages = await getMergedMessages(normalizedPhone, limitParam);

    console.log(`✅ [server] Encontradas ${messages.length} mensagens para ${normalizedPhone} (merged)`);

    // Detectar channel_phone e umbler IDs mais recentes da conversa
    let conversationChannelPhone = null;
    let umblerOrgId = null;
    let umblerChatId = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (!conversationChannelPhone && messages[i].channel_phone) {
        conversationChannelPhone = messages[i].channel_phone;
      }
      if (!umblerChatId && messages[i].umbler_chat_id) {
        umblerOrgId = messages[i].umbler_org_id;
        umblerChatId = messages[i].umbler_chat_id;
      }
      if (conversationChannelPhone && umblerChatId) break;
    }

    return res.json({ messages, count: messages.length, channel_phone: conversationChannelPhone, umbler_org_id: umblerOrgId, umbler_chat_id: umblerChatId });
  } catch (err) {
    console.error('❌ [server] Erro ao buscar mensagens do Firestore:', err);
    return res.status(500).json({
      error: 'Erro ao buscar mensagens',
      details: err.message,
    });
  }
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

app.post('/api/send-message', requireAuth, requirePermission('conversas-leads'), async (req, res) => {
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

    const { phone, message, channel_phone } = req.body || {};
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'phone é obrigatório (string)' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message é obrigatório (string)' });
    }

    console.log('📤 [server] Proxy envio mensagem:', {
      phone,
      messageLength: message.length,
      channel_phone: channel_phone || null,
      upstream: sendMessageUrl,
    });

    const upstream = await axios.post(
      sendMessageUrl,
      { phone, message, channel_phone: channel_phone || null },
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

    // Usage log: message sent (fire-and-forget)
    firestoreDb.collection('usage_logs').add({
      type: 'message_sent',
      email: req.user.email,
      name: req.user.name,
      phone,
      messageLength: message.length,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

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
app.get('/api/contencioso/columns', requireAuth, requirePermission('contencioso'), async (req, res) => {
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

app.get('/api/contencioso', requireAuth, requirePermission('contencioso'), async (req, res) => {
  const boardId = Number(req.query.boardId) || 632454515;
  const maxItems = Number(req.query.maxItems) || 0; // 0 = todos os itens
  const orderByRecent = req.query.orderByRecent === 'true'; // Ordenar por data de criação
  const apiKey = loadMondayApiKey();

  if (!apiKey) {
    return res.status(500).json({ error: 'Monday API key não configurada no .env (MONDAY_API_KEY)' });
  }

  const PAGE_LIMIT = 500;

  // Monday: `items_page` é paginado via `cursor`.
  // Agora com suporte a query_params para ordenar por data de criação
  // 1) Primeira página: items_page(limit: 500, query_params: ...)
  // 2) Próximas: items_page(limit: 500, cursor: "...")
  const firstPageQuery = orderByRecent ? `
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
        items_page (limit: $limit, query_params: {order_by: [{column_id: "__creation_log__", direction: desc}]}) {
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
  ` : `
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
    console.log(`📄 [server] Buscando itens do board no Monday (com paginação)${maxItems ? ` (max: ${maxItems})` : ''}${orderByRecent ? ' (ordenado por data)' : ''}:`, boardId);

    const allItems = [];
    const seenIds = new Set();
    let cursor = null;
    let page = 0;
    const MAX_PAGES = 200; // safety guard (200 * 500 = 100k itens)
    let boardColumns = null;
    let hasMore = false;

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
        return res.json({ columns: [], items: [], hasMore: false });
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

        // Se atingiu o limite máximo, parar
        if (maxItems > 0 && allItems.length >= maxItems) {
          hasMore = !!pageObj?.cursor || items.length === PAGE_LIMIT;
          break;
        }
      }

      // Se atingiu o limite máximo, parar
      if (maxItems > 0 && allItems.length >= maxItems) {
        break;
      }

      cursor = pageObj?.cursor || null;

      // Se não houver cursor, acabou.
      if (!cursor) break;

      hasMore = true;
    }

    return res.json({
      columns: boardColumns || [],
      items: allItems,
      hasMore: maxItems > 0 ? hasMore : false,
      totalLoaded: allItems.length
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
app.get('/api/contencioso/updates', requireAuth, requirePermission('contencioso'), async (req, res) => {
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
app.get('/api/monday/updates-by-phone', requireAuth, requirePermission('conversas-leads'), async (req, res) => {
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
        // pdf-parse v2.x: new PDFParse({ data: buffer }).getText()
        const parser = new PDFParse({ data: fileBuffer });
        const result = await parser.getText();
        await parser.destroy();
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
    
    // DOCX (Word moderno) - usando mammoth
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        filename.endsWith('.docx')) {
      console.log(`📄 Detectado como DOCX: ${file.filename}`);
      try {
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        const extractedText = result.value || '';
        console.log(`✅ DOCX processado: ${extractedText.length} caracteres extraídos`);
        if (result.messages && result.messages.length > 0) {
          console.log(`ℹ️ Mensagens do mammoth:`, result.messages);
        }
        return extractedText;
      } catch (docxError) {
        console.error(`❌ Erro ao processar DOCX ${file.filename}:`, docxError.message);
        return null;
      }
    }

    // DOC (Word antigo) - usando word-extractor
    if (mimeType === 'application/msword' || filename.endsWith('.doc')) {
      console.log(`📄 Detectado como DOC: ${file.filename}`);
      try {
        const extractor = new WordExtractor();
        const doc = await extractor.extract(fileBuffer);
        const extractedText = doc.getBody() || '';
        console.log(`✅ DOC processado: ${extractedText.length} caracteres extraídos`);
        return extractedText;
      } catch (docError) {
        console.error(`❌ Erro ao processar DOC ${file.filename}:`, docError.message);
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
app.post('/api/grok/chat', requireAuth, requirePermission('conversas-leads'), async (req, res) => {
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

    // Usage log: AI suggestion (fire-and-forget)
    firestoreDb.collection('usage_logs').add({
      type: 'ai_suggestion',
      email: req.user.email,
      name: req.user.name,
      model: model || 'grok-4-fast',
      timestamp: new Date().toISOString(),
    }).catch(() => {});

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
app.post('/api/grok/contencioso', requireAuth, requirePermission('contencioso'), async (req, res) => {
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
app.post('/api/monday/update', requireAuth, requirePermission('conversas-leads'), async (req, res) => {
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
 * Busca todos os telefones únicos da collection messages do Firestore
 * Retorna: { phone, messageCount, lastMessage: { content, timestamp, source } }
 */
app.get('/api/firestore/unique-phones', requireAuth, requirePermission('conversas-leads'), async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado no servidor' });
    }

    console.log('📱 [server] Buscando telefones únicos do Firestore...');

    // Buscar todas as mensagens
    const messagesRef = firestoreDb.collection('messages');
    const snapshot = await messagesRef.orderBy('timestamp', 'desc').get();

    if (snapshot.empty) {
      console.log('ℹ️ [server] Nenhuma mensagem encontrada no Firestore');
      return res.json({ phones: [], count: 0 });
    }

    // Agrupar mensagens por telefone
    const phoneMap = new Map();

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const phone = String(data.chat_phone || '').replace(/\D/g, '');

      if (!phone || phone.length < 10) return;

      if (!phoneMap.has(phone)) {
        phoneMap.set(phone, {
          phone,
          messageCount: 0,
          lastMessage: null,
          contactName: null,
        });
      }

      const entry = phoneMap.get(phone);
      entry.messageCount++;

      // Atualizar última mensagem (já ordenado por timestamp desc)
      if (!entry.lastMessage) {
        entry.lastMessage = {
          content: data.content || '',
          timestamp: data.timestamp?.toDate?.() || data.timestamp || null,
          source: data.source || '',
        };
      }

      // Pegar nome do contato se disponível
      if (!entry.contactName && data.name && data.source === 'Contact') {
        entry.contactName = data.name;
      }
    });

    // Converter Map para array e ordenar por última mensagem
    const phones = Array.from(phoneMap.values()).sort((a, b) => {
      const timeA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
      const timeB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
      return timeB - timeA;
    });

    console.log(`✅ [server] Encontrados ${phones.length} telefones únicos`);

    return res.json({ phones, count: phones.length });
  } catch (err) {
    console.error('❌ [server] Erro ao buscar telefones únicos do Firestore:', err);
    return res.status(500).json({
      error: 'Erro ao buscar telefones únicos',
      details: err.message,
    });
  }
});

// ─── GET /api/firestore/emails ─────────────────────────────────────────────────
// Busca emails da collection email_webhooks do Firestore para um endereço de email
app.get('/api/firestore/emails', requireAuth, requirePermission('conversas-leads'), async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado no servidor' });
    }

    const email = req.query.email;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Parâmetro "email" é obrigatório' });
    }

    const emailLower = email.toLowerCase().trim();
    console.log(`📧 [server] Buscando emails no Firestore para: ${emailLower}`);

    const emailsRef = firestoreDb.collection('email_webhooks');

    // 2 queries paralelas: emails recebidos (destination) e enviados (sender)
    const [destSnap, senderSnap] = await Promise.all([
      emailsRef.where('destination', '==', emailLower).orderBy('_receivedAt', 'desc').limit(200).get(),
      emailsRef.where('sender', '==', emailLower).orderBy('_receivedAt', 'desc').limit(200).get(),
    ]);

    // Merge e deduplicar por doc.id
    const docsMap = new Map();
    destSnap.docs.forEach(doc => docsMap.set(doc.id, { doc, matchField: 'destination' }));
    senderSnap.docs.forEach(doc => {
      if (!docsMap.has(doc.id)) {
        docsMap.set(doc.id, { doc, matchField: 'sender' });
      }
    });

    // Se poucos resultados, fazer scan mais amplo (sender pode ter formato "Nome <email>")
    if (docsMap.size < 5) {
      console.log(`📧 [server] Poucos resultados (${docsMap.size}), fazendo scan amplo...`);
      const broadSnap = await emailsRef.orderBy('_receivedAt', 'desc').limit(500).get();
      broadSnap.docs.forEach(doc => {
        if (docsMap.has(doc.id)) return;
        const data = doc.data();
        const senderStr = (data.sender || '').toLowerCase();
        const destStr = (data.destination || '').toLowerCase();
        if (senderStr.includes(emailLower)) {
          docsMap.set(doc.id, { doc, matchField: 'sender' });
        } else if (destStr.includes(emailLower)) {
          docsMap.set(doc.id, { doc, matchField: 'destination' });
        }
      });
    }

    console.log(`📧 [server] Total de emails encontrados: ${docsMap.size}`);

    // Transformar para formato da UI
    const emails = [];
    for (const [docId, { doc, matchField }] of docsMap) {
      const data = doc.data();

      // Calcular timestamp
      let timestamp = null;
      if (data._receivedAtISO) {
        timestamp = data._receivedAtISO;
      } else if (data._receivedAt && typeof data._receivedAt.toDate === 'function') {
        timestamp = data._receivedAt.toDate().toISOString();
      } else if (data._receivedAt) {
        timestamp = new Date(data._receivedAt).toISOString();
      }

      // Extrair anexos usando helper existente
      const rawAttachments = extractEmailAttachments(data);
      const attachments = rawAttachments.map(a => ({
        url: a.url,
        name: a.rawValue ? a.rawValue.split('/').pop() || `anexo_${a.index + 1}` : `anexo_${a.index + 1}`,
      }));

      // Determinar direction
      const direction = matchField === 'sender' ? 'sent' : 'received';

      emails.push({
        id: docId,
        subject: data.subject || '',
        sender: data.sender || '',
        destination: data.destination || '',
        text: data.text || '',
        timestamp,
        attachments,
        direction,
      });
    }

    // Ordenar por timestamp desc
    emails.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });

    return res.json({ emails, count: emails.length, source: 'firestore' });
  } catch (err) {
    console.error('❌ [server] Erro ao buscar emails do Firestore:', err);
    return res.status(500).json({
      error: 'Erro ao buscar emails do Firestore',
      details: err.message,
    });
  }
});

/**
 * Cria um item (lead) em um board do Monday
 */
app.post('/api/monday/create-item', requireAuth, requirePermission('conversas-leads'), async (req, res) => {
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

/**
 * Webhook endpoint para receber notificações do Umbler
 * POST /api/umbler/webhook
 * Salva as notificações na collection 'umbler_webhooks' do Firestore
 */
// Auto-enqueue: adiciona mídia do Umbler à file_processing_queue automaticamente
async function autoEnqueueUmblerMedia(db, webhookId, webhookData) {
  const payload = webhookData.Payload || {};
  const content = payload.Content || {};
  const message = content.Message || webhookData.Message || {};
  const lastMessage = content.LastMessage || webhookData.LastMessage || {};
  const messageType = message.MessageType || lastMessage.MessageType || '';

  if (!messageType || messageType === 'Text') return;

  const msgFile = message.File || {};
  const lmFile = lastMessage.File || {};
  const mediaUrl = msgFile.Url || lmFile.Url || '';
  if (!mediaUrl) return;

  const queueRef = db.collection('file_processing_queue');
  const existing = await queueRef.where('webhookId', '==', webhookId).limit(1).get();
  if (!existing.empty) return;

  const mimeType = msgFile.ContentType || lmFile.ContentType || '';
  const fileName = msgFile.OriginalName || lmFile.OriginalName || `file_${webhookId}`;
  const contactPhone = (content.Contact || webhookData.Contact || {}).PhoneNumber || '';
  const thumbnailObj = message.Thumbnail || lastMessage.Thumbnail || {};
  const thumbnailData = thumbnailObj.Data || null;
  const thumbnailMime = thumbnailObj.ContentType || 'image/jpeg';

  let mediaType = classifyMediaType(mimeType);
  if (messageType === 'Audio') mediaType = 'audio';
  if (messageType === 'Image') mediaType = 'image';
  if (messageType === 'Video') mediaType = 'video';

  await queueRef.add({
    webhookId, webhookSource: 'umbler', sourcePhone: contactPhone,
    mediaUrl, mediaFileName: fileName, mediaMimeType: mimeType, mediaType,
    thumbnailBase64: thumbnailData ? `data:${thumbnailMime};base64,${thumbnailData}` : null,
    receivedAt: new Date().toISOString(),
    status: 'queued', extractedText: null, error: null, processingMethod: null,
    attempts: 0, maxAttempts: 3, lastAttemptAt: null, nextRetryAt: null,
    gcsUrl: null, gcsPath: null, processedAt: null, createdAt: new Date().toISOString(),
  });
  console.log(`📥 [Auto-enqueue] Umbler ${webhookId} (${messageType}) enfileirado`);
}

app.post('/api/umbler/webhook', async (req, res) => {
  try {
    const webhookData = req.body;

    console.log('📥 [Umbler Webhook] Recebido:', JSON.stringify(webhookData, null, 2).substring(0, 500));

    if (!webhookData || Object.keys(webhookData).length === 0) {
      console.warn('⚠️ [Umbler Webhook] Payload vazio recebido');
      return res.status(400).json({ error: 'Payload vazio' });
    }

    if (!firestoreDb) {
      console.error('❌ [Umbler Webhook] Firebase não configurado');
      return res.status(500).json({ error: 'Firebase não configurado no servidor' });
    }

    // Preparar documento para salvar
    const docData = {
      ...webhookData,
      _receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      _receivedAtISO: new Date().toISOString(),
    };

    // Usar EventId como ID do documento se disponível, senão gerar automaticamente
    const eventId = webhookData.EventId || webhookData.Id || null;

    let docRef;
    if (eventId) {
      docRef = firestoreDb.collection('umbler_webhooks').doc(eventId);
      await docRef.set(docData, { merge: true });
      console.log(`✅ [Umbler Webhook] Salvo com ID: ${eventId}`);
    } else {
      docRef = await firestoreDb.collection('umbler_webhooks').add(docData);
      console.log(`✅ [Umbler Webhook] Salvo com ID gerado: ${docRef.id}`);
    }

    const savedId = eventId || docRef.id;

    // Auto-enqueue mídia (fire-and-forget)
    autoEnqueueUmblerMedia(firestoreDb, savedId, webhookData).catch(err => {
      console.warn(`⚠️ [Umbler Webhook] Auto-enqueue falhou (não fatal): ${err.message}`);
    });

    return res.status(200).json({
      success: true,
      id: savedId,
      message: 'Webhook recebido e salvo com sucesso'
    });
  } catch (err) {
    console.error('❌ [Umbler Webhook] Erro ao processar webhook:', err.message);
    return res.status(500).json({
      error: 'Erro ao processar webhook',
      details: err.message,
    });
  }
});

/**
 * GET /api/umbler/webhooks - Lista webhooks recebidos do Umbler
 * Query params:
 *   - limit: número máximo de webhooks (default 50)
 *   - startAfter: ID do documento para paginação
 */
app.get('/api/umbler/webhooks', requireAuth, async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado no servidor' });
    }

    const limitParam = parseInt(req.query.limit) || 50;

    console.log(`📋 [Umbler Webhooks] Buscando últimos ${limitParam} webhooks...`);

    let query = firestoreDb
      .collection('umbler_webhooks')
      .orderBy('_receivedAt', 'desc')
      .limit(limitParam);

    const snapshot = await query.get();

    const webhooks = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      _receivedAt: doc.data()._receivedAt?.toDate?.() || doc.data()._receivedAt,
    }));

    console.log(`✅ [Umbler Webhooks] Retornando ${webhooks.length} webhooks`);

    return res.json({ webhooks, count: webhooks.length });
  } catch (err) {
    console.error('❌ [Umbler Webhooks] Erro ao buscar webhooks:', err.message);
    return res.status(500).json({
      error: 'Erro ao buscar webhooks',
      details: err.message,
    });
  }
});

/**
 * GET /api/umbler/webhooks/diagnose — Diagnóstico: mostra campos de direção dos webhooks
 * Retorna 10 documentos com os campos relevantes para detectar incoming vs outgoing.
 * ENDPOINT TEMPORÁRIO — remover após validação.
 */
app.get('/api/umbler/webhooks/diagnose', requireAuth, async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado' });
    }

    const snapshot = await firestoreDb
      .collection('umbler_webhooks')
      .orderBy('_receivedAt', 'desc')
      .limit(10)
      .get();

    const diagnosis = snapshot.docs.map(doc => {
      const data = doc.data();
      const payload = data.Payload || {};
      const content = payload.Content || {};
      const message = content.Message || data.Message || {};
      const lastMessage = content.LastMessage || data.LastMessage || {};
      const contact = content.Contact || data.Contact || {};

      return {
        docId: doc.id,
        // Campos de direção candidatos
        'Message.IsFromMe': message.IsFromMe,
        'LastMessage.IsFromMe': lastMessage.IsFromMe,
        'data.IsFromMe': data.IsFromMe,
        'content.IsFromMe': content.IsFromMe,
        'EventName': data.EventName || data.eventName || payload.EventName,
        'Trigger': data.Trigger || data.trigger,
        'Direction': data.Direction || data.direction || content.Direction,
        'Message.Participant': message.Participant,
        // Contexto
        'Contact.PhoneNumber': contact.PhoneNumber,
        'Contact.Name': contact.Name || contact.DisplayName,
        'MessageType': message.MessageType || lastMessage.MessageType,
        'MessageContent': (message.Content || lastMessage.Content || '').substring(0, 80),
        // Source detectado pela heurística
        detectedSource: detectSourceFromWebhook(data),
        timestamp: data._receivedAtISO,
        // Todas as top-level keys para referência
        topLevelKeys: Object.keys(data).filter(k => !k.startsWith('_')),
      };
    });

    return res.json({ diagnosis, count: diagnosis.length });
  } catch (err) {
    console.error('❌ [Diagnose] Erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// =====================================================
// FILE PROCESSING — Processamento de Arquivos (Mídias)
// =====================================================

// Helper: classificar mediaType a partir do MIME type
function classifyMediaType(mimeType) {
  if (!mimeType) return 'image';
  const m = mimeType.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (m === 'application/msword') return 'docx';
  if (m.startsWith('video/')) return 'image'; // treat video as image fallback
  return 'image';
}

// Helper: Resolver URL de arquivo de email
// O campo `file` nos anexos de email pode ser um Google Drive file ID ou uma URL completa
function resolveEmailFileUrl(fileValue) {
  if (!fileValue) return '';
  // Remove prefixo do Drive quando o id= já contém uma URL completa
  const drivePrefix = 'https://drive.google.com/uc?export=download&id=';
  if (fileValue.startsWith(drivePrefix)) {
    const inner = fileValue.slice(drivePrefix.length);
    if (inner.startsWith('http://') || inner.startsWith('https://')) return inner;
  }
  // Se já é uma URL completa, retorna direto
  if (fileValue.startsWith('http://') || fileValue.startsWith('https://')) return fileValue;
  // Se parece com um Google Drive file ID, construir a URL de download direto
  return `https://drive.google.com/uc?export=download&id=${fileValue}`;
}

// Helper: Extrair anexos de email_webhooks
// Emails armazenam anexos em campos individuais file_001..file_020 (URLs diretas ou template placeholders)
function extractEmailAttachments(emailData) {
  const attachments = [];
  for (let i = 1; i <= 20; i++) {
    const key = `file_${String(i).padStart(3, '0')}`;
    const val = emailData[key];
    if (!val || typeof val !== 'string') continue;
    // Ignorar placeholders não resolvidos ($request.file.N.link$)
    if (val.startsWith('$') || val.includes('$request.')) continue;
    // Só aceitar URLs reais
    const resolved = resolveEmailFileUrl(val);
    if (!resolved) continue;
    attachments.push({ index: i - 1, url: resolved, rawValue: val, fieldKey: key });
  }
  return attachments;
}

// Helper: OCR com Google Cloud Vision API (chamada direta via REST + service account)
const { GoogleAuth } = require('google-auth-library');

let _visionAuthClient = null;
async function getVisionAuthClient() {
  if (_visionAuthClient) return _visionAuthClient;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || process.env.REACT_APP_FIREBASE_PRIVATE_KEY || '')
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || process.env.REACT_APP_FIREBASE_CLIENT_EMAIL;
  const auth = new GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/cloud-vision'],
  });
  _visionAuthClient = await auth.getClient();
  return _visionAuthClient;
}

async function ocrWithGoogleVision(mediaUrl) {
  console.log(`🔍 [Vision API] Enviando URL para OCR: ${mediaUrl}`);
  const client = await getVisionAuthClient();
  const accessToken = (await client.getAccessToken()).token;

  const response = await axios.post(
    'https://vision.googleapis.com/v1/images:annotate',
    {
      requests: [{
        image: { source: { imageUri: mediaUrl } },
        features: [{ type: 'TEXT_DETECTION' }],
      }],
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 60000,
    }
  );

  const annotations = response.data?.responses?.[0]?.textAnnotations;
  if (!annotations || annotations.length === 0) {
    console.log('🔍 [Vision API] Nenhum texto detectado na imagem');
    return '';
  }
  const text = annotations[0].description || '';
  console.log(`✅ [Vision API] Texto extraído: ${text.length} caracteres`);
  return text;
}

// Helper: Transcrever áudio com AssemblyAI
async function transcribeWithAssemblyAI(audioBuffer) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY não configurada');

  const headers = { authorization: apiKey };

  // 1. Upload
  const uploadRes = await axios.post('https://api.assemblyai.com/v2/upload', audioBuffer, {
    headers: { ...headers, 'Content-Type': 'application/octet-stream' },
    maxBodyLength: Infinity,
  });
  const uploadUrl = uploadRes.data.upload_url;

  // 2. Create transcript
  const transcriptRes = await axios.post(
    'https://api.assemblyai.com/v2/transcript',
    { audio_url: uploadUrl, language_code: 'pt' },
    { headers }
  );
  const transcriptId = transcriptRes.data.id;

  // 3. Poll until done (max ~5 min)
  const maxPolls = 60;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await axios.get(
      `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
      { headers }
    );
    if (pollRes.data.status === 'completed') {
      return pollRes.data.text || '';
    }
    if (pollRes.data.status === 'error') {
      throw new Error(`AssemblyAI error: ${pollRes.data.error}`);
    }
  }
  throw new Error('AssemblyAI: timeout aguardando transcrição');
}

// Helper: OCR de PDF escaneado — renderiza cada página como imagem, faz upload GCS e OCR individual
async function ocrScannedPDFPages(pdfBuffer, webhookId) {
  const scale = parseFloat(process.env.PDF_OCR_SCALE) || 2.0;
  const concurrency = parseInt(process.env.PDF_OCR_CONCURRENCY) || 3;
  const maxPages = parseInt(process.env.PDF_OCR_MAX_PAGES) || 20;

  const pdfData = new Uint8Array(pdfBuffer);
  const pdf = await getDocumentProxy(pdfData);
  const totalPages = pdf.numPages;
  const pagesToProcess = Math.min(totalPages, maxPages);

  const pageTexts = new Array(pagesToProcess).fill('');
  let pagesOCRed = 0;

  for (let batchStart = 0; batchStart < pagesToProcess; batchStart += concurrency) {
    const batchEnd = Math.min(batchStart + concurrency, pagesToProcess);
    const batch = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const pageNum = i + 1;
      batch.push(
        (async () => {
          try {
            const canvasImport = require('@napi-rs/canvas');
            const pngBuffer = await renderPageAsImage(pdf, pageNum, { scale, canvasImport });
            const gcsPath = `file-processing/pdf-pages/${webhookId}/page-${pageNum}.png`;
            const gcsUrl = await uploadToGCS(Buffer.from(pngBuffer), gcsPath, 'image/png');
            const text = await ocrWithGoogleVision(gcsUrl);
            if (text && text.trim().length > 0) {
              pageTexts[i] = text.trim();
              pagesOCRed++;
            }
          } catch (err) {
            // Erro na página individual — continua com as demais
          }
        })()
      );
    }
    await Promise.all(batch);
  }

  const combinedText = pageTexts
    .map((text, i) => text ? `--- Página ${i + 1} ---\n${text}` : null)
    .filter(Boolean)
    .join('\n\n');

  console.log(`📄 PDF-OCR: ${pagesOCRed}/${pagesToProcess} páginas, ${combinedText.length} chars`);

  return {
    text: combinedText,
    method: 'google-vision-pdf-pages',
    pageCount: pagesToProcess,
    pagesOCRed,
  };
}

// Helper: Extrair texto de PDF (pdf-parse + fallback OCR por página + fallback Vision via buffer)
// PDFs que são prints/scans retornam pouco texto via pdf-parse — threshold de 50 chars
// Fallback 1: OCR por página (renderiza cada página como imagem)
// Fallback 2: Vision via buffer (base64)
async function extractTextFromPDF(pdfBuffer, mediaUrl, webhookId) {
  let pdfText = '';
  try {
    const parser = new PDFParse({ data: pdfBuffer });
    const result = await parser.getText();
    await parser.destroy();
    pdfText = (result.text || '').trim();
  } catch (err) {
    console.warn('⚠️ pdf-parse falhou:', err.message);
  }

  // Se pdf-parse extraiu bastante texto, usa direto
  if (pdfText.length > 50) {
    return { text: pdfText, method: 'pdf-parse' };
  }

  // Pouco ou nenhum texto — provavelmente é um scan/print, tentar OCR
  // Fallback 1: OCR por página (renderiza cada página como imagem PNG e OCR individual)
  if (webhookId) {
    try {
      const pageResult = await ocrScannedPDFPages(pdfBuffer, webhookId);
      if (pageResult.text && pageResult.text.trim().length > pdfText.length) {
        return pageResult;
      }
    } catch (err) {
      console.warn(`⚠️ PDF OCR por página falhou: ${err.message}`);
    }
  }

  // Fallback 2: Vision via URL original
  try {
    const ocrText = await ocrWithGoogleVision(mediaUrl);
    if (ocrText.trim().length > pdfText.length) {
      return { text: ocrText, method: 'google-vision-pdf' };
    }
  } catch (err) {
    // Vision fallback falhou silenciosamente
  }

  return { text: pdfText, method: pdfText ? 'pdf-parse' : 'none' };
}

// Helper: Extrair texto de DOCX (mammoth para .docx, word-extractor para .doc)
async function extractTextFromDocx(buffer, mimeType) {
  // .docx (OpenXML)
  if (!mimeType || mimeType.includes('openxmlformats') || mimeType.includes('docx')) {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value || '', method: 'mammoth' };
  }
  // .doc (legacy binary format)
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buffer);
  return { text: doc.getBody() || '', method: 'word-extractor' };
}

// Helper: Upload para GCS usando Firebase Admin SDK (com retry para erros de concorrência)
async function uploadToGCS(buffer, gcsPath, mimeType) {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) throw new Error('GCS_BUCKET_NAME não configurada');

  const bucket = admin.storage().bucket(bucketName);
  const file = bucket.file(gcsPath);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await file.save(buffer, {
        metadata: { contentType: mimeType },
      });
      await file.makePublic();
      return `https://storage.googleapis.com/${bucketName}/${gcsPath}`;
    } catch (err) {
      if (attempt < 2 && err.message && err.message.includes('edited during the operation')) {
        console.warn(`GCS upload retry ${attempt + 1}/2: ${err.message}`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

// Helper: Detectar tipo de arquivo por magic bytes (file signature)
// Segundo argumento opcional: httpContentType e fileName para desambiguar OLE2
function detectFileTypeFromBuffer(buffer, hints) {
  if (!buffer || buffer.length < 8) return null;
  // PDF: starts with %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'pdf';
  // DOCX/XLSX/PPTX (ZIP-based Office): starts with PK (0x50 0x4B)
  if (buffer[0] === 0x50 && buffer[1] === 0x4B) return 'docx';
  // DOC/MSG/XLS (legacy OLE2): starts with D0 CF 11 E0
  // OLE2 é compartilhado por .doc, .msg, .xls — usar hints para desambiguar
  if (buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0) {
    const ct = (hints && hints.contentType || '').toLowerCase();
    const fn = (hints && hints.fileName || '').toLowerCase();
    // MSG (Outlook) — não temos parser, skip
    if (ct.includes('ms-outlook') || fn.endsWith('.msg')) return null;
    // XLS — não temos parser, skip
    if (ct.includes('ms-excel') || fn.endsWith('.xls')) return null;
    return 'docx'; // assume DOC
  }
  // PNG: starts with 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image';
  // JPEG: starts with FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image';
  // GIF: starts with GIF8
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image';
  // WebP: starts with RIFF....WEBP
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image';
  // MP3: starts with FF FB, FF F3, FF F2, or ID3
  if ((buffer[0] === 0xFF && (buffer[1] === 0xFB || buffer[1] === 0xF3 || buffer[1] === 0xF2)) ||
      (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33)) return 'audio';
  // OGG: starts with OggS
  if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) return 'audio';
  // WAV: starts with RIFF....WAVE
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) return 'audio';
  return null; // unknown — keep original classification
}

// Lock em memória para evitar processamento duplicado de itens em chamadas concorrentes
const _processingLock = new Set();

// Helper: Processar um item da fila
async function processQueueItem(itemId) {
  if (!firestoreDb) throw new Error('Firebase não configurado');

  const queueRef = firestoreDb.collection('file_processing_queue').doc(itemId);
  const itemDoc = await queueRef.get();

  if (!itemDoc.exists) throw new Error(`Item ${itemId} não encontrado na fila`);

  const item = itemDoc.data();

  // Atualizar status para processing
  await queueRef.update({
    status: 'processing',
    lastAttemptAt: new Date().toISOString(),
  });

  try {
    // Determinar collection de origem (email ou umbler)
    const webhookSource = item.webhookSource || 'umbler';
    const sourceCollection = webhookSource === 'email' ? 'email_webhooks' : 'umbler_webhooks';

    // Buscar webhook original para pegar MediaUrl (fallback se não salvo na fila)
    const webhookDoc = await firestoreDb.collection(sourceCollection).doc(item.webhookId).get();
    if (!webhookDoc.exists) throw new Error(`Webhook ${item.webhookId} não encontrado em ${sourceCollection}`);

    let mediaUrl = item.mediaUrl;
    const whData = webhookDoc.data();

    // Se mediaUrl vazio, tentar extrair do webhook original
    if (!mediaUrl) {
      if (webhookSource === 'email') {
        // Para emails, extrair URL dos campos file_001..file_020 pelo attachmentIndex
        const attachments = extractEmailAttachments(whData);
        const idx = item.attachmentIndex || 0;
        const att = attachments.find(a => a.index === idx);
        mediaUrl = att ? att.url : '';

        if (mediaUrl) {
          await queueRef.update({ mediaUrl });
          console.log(`🔗 [FileProcessing] mediaUrl extraída do email (${att.fieldKey}): ${mediaUrl}`);
        }
      } else {
        // Para umbler, extrair de Message.File.Url ou LastMessage.File.Url
        const payload = whData.Payload || whData.body?.Payload || {};
        const content = payload.Content || {};
        const msgNested = content.Message || {};
        const lmNested = content.LastMessage || {};
        const msgRoot = whData.Message || {};
        const lmRoot = whData.LastMessage || {};
        mediaUrl = (msgNested.File || {}).Url || (lmNested.File || {}).Url
                || (msgRoot.File || {}).Url || (lmRoot.File || {}).Url || '';

        if (mediaUrl) {
          await queueRef.update({ mediaUrl });
          console.log(`🔗 [FileProcessing] mediaUrl atualizada do webhook: ${mediaUrl}`);
        }
      }
    }

    if (!mediaUrl) {
      // LOG DIAGNÓSTICO: estrutura completa do webhook para identificar onde está a URL
      console.error(`🔍 [FileProcessing] DIAGNÓSTICO — mediaUrl não encontrada para item ${itemId}`);
      console.error(`🔍 [FileProcessing] webhookId: ${item.webhookId}`);
      console.error(`🔍 [FileProcessing] item.mediaUrl: "${item.mediaUrl}"`);
      console.error(`🔍 [FileProcessing] WEBHOOK COMPLETO:`, JSON.stringify(whData, null, 2));
      // Listar todas as chaves de primeiro nível do webhook
      console.error(`🔍 [FileProcessing] Chaves raiz do webhook: [${Object.keys(whData).join(', ')}]`);
      // Buscar qualquer campo que contenha "url" (case insensitive) em toda a estrutura
      const findUrls = (obj, path = '') => {
        const found = [];
        if (!obj || typeof obj !== 'object') return found;
        for (const [key, val] of Object.entries(obj)) {
          const fullPath = path ? `${path}.${key}` : key;
          if (/url/i.test(key) && typeof val === 'string' && val.length > 0) {
            found.push({ path: fullPath, value: val });
          }
          if (val && typeof val === 'object') {
            found.push(...findUrls(val, fullPath));
          }
        }
        return found;
      };
      const urlFields = findUrls(whData);
      if (urlFields.length > 0) {
        console.error(`🔍 [FileProcessing] Campos com "url" encontrados:`, JSON.stringify(urlFields, null, 2));
      } else {
        console.error(`🔍 [FileProcessing] NENHUM campo com "url" encontrado em toda a estrutura do webhook`);
      }
      throw new Error('mediaUrl não encontrada no item nem no webhook');
    }

    // Baixar mídia
    emitSSE('processing', { id: itemId, step: 'download', fileName: item.mediaFileName, mediaType: item.mediaType, phone: item.sourcePhone });
    let mediaResponse = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    let mediaBuffer = Buffer.from(mediaResponse.data);
    let responseContentType = (mediaResponse.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    let redirected = false;

    // Webhook.site retorna 302 com Location truncado, mas o HTML body tem a URL correta no meta refresh
    if (mediaBuffer.length > 0 && mediaBuffer[0] === 0x3C) {
      const htmlContent = mediaBuffer.toString('utf8', 0, Math.min(mediaBuffer.length, 2000));
      const metaMatch = htmlContent.match(/url='([^']+)'/i) || htmlContent.match(/url="([^"]+)"/i);
      if (metaMatch && metaMatch[1]) {
        mediaResponse = await axios.get(metaMatch[1], { responseType: 'arraybuffer', timeout: 60000 });
        mediaBuffer = Buffer.from(mediaResponse.data);
        responseContentType = (mediaResponse.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        redirected = true;
      }
    }

    // Detectar tipo real do arquivo por magic bytes (file signature)
    let mediaType = item.mediaType;
    const detectedType = detectFileTypeFromBuffer(mediaBuffer, { contentType: responseContentType, fileName: item.mediaFileName });
    const httpDetectedType = responseContentType ? classifyMediaType(responseContentType) : null;
    const finalDetected = detectedType || (httpDetectedType !== 'image' ? httpDetectedType : null);
    if (finalDetected && finalDetected !== mediaType) {
      mediaType = finalDetected;
      await queueRef.update({ mediaType: finalDetected, mediaTypeDetected: true });
    }

    const typeInfo = finalDetected && finalDetected !== item.mediaType ? ` (${item.mediaType}→${mediaType})` : '';
    const redirectInfo = redirected ? ' [redirect]' : '';
    console.log(`⚙️ [${itemId}] ${item.mediaFileName} | ${mediaBuffer.length}b ${mediaType}${typeInfo}${redirectInfo}`);

    // Upload GCS primeiro — a URL pública é usada para OCR (evita redirect webhook.site)
    let gcsUrl = null;
    let gcsPath = null;
    try {
      gcsPath = `file-processing/${mediaType}/${item.webhookId}/${item.mediaFileName}`;
      gcsUrl = await uploadToGCS(mediaBuffer, gcsPath, item.mediaMimeType);
    } catch (gcsErr) {
      // GCS upload não fatal — continua sem salvar
    }

    // URL confiável para OCR: GCS (pública) > mediaUrl original
    const ocrUrl = gcsUrl || mediaUrl;

    // Classificar e processar
    let extractedText = '';
    let processingMethod = '';

    emitSSE('processing', { id: itemId, step: 'extracting', fileName: item.mediaFileName, mediaType, phone: item.sourcePhone });
    if (mediaType === 'image') {
      extractedText = await ocrWithGoogleVision(ocrUrl);
      processingMethod = 'google-vision-ocr';
    } else if (mediaType === 'audio') {
      extractedText = await transcribeWithAssemblyAI(mediaBuffer);
      processingMethod = 'assemblyai';
    } else if (mediaType === 'pdf') {
      const result = await extractTextFromPDF(mediaBuffer, ocrUrl, item.webhookId);
      extractedText = result.text;
      processingMethod = result.method;
    } else if (mediaType === 'docx') {
      const result = await extractTextFromDocx(mediaBuffer, item.mediaMimeType);
      extractedText = result.text;
      processingMethod = result.method;
    } else if (mediaType === 'video') {
      processingMethod = 'skipped-video';
    }

    // Se não extraiu texto e não é vídeo, marcar como needs_review
    const finalStatus = (!extractedText || !extractedText.trim()) && mediaType !== 'video'
      ? 'needs_review'
      : 'done';

    await queueRef.update({
      status: finalStatus,
      extractedText,
      processingMethod,
      gcsUrl,
      gcsPath,
      processedAt: new Date().toISOString(),
      error: null,
    });

    console.log(`${finalStatus === 'done' ? '✅' : '⚠️'} [${itemId}] ${extractedText.length} chars via ${processingMethod} → ${finalStatus}`);
    emitSSE('done', { id: itemId, fileName: item.mediaFileName, mediaType, phone: item.sourcePhone, method: processingMethod, chars: extractedText.length });
    return { success: true, extractedText, processingMethod, gcsUrl };
  } catch (err) {
    console.error(`❌ [${itemId}] ${err.message}`);
    emitSSE('error', { id: itemId, fileName: item.mediaFileName, mediaType: item.mediaType, phone: item.sourcePhone, error: err.message });

    const newAttempts = (item.attempts || 0) + 1;
    const maxAttempts = item.maxAttempts || 3;

    const updateData = {
      attempts: newAttempts,
      error: err.message,
      lastAttemptAt: new Date().toISOString(),
    };

    if (newAttempts >= maxAttempts) {
      updateData.status = 'error';
      updateData.nextRetryAt = null;
    } else {
      // Backoff exponencial: 30s, 2min, 10min
      const backoffMs = [30000, 120000, 600000][newAttempts - 1] || 600000;
      updateData.status = 'queued';
      updateData.nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
    }

    await queueRef.update(updateData);
    throw err;
  }
}

/**
 * GET /api/files/media-webhooks — Lista webhooks com mídia
 * Query: limit, type (image|audio|pdf)
 */
app.get('/api/files/media-webhooks', async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado' });
    }

    const limitParam = parseInt(req.query.limit) || 100;
    const typeFilter = req.query.type || null; // image, audio, pdf

    console.log(`📋 [FileProcessing] Buscando webhooks com mídia (limit=${limitParam}, type=${typeFilter})...`);

    const snapshot = await firestoreDb
      .collection('umbler_webhooks')
      .orderBy('_receivedAt', 'desc')
      .limit(500) // Buscar mais para filtrar
      .get();

    const mediaWebhooks = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();

      // Suporta ambos formatos: {Payload.Content.Message...} e {Message... / LastMessage...}
      const payload = data.Payload || {};
      const content = payload.Content || {};
      // Formato aninhado (Payload.Content.Message) e raiz (data.Message)
      const message = content.Message || data.Message || {};
      const lastMessage = content.LastMessage || data.LastMessage || {};

      // Prioridade: Message (tem URL), fallback LastMessage
      const msgFile = message.File || {};
      const lmFile = lastMessage.File || {};
      const messageType = message.MessageType || lastMessage.MessageType || '';

      // Só interessa mensagens com mídia (Audio, File, Image, Video)
      if (messageType === 'Text' || !messageType) continue;

      const mediaUrl = msgFile.Url || lmFile.Url || null;
      if (!mediaUrl) continue; // Webhook de status/leitura sem URL do arquivo
      const mimeType = msgFile.ContentType || lmFile.ContentType || '';
      const fileName = msgFile.OriginalName || lmFile.OriginalName || `file_${doc.id}`;
      const contactPhone = (content.Contact || data.Contact || {}).PhoneNumber || '';

      // Thumbnail como fallback para preview
      const thumbnailObj = message.Thumbnail || lastMessage.Thumbnail || {};
      const thumbnailData = thumbnailObj.Data || null;
      const thumbnailMime = thumbnailObj.ContentType || 'image/jpeg';

      // Classificar tipo
      let mediaType = classifyMediaType(mimeType);
      // Também usar MessageType como hint
      if (messageType === 'Audio') mediaType = 'audio';
      if (messageType === 'Image') mediaType = 'image';

      // Filtrar por tipo se solicitado
      if (typeFilter && mediaType !== typeFilter) continue;

      mediaWebhooks.push({
        id: doc.id,
        from: contactPhone,
        mediaUrl,
        mediaFileName: fileName,
        mediaMimeType: mimeType,
        mediaType,
        receivedAt: data._receivedAtISO || data._receivedAt?.toDate?.()?.toISOString() || null,
        body: lastMessage.Content || data.Body || '',
        hasUrl: !!mediaUrl,
        thumbnailBase64: thumbnailData ? `data:${thumbnailMime};base64,${thumbnailData}` : null,
        source: 'umbler',
      });

      if (mediaWebhooks.length >= limitParam) break;
    }

    // ── Também buscar anexos em email_webhooks (campos file_001..file_020) ──
    if (mediaWebhooks.length < limitParam) {
      const emailSnapshot = await firestoreDb
        .collection('email_webhooks')
        .orderBy('_receivedAt', 'desc')
        .limit(500)
        .get();

      for (const eDoc of emailSnapshot.docs) {
        if (mediaWebhooks.length >= limitParam) break;

        const eData = eDoc.data();
        const attachments = extractEmailAttachments(eData);

        if (attachments.length === 0) continue;

        const totalAttachments = attachments.length;
        // Extrair nome legível do sender (ex: "João <joao@gmail.com>" -> "João")
        const rawSender = eData.sender || eData.from || '';
        const senderName = rawSender.replace(/<[^>]+>/, '').replace(/["']/g, '').trim() || rawSender;

        for (const att of attachments) {
          if (mediaWebhooks.length >= limitParam) break;

          const eFileName = totalAttachments > 1
            ? `Anexo ${att.index + 1}/${totalAttachments} - ${senderName}`
            : `Anexo - ${senderName}`;
          // Sem mime type disponível nos campos file_XXX, inferir como image por padrão
          let eMimeType = '';
          let eMediaType = 'image';

          // Tentar inferir pelo URL
          const urlLower = att.url.toLowerCase();
          if (urlLower.includes('.pdf')) { eMediaType = 'pdf'; eMimeType = 'application/pdf'; }
          else if (urlLower.includes('.doc')) { eMediaType = 'docx'; eMimeType = 'application/msword'; }
          else if (urlLower.includes('.mp3') || urlLower.includes('.wav') || urlLower.includes('.ogg')) { eMediaType = 'audio'; }

          if (typeFilter && eMediaType !== typeFilter) continue;

          mediaWebhooks.push({
            id: eDoc.id,
            attachmentIndex: att.index,
            from: rawSender,
            mediaUrl: att.url,
            mediaFileName: eFileName,
            mediaMimeType: eMimeType,
            mediaType: eMediaType,
            receivedAt: eData._receivedAtISO || eData._receivedAt?.toDate?.()?.toISOString() || null,
            body: eData.subject || '',
            hasUrl: true,
            thumbnailBase64: null,
            source: 'email',
            totalAttachments,
          });
        }
      }
    }

    console.log(`✅ [FileProcessing] ${mediaWebhooks.length} webhooks com mídia encontrados (umbler + email)`);
    return res.json({ webhooks: mediaWebhooks, count: mediaWebhooks.length });
  } catch (err) {
    console.error('❌ [FileProcessing] Erro ao buscar media webhooks:', err.message);
    return res.status(500).json({ error: 'Erro ao buscar webhooks', details: err.message });
  }
});

/**
 * GET /api/files/queue — Lista itens da fila de processamento
 * Query: status, type, limit
 */
// Endpoint leve: retorna apenas webhookId + attachmentIndex de toda a fila
app.get('/api/files/queue-keys', async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado' });
    }

    const snapshot = await firestoreDb
      .collection('file_processing_queue')
      .select('webhookId', 'webhookSource', 'attachmentIndex')
      .get();

    const keys = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        webhookId: d.webhookId,
        webhookSource: d.webhookSource || 'umbler',
        attachmentIndex: d.attachmentIndex !== undefined ? d.attachmentIndex : null,
      };
    });

    return res.json({ keys, count: keys.length });
  } catch (err) {
    console.error('❌ [FileProcessing] Erro ao buscar chaves da fila:', err.message);
    return res.status(500).json({ error: 'Erro ao buscar chaves da fila', details: err.message });
  }
});

app.get('/api/files/queue', async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado' });
    }

    const limitParam = parseInt(req.query.limit) || 200;
    const statusFilter = req.query.status || null;
    const typeFilter = req.query.type || null;

    let query = firestoreDb
      .collection('file_processing_queue')
      .orderBy('createdAt', 'desc')
      .limit(limitParam);

    const snapshot = await query.get();

    let items = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Filtrar no cliente (Firestore tem limitações com múltiplos filtros + orderBy)
    if (statusFilter) {
      items = items.filter(item => item.status === statusFilter);
    }
    if (typeFilter) {
      items = items.filter(item => item.mediaType === typeFilter);
    }

    return res.json({ items, count: items.length });
  } catch (err) {
    console.error('❌ [FileProcessing] Erro ao buscar fila:', err.message);
    return res.status(500).json({ error: 'Erro ao buscar fila', details: err.message });
  }
});

/**
 * GET /api/prompts — Listar todos os prompts do Firestore (database: messages)
 */
app.get('/api/prompts', async (req, res) => {
  try {
    if (!firestoreDb) return res.status(500).json({ error: 'Firebase não configurado' });
    const snapshot = await firestoreDb.collection('prompts').get();
    const prompts = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        name: d.name || '',
        description: d.description || '',
        content: d.content || '',
        parentId: d.parentId || null,
        order: d.order || 0,
        createdAt: d.createdAt || '',
        updatedAt: d.updatedAt || '',
      };
    });
    res.json(prompts);
  } catch (err) {
    console.error('❌ Erro ao carregar prompts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/prompts — Criar novo prompt
 */
app.post('/api/prompts', async (req, res) => {
  try {
    if (!firestoreDb) return res.status(500).json({ error: 'Firebase não configurado' });
    const { name, description, content, parentId, order } = req.body;
    const docRef = await firestoreDb.collection('prompts').add({
      name, description: description || '', content: content || '',
      parentId: parentId || null, order: order || 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const doc = await docRef.get();
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/prompts/:id — Atualizar prompt
 */
app.patch('/api/prompts/:id', async (req, res) => {
  try {
    if (!firestoreDb) return res.status(500).json({ error: 'Firebase não configurado' });
    const { name, description, content, parentId, order } = req.body;
    const ref = firestoreDb.collection('prompts').doc(req.params.id);
    await ref.update({ name, description: description || '', content: content || '', parentId: parentId || null, order: order || 0, updatedAt: new Date().toISOString() });
    const doc = await ref.get();
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/prompts/:id — Deletar prompt
 */
app.delete('/api/prompts/:id', async (req, res) => {
  try {
    if (!firestoreDb) return res.status(500).json({ error: 'Firebase não configurado' });
    await firestoreDb.collection('prompts').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/files/extracted-texts?phone=XXXXX — Textos extraídos de arquivos processados para um contato
 */
app.get('/api/files/extracted-texts', async (req, res) => {
  try {
    if (!firestoreDb) return res.status(500).json({ error: 'Firebase não configurado' });
    const phone = (req.query.phone || '').toString().trim();
    if (!phone) return res.status(400).json({ error: 'phone é obrigatório' });

    // Normalizar: buscar por variantes do telefone (com/sem 55, com/sem 9o dígito)
    const clean = phone.replace(/\D/g, '');
    const variants = new Set([clean]);
    if (clean.startsWith('55')) variants.add(clean.substring(2));
    else variants.add('55' + clean);
    // 9o dígito
    for (const v of [...variants]) {
      if (v.length === 11 && v[2] === '9') variants.add(v.substring(0, 2) + v.substring(3));
      if (v.length === 10) variants.add(v.substring(0, 2) + '9' + v.substring(2));
      if (v.length === 13 && v[4] === '9') variants.add(v.substring(0, 4) + v.substring(5));
      if (v.length === 12) variants.add(v.substring(0, 4) + '9' + v.substring(4));
    }

    const snapshot = await firestoreDb.collection('file_processing_queue')
      .where('status', '==', 'done')
      .limit(500)
      .get();

    const results = [];
    for (const doc of snapshot.docs) {
      const d = doc.data();
      if (!d.extractedText || d.extractedText.trim().length === 0) continue;
      const sp = (d.sourcePhone || '').replace(/\D/g, '');
      if (!sp) continue;
      let match = false;
      for (const v of variants) {
        if (sp === v || sp.endsWith(v) || v.endsWith(sp)) { match = true; break; }
      }
      if (!match) continue;
      results.push({
        id: doc.id,
        fileName: d.mediaFileName || '',
        mediaType: d.mediaType || '',
        extractedText: d.extractedText,
        processedAt: d.processedAt || '',
      });
    }

    res.json(results);
  } catch (err) {
    console.error('❌ Erro ao buscar textos extraídos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/files/enqueue — Adiciona webhooks na fila
 * Body: { webhookIds: string[], source?: 'umbler' | 'email', attachmentIndex?: number }
 */
app.post('/api/files/enqueue', async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado' });
    }

    const { webhookIds, source = 'umbler', attachmentIndex } = req.body || {};
    if (!Array.isArray(webhookIds) || webhookIds.length === 0) {
      return res.status(400).json({ error: 'webhookIds (array) é obrigatório' });
    }

    const webhookSource = source === 'email' ? 'email' : 'umbler';
    const collectionName = webhookSource === 'email' ? 'email_webhooks' : 'umbler_webhooks';

    console.log(`📥 [FileProcessing] Enfileirando ${webhookIds.length} webhook(s) de ${collectionName}...`);

    const results = [];

    for (const webhookId of webhookIds) {
      // Buscar webhook na collection correta
      const webhookDoc = await firestoreDb.collection(collectionName).doc(webhookId).get();
      if (!webhookDoc.exists) {
        results.push({ webhookId, error: 'Webhook não encontrado' });
        continue;
      }

      const data = webhookDoc.data();

      if (webhookSource === 'email') {
        // ── Fluxo para email_webhooks (campos file_001..file_020) ──
        const attachments = extractEmailAttachments(data);

        if (attachments.length === 0) {
          results.push({ webhookId, error: 'Email sem anexos com URL válida' });
          continue;
        }

        // Se attachmentIndex especificado, processar só aquele; senão, todos
        const toProcess = (attachmentIndex !== undefined && attachmentIndex !== null)
          ? attachments.filter(a => a.index === attachmentIndex)
          : attachments;

        const totalAtt = attachments.length;
        const rawSender = data.sender || data.from || '';
        const senderName = rawSender.replace(/<[^>]+>/, '').replace(/["']/g, '').trim() || rawSender;

        for (const att of toProcess) {
          const eFileName = totalAtt > 1
            ? `Anexo ${att.index + 1}/${totalAtt} - ${senderName}`
            : `Anexo - ${senderName}`;
          let eMimeType = '';
          let eMediaType = 'image';

          // Tentar inferir pelo URL
          const urlLower = att.url.toLowerCase();
          if (urlLower.includes('.pdf')) { eMediaType = 'pdf'; eMimeType = 'application/pdf'; }
          else if (urlLower.includes('.doc')) { eMediaType = 'docx'; eMimeType = 'application/msword'; }
          else if (urlLower.includes('.mp3') || urlLower.includes('.wav') || urlLower.includes('.ogg')) { eMediaType = 'audio'; }

          const existing = await firestoreDb
            .collection('file_processing_queue')
            .where('webhookId', '==', webhookId)
            .where('attachmentIndex', '==', att.index)
            .limit(1)
            .get();

          if (!existing.empty) {
            results.push({ webhookId, attachmentIndex: att.index, error: 'Já está na fila', existingId: existing.docs[0].id });
            continue;
          }

          const queueItem = {
            webhookId,
            webhookSource: 'email',
            attachmentIndex: att.index,
            sourcePhone: data.sender || data.from || '',
            mediaUrl: att.url,
            mediaFileName: eFileName,
            mediaMimeType: eMimeType,
            mediaType: eMediaType,
            thumbnailBase64: null,
            receivedAt: data._receivedAtISO || (data._receivedAt?.toDate ? data._receivedAt.toDate().toISOString() : null),
            status: 'queued',
            extractedText: null,
            error: null,
            processingMethod: null,
            attempts: 0,
            maxAttempts: 3,
            lastAttemptAt: null,
            nextRetryAt: null,
            gcsUrl: null,
            gcsPath: null,
            processedAt: null,
            createdAt: new Date().toISOString(),
          };

          const docRef = await firestoreDb.collection('file_processing_queue').add(queueItem);
          results.push({ webhookId, attachmentIndex: att.index, queueId: docRef.id, status: 'queued' });
        }
      } else {
        // ── Fluxo original para umbler_webhooks ──
        const payload = data.Payload || {};
        const content = payload.Content || {};
        const message = content.Message || data.Message || {};
        const lastMessage = content.LastMessage || data.LastMessage || {};

        const msgFile = message.File || {};
        const lmFile = lastMessage.File || {};
        const messageType = message.MessageType || lastMessage.MessageType || '';

        const mediaUrl = msgFile.Url || lmFile.Url || '';
        const mimeType = msgFile.ContentType || lmFile.ContentType || '';
        const fileName = msgFile.OriginalName || lmFile.OriginalName || `file_${webhookId}`;
        const contactPhone = (content.Contact || data.Contact || {}).PhoneNumber || '';

        if (!mediaUrl) {
          console.warn(`⏭️ [FileProcessing/Enqueue] mediaUrl vazia, ignorando webhookId=${webhookId} (MessageType=${messageType})`);
          results.push({ webhookId, error: 'Sem mediaUrl — não enfileirado' });
          continue;
        }

        const thumbnailObj = message.Thumbnail || lastMessage.Thumbnail || {};
        const thumbnailData = thumbnailObj.Data || null;
        const thumbnailMime = thumbnailObj.ContentType || 'image/jpeg';

        if (!messageType || messageType === 'Text') {
          results.push({ webhookId, error: 'Webhook sem mídia' });
          continue;
        }

        let mediaType = classifyMediaType(mimeType);
        if (messageType === 'Audio') mediaType = 'audio';
        if (messageType === 'Image') mediaType = 'image';

        const existing = await firestoreDb
          .collection('file_processing_queue')
          .where('webhookId', '==', webhookId)
          .limit(1)
          .get();

        if (!existing.empty) {
          results.push({ webhookId, error: 'Já está na fila', existingId: existing.docs[0].id });
          continue;
        }

        const queueItem = {
          webhookId,
          webhookSource: 'umbler',
          sourcePhone: contactPhone,
          mediaUrl,
          mediaFileName: fileName,
          mediaMimeType: mimeType,
          mediaType,
          thumbnailBase64: thumbnailData ? `data:${thumbnailMime};base64,${thumbnailData}` : null,
          receivedAt: data._receivedAtISO || (data._receivedAt?.toDate ? data._receivedAt.toDate().toISOString() : null),
          status: 'queued',
          extractedText: null,
          error: null,
          processingMethod: null,
          attempts: 0,
          maxAttempts: 3,
          lastAttemptAt: null,
          nextRetryAt: null,
          gcsUrl: null,
          gcsPath: null,
          processedAt: null,
          createdAt: new Date().toISOString(),
        };

        const docRef = await firestoreDb.collection('file_processing_queue').add(queueItem);
        results.push({ webhookId, queueId: docRef.id, status: 'queued' });
      }
    }

    console.log(`✅ [FileProcessing] Enfileirados: ${results.filter(r => r.queueId).length}/${webhookIds.length}`);
    return res.json({ results });
  } catch (err) {
    console.error('❌ [FileProcessing] Erro ao enfileirar:', err.message);
    return res.status(500).json({ error: 'Erro ao enfileirar', details: err.message });
  }
});

/**
 * POST /api/files/process-next — Processa o próximo item da fila
 */
app.post('/api/files/process-next', async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado' });
    }

    // Resetar itens "processing" travados (> 5 min)
    const now = new Date().toISOString();
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const staleSnap = await firestoreDb
      .collection('file_processing_queue')
      .where('status', '==', 'processing')
      .limit(20)
      .get();
    for (const doc of staleSnap.docs) {
      const data = doc.data();
      const startedAt = data.lastAttemptAt || data.createdAt || '';
      if (startedAt && startedAt < staleThreshold) {
        await doc.ref.update({ status: 'queued' });
        console.log(`🔄 [FileProcessing] Item ${doc.id} travado em processing, resetado para queued`);
      }
    }

    // Buscar próximo item: queued sem nextRetryAt, ou com nextRetryAt <= now

    // Buscar itens queued (sem orderBy composto para evitar necessidade de índice)
    let snapshot = await firestoreDb
      .collection('file_processing_queue')
      .where('status', '==', 'queued')
      .limit(50)
      .get();

    // Ordenar por receivedAt desc (mais recentes primeiro), filtrar por nextRetryAt
    const candidates = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item => !item.nextRetryAt || item.nextRetryAt <= now)
      .sort((a, b) => (b.receivedAt || b.createdAt || '').localeCompare(a.receivedAt || a.createdAt || ''));

    // Remover itens sem mediaUrl da fila (não têm como ser processados)
    const noUrl = candidates.filter(item => !item.mediaUrl);
    for (const item of noUrl) {
      await firestoreDb.collection('file_processing_queue').doc(item.id).delete();
      console.log(`🗑️ [FileProcessing] Removido item ${item.id} sem mediaUrl da fila`);
    }

    const nextItem = candidates.find(item => item.mediaUrl && !_processingLock.has(item.id)) || null;

    if (!nextItem) {
      return res.json({ message: 'Nenhum item na fila para processar', processed: false, skippedNoUrl: noUrl.length });
    }

    // Lock para evitar que chamadas concorrentes peguem o mesmo item
    _processingLock.add(nextItem.id);
    try {
      const result = await processQueueItem(nextItem.id);
      return res.json({ processed: true, itemId: nextItem.id, ...result });
    } finally {
      _processingLock.delete(nextItem.id);
    }
  } catch (err) {
    console.error(`❌ [process-next] ${err.message}`);
    return res.status(500).json({ error: 'Erro ao processar', details: err.message });
  }
});

/**
 * POST /api/files/process/:id — Processa um item específico da fila
 */
app.post('/api/files/process/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await processQueueItem(id);
    return res.json({ processed: true, itemId: id, ...result });
  } catch (err) {
    console.error(`❌ [FileProcessing] Erro ao processar ${req.params.id}:`, err.message);
    return res.status(500).json({ error: 'Erro ao processar', details: err.message });
  }
});

/**
 * GET /api/files/webhook-raw/:queueId — Retorna o webhook original completo + mediaUrl interpretada
 */
app.get('/api/files/webhook-raw/:queueId', async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado' });
    }

    const { queueId } = req.params;

    // Buscar item da fila para saber webhookId e source
    const queueDoc = await firestoreDb.collection('file_processing_queue').doc(queueId).get();
    if (!queueDoc.exists) {
      return res.status(404).json({ error: 'Item não encontrado na fila' });
    }

    const queueData = queueDoc.data();
    const webhookSource = queueData.webhookSource || 'umbler';
    const collectionName = webhookSource === 'email' ? 'email_webhooks' : 'umbler_webhooks';

    // Buscar webhook original
    const webhookDoc = await firestoreDb.collection(collectionName).doc(queueData.webhookId).get();
    if (!webhookDoc.exists) {
      return res.status(404).json({ error: `Webhook ${queueData.webhookId} não encontrado em ${collectionName}` });
    }

    const webhookData = webhookDoc.data();

    // Converter timestamps do Firestore para ISO strings para serialização
    const sanitize = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      if (obj._seconds !== undefined && obj._nanoseconds !== undefined) {
        return new Date(obj._seconds * 1000).toISOString();
      }
      if (typeof obj.toDate === 'function') {
        return obj.toDate().toISOString();
      }
      if (Array.isArray(obj)) return obj.map(sanitize);
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = sanitize(v);
      }
      return result;
    };

    return res.json({
      queueItem: {
        id: queueDoc.id,
        webhookId: queueData.webhookId,
        webhookSource,
        attachmentIndex: queueData.attachmentIndex,
        mediaUrl: queueData.mediaUrl,
        mediaFileName: queueData.mediaFileName,
        mediaMimeType: queueData.mediaMimeType,
        mediaType: queueData.mediaType,
      },
      webhook: sanitize(webhookData),
      collection: collectionName,
    });
  } catch (err) {
    console.error(`❌ [FileProcessing] Erro ao buscar webhook raw:`, err.message);
    return res.status(500).json({ error: 'Erro ao buscar webhook', details: err.message });
  }
});

/**
 * POST /api/files/retry/:id — Reseta tentativas e recoloca na fila
 */
app.post('/api/files/retry/:id', async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado' });
    }

    const { id } = req.params;
    const queueRef = firestoreDb.collection('file_processing_queue').doc(id);
    const doc = await queueRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }

    await queueRef.update({
      status: 'queued',
      attempts: 0,
      error: null,
      nextRetryAt: null,
      lastAttemptAt: null,
    });

    console.log(`🔄 [FileProcessing] Item ${id} resetado para fila`);
    return res.json({ success: true, itemId: id, status: 'queued' });
  } catch (err) {
    console.error(`❌ [FileProcessing] Erro ao retry ${req.params.id}:`, err.message);
    return res.status(500).json({ error: 'Erro ao retentar', details: err.message });
  }
});

/**
 * DELETE /api/files/queue/:id — Remove um item da fila
 */
app.delete('/api/files/queue/:id', async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado' });
    }

    const { id } = req.params;
    const queueRef = firestoreDb.collection('file_processing_queue').doc(id);
    const doc = await queueRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }

    await queueRef.delete();

    console.log(`🗑️ [FileProcessing] Item ${id} removido da fila`);
    return res.json({ success: true, itemId: id });
  } catch (err) {
    console.error(`❌ [FileProcessing] Erro ao remover ${req.params.id}:`, err.message);
    return res.status(500).json({ error: 'Erro ao remover', details: err.message });
  }
});

/**
 * POST /api/files/upload — Upload manual de arquivo para a fila de processamento
 */
app.post('/api/files/upload', uploadMulter.single('file'), async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase não configurado' });
    }

    const file = req.file;
    const phone = req.body.phone;

    if (!file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }
    if (!phone) {
      return res.status(400).json({ error: 'Telefone do lead é obrigatório' });
    }

    const uuid = crypto.randomUUID();
    const mediaType = classifyMediaType(file.mimetype);
    const gcsPath = `file-processing/manual-upload/${uuid}/${file.originalname}`;

    // Upload para GCS
    const gcsUrl = await uploadToGCS(file.buffer, gcsPath, file.mimetype);

    // Criar documento na fila de processamento
    const queueDoc = {
      webhookId: uuid,
      webhookSource: 'manual-upload',
      sourcePhone: phone,
      mediaUrl: gcsUrl,
      mediaFileName: file.originalname,
      mediaMimeType: file.mimetype,
      mediaType: mediaType,
      thumbnailBase64: null,
      receivedAt: new Date().toISOString(),
      status: 'queued',
      extractedText: null,
      error: null,
      processingMethod: null,
      attempts: 0,
      maxAttempts: 3,
      lastAttemptAt: null,
      nextRetryAt: null,
      gcsUrl: gcsUrl,
      gcsPath: gcsPath,
      processedAt: null,
      createdAt: new Date().toISOString(),
    };

    const docRef = await firestoreDb.collection('file_processing_queue').add(queueDoc);

    console.log(`📤 [FileProcessing] Upload manual: ${file.originalname} (${mediaType}) para ${phone} — queueId: ${docRef.id}`);

    return res.json({
      success: true,
      queueId: docRef.id,
      fileName: file.originalname,
      status: 'queued',
    });
  } catch (err) {
    console.error('❌ [FileProcessing] Erro no upload manual:', err.message);
    return res.status(500).json({ error: 'Erro ao fazer upload', details: err.message });
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

// ============================================================================
// Error Reports
// ============================================================================

app.post('/api/error-reports', requireAuth, async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase nao configurado' });
    }

    const { description, leadId, leadName, url, userAgent } = req.body || {};
    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: 'description e obrigatorio' });
    }

    const report = {
      description: description.trim(),
      leadId: leadId || null,
      leadName: leadName || null,
      url: url || null,
      userAgent: userAgent || null,
      reportedBy: req.user?.email || 'unknown',
      reportedByName: req.user?.name || 'unknown',
      status: 'open',
      createdAt: new Date().toISOString(),
    };

    const docRef = await firestoreDb.collection('error_reports').add(report);
    console.log(`🐛 [ErrorReport] Novo erro reportado por ${report.reportedBy}: "${description.substring(0, 80)}..." (id: ${docRef.id})`);

    return res.json({ success: true, id: docRef.id });
  } catch (err) {
    console.error('❌ [ErrorReport] Erro ao salvar report:', err.message);
    return res.status(500).json({ error: 'Erro ao salvar report' });
  }
});

app.get('/api/error-reports', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase nao configurado' });
    }

    const snapshot = await firestoreDb.collection('error_reports')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.json({ reports });
  } catch (err) {
    console.error('❌ [ErrorReport] Erro ao listar reports:', err.message);
    return res.status(500).json({ error: 'Erro ao listar reports' });
  }
});

app.patch('/api/error-reports/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase nao configurado' });
    }

    const { id } = req.params;
    const { status } = req.body || {};
    if (!status) {
      return res.status(400).json({ error: 'Status é obrigatório' });
    }

    const docRef = firestoreDb.collection('error_reports').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Report não encontrado' });
    }

    await docRef.update({ status, updatedAt: new Date().toISOString() });
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ [ErrorReport] Erro ao atualizar report:', err.message);
    return res.status(500).json({ error: 'Erro ao atualizar report' });
  }
});

app.delete('/api/error-reports/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase nao configurado' });
    }

    const { id } = req.params;
    const docRef = firestoreDb.collection('error_reports').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Report não encontrado' });
    }

    await docRef.delete();
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ [ErrorReport] Erro ao deletar report:', err.message);
    return res.status(500).json({ error: 'Erro ao deletar report' });
  }
});

// =====================================================
// USAGE LOGS — Endpoint para consultar logs de uso
// =====================================================

app.get('/api/usage-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(500).json({ error: 'Firebase nao configurado' });
    }

    const { email, startDate, endDate } = req.query;

    let query = firestoreDb.collection('usage_logs').orderBy('timestamp', 'desc');

    if (email) {
      query = firestoreDb.collection('usage_logs')
        .where('email', '==', email)
        .orderBy('timestamp', 'desc');
    }

    if (startDate) {
      query = query.where('timestamp', '>=', startDate);
    }
    if (endDate) {
      query = query.where('timestamp', '<=', endDate);
    }

    query = query.limit(2000);

    const snapshot = await query.get();
    const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Aggregate stats per user
    const statsMap = {};
    for (const log of logs) {
      const key = log.email;
      if (!statsMap[key]) {
        statsMap[key] = {
          email: log.email,
          name: log.name,
          logins: 0,
          aiSuggestions: 0,
          messagesSent: 0,
          lastActivity: log.timestamp,
        };
      }
      if (log.type === 'login') statsMap[key].logins++;
      else if (log.type === 'ai_suggestion') statsMap[key].aiSuggestions++;
      else if (log.type === 'message_sent') statsMap[key].messagesSent++;

      if (log.timestamp > statsMap[key].lastActivity) {
        statsMap[key].lastActivity = log.timestamp;
      }
    }

    const stats = Object.values(statsMap);
    return res.json({ logs, stats });
  } catch (err) {
    console.error('❌ [UsageLogs] Erro ao consultar logs:', err.message);
    return res.status(500).json({ error: 'Erro ao consultar logs de uso', details: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor backend rodando em http://0.0.0.0:${PORT}`);
  console.log(`📁 Carregando variáveis de ambiente de: .env`);

  // Limpeza: remover itens sem mediaUrl da fila (queued ou error)
  if (firestoreDb) {
    (async () => {
      try {
        for (const status of ['queued', 'error']) {
          const snap = await firestoreDb.collection('file_processing_queue').where('status', '==', status).get();
          let removed = 0;
          for (const doc of snap.docs) {
            const d = doc.data();
            if (!d.mediaUrl) {
              await doc.ref.delete();
              removed++;
            }
          }
          if (removed > 0) console.log(`🧹 [Startup] Removidos ${removed} itens "${status}" sem mediaUrl`);
        }
      } catch (err) {
        console.error('⚠️ [Startup] Erro na limpeza:', err.message);
      }
    })();
  }

  // Background worker: processa fila automaticamente a cada 30s
  const WORKER_INTERVAL = 30000;
  const WORKER_CONCURRENCY = 3;
  const WORKER_MAX_PER_CYCLE = 10;
  let workerRunning = false;

  const runBackgroundWorker = async () => {
    if (workerRunning || !firestoreDb) return;
    workerRunning = true;

    try {
      const snap = await firestoreDb.collection('file_processing_queue')
        .where('status', '==', 'queued')
        .limit(1)
        .get();

      if (snap.empty) {
        workerRunning = false;
        return;
      }

      let totalProcessed = 0;
      let hasMore = true;

      while (hasMore && totalProcessed < WORKER_MAX_PER_CYCLE) {
        const batchSize = Math.min(WORKER_CONCURRENCY, WORKER_MAX_PER_CYCLE - totalProcessed);
        const batchPromises = [];

        for (let i = 0; i < batchSize; i++) {
          batchPromises.push((async () => {
            try {
              const qSnap = await firestoreDb.collection('file_processing_queue')
                .where('status', '==', 'queued')
                .orderBy('createdAt', 'asc')
                .limit(1)
                .get();

              if (qSnap.empty) return false;

              const doc = qSnap.docs[0];
              const item = doc.data();

              if (_processingLock.has(doc.id)) return false;
              if (!item.mediaUrl) {
                await doc.ref.update({ status: 'error', error: 'mediaUrl não encontrada no webhook', processedAt: new Date().toISOString() });
                return true; // conta como processado para avançar na fila
              }

              _processingLock.add(doc.id);
              try {
                await processQueueItem(doc.id);
                return true;
              } finally {
                _processingLock.delete(doc.id);
              }
            } catch (err) {
              console.error(`⚠️ [Worker] Erro ao processar:`, err.message);
              return false;
            }
          })());
        }

        const results = await Promise.all(batchPromises);
        const batchProcessed = results.filter(Boolean).length;
        totalProcessed += batchProcessed;
        hasMore = batchProcessed > 0;
      }

      if (totalProcessed > 0) {
        console.log(`🔄 [Worker] Processados ${totalProcessed} itens da fila`);
      }
    } catch (err) {
      console.error('⚠️ [Worker] Erro no background worker:', err.message);
    } finally {
      workerRunning = false;
    }
  };

  setInterval(runBackgroundWorker, WORKER_INTERVAL);
  // Primeira execução após 5s
  setTimeout(runBackgroundWorker, 5000);
  console.log(`🔄 Background worker ativo: processando fila a cada ${WORKER_INTERVAL / 1000}s`);
});


