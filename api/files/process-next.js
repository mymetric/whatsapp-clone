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

// ── Extrair imagem embutida de PDF (JPEG direto ou FlateDecode RGB→JPEG) ──
function extractImageFromPDF(pdfBuffer) {
  // 1. JPEG direto: procurar FF D8 FF ... FF D9
  let jpegStart = -1;
  for (let i = 0; i < pdfBuffer.length - 2; i++) {
    if (pdfBuffer[i] === 0xFF && pdfBuffer[i + 1] === 0xD8 && pdfBuffer[i + 2] === 0xFF) {
      jpegStart = i;
      break;
    }
  }
  if (jpegStart >= 0) {
    let jpegEnd = -1;
    for (let i = pdfBuffer.length - 2; i > jpegStart; i--) {
      if (pdfBuffer[i] === 0xFF && pdfBuffer[i + 1] === 0xD9) {
        jpegEnd = i + 2;
        break;
      }
    }
    if (jpegEnd > jpegStart) {
      return { buffer: pdfBuffer.slice(jpegStart, jpegEnd), mimeType: 'image/jpeg', ext: 'jpg' };
    }
  }

  // 2. FlateDecode: imagem raw RGB comprimida com zlib dentro do PDF
  try {
    const content = pdfBuffer.toString('latin1');
    // Verificar se tem Image XObject com FlateDecode
    if (!content.includes('/Subtype /Image') || !content.includes('/FlateDecode')) return null;

    const widthMatch = content.match(/\/Width\s+(\d+)/);
    const heightMatch = content.match(/\/Height\s+(\d+)/);
    if (!widthMatch || !heightMatch) return null;
    const width = parseInt(widthMatch[1]);
    const height = parseInt(heightMatch[1]);
    if (width < 100 || height < 100) return null;

    // Encontrar o maior stream (que é a imagem)
    const zlib = require('zlib');
    let bestRgb = null;
    let pos = 0;
    while (true) {
      const idx1 = content.indexOf('stream\r\n', pos);
      const idx2 = content.indexOf('stream\n', pos);
      const sIdx = (idx1 >= 0 && idx2 >= 0) ? Math.min(idx1, idx2) : (idx1 >= 0 ? idx1 : idx2);
      if (sIdx < 0) break;
      const hLen = content[sIdx + 6] === '\r' ? 8 : 7;
      const dataStart = sIdx + hLen;
      const endIdx = content.indexOf('endstream', dataStart);
      if (endIdx < 0) { pos = dataStart; continue; }
      const rawStream = pdfBuffer.slice(dataStart, endIdx);
      try {
        const dec = zlib.inflateSync(rawStream);
        if (dec.length === width * height * 3) {
          bestRgb = dec;
          break;
        }
      } catch (_) { /* stream não é zlib válido */ }
      pos = endIdx;
    }
    if (!bestRgb) return null;

    console.log(`FlateDecode: imagem ${width}x${height} RGB (${bestRgb.length} bytes), convertendo para JPEG`);
    const jpeg = require('jpeg-js');
    const rgbaData = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgbaData[i * 4] = bestRgb[i * 3];
      rgbaData[i * 4 + 1] = bestRgb[i * 3 + 1];
      rgbaData[i * 4 + 2] = bestRgb[i * 3 + 2];
      rgbaData[i * 4 + 3] = 255;
    }
    const encoded = jpeg.encode({ data: rgbaData, width, height }, 75);
    return { buffer: Buffer.from(encoded.data), mimeType: 'image/jpeg', ext: 'jpg' };
  } catch (err) {
    console.warn('FlateDecode extraction falhou:', err.message);
    return null;
  }
}

