import { MondayBoardItem, MondayColumn, MondayUpdate, mondayService } from './mondayService';
import { FirestoreMessage } from './firestoreMessagesService';
import { DocumentAnalysis } from './api';
import { DocumentRecord } from '../types';

// ============================================================================
// Types
// ============================================================================

type SectionType =
  | 'lead_profile'
  | 'document_analysis'
  | 'whatsapp_recent'
  | 'monday_updates'
  | 'emails'
  | 'whatsapp_history'
  | 'documents'
  | 'processed_files';

interface ContextSection {
  id: string;
  type: SectionType;
  priority: number; // 1 (highest) to 5 (lowest)
  content: string;
  charCount: number;
}

type UseCase = 'whatsapp_response' | 'copilot' | 'document_analysis';

interface FreshData {
  messages: FirestoreMessage[];
  docs: DocumentRecord[];
  analysis: DocumentAnalysis | null;
  files: Array<{ id: string; fileName: string; mediaType: string; extractedText: string; processedAt: string }>;
  emails: any[];
  mondayUpdates: MondayUpdate[];
}

interface StateData {
  whatsappMessages: FirestoreMessage[];
  updates: MondayUpdate[];
  documentAnalysis: DocumentAnalysis | null;
  leadEmails: any[];
  leadDocuments: DocumentRecord[];
  processedFiles: Array<{ id: string; fileName: string; mediaType: string; extractedText: string; processedAt: string }>;
}

// ============================================================================
// Factual pattern detection
// ============================================================================

const FACTUAL_PATTERNS = [
  /R\$\s*[\d.,]+/,                           // Monetary values
  /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/,            // CPF
  /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/,    // CNPJ
  /\d{1,2}\/\d{1,2}\/\d{2,4}/,               // Dates
  /prazo|vencimento|deadline/i,               // Deadlines
  /processo\s*n[°o]?\s*[\d.\-/]+/i,           // Legal processes
  /contrato|acordo|termo/i,                   // Contracts
  /pagamento|parcela|boleto|pix/i,            // Payments
  /endere[cç]o|cep|rua|avenida/i,            // Addresses
  /cpf|cnpj|rg|oab/i,                        // Document identifiers
];

const DECISION_KEYWORDS = /\b(sim|não|nao|confirmo|aceito|recuso|cancelo|concordo|discordo|aprovado|negado)\b/i;

function hasFactualContent(text: string): boolean {
  return FACTUAL_PATTERNS.some(p => p.test(text));
}

function hasDecisionContent(text: string): boolean {
  return DECISION_KEYWORDS.test(text);
}

function isQuestion(text: string): boolean {
  return text.includes('?');
}

function hasNumbersOrValues(text: string): boolean {
  return /R\$\s*[\d.,]+|\d{2}\/\d{2}\/\d{2,4}|\d{3,}/.test(text);
}

function extractFactualLines(text: string): string[] {
  return text.split('\n').filter(line => line.trim() && hasFactualContent(line));
}

// ============================================================================
// Email chain detection & signature removal
// ============================================================================

const EMAIL_CHAIN_PATTERN = /^(Em|On|De:)\s+\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}.*escreveu:?/im;
const SIGNATURE_PATTERNS = [
  /^--\s*$/m,
  /^_{3,}/m,
  /^Att,?\s*$/im,
  /^Atenciosamente,?\s*$/im,
  /^Enviado d[eo] meu (iPhone|Android|celular)/im,
  /^Sent from my/im,
];

function removeEmailChain(text: string): string {
  const match = EMAIL_CHAIN_PATTERN.exec(text);
  if (match) {
    return text.substring(0, match.index).trim();
  }
  return text;
}

function removeSignature(text: string): string {
  let result = text;
  for (const pattern of SIGNATURE_PATTERNS) {
    const match = pattern.exec(result);
    if (match && match.index > result.length * 0.3) {
      result = result.substring(0, match.index).trim();
      break;
    }
  }
  return result;
}

// ============================================================================
// Compression functions
// ============================================================================

