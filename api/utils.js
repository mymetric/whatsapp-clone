let axios;
let pdf = null;

try {
  axios = require('axios');
} catch (error) {
  console.error('❌ Erro ao carregar axios:', error);
}

try {
  pdf = require('pdf-parse');
} catch (error) {
  console.warn('⚠️ pdf-parse não pôde ser carregado (funcionalidade de PDF limitada):', error.message);
}

function loadMondayApiKey() {
  const apiKey = process.env.MONDAY_API_KEY;
  if (!apiKey) {
    console.error('❌ Monday: MONDAY_API_KEY não encontrada');
    console.error('❌ Variáveis de ambiente disponíveis:', Object.keys(process.env).filter(k => k.includes('MONDAY')));
    return null;
  }
  console.log('✅ MONDAY_API_KEY encontrada (length:', apiKey.length, ')');
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
    // Validações iniciais
    if (!file) {
      console.error(`❌ extractTextFromFile: file é null ou undefined`);
      return null;
    }
    
    if (!file.base64) {
      console.error(`❌ extractTextFromFile: file.base64 não está presente`);
      return null;
    }
    
    if (typeof file.base64 !== 'string') {
      console.error(`❌ extractTextFromFile: file.base64 não é uma string (tipo: ${typeof file.base64})`);
      return null;
    }
    
    const fileBuffer = Buffer.from(file.base64, 'base64');
    const mimeType = (file.mimeType || '').toLowerCase();
    const filename = (file.filename || '').toLowerCase();
    
    console.log(`🔍 [extractTextFromFile] Tentando extrair texto:`);
    console.log(`   - filename: "${file.filename}"`);
    console.log(`   - mimeType: "${file.mimeType}"`);
    console.log(`   - base64 length: ${file.base64.length} caracteres`);
    console.log(`   - buffer size: ${fileBuffer.length} bytes`);
    
    // PDF - verificar por MIME type ou extensão
    if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
      console.log(`📄 Detectado como PDF: ${file.filename}`);

      if (!pdf) {
        console.warn('⚠️ pdf-parse não está disponível. Pulando extração de PDF.');
        return null;
      }

      try {
        const result = await pdf(fileBuffer);
        const extractedText = result.text || '';
        console.log(`✅ [extractTextFromFile] PDF processado: ${extractedText.length} caracteres extraídos`);
        if (extractedText.length === 0) {
          console.warn(`⚠️ [extractTextFromFile] PDF ${file.filename} não contém texto extraível (pode ser imagem escaneada)`);
        } else {
          console.log(`📝 [extractTextFromFile] Primeiros 200 caracteres: ${extractedText.substring(0, 200)}...`);
        }
        return extractedText;
      } catch (pdfError) {
        console.error(`❌ [extractTextFromFile] Erro ao processar PDF ${file.filename}:`, pdfError.message);
        console.error(`❌ [extractTextFromFile] Stack:`, pdfError.stack);
        return null;
      }
    }
    
    // Texto simples
    if (mimeType.startsWith('text/') || 
        filename.match(/\.(txt|md|json|csv|log|xml|html|htm)$/)) {
      console.log(`📄 [extractTextFromFile] Detectado como arquivo de texto: ${file.filename}`);
      try {
        const text = fileBuffer.toString('utf-8');
        console.log(`✅ [extractTextFromFile] Texto extraído: ${text.length} caracteres`);
        console.log(`📝 [extractTextFromFile] Primeiros 200 caracteres: ${text.substring(0, 200)}...`);
        return text;
      } catch (textError) {
        console.error(`❌ [extractTextFromFile] Erro ao ler arquivo de texto ${file.filename}:`, textError.message);
        console.error(`❌ [extractTextFromFile] Stack:`, textError.stack);
        return null;
      }
    }
    
    // Tentar como texto UTF-8 se não for reconhecido (fallback)
    console.log(`⚠️ [extractTextFromFile] Tipo não reconhecido (${mimeType}), tentando como texto UTF-8...`);
    try {
      const text = fileBuffer.toString('utf-8');
      const controlChars = (text.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g) || []).length;
      const controlCharRatio = controlChars / text.length;
      console.log(`   - Total caracteres: ${text.length}`);
      console.log(`   - Caracteres de controle: ${controlChars} (${(controlCharRatio * 100).toFixed(2)}%)`);
      
      if (controlCharRatio < 0.1) {
        console.log(`✅ [extractTextFromFile] Texto extraído (fallback): ${text.length} caracteres`);
        console.log(`📝 [extractTextFromFile] Primeiros 200 caracteres: ${text.substring(0, 200)}...`);
        return text;
      } else {
        console.warn(`⚠️ [extractTextFromFile] Arquivo ${file.filename} não parece ser texto válido (muitos caracteres de controle)`);
        return null;
      }
    } catch (fallbackError) {
      console.error(`❌ [extractTextFromFile] Erro no fallback para ${file.filename}:`, fallbackError.message);
      console.error(`❌ [extractTextFromFile] Stack:`, fallbackError.stack);
    }
    
    console.warn(`⚠️ [extractTextFromFile] Tipo de arquivo não suportado para extração de texto: ${mimeType} - ${file.filename}`);
    return null;
  } catch (error) {
    console.error(`❌ [extractTextFromFile] Erro geral ao extrair texto de ${file.filename || 'arquivo desconhecido'}:`, error.message);
    console.error(`❌ [extractTextFromFile] Stack:`, error.stack);
    return null;
  }
}

module.exports = {
  loadMondayApiKey,
  loadGrokApiKey,
  extractTextFromFile,
  axios
};
