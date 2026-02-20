const { getDb, setCors, admin, extractEmailAttachments } = require('../../lib/firebase-admin');
const axios = require('axios');

// ── OCR via Google Vision FaaS ──
const VISION_FAAS_URL = 'https://faas-nyc1-2ef2e6cc.doserverless.co/api/v1/namespaces/fn-40f71f3b-ef29-4735-b9b7-94774d6c5fa7/actions/google_vision';
const VISION_FAAS_AUTH = 'Basic NTUxZDA1YmMtN2YzMy00MzgyLWFjZjktOWMxZDk5ZGE4MGFkOjM5VFl5N1lHNHNHSW1Rek42QXZLQkVnMkRkQTVjMjBKRlY4c1h2RndUSGpIVUJUdmlUMG5MalJ1SjRuSUNBZ0Y=';

async function ocrWithGoogleVision(mediaUrl) {
  const response = await axios.post(
    `${VISION_FAAS_URL}?blocking=true&result=true`,
    { url: mediaUrl },
    { headers: { 'Content-Type': 'application/json', Authorization: VISION_FAAS_AUTH }, timeout: 60000 }
  );
  const rawBody = response.data?.body || response.data;
  const parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  const annotations = parsed?.responses?.[0]?.textAnnotations;
  if (!annotations || annotations.length === 0) return '';
  return annotations[0].description || '';
}

// ── Transcrição áudio via AssemblyAI ──
async function transcribeWithAssemblyAI(audioBuffer) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY não configurada');
  const headers = { authorization: apiKey };

  const uploadRes = await axios.post('https://api.assemblyai.com/v2/upload', audioBuffer, {
    headers: { ...headers, 'Content-Type': 'application/octet-stream' }, maxBodyLength: Infinity,
  });

  const transcriptRes = await axios.post(
    'https://api.assemblyai.com/v2/transcript',
    { audio_url: uploadRes.data.upload_url, language_code: 'pt' },
    { headers }
  );
  const transcriptId = transcriptRes.data.id;

  // Poll até completar (max ~4 min para caber no timeout Vercel Pro de 5min)
  for (let i = 0; i < 48; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await axios.get(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, { headers });
    if (pollRes.data.status === 'completed') return pollRes.data.text || '';
    if (pollRes.data.status === 'error') throw new Error(`AssemblyAI error: ${pollRes.data.error}`);
  }
  throw new Error('AssemblyAI: timeout aguardando transcrição');
}

// ── Extração de PDF ──
async function extractTextFromPDF(pdfBuffer, mediaUrl) {
  let pdfText = '';
  try {
    const { extractText } = await import('unpdf');
    const data = new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength);
    const result = await extractText(data, { mergePages: true });
    pdfText = (result.text || '').trim();
  } catch (err) {
    console.warn('pdf-parse falhou:', err.message);
  }

  if (pdfText.length > 50) return { text: pdfText, method: 'pdf-parse' };

  // Fallback: Vision OCR via URL
  try {
    const ocrText = await ocrWithGoogleVision(mediaUrl);
    if (ocrText.trim().length > pdfText.length) return { text: ocrText, method: 'google-vision-pdf' };
  } catch (err) {
    console.warn('Vision OCR falhou:', err.message);
  }

  return { text: pdfText, method: pdfText ? 'pdf-parse' : 'none' };
}

// ── Extração de DOCX ──
async function extractTextFromDocx(buffer, mimeType) {
  if (!mimeType || mimeType.includes('openxmlformats') || mimeType.includes('docx')) {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value || '', method: 'mammoth' };
  }
  const WordExtractor = require('word-extractor');
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buffer);
  return { text: doc.getBody() || '', method: 'word-extractor' };
}

// ── Upload GCS ──
async function uploadToGCS(buffer, gcsPath, mimeType) {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) throw new Error('GCS_BUCKET_NAME não configurada');
  const bucket = admin.storage().bucket(bucketName);
  const file = bucket.file(gcsPath);
  await file.save(buffer, { metadata: { contentType: mimeType } });
  await file.makePublic();
  return `https://storage.googleapis.com/${bucketName}/${gcsPath}`;
}