function compressWhatsAppHistory(
  messages: FirestoreMessage[],
  recentCount: number
): { recent: string; history: string } {
  if (messages.length === 0) return { recent: '', history: '' };

  const recentMsgs = messages.slice(-recentCount);
  const olderMsgs = messages.slice(0, -recentCount);

  // Recent messages: verbatim
  let recent = '';
  if (recentMsgs.length > 0) {
    recent = `\n## Últimas ${recentMsgs.length} Mensagens WhatsApp (recentes):\n`;
    recentMsgs.forEach((msg, idx) => {
      const sender = msg.source === 'Contact' ? 'Cliente' : 'Atendente';
      const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString('pt-BR') : '';
      recent += `${idx + 1}. [${time}] ${sender}: ${msg.content}\n`;
    });
  }

  // Older messages: compressed by day
  let history = '';
  if (olderMsgs.length > 0) {
    const dayGroups = new Map<string, FirestoreMessage[]>();
    for (const msg of olderMsgs) {
      const day = msg.timestamp
        ? new Date(msg.timestamp).toLocaleDateString('pt-BR')
        : 'Data desconhecida';
      if (!dayGroups.has(day)) dayGroups.set(day, []);
      dayGroups.get(day)!.push(msg);
    }

    history = `\n## Histórico de Mensagens WhatsApp (${olderMsgs.length} mensagens anteriores, compactado):\n`;

    for (const [day, dayMsgs] of Array.from(dayGroups.entries())) {
      const kept: string[] = [];
      const omittedCount = { value: 0 };

      for (let i = 0; i < dayMsgs.length; i++) {
        const msg = dayMsgs[i];
        const isFirst = i === 0;
        const isLast = i === dayMsgs.length - 1;
        const content = msg.content || '';

        const shouldKeep = isFirst || isLast ||
          isQuestion(content) ||
          hasNumbersOrValues(content) ||
          hasDecisionContent(content) ||
          hasFactualContent(content);

        if (shouldKeep) {
          if (omittedCount.value > 0) {
            kept.push(`  [...${omittedCount.value} mensagens de rotina omitidas...]`);
            omittedCount.value = 0;
          }
          const sender = msg.source === 'Contact' ? 'Cliente' : 'Atendente';
          kept.push(`  ${sender}: ${content}`);
        } else {
          omittedCount.value++;
        }
      }
      if (omittedCount.value > 0) {
        kept.push(`  [...${omittedCount.value} mensagens de rotina omitidas...]`);
      }

      history += `\n[${day}] (${dayMsgs.length} msgs):\n${kept.join('\n')}\n`;
    }
  }

  return { recent, history };
}

function compressEmails(emails: any[]): string {
  if (emails.length === 0) return '';

  const RECENT_FULL = 3;
  let section = `\n## Emails (${emails.length} encontrados):\n`;

  // Sort by date descending (most recent first)
  const sorted = [...emails].sort((a, b) => {
    const dateA = new Date(a.date || a.timestamp || 0).getTime();
    const dateB = new Date(b.date || b.timestamp || 0).getTime();
    return dateB - dateA;
  });

  sorted.forEach((email, idx) => {
    const isRecent = idx < RECENT_FULL;

    section += `\n### Email ${idx + 1}: ${email.subject || 'Sem assunto'}\n`;
    if (email.from) section += `De: ${email.from}\n`;
    if (email.to) section += `Para: ${email.to}\n`;
    if (email.date || email.timestamp) section += `Data: ${email.date || email.timestamp}\n`;
    if (email.direction) section += `Direção: ${email.direction === 'sent' ? 'Enviado' : 'Recebido'}\n`;

    if (email.text) {
      if (isRecent) {
        // Recent: full text but remove chains and signatures
        let cleanedText = removeEmailChain(email.text);
        cleanedText = removeSignature(cleanedText);
        section += `Conteúdo:\n${cleanedText}\n`;
      } else {
        // Older: first paragraph + factual lines
        const noChain = removeEmailChain(email.text);
        const noSig = removeSignature(noChain);
        const paragraphs = noSig.split(/\n\s*\n/);
        const firstParagraph = paragraphs[0] || '';
        const factualLines = extractFactualLines(noSig);
        const factualNotInFirst = factualLines.filter(l => !firstParagraph.includes(l));

        section += `Conteúdo (resumido):\n${firstParagraph}\n`;
        if (factualNotInFirst.length > 0) {
          section += `[Dados relevantes]: ${factualNotInFirst.join(' | ')}\n`;
        }
      }
    }
  });

  return section;
}