// ── Extração de PDF ──
async function extractTextFromPDF(pdfBuffer, mediaUrl, uploadFn) {
  let pdfText = '';
  try {
    const { extractText } = await import('unpdf');
    // IMPORTANTE: unpdf/pdfjs detach o ArrayBuffer subjacente, destruindo o buffer original.
    // Criar uma cópia para preservar pdfBuffer para os fallbacks.
    const copy = new Uint8Array(pdfBuffer.length);
    copy.set(pdfBuffer);
    const result = await extractText(copy, { mergePages: true });
    pdfText = (result.text || '').trim();
  } catch (err) {
    console.warn('pdf-parse falhou:', err.message);
  }

  if (pdfText.length > 50) return { text: pdfText, method: 'pdf-parse' };

  // Fallback 1: Extrair imagem embutida do PDF e enviar para Vision OCR
  try {
    const embedded = extractImageFromPDF(pdfBuffer);
    if (embedded && embedded.buffer.length > 5000) {
      console.log(`PDF contém ${embedded.mimeType} embutido (${embedded.buffer.length} bytes), extraindo para OCR`);
      if (uploadFn) {
        const imgPath = mediaUrl.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 60) + '_extracted.' + embedded.ext;
        const imgGcsUrl = await uploadFn(embedded.buffer, `file-processing/pdf-images/${imgPath}`, embedded.mimeType);
        const ocrText = await ocrWithGoogleVision(imgGcsUrl);
        if (ocrText.trim().length > pdfText.length) return { text: ocrText, method: 'google-vision-pdf-image' };
      }
    }
  } catch (err) {
    console.warn('Extração de imagem do PDF falhou:', err.message);
  }

  // Fallback 2: Vision OCR direto na URL (funciona para alguns formatos)
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
  // ZIP e openxmlformats → tentar mammoth (DOCX)
  if (!mimeType || mimeType.includes('openxmlformats') || mimeType.includes('docx') || mimeType === 'application/zip') {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      if (result.value && result.value.trim()) return { text: result.value, method: 'mammoth' };
    } catch (err) {
      console.warn('mammoth falhou:', err.message);
    }
    // Se mammoth falhou ou retornou vazio e é ZIP genérico, não é DOCX
    if (mimeType === 'application/zip') return { text: '', method: 'skipped-zip' };
  }
  // DOC antigo (OLE2)
  if (mimeType === 'application/msword' || mimeType?.includes('msword')) {
    try {
      const WordExtractor = require('word-extractor');
      const extractor = new WordExtractor();
      const doc = await extractor.extract(buffer);
      return { text: doc.getBody() || '', method: 'word-extractor' };
    } catch (err) {
      console.warn('word-extractor falhou:', err.message);
      return { text: '', method: 'word-extractor-failed' };
    }
  }
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value || '', method: 'mammoth' };
}

// ── Upload GCS (com retry para erros de concorrência) ──
async function uploadToGCS(buffer, gcsPath, mimeType) {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) throw new Error('GCS_BUCKET_NAME não configurada');
  const bucket = admin.storage().bucket(bucketName);
  const file = bucket.file(gcsPath);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await file.save(buffer, { metadata: { contentType: mimeType } });
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

