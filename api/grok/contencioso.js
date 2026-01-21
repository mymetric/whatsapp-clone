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
      console.log(`   - base64 length: ${file.base64 ? file.base64.length : 0} caracteres`);
      
      if (!file.base64) {
        console.error(`❌ Arquivo ${file.filename} não tem base64!`);
        continue;
      }
      
      if (!file.filename) {
        console.warn(`⚠️ Arquivo sem nome, tentando processar mesmo assim...`);
      }
      
      try {
        console.log(`   🔍 Chamando extractTextFromFile para ${file.filename}...`);
        const text = await extractTextFromFile(file);
        console.log(`   📝 Resultado da extração:`, {
          isNull: text === null,
          isUndefined: text === undefined,
          type: typeof text,
          length: text ? text.length : 0,
          trimmedLength: text ? text.trim().length : 0,
          preview: text ? text.substring(0, 200) + '...' : 'N/A'
        });
        
        if (text && text.trim().length > 0) {
          extractedTexts.push({
            filename: file.filename || `arquivo_${i + 1}`,
            text: text,
            size: text.length,
          });
          console.log(`✅ Texto extraído de ${file.filename}: ${text.length} caracteres`);
          console.log(`   📝 Primeiros 300 caracteres: ${text.substring(0, 300)}...`);
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
    if (extractedTexts.length === 0 && downloadedFiles.length > 0) {
      console.error(`❌ ATENÇÃO: Nenhum texto foi extraído dos ${downloadedFiles.length} arquivo(s) enviado(s)!`);
    }
  } else {
    console.log(`ℹ️ Nenhum arquivo para processar (downloadedFiles.length = 0)`);
  }

  // Construir mensagem do usuário com texto extraído dos arquivos
  let userMessageText = contextText;
  
  // Adicionar textos extraídos dos arquivos
  if (extractedTexts.length > 0) {
    console.log(`\n✅✅✅ INCLUINDO TEXTO EXTRAÍDO NA MENSAGEM AO GROK ✅✅✅`);
    console.log(`   Total de textos extraídos: ${extractedTexts.length}`);
    extractedTexts.forEach((extracted, index) => {
      console.log(`   [${index + 1}] ${extracted.filename}: ${extracted.size} caracteres`);
    });
    
    userMessageText += `\n\n=== CONTEÚDO DOS ANEXOS ===\n\n`;
    
    extractedTexts.forEach((extracted, index) => {
      userMessageText += `\n--- Anexo ${index + 1}: ${extracted.filename} ---\n`;
      userMessageText += extracted.text;
      userMessageText += `\n\n`;
    });
    
    userMessageText += `=== FIM DOS ANEXOS ===\n\n`;
    
    // Verificar se o texto foi realmente incluído
    const totalExtractedChars = extractedTexts.reduce((sum, et) => sum + et.size, 0);
    console.log(`   ✅ Total de caracteres de texto extraído incluído: ${totalExtractedChars}`);
    console.log(`   ✅ Mensagem agora tem ${userMessageText.length} caracteres (antes: ${contextText.length})`);
  } else if (downloadedFiles.length > 0) {
    // Se arquivos foram enviados mas nenhum texto foi extraído, avisar
    console.log(`\n⚠️⚠️⚠️ ATENÇÃO: NENHUM TEXTO FOI EXTRAÍDO DOS ARQUIVOS ⚠️⚠️⚠️`);
    console.log(`   Arquivos recebidos: ${downloadedFiles.length}`);
    console.log(`   Textos extraídos: ${extractedTexts.length}`);
    
    userMessageText += `\n\n⚠️ ATENÇÃO: ${downloadedFiles.length} arquivo(s) foram enviado(s), mas não foi possível extrair texto deles. `;
    userMessageText += `Isso pode acontecer se os arquivos forem imagens escaneadas, formatos não suportados, ou arquivos corrompidos.\n\n`;
  }
  
  userMessageText += `Pergunta do usuário: ${question}`;
  
  messages.push({ role: 'user', content: userMessageText });
  
  console.log(`\n📋 ========== MENSAGEM FINAL ENVIADA AO GROK ==========`);
  console.log(`📋 Tamanho total: ${userMessageText.length} caracteres`);
  console.log(`📋 Total de arquivos processados com texto: ${extractedTexts.length}`);
  console.log(`📋 Primeiros 1000 caracteres:`);
  console.log(userMessageText.substring(0, 1000));
  console.log(`\n📋 Verificando se contém "=== CONTEÚDO DOS ANEXOS ===": ${userMessageText.includes('=== CONTEÚDO DOS ANEXOS ===') ? '✅ SIM' : '❌ NÃO'}`);
  if (extractedTexts.length > 0) {
    console.log(`📋 Verificando se contém texto do primeiro anexo (primeiros 50 chars): ${userMessageText.includes(extractedTexts[0].text.substring(0, 50)) ? '✅ SIM' : '❌ NÃO'}`);
  }
  console.log(`📋 ====================================================\n`);

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
    
    // Verificar se o texto foi incluído na mensagem
    const hasExtractedText = extractedTexts.length > 0;
    const messageContainsExtractedText = hasExtractedText && userMessageText.includes('=== CONTEÚDO DOS ANEXOS ===');
    
    console.log(`\n✅✅✅ RESPOSTA DO GROK RECEBIDA ✅✅✅`);
    console.log(`   Texto extraído incluído na mensagem: ${messageContainsExtractedText ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`   Total de textos extraídos: ${extractedTexts.length}`);
    console.log(`   Tamanho da mensagem enviada: ${userMessageText.length} caracteres`);
    
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
        totalFilesReceived: downloadedFiles.length,
        extractedTextsSummary: extractedTexts.map(et => ({
          filename: et.filename,
          size: et.size,
          preview: et.text.substring(0, 200) + '...'
        })),
        // Informações de verificação
        textExtractionStatus: {
          filesReceived: downloadedFiles.length,
          textsExtracted: extractedTexts.length,
          textIncludedInMessage: messageContainsExtractedText,
          totalExtractedChars: extractedTexts.reduce((sum, et) => sum + et.size, 0),
          messageContainsMarker: userMessageText.includes('=== CONTEÚDO DOS ANEXOS ===')
        }
      },
      fullUserMessage: userMessageText // Mensagem completa para análise/debug
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