function compressDocuments(docs: DocumentRecord[]): string {
  if (docs.length === 0) return '';

  const DOC_CAP = 3000;
  let section = `\n## Documentos do Lead (${docs.length} documentos):\n`;

  docs.forEach((doc, idx) => {
    const origin = doc.origin === 'email' ? 'Email' : 'Telefone';
    const direction = doc.direction === 'sent' ? 'Enviado' : 'Recebido';
    const subject = doc.metadata?.subject || 'Sem assunto';
    let docContent = `\n### Documento ${idx + 1} (${origin} - ${direction}):\n`;
    docContent += `- Assunto: ${subject}\n`;

    if (doc.text) {
      const preview = doc.text.substring(0, 500);
      const factualLines = extractFactualLines(doc.text);
      const factualNotInPreview = factualLines.filter(l => !preview.includes(l));

      docContent += `- Conteúdo (preview): ${preview}\n`;
      if (factualNotInPreview.length > 0) {
        docContent += `- [Dados relevantes]: ${factualNotInPreview.slice(0, 20).join(' | ')}\n`;
      }
    }
    if (doc.images && doc.images.length > 0) {
      doc.images.forEach((img, imgIdx) => {
        if (img.extractedText) {
          const imgPreview = img.extractedText.substring(0, 500);
          const imgFactual = extractFactualLines(img.extractedText);
          const imgFactualNotInPreview = imgFactual.filter(l => !imgPreview.includes(l));

          docContent += `- Arquivo ${imgIdx + 1} (transcrição preview): ${imgPreview}\n`;
          if (imgFactualNotInPreview.length > 0) {
            docContent += `- [Dados relevantes do arquivo ${imgIdx + 1}]: ${imgFactualNotInPreview.slice(0, 10).join(' | ')}\n`;
          }
        }
      });
    }

    // Cap each document
    if (docContent.length > DOC_CAP) {
      docContent = docContent.substring(0, DOC_CAP) + '\n...[documento compactado]\n';
    }
    section += docContent;
  });

  return section;
}

function compressProcessedFiles(
  files: Array<{ id: string; fileName: string; mediaType: string; extractedText: string; processedAt: string }>
): string {
  if (files.length === 0) return '';

  const FILE_CAP = 5000;
  const SECTION_CAP = 15000;
  let section = `\n## Arquivos Processados (${files.length} arquivo(s)):\n`;

  for (const f of files) {
    let fileContent = `\n### Arquivo: ${f.fileName || 'sem nome'} (${f.mediaType})\n`;

    if (f.extractedText) {
      const preview = f.extractedText.substring(0, 1000);
      const factualLines = extractFactualLines(f.extractedText);
      const factualNotInPreview = factualLines.filter(l => !preview.includes(l));

      fileContent += preview + '\n';
      if (factualNotInPreview.length > 0) {
        fileContent += `[Dados relevantes]: ${factualNotInPreview.slice(0, 15).join(' | ')}\n`;
      }
    }

    if (fileContent.length > FILE_CAP) {
      fileContent = fileContent.substring(0, FILE_CAP) + '\n...[arquivo compactado]\n';
    }
    section += fileContent;

    if (section.length > SECTION_CAP) {
      section = section.substring(0, SECTION_CAP) + '\n...[seção de arquivos compactada]\n';
      break;
    }
  }

  return section;
}