// ── processQueueItem ──
async function processQueueItem(db, itemId) {
  const queueRef = db.collection('file_processing_queue').doc(itemId);
  const itemDoc = await queueRef.get();
  if (!itemDoc.exists) throw new Error(`Item ${itemId} não encontrado`);

  const item = itemDoc.data();

  // status já foi setado para 'processing' pela transação em processNextItem

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

    if (!mediaUrl) {
      // Marcar como erro permanente para não travar a fila retentando infinitamente
      await queueRef.update({
        status: 'error',
        error: 'mediaUrl não encontrada no webhook',
        processedAt: new Date().toISOString(),
      });
      return { success: false, extractedText: '', processingMethod: 'skipped-no-url' };
    }

    // Download
    console.log(`Baixando: ${mediaUrl}`);
    let mediaResponse = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 60000 });
    let mediaBuffer = Buffer.from(mediaResponse.data);

    // Webhook.site retorna HTML com meta refresh ao invés de redirect direto
    if (mediaBuffer.length > 0 && mediaBuffer[0] === 0x3C) {
      const htmlContent = mediaBuffer.toString('utf8', 0, Math.min(mediaBuffer.length, 2000));
      const metaMatch = htmlContent.match(/url='([^']+)'/i) || htmlContent.match(/url="([^"]+)"/i);
      if (metaMatch && metaMatch[1]) {
        console.log(`Redirect detectado → ${metaMatch[1].substring(0, 80)}`);
        mediaResponse = await axios.get(metaMatch[1], { responseType: 'arraybuffer', timeout: 60000 });
        mediaBuffer = Buffer.from(mediaResponse.data);
      }
    }

    // Detectar mime type por magic bytes quando mime está ausente ou genérico
    let mimeType = item.mediaMimeType || '';
    if ((!mimeType || mimeType === 'application/octet-stream') && mediaBuffer.length >= 4) {
      const h = mediaBuffer.slice(0, 4);
      if (h[0] === 0xFF && h[1] === 0xD8) mimeType = 'image/jpeg';
      else if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47) mimeType = 'image/png';
      else if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) mimeType = 'image/gif';
      else if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) mimeType = 'application/pdf';
      else if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46) mimeType = 'image/webp';
      else if (h[0] === 0x50 && h[1] === 0x4B && h[2] === 0x03 && h[3] === 0x04) mimeType = 'application/zip';
      else if (h[0] === 0xD0 && h[1] === 0xCF) mimeType = 'application/msword';
      else if (h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) mimeType = 'audio/mpeg';
      if (mimeType && mimeType !== item.mediaMimeType) console.log(`Mime detectado por magic bytes: ${mimeType}`);
    }

    // Corrigir mediaType baseado no mime real (magic bytes > classificação do webhook)
    let mediaType = item.mediaType;
    const mLower = mimeType.toLowerCase();
    if (mLower === 'application/pdf' && mediaType !== 'pdf') {
      console.log(`Tipo corrigido: ${mediaType} → pdf`);
      mediaType = 'pdf';
    } else if ((mLower === 'application/zip' || mLower.includes('openxmlformats') || mLower === 'application/msword') && mediaType !== 'docx') {
      console.log(`Tipo corrigido: ${mediaType} → docx`);
      mediaType = 'docx';
    } else if (mLower.startsWith('audio/') && mediaType !== 'audio') {
      console.log(`Tipo corrigido: ${mediaType} → audio`);
      mediaType = 'audio';
    } else if (mLower.startsWith('video/') && mediaType !== 'video') {
      console.log(`Tipo corrigido: ${mediaType} → video`);
      mediaType = 'video';
    } else if (mLower.startsWith('image/') && mediaType !== 'image') {
      console.log(`Tipo corrigido: ${mediaType} → image`);
      mediaType = 'image';
    }

    // Upload GCS primeiro — a URL pública é usada para OCR (evita problemas com redirect)
    let gcsUrl = null, gcsPath = null;
    try {
      gcsPath = `file-processing/${mediaType}/${item.webhookId}/${item.mediaFileName}`;
      gcsUrl = await uploadToGCS(mediaBuffer, gcsPath, mimeType);
    } catch (gcsErr) {
      console.warn('GCS upload falhou (não fatal):', gcsErr.message);
    }

    // URL confiável para OCR: GCS (pública) > mediaUrl original
    const ocrUrl = gcsUrl || mediaUrl;

    // Processar por tipo
    let extractedText = '';
    let processingMethod = '';

    if (mediaType === 'image') {
      extractedText = await ocrWithGoogleVision(ocrUrl);
      processingMethod = 'google-vision-ocr';
    } else if (mediaType === 'audio') {
      extractedText = await transcribeWithAssemblyAI(mediaBuffer);
      processingMethod = 'assemblyai';
    } else if (mediaType === 'pdf') {
      const result = await extractTextFromPDF(mediaBuffer, ocrUrl, uploadToGCS);
      extractedText = result.text;
      processingMethod = result.method;
    } else if (mediaType === 'docx') {
      const result = await extractTextFromDocx(mediaBuffer, item.mediaMimeType);
      extractedText = result.text;
      processingMethod = result.method;
    } else if (mediaType === 'video') {
      processingMethod = 'skipped-video';
    }

    // Se não extraiu texto e não é vídeo, marcar como needs_review ao invés de done
    const finalStatus = (!extractedText || !extractedText.trim()) && mediaType !== 'video'
      ? 'needs_review'
      : 'done';

    await queueRef.update({
      status: finalStatus, extractedText, processingMethod, gcsUrl, gcsPath,
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

// Busca próximo item queued e processa — usa transação para evitar processamento duplicado
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

  // Tentar claim via transação — se outro processo já pegou, tenta o próximo
  let claimedId = null;
  for (const candidate of candidates) {
    const ref = db.collection('file_processing_queue').doc(candidate.id);
    try {
      await db.runTransaction(async (t) => {
        const doc = await t.get(ref);
        if (!doc.exists || doc.data().status !== 'queued') {
          throw new Error('already_claimed');
        }
        t.update(ref, { status: 'processing', lastAttemptAt: new Date().toISOString() });
      });
      claimedId = candidate.id;
      break;
    } catch (err) {
      if (err.message === 'already_claimed') continue;
      throw err;
    }
  }

  if (!claimedId) return { processed: false };

  const result = await processQueueItem(db, claimedId);
  return { processed: true, itemId: claimedId, ...result };
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