// ── processQueueItem ──
async function processQueueItem(db, itemId) {
  const queueRef = db.collection('file_processing_queue').doc(itemId);
  const itemDoc = await queueRef.get();
  if (!itemDoc.exists) throw new Error(`Item ${itemId} não encontrado`);

  const item = itemDoc.data();

  await queueRef.update({ status: 'processing', lastAttemptAt: new Date().toISOString() });

  try {
    const webhookSource = item.webhookSource || 'umbler';
    const sourceCollection = webhookSource === 'email' ? 'email_webhooks' : 'umbler_webhooks';
    const webhookDoc = await db.collection(sourceCollection).doc(item.webhookId).get();
    if (!webhookDoc.exists) throw new Error(`Webhook ${item.webhookId} não encontrado`);

    let mediaUrl = item.mediaUrl;
    const whData = webhookDoc.data();

    // Resolver mediaUrl se vazio
    if (!mediaUrl) {
      if (webhookSource === 'email') {
        const attachments = extractEmailAttachments(whData);
        const att = attachments.find(a => a.index === (item.attachmentIndex || 0));
        mediaUrl = att ? att.url : '';
        if (mediaUrl) await queueRef.update({ mediaUrl });
      } else {
        const payload = whData.Payload || {};
        const content = payload.Content || {};
        mediaUrl = (content.Message?.File || {}).Url || (content.LastMessage?.File || {}).Url
                || (whData.Message?.File || {}).Url || (whData.LastMessage?.File || {}).Url || '';
        if (mediaUrl) await queueRef.update({ mediaUrl });
      }
    }

    if (!mediaUrl) throw new Error('mediaUrl não encontrada');

    // Download
    console.log(`Baixando: ${mediaUrl}`);
    const mediaResponse = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 60000 });
    const mediaBuffer = Buffer.from(mediaResponse.data);

    // Processar por tipo
    let extractedText = '';
    let processingMethod = '';
    const mediaType = item.mediaType;

    if (mediaType === 'image') {
      extractedText = await ocrWithGoogleVision(mediaUrl);
      processingMethod = 'google-vision-ocr';
    } else if (mediaType === 'audio') {
      extractedText = await transcribeWithAssemblyAI(mediaBuffer);
      processingMethod = 'assemblyai';
    } else if (mediaType === 'pdf') {
      const result = await extractTextFromPDF(mediaBuffer, mediaUrl);
      extractedText = result.text;
      processingMethod = result.method;
    } else if (mediaType === 'docx') {
      const result = await extractTextFromDocx(mediaBuffer, item.mediaMimeType);
      extractedText = result.text;
      processingMethod = result.method;
    }

    // Upload GCS
    let gcsUrl = null, gcsPath = null;
    try {
      gcsPath = `file-processing/${mediaType}/${item.webhookId}/${item.mediaFileName}`;
      gcsUrl = await uploadToGCS(mediaBuffer, gcsPath, item.mediaMimeType);
    } catch (gcsErr) {
      console.warn('GCS upload falhou (não fatal):', gcsErr.message);
    }

    await queueRef.update({
      status: 'done', extractedText, processingMethod, gcsUrl, gcsPath,
      processedAt: new Date().toISOString(), error: null,
    });

    return { success: true, extractedText, processingMethod, gcsUrl };
  } catch (err) {
    console.error(`Erro item ${itemId}:`, err.message);
    const newAttempts = (item.attempts || 0) + 1;
    const maxAttempts = item.maxAttempts || 3;
    const updateData = { attempts: newAttempts, error: err.message, lastAttemptAt: new Date().toISOString() };

    if (newAttempts >= maxAttempts) {
      updateData.status = 'error';
      updateData.nextRetryAt = null;
    } else {
      const backoffMs = [30000, 120000, 600000][newAttempts - 1] || 600000;
      updateData.status = 'queued';
      updateData.nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
    }
    await queueRef.update(updateData);
    throw err;
  }
}

// Busca próximo item queued e processa — retorna resultado sem depender de req/res
async function processNextItem() {
  const db = getDb();
  if (!db) throw new Error('Firebase não configurado');

  const now = new Date().toISOString();
  const snapshot = await db
    .collection('file_processing_queue')
    .where('status', '==', 'queued')
    .limit(50)
    .get();

  const candidates = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(item => !item.nextRetryAt || item.nextRetryAt <= now)
    .sort((a, b) => (b.receivedAt || b.createdAt || '').localeCompare(a.receivedAt || a.createdAt || ''));

  const nextItem = candidates.length > 0 ? candidates[0] : null;
  if (!nextItem) return { processed: false };

  const result = await processQueueItem(db, nextItem.id);
  return { processed: true, itemId: nextItem.id, ...result };
}

const handler = async (req, res) => {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const result = await processNextItem();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao processar', details: err.message });
  }
};

handler.processNextItem = processNextItem;
module.exports = handler;
