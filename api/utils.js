const axios = require('axios');
const pdf = require('pdf-parse');

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
        const result = await pdf(fileBuffer);
        const extractedText = result.text || '';
        console.log(`✅ PDF processado: ${extractedText.length} caracteres extraídos`);
        if (extractedText.length === 0) {
          console.warn(`⚠️ PDF ${file.filename} não contém texto extraível (pode ser imagem escaneada)`);
        }
        return extractedText;
      } catch (pdfError) {
        console.error(`❌ Erro ao processar PDF ${file.filename}:`, pdfError.message);
        return null;
      }
    }
    
    // Texto simples
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
      const controlChars = (text.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g) || []).length;
      if (controlChars < text.length * 0.1) {
        console.log(`✅ Texto extraído (fallback): ${text.length} caracteres`);
        return text;
      } else {
        console.warn(`⚠️ Arquivo ${file.filename} não parece ser texto válido`);
        return null;
      }
    } catch (fallbackError) {
      console.error(`❌ Erro no fallback para ${file.filename}:`, fallbackError.message);
    }
    
    console.warn(`⚠️ Tipo de arquivo não suportado para extração de texto: ${mimeType} - ${file.filename}`);
    return null;
  } catch (error) {
    console.error(`❌ Erro geral ao extrair texto de ${file.filename}:`, error.message);
    return null;
  }
}

module.exports = {
  loadMondayApiKey,
  loadGrokApiKey,
  extractTextFromFile,
  axios
};
