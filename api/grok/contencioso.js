const { loadGrokApiKey, extractTextFromFile, axios } = require('../utils');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  // Extrair texto dos arquivos
  let extractedTexts = [];
  if (downloadedFiles.length > 0) {
    console.log(`📄 Iniciando extração de texto de ${downloadedFiles.length} arquivo(s)...`);
    
    for (let i = 0; i < downloadedFiles.length; i++) {
      const file = downloadedFiles[i];
      console.log(`\n📄 [${i + 1}/${downloadedFiles.length}] Processando arquivo:`);
      console.log(`   - filename: ${file.filename || 'NÃO DEFINIDO'}`);
      console.log(`   - mimeType: ${file.mimeType || 'NÃO DEFINIDO'}`);
      console.log(`   - base64 presente: ${!!file.base64}`);
      
      if (!file.base64) {
        console.error(`❌ Arquivo ${file.filename} não tem base64!`);
        continue;
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
        } else {
          console.warn(`⚠️ Não foi possível extrair texto de ${file.filename} (texto vazio ou null)`);
        }
      } catch (extractErr) {
        console.error(`❌ Erro ao extrair texto de ${file.filename}:`, extractErr.message);
      }
    }
    
    console.log(`\n✅ Extração concluída: ${extractedTexts.length} de ${downloadedFiles.length} arquivo(s) processado(s) com sucesso`);
  }

  // Construir mensagem do usuário
  let userMessageText = contextText;
  
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
  console.log(`📋 Total de arquivos processados: ${extractedTexts.length}`);

  try {
    console.log(`💬 Enviando mensagem para o Grok com ${extractedTexts.length} arquivo(s) processado(s)`);
    
    const estimatedTokens = Math.ceil(userMessageText.length / 4);
    const maxTokens = Math.min(Math.max(estimatedTokens * 2, 2000), 40000);
    
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
    
    return res.json({ 
      answer: answer.trim(),
      payload: {
        model: 'grok-4-fast',
        max_tokens: maxTokens,
        temperature: 0.7,
        stream: false,
      },
      payloadSize: {
        messagesLength: messages.length,
        userMessageLength: userMessageText.length,
        extractedFilesCount: extractedTexts.length,
      },
    });
  } catch (err) {
    console.error('❌ [server] Erro ao chamar Grok:');
    console.error('❌ Status:', err.response?.status);
    console.error('❌ Message:', err.message);
    
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'Erro ao conversar com o Grok',
      details: err.response?.data || err.message,
    });
  }
};