function compressMondayUpdates(updates: MondayUpdate[]): string {
  if (updates.length === 0) return '';

  const RECENT_FULL = 5;
  let section = `\n## Updates do Monday (${updates.length}):\n`;

  // Sort by date descending (most recent first)
  const sorted = [...updates].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  sorted.forEach((update, idx) => {
    const creator = update.creator?.name || 'Desconhecido';
    const date = mondayService.formatDate(update.created_at);
    const body = mondayService.formatUpdateBody(update.body);

    if (idx < RECENT_FULL) {
      // Recent updates: full content
      section += `${idx + 1}. [${date}] ${creator}: ${body}\n`;
    } else {
      // Older updates: abbreviated - first 200 chars + factual lines
      const preview = body.substring(0, 200);
      const factualLines = extractFactualLines(body);
      const factualNotInPreview = factualLines.filter(l => !preview.includes(l));

      section += `${idx + 1}. [${date}] ${creator}: ${preview}`;
      if (body.length > 200) section += '...';
      section += '\n';
      if (factualNotInPreview.length > 0) {
        section += `   [Dados]: ${factualNotInPreview.slice(0, 5).join(' | ')}\n`;
      }
    }
  });

  return section;
}

// ============================================================================
// Lead profile builder (never compressed)
// ============================================================================

function buildLeadProfile(item: MondayBoardItem, columns: MondayColumn[]): string {
  let leadInfo = `## Dados do Lead:\n`;
  leadInfo += `- Nome: ${item.name || 'Não informado'}\n`;
  if (item.column_values) {
    item.column_values.forEach(col => {
      if (col.text && col.text.trim()) {
        const colTitle = columns.find(c => c.id === col.id)?.title || col.id;
        leadInfo += `- ${colTitle}: ${col.text}\n`;
      }
    });
  }
  return leadInfo;
}

function buildDocumentAnalysis(analysis: DocumentAnalysis | null): string {
  if (!analysis) return '';
  let section = `\n## Análise de Documentos do Monday:\n`;
  if (analysis.checklist) {
    section += `### Checklist:\n${analysis.checklist}\n`;
  }
  if (analysis.analise) {
    section += `### Análise:\n${analysis.analise}\n`;
  }
  return section;
}

// ============================================================================
// Budget allocation & assembly
// ============================================================================

interface BudgetConfig {
  total: number;
  recentMessageCount: number;
  excludeRecentMessages: number; // messages to exclude from context (sent separately)
  docBudgetRatio: number; // ratio of budget for docs (for document_analysis use case)
}

function getUseCaseConfig(useCase: UseCase): BudgetConfig {
  switch (useCase) {
    case 'whatsapp_response':
      return { total: 300000, recentMessageCount: 20, excludeRecentMessages: 10, docBudgetRatio: 0.3 };
    case 'copilot':
      return { total: 310000, recentMessageCount: 20, excludeRecentMessages: 0, docBudgetRatio: 0.3 };
    case 'document_analysis':
      return { total: 300000, recentMessageCount: 10, excludeRecentMessages: 0, docBudgetRatio: 0.7 };
  }
}

function buildCompactedContext(
  data: FreshData | undefined,
  item: MondayBoardItem,
  columns: MondayColumn[],
  useCase: UseCase,
  stateData?: StateData
): string {
  // Resolve data sources
  const msgs = data?.messages ?? stateData?.whatsappMessages ?? [];
  const mondayUpdates = data?.mondayUpdates ?? stateData?.updates ?? [];
  const docAnalysis = data?.analysis ?? stateData?.documentAnalysis ?? null;
  const emails = data?.emails ?? stateData?.leadEmails ?? [];
  const docs = data?.docs ?? stateData?.leadDocuments ?? [];
  const files = data?.files ?? stateData?.processedFiles ?? [];

  const config = getUseCaseConfig(useCase);

  // For whatsapp_response, exclude last N messages (they go as conversationHistory)
  const contextMsgs = config.excludeRecentMessages > 0 && msgs.length > config.excludeRecentMessages
    ? msgs.slice(0, -config.excludeRecentMessages)
    : msgs;

  // ---- Build all raw sections to check total size ----
  const leadProfile = buildLeadProfile(item, columns);
  const docAnalysisSection = buildDocumentAnalysis(docAnalysis);

  // Quick check: if total raw data is small, skip compression
  const rawTotal = estimateRawSize(leadProfile, contextMsgs, mondayUpdates, docAnalysis, emails, docs, files);
  if (rawTotal < 30000) {
    return buildUncompressedContext(leadProfile, contextMsgs, mondayUpdates, docAnalysisSection, emails, docs, files);
  }

  // ---- Tier 1: never compressed ----
  const tier1 = leadProfile + docAnalysisSection;
  let remaining = config.total - tier1.length;

  // ---- Tier 2: recent messages verbatim ----
  const { recent: recentSection, history: historySection } = compressWhatsAppHistory(contextMsgs, config.recentMessageCount);
  const tier2 = recentSection;
  remaining -= tier2.length;

  // ---- Tier 3: monday updates + emails (up to 40% of remaining) ----
  const tier3Budget = Math.floor(remaining * 0.4);
  const updatesSection = compressMondayUpdates(mondayUpdates);
  const emailsSection = compressEmails(emails);
  const tier3Raw = updatesSection + emailsSection;
  let tier3: string;
  if (tier3Raw.length <= tier3Budget) {
    tier3 = tier3Raw;
  } else {
    // Proportional allocation
    const updatesRatio = updatesSection.length / (tier3Raw.length || 1);
    const updatesBudget = Math.floor(tier3Budget * updatesRatio);
    const emailsBudget = tier3Budget - updatesBudget;
    tier3 = truncateSection(updatesSection, updatesBudget) + truncateSection(emailsSection, emailsBudget);
  }
  remaining -= tier3.length;

  // ---- Tier 4: whatsapp history + documents (up to 70% of remaining) ----
  const tier4Budget = Math.floor(remaining * 0.7);
  const docsSection = compressDocuments(docs);

  let tier4Raw: string;
  let tier4: string;

  if (useCase === 'document_analysis') {
    // Documents get priority in document_analysis mode
    const docBudget = Math.floor(tier4Budget * config.docBudgetRatio);
    const histBudget = tier4Budget - docBudget;
    tier4 = truncateSection(docsSection, docBudget) + truncateSection(historySection, histBudget);
  } else {
    tier4Raw = historySection + docsSection;
    if (tier4Raw.length <= tier4Budget) {
      tier4 = tier4Raw;
    } else {
      const historyRatio = historySection.length / (tier4Raw.length || 1);
      const historyBudget = Math.floor(tier4Budget * historyRatio);
      const docsBudget = tier4Budget - historyBudget;
      tier4 = truncateSection(historySection, historyBudget) + truncateSection(docsSection, docsBudget);
    }
  }
  remaining -= tier4.length;

  // ---- Tier 5: processed files (fill remaining) ----
  const filesSection = compressProcessedFiles(files);
  const tier5 = truncateSection(filesSection, Math.max(0, remaining));

  const result = tier1 + tier2 + tier3 + tier4 + tier5;

  console.log(`[ContextCompaction] useCase=${useCase} | raw~${rawTotal} chars | compacted=${result.length} chars | msgs=${msgs.length} emails=${emails.length} docs=${docs.length} files=${files.length}`);

  return result;
}

// ============================================================================
// Helpers
// ============================================================================

function truncateSection(section: string, maxChars: number): string {
  if (!section || section.length <= maxChars) return section;
  if (maxChars <= 0) return '';
  return section.substring(0, maxChars) + '\n...[seção compactada por limite de budget]\n';
}

function estimateRawSize(
  leadProfile: string,
  msgs: FirestoreMessage[],
  updates: MondayUpdate[],
  docAnalysis: DocumentAnalysis | null,
  emails: any[],
  docs: DocumentRecord[],
  files: Array<{ extractedText: string }>
): number {
  let size = leadProfile.length;
  for (const m of msgs) size += (m.content?.length || 0) + 50;
  for (const u of updates) size += (u.body?.length || 0) + 50;
  if (docAnalysis) size += (docAnalysis.checklist?.length || 0) + (docAnalysis.analise?.length || 0);
  for (const e of emails) size += (e.text?.length || 0) + 100;
  for (const d of docs) {
    size += (d.text?.length || 0) + 100;
    if (d.images) for (const img of d.images) size += (img.extractedText?.length || 0);
  }
  for (const f of files) size += (f.extractedText?.length || 0) + 50;
  return size;
}

function buildUncompressedContext(
  leadProfile: string,
  msgs: FirestoreMessage[],
  updates: MondayUpdate[],
  docAnalysisSection: string,
  emails: any[],
  docs: DocumentRecord[],
  files: Array<{ id: string; fileName: string; mediaType: string; extractedText: string; processedAt: string }>
): string {
  const sections: string[] = [leadProfile];

  if (msgs.length > 0) {
    let msgSection = `\n## Histórico de Conversa WhatsApp (${msgs.length} mensagens):\n`;
    msgs.forEach((msg, idx) => {
      const sender = msg.source === 'Contact' ? 'Cliente' : 'Atendente';
      const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString('pt-BR') : '';
      msgSection += `${idx + 1}. [${time}] ${sender}: ${msg.content}\n`;
    });
    sections.push(msgSection);
  }

  if (updates.length > 0) {
    let updatesSection = `\n## Updates do Monday (${updates.length}):\n`;
    updates.forEach((update, idx) => {
      const creator = update.creator?.name || 'Desconhecido';
      const date = mondayService.formatDate(update.created_at);
      const body = mondayService.formatUpdateBody(update.body);
      updatesSection += `${idx + 1}. [${date}] ${creator}: ${body}\n`;
    });
    sections.push(updatesSection);
  }

  if (docAnalysisSection) sections.push(docAnalysisSection);

  if (emails.length > 0) {
    let emailSection = `\n## Emails (${emails.length} encontrados):\n`;
    emails.forEach((email, idx) => {
      emailSection += `\n### Email ${idx + 1}: ${email.subject || 'Sem assunto'}\n`;
      if (email.from) emailSection += `De: ${email.from}\n`;
      if (email.to) emailSection += `Para: ${email.to}\n`;
      if (email.date || email.timestamp) emailSection += `Data: ${email.date || email.timestamp}\n`;
      if (email.direction) emailSection += `Direção: ${email.direction === 'sent' ? 'Enviado' : 'Recebido'}\n`;
      if (email.text) emailSection += `Conteúdo:\n${email.text}\n`;
    });
    sections.push(emailSection);
  }

  if (docs.length > 0) {
    let docSection = `\n## Documentos do Lead (${docs.length} documentos):\n`;
    docs.forEach((doc, idx) => {
      const origin = doc.origin === 'email' ? 'Email' : 'Telefone';
      const direction = doc.direction === 'sent' ? 'Enviado' : 'Recebido';
      const subject = doc.metadata?.subject || 'Sem assunto';
      docSection += `\n### Documento ${idx + 1} (${origin} - ${direction}):\n`;
      docSection += `- Assunto: ${subject}\n`;
      if (doc.text) docSection += `- Conteúdo: ${doc.text}\n`;
      if (doc.images && doc.images.length > 0) {
        doc.images.forEach((img, imgIdx) => {
          if (img.extractedText) docSection += `- Arquivo ${imgIdx + 1} (transcrição): ${img.extractedText}\n`;
        });
      }
    });
    sections.push(docSection);
  }

  if (files.length > 0) {
    let fileSection = `\n## Arquivos Processados (${files.length} arquivo(s)):\n`;
    files.forEach((f, idx) => {
      fileSection += `\n### Arquivo ${idx + 1}: ${f.fileName || 'sem nome'} (${f.mediaType})\n${f.extractedText}\n`;
    });
    sections.push(fileSection);
  }

  return sections.join('\n');
}

// ============================================================================
// Export
// ============================================================================

export const contextCompactionService = {
  buildCompactedContext,
};

export type { UseCase, FreshData as CompactionFreshData };
