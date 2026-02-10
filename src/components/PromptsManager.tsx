import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { promptService, Prompt, PromptTreeNode } from '../services/api';
import './PromptsManager.css';

interface PromptsManagerProps {
  onClose?: () => void;
}

const emptyPrompt: Omit<Prompt, 'id'> = {
  name: '',
  description: '',
  content: '',
  parentId: null,
  order: 0
};

// Função para construir árvore de prompts
const buildPromptTree = (prompts: Prompt[], expandedIds: Set<string>): PromptTreeNode[] => {
  const promptMap = new Map<string, PromptTreeNode>();
  const rootNodes: PromptTreeNode[] = [];

  prompts.forEach(prompt => {
    promptMap.set(prompt.id, {
      ...prompt,
      children: [],
      level: 0,
      expanded: expandedIds.has(prompt.id)
    });
  });

  // Montar estrutura pai-filho (sem calcular levels ainda)
  prompts.forEach(prompt => {
    const node = promptMap.get(prompt.id)!;
    if (prompt.parentId && promptMap.has(prompt.parentId)) {
      const parent = promptMap.get(prompt.parentId)!;
      parent.children.push(node);
    } else {
      rootNodes.push(node);
    }
  });

  // Calcular levels corretamente via DFS (independente da ordem do array)
  const computeLevels = (nodes: PromptTreeNode[], level: number) => {
    nodes.forEach(node => {
      node.level = level;
      if (node.children.length > 0) {
        computeLevels(node.children, level + 1);
      }
    });
  };
  computeLevels(rootNodes, 0);

  const sortChildren = (nodes: PromptTreeNode[]): PromptTreeNode[] => {
    nodes.sort((a, b) => (a.order || 0) - (b.order || 0));
    nodes.forEach(node => {
      if (node.children.length > 0) {
        node.children = sortChildren(node.children);
      }
    });
    return nodes;
  };

  return sortChildren(rootNodes);
};

const flattenTree = (nodes: PromptTreeNode[], expandedIds: Set<string>): PromptTreeNode[] => {
  const result: PromptTreeNode[] = [];
  const traverse = (node: PromptTreeNode) => {
    result.push(node);
    if (expandedIds.has(node.id) && node.children.length > 0) {
      node.children.forEach(traverse);
    }
  };
  nodes.forEach(traverse);
  return result;
};

const isDescendant = (prompts: Prompt[], potentialDescendantId: string, ancestorId: string): boolean => {
  const prompt = prompts.find(p => p.id === potentialDescendantId);
  if (!prompt) return false;
  if (!prompt.parentId) return false;
  if (prompt.parentId === ancestorId) return true;
  return isDescendant(prompts, prompt.parentId, ancestorId);
};

// Obter caminho do prompt (breadcrumb)
const getPromptPath = (prompts: Prompt[], promptId: string): Prompt[] => {
  const promptMap = new Map(prompts.map(p => [p.id, p]));
  const path: Prompt[] = [];
  let currentId: string | null | undefined = promptId;
  while (currentId) {
    const found = promptMap.get(currentId);
    if (!found) break;
    path.unshift(found);
    currentId = found.parentId;
  }
  return path;
};

// Calcular nível de indentação para o dropdown
const getPromptLevel = (prompts: Prompt[], promptId: string): number => {
  const promptMap = new Map(prompts.map(p => [p.id, p]));
  let level = 0;
  let currentId: string | null | undefined = promptId;
  while (currentId) {
    const found = promptMap.get(currentId);
    if (!found?.parentId) break;
    level++;
    currentId = found.parentId;
  }
  return level;
};

const PromptsManager: React.FC<PromptsManagerProps> = ({ onClose }) => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [form, setForm] = useState<Omit<Prompt, 'id'>>(emptyPrompt);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // JSON Editor states
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [jsonContent, setJsonContent] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonSaving, setJsonSaving] = useState(false);
  const [jsonDirty, setJsonDirty] = useState(false);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);

  const loadPrompts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await promptService.getPrompts();
      setPrompts(data);
      setExpandedIds(new Set(data.map(p => p.id)));
    } catch (err: any) {
      console.error('Erro ao carregar prompts:', err);
      const errorMessage = err?.message || 'Erro desconhecido';
      if (errorMessage.includes('Endpoint /prompts não encontrado') || err?.response?.status === 404) {
        setError('Backend não configurado');
      } else if (errorMessage.includes('Network Error') || errorMessage.includes('Erro de conexão')) {
        setError('Erro de conexão');
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPrompts();
  }, []);

  const promptTree = useMemo(() => buildPromptTree(prompts, expandedIds), [prompts, expandedIds]);
  const flattenedPrompts = useMemo(() => flattenTree(promptTree, expandedIds), [promptTree, expandedIds]);

  // Filtrar prompts por busca
  const filteredPrompts = useMemo(() => {
    if (!searchTerm.trim()) return flattenedPrompts;
    const term = searchTerm.toLowerCase();
    return flattenedPrompts.filter(p =>
      p.name.toLowerCase().includes(term) ||
      p.description?.toLowerCase().includes(term) ||
      p.content.toLowerCase().includes(term)
    );
  }, [flattenedPrompts, searchTerm]);

  const toggleExpand = useCallback((promptId: string) => {
    setExpandedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(promptId)) {
        newSet.delete(promptId);
      } else {
        newSet.add(promptId);
      }
      return newSet;
    });
  }, []);

  const insertMd = (before: string, after: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = form.content.substring(start, end);
    const newText = form.content.substring(0, start) + before + selected + after + form.content.substring(end);
    setForm(prev => ({ ...prev, content: newText }));
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = start + before.length;
      ta.selectionEnd = start + before.length + selected.length;
    }, 0);
  };

  const handleEdit = (prompt: Prompt) => {
    setEditingPrompt(prompt);
    setForm({
      name: prompt.name,
      description: prompt.description || '',
      content: prompt.content,
      parentId: prompt.parentId || null,
      order: prompt.order || 0
    });
  };

  const handleDelete = async (prompt: Prompt) => {
    const children = prompts.filter(p => p.parentId === prompt.id);
    if (children.length > 0) {
      if (!window.confirm(`"${prompt.name}" tem ${children.length} filho(s). Remover e mover filhos para a raiz?`)) {
        return;
      }
      for (const child of children) {
        await promptService.updatePrompt(child.id, { ...child, parentId: null });
      }
    } else if (!window.confirm(`Remover "${prompt.name}"?`)) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await promptService.deletePrompt(prompt.id);
      setPrompts(prev => prev.filter(p => p.id !== prompt.id).map(p =>
        p.parentId === prompt.id ? { ...p, parentId: null } : p
      ));
      if (editingPrompt?.id === prompt.id) {
        setEditingPrompt(null);
        setForm(emptyPrompt);
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao remover');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    if (name === 'parentId') {
      setForm(prev => ({ ...prev, parentId: value === '' ? null : value }));
    } else if (name === 'order') {
      setForm(prev => ({ ...prev, order: parseInt(value) || 0 }));
    } else {
      setForm(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.content.trim()) {
      setError('Nome e conteúdo são obrigatórios.');
      return;
    }

    if (editingPrompt && form.parentId) {
      if (form.parentId === editingPrompt.id) {
        setError('Um prompt não pode ser pai de si mesmo.');
        return;
      }
      if (isDescendant(prompts, form.parentId, editingPrompt.id)) {
        setError('Não é possível mover para dentro de um filho.');
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      if (editingPrompt) {
        const updated = await promptService.updatePrompt(editingPrompt.id, form);
        setPrompts(prev => prev.map(p => (p.id === updated.id ? updated : p)));
        setEditingPrompt(updated);
      } else {
        const created = await promptService.createPrompt(form);
        setPrompts(prev => [created, ...prev]);
        setForm(emptyPrompt);
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleNew = (parentId?: string) => {
    setEditingPrompt(null);
    setForm({
      ...emptyPrompt,
      parentId: parentId || null,
      order: prompts.filter(p => p.parentId === (parentId || null)).length
    });
  };

  const getParentOptions = useCallback(() => {
    const sortedPrompts = [...prompts].sort((a, b) => {
      const levelA = getPromptLevel(prompts, a.id);
      const levelB = getPromptLevel(prompts, b.id);
      if (levelA !== levelB) return levelA - levelB;
      return (a.order || 0) - (b.order || 0);
    });

    if (!editingPrompt) return sortedPrompts;
    return sortedPrompts.filter(p =>
      p.id !== editingPrompt.id &&
      !isDescendant(prompts, p.id, editingPrompt.id)
    );
  }, [prompts, editingPrompt]);

  // Obter breadcrumb do prompt em edição
  const currentPath = useMemo(() => {
    if (!editingPrompt) return [];
    return getPromptPath(prompts, editingPrompt.id);
  }, [editingPrompt, prompts]);

  // Contar filhos de um prompt
  const getChildCount = useCallback((promptId: string): number => {
    return prompts.filter(p => p.parentId === promptId).length;
  }, [prompts]);

  // Contar total de descendentes
  const getDescendantCount = useCallback((promptId: string): number => {
    const children = prompts.filter(p => p.parentId === promptId);
    let count = children.length;
    children.forEach(child => {
      count += getDescendantCount(child.id);
    });
    return count;
  }, [prompts]);

  const renderTreeItem = (node: PromptTreeNode) => {
    const hasChildNodes = node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isActive = editingPrompt?.id === node.id;
    const childCount = getChildCount(node.id);

    return (
      <li key={node.id} className={`prompt-tree-item level-${node.level}`}>
        <div
          className={`prompt-tree-row ${isActive ? 'active' : ''}`}
          onClick={() => handleEdit(node)}
          style={{ paddingLeft: `${12 + node.level * 24}px` }}
        >
          {/* Toggle */}
          <button
            className={`tree-toggle ${hasChildNodes ? 'has-children' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildNodes) toggleExpand(node.id);
            }}
          >
            {hasChildNodes ? (isExpanded ? '▾' : '▸') : '•'}
          </button>

          {/* Ícone baseado no nível */}
          <span className={`tree-icon level-${Math.min(node.level, 2)}`}>
            {node.level === 0 ? '📁' : node.level === 1 ? '📄' : '📝'}
          </span>

          {/* Conteúdo */}
          <div className="tree-content">
            <div className="tree-name">
              {node.name}
              {childCount > 0 && (
                <span className="tree-child-count">{childCount}</span>
              )}
            </div>
            {node.description && (
              <div className="tree-description">{node.description}</div>
            )}
          </div>

          {/* Ações */}
          <div className="tree-actions">
            <button
              className="tree-action-btn add"
              onClick={(e) => {
                e.stopPropagation();
                handleNew(node.id);
                setExpandedIds(prev => new Set([...Array.from(prev), node.id]));
              }}
              title="Adicionar sub-prompt"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
            </button>
            <button
              className="tree-action-btn delete"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(node);
              }}
              title="Remover"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          </div>
        </div>
      </li>
    );
  };

  // ========== JSON Editor ==========

  // Gera JSON formatado a partir dos prompts atuais
  const promptsToJson = useCallback((data: Prompt[]): string => {
    const clean = data.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      content: p.content,
      parentId: p.parentId || null,
      order: p.order || 0,
    }));
    return JSON.stringify(clean, null, 2);
  }, []);

  // Abrir editor JSON
  const handleOpenJsonEditor = useCallback(() => {
    setJsonContent(promptsToJson(prompts));
    setJsonError(null);
    setJsonDirty(false);
    setShowJsonEditor(true);
  }, [prompts, promptsToJson]);

  // Validar JSON no textarea
  const validateJson = useCallback((text: string): { valid: boolean; data?: any[]; error?: string } => {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        return { valid: false, error: 'O JSON deve ser um array de prompts.' };
      }
      for (let i = 0; i < parsed.length; i++) {
        const p = parsed[i];
        if (!p.name || typeof p.name !== 'string' || !p.name.trim()) {
          return { valid: false, error: `Prompt #${i + 1}: "name" é obrigatório.` };
        }
        if (!p.content || typeof p.content !== 'string' || !p.content.trim()) {
          return { valid: false, error: `Prompt #${i + 1} ("${p.name}"): "content" é obrigatório.` };
        }
        if (p.parentId !== null && p.parentId !== undefined && typeof p.parentId !== 'string') {
          return { valid: false, error: `Prompt #${i + 1} ("${p.name}"): "parentId" deve ser string ou null.` };
        }
      }
      // Verificar parentIds apontam para IDs válidos dentro do array
      const ids = new Set(parsed.filter((p: any) => p.id).map((p: any) => p.id));
      for (const p of parsed) {
        if (p.parentId && !ids.has(p.parentId)) {
          return { valid: false, error: `Prompt "${p.name}": parentId "${p.parentId}" não existe no JSON.` };
        }
      }
      return { valid: true, data: parsed };
    } catch (e: any) {
      return { valid: false, error: `JSON inválido: ${e.message}` };
    }
  }, []);

  // Salvar alterações do JSON
  const handleJsonSave = useCallback(async () => {
    const result = validateJson(jsonContent);
    if (!result.valid || !result.data) {
      setJsonError(result.error || 'JSON inválido');
      return;
    }

    setJsonSaving(true);
    setJsonError(null);

    try {
      const newPrompts: any[] = result.data;
      const oldMap = new Map(prompts.map(p => [p.id, p]));
      const newIds = new Set(newPrompts.filter(p => p.id).map(p => p.id));

      // Prompts para deletar (existem no old mas não no new)
      const toDelete = prompts.filter(p => !newIds.has(p.id));

      // Prompts para criar (sem id ou id não existe no old)
      const toCreate = newPrompts.filter(p => !p.id || !oldMap.has(p.id));

      // Prompts para atualizar (id existe em ambos e dados mudaram)
      const toUpdate = newPrompts.filter(p => {
        if (!p.id || !oldMap.has(p.id)) return false;
        const old = oldMap.get(p.id)!;
        return (
          old.name !== p.name ||
          (old.description || '') !== (p.description || '') ||
          old.content !== p.content ||
          (old.parentId || null) !== (p.parentId || null) ||
          (old.order || 0) !== (p.order || 0)
        );
      });

      const total = toDelete.length + toCreate.length + toUpdate.length;
      if (total === 0) {
        setJsonError('Nenhuma alteração detectada.');
        setJsonSaving(false);
        return;
      }

      const confirmed = window.confirm(
        `Aplicar alterações?\n\n` +
        `- ${toCreate.length} prompt(s) a criar\n` +
        `- ${toUpdate.length} prompt(s) a atualizar\n` +
        `- ${toDelete.length} prompt(s) a deletar\n\n` +
        `Total: ${total} operação(ões)`
      );
      if (!confirmed) {
        setJsonSaving(false);
        return;
      }

      // Executar operações
      for (const p of toDelete) {
        await promptService.deletePrompt(p.id);
      }
      for (const p of toCreate) {
        await promptService.createPrompt({
          name: p.name.trim(),
          content: p.content.trim(),
          description: p.description?.trim() || '',
          parentId: p.parentId || null,
          order: p.order || 0,
        });
      }
      for (const p of toUpdate) {
        await promptService.updatePrompt(p.id, {
          name: p.name.trim(),
          content: p.content.trim(),
          description: p.description?.trim() || '',
          parentId: p.parentId || null,
          order: p.order || 0,
        });
      }

      // Recarregar dados
      await loadPrompts();
      setShowJsonEditor(false);
      setJsonDirty(false);
    } catch (err: any) {
      setJsonError(`Erro ao salvar: ${err.message || 'Erro desconhecido'}`);
    } finally {
      setJsonSaving(false);
    }
  }, [jsonContent, prompts, validateJson, loadPrompts]);

  // Exportar JSON como arquivo
  const handleJsonExport = useCallback(() => {
    const json = promptsToJson(prompts);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prompts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [prompts, promptsToJson]);

  // Importar JSON de arquivo
  const handleJsonImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (!text) return;

      // Validar antes de colocar no editor
      const result = validateJson(text);
      if (!result.valid) {
        setJsonError(`Arquivo inválido: ${result.error}`);
        return;
      }

      // Formatar e colocar no editor
      setJsonContent(JSON.stringify(result.data, null, 2));
      setJsonError(null);
      setJsonDirty(true);
    };
    reader.readAsText(file);

    // Resetar o input para permitir reimportar o mesmo arquivo
    e.target.value = '';
  }, [validateJson]);

  // Atualizar JSON no textarea
  const handleJsonChange = useCallback((text: string) => {
    setJsonContent(text);
    setJsonDirty(true);
    // Validar em tempo real mas sem bloquear
    const result = validateJson(text);
    setJsonError(result.valid ? null : result.error || null);
  }, [validateJson]);

  // Estatísticas
  const stats = useMemo(() => {
    const rootCount = prompts.filter(p => !p.parentId).length;
    const totalCount = prompts.length;
    const maxDepth = Math.max(0, ...flattenedPrompts.map(p => p.level));
    return { rootCount, totalCount, maxDepth };
  }, [prompts, flattenedPrompts]);

  return (
    <div className="prompts-manager-v2">
      {/* Header */}
      <header className="pm-header">
        <div className="pm-header-left">
          <div className="pm-logo">
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </div>
          <div className="pm-title">
            <h1>Gerenciador de Prompts</h1>
            <p>Organize seus prompts em estrutura hierárquica</p>
          </div>
        </div>
        <div className="pm-header-right">
          <div className="pm-stats">
            <span className="pm-stat">
              <strong>{stats.totalCount}</strong> prompts
            </span>
            <span className="pm-stat">
              <strong>{stats.rootCount}</strong> raízes
            </span>
            <span className="pm-stat">
              <strong>{stats.maxDepth + 1}</strong> níveis
            </span>
          </div>
          <button
            className={`pm-btn-json ${showJsonEditor ? 'active' : ''}`}
            onClick={() => showJsonEditor ? setShowJsonEditor(false) : handleOpenJsonEditor()}
            title={showJsonEditor ? 'Voltar para editor visual' : 'Editar como JSON'}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
            </svg>
            JSON
          </button>
          {onClose && (
            <button className="pm-close-btn" onClick={onClose}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          )}
        </div>
      </header>

      <div className="pm-body">
        {/* Hidden file input for JSON import */}
        <input
          ref={jsonFileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleJsonImport}
        />

        {showJsonEditor ? (
          /* Painel do editor JSON */
          <div className="pm-json-panel">
            <div className="pm-json-toolbar">
              <div className="pm-json-toolbar-left">
                <span className="pm-json-title">Editor JSON</span>
                <span className="pm-json-count">{(() => {
                  try { return JSON.parse(jsonContent).length; } catch { return '?'; }
                })()} prompts</span>
                {jsonDirty && <span className="pm-json-dirty">Alterado</span>}
              </div>
              <div className="pm-json-toolbar-right">
                <button
                  className="pm-btn-secondary"
                  onClick={() => jsonFileInputRef.current?.click()}
                  disabled={jsonSaving}
                  title="Importar arquivo JSON"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                    <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/>
                  </svg>
                  Importar
                </button>
                <button
                  className="pm-btn-secondary"
                  onClick={handleJsonExport}
                  disabled={jsonSaving}
                  title="Exportar como arquivo JSON"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                  </svg>
                  Exportar
                </button>
                <button
                  className="pm-btn-secondary"
                  onClick={handleOpenJsonEditor}
                  disabled={jsonSaving}
                  title="Resetar para dados atuais do servidor"
                >
                  Resetar
                </button>
                <button
                  className="pm-btn-primary pm-btn-large"
                  onClick={handleJsonSave}
                  disabled={jsonSaving || !jsonDirty || !!jsonError}
                  title="Salvar alterações"
                >
                  {jsonSaving ? (
                    <>
                      <div className="pm-spinner-small"></div>
                      Salvando...
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                        <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
                      </svg>
                      Salvar
                    </>
                  )}
                </button>
              </div>
            </div>
            {jsonError && (
              <div className="pm-json-error">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                {jsonError}
              </div>
            )}
            <textarea
              className="pm-json-textarea"
              value={jsonContent}
              onChange={(e) => handleJsonChange(e.target.value)}
              disabled={jsonSaving}
              spellCheck={false}
              placeholder="[]"
            />
          </div>
        ) : (
        <>
        {/* Painel da árvore */}
        <aside className="pm-tree-panel">
          {/* Toolbar */}
          <div className="pm-tree-toolbar">
            <div className="pm-search">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <input
                type="text"
                placeholder="Buscar prompts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button className="pm-search-clear" onClick={() => setSearchTerm('')}>×</button>
              )}
            </div>
            <div className="pm-tree-actions">
              <button
                className="pm-btn-icon"
                onClick={() => setExpandedIds(new Set(prompts.map(p => p.id)))}
                title="Expandir todos"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M12 5.83L15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z"/>
                </svg>
              </button>
              <button
                className="pm-btn-icon"
                onClick={() => setExpandedIds(new Set())}
                title="Colapsar todos"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M7.41 18.59L8.83 20 12 16.83 15.17 20l1.41-1.41L12 14l-4.59 4.59zm9.18-13.18L15.17 4 12 7.17 8.83 4 7.41 5.41 12 10l4.59-4.59z"/>
                </svg>
              </button>
              <button
                className="pm-btn-primary"
                onClick={() => handleNew()}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
                Novo
              </button>
            </div>
          </div>

          {/* Árvore */}
          <div className="pm-tree-container">
            {loading ? (
              <div className="pm-tree-loading">
                <div className="pm-spinner"></div>
                <span>Carregando...</span>
              </div>
            ) : error ? (
              <div className="pm-tree-error">
                <span className="pm-error-icon">⚠️</span>
                <span>{error}</span>
                <button onClick={loadPrompts}>Tentar novamente</button>
              </div>
            ) : filteredPrompts.length === 0 ? (
              <div className="pm-tree-empty">
                {searchTerm ? (
                  <>
                    <span className="pm-empty-icon">🔍</span>
                    <p>Nenhum prompt encontrado para "{searchTerm}"</p>
                  </>
                ) : (
                  <>
                    <span className="pm-empty-icon">🌳</span>
                    <p>Nenhum prompt cadastrado</p>
                    <button onClick={() => handleNew()} className="pm-btn-primary">
                      Criar primeiro prompt
                    </button>
                  </>
                )}
              </div>
            ) : (
              <ul className="pm-tree">
                {filteredPrompts.map(node => renderTreeItem(node))}
              </ul>
            )}
          </div>
        </aside>

        {/* Painel do formulário */}
        <main className="pm-form-panel">
          {/* Breadcrumb */}
          {currentPath.length > 0 && (
            <nav className="pm-breadcrumb">
              <span className="pm-breadcrumb-label">Caminho:</span>
              {currentPath.map((p, i) => (
                <React.Fragment key={p.id}>
                  {i > 0 && <span className="pm-breadcrumb-sep">›</span>}
                  <span
                    className={`pm-breadcrumb-item ${i === currentPath.length - 1 ? 'current' : ''}`}
                    onClick={() => handleEdit(p)}
                  >
                    {p.name}
                  </span>
                </React.Fragment>
              ))}
            </nav>
          )}

          {/* Título do formulário */}
          <div className="pm-form-header">
            <h2>
              {editingPrompt ? (
                <>
                  <span className="pm-form-icon">✏️</span>
                  Editar: {editingPrompt.name}
                </>
              ) : form.parentId ? (
                <>
                  <span className="pm-form-icon">➕</span>
                  Novo sub-prompt
                </>
              ) : (
                <>
                  <span className="pm-form-icon">📁</span>
                  Novo prompt raiz
                </>
              )}
            </h2>
            {editingPrompt && (
              <div className="pm-form-meta">
                ID: {editingPrompt.id}
                {getDescendantCount(editingPrompt.id) > 0 && (
                  <span className="pm-form-descendants">
                    • {getDescendantCount(editingPrompt.id)} descendente(s)
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Mensagem de erro */}
          {error && !error.includes('Backend') && (
            <div className="pm-form-error">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              {error}
            </div>
          )}

          {/* Formulário */}
          <form className="pm-form" onSubmit={handleSubmit}>
            <div className="pm-form-grid">
              {/* Coluna esquerda */}
              <div className="pm-form-col">
                <div className="pm-form-group">
                  <label htmlFor="prompt-name">
                    Nome <span className="required">*</span>
                  </label>
                  <input
                    id="prompt-name"
                    name="name"
                    type="text"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="Ex: Resposta formal"
                    disabled={saving}
                    autoFocus
                  />
                </div>

                <div className="pm-form-group">
                  <label htmlFor="prompt-description">Descrição</label>
                  <input
                    id="prompt-description"
                    name="description"
                    type="text"
                    value={form.description}
                    onChange={handleChange}
                    placeholder="Breve descrição do uso"
                    disabled={saving}
                  />
                </div>

                <div className="pm-form-row">
                  <div className="pm-form-group">
                    <label htmlFor="prompt-parent">Prompt pai</label>
                    <select
                      id="prompt-parent"
                      name="parentId"
                      value={form.parentId || ''}
                      onChange={handleChange}
                      disabled={saving}
                    >
                      <option value="">📁 Raiz</option>
                      {getParentOptions().map(p => {
                        const level = getPromptLevel(prompts, p.id);
                        const indent = '\u00A0\u00A0\u00A0\u00A0'.repeat(level);
                        const prefix = level > 0 ? '└─ ' : '';
                        const icon = level === 0 ? '📁' : level === 1 ? '📄' : '📝';
                        return (
                          <option key={p.id} value={p.id}>
                            {indent}{prefix}{icon} {p.name}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="pm-form-group pm-form-group-small">
                    <label htmlFor="prompt-order">Ordem</label>
                    <input
                      id="prompt-order"
                      name="order"
                      type="number"
                      min="0"
                      value={form.order || 0}
                      onChange={handleChange}
                      disabled={saving}
                    />
                  </div>
                </div>
              </div>

              {/* Coluna direita - Conteúdo */}
              <div className="pm-form-col pm-form-col-content">
                <div className="pm-form-group pm-form-group-full">
                  <label htmlFor="prompt-content">
                    Conteúdo do Prompt <span className="required">*</span>
                    <span className="pm-char-count">{form.content.length} caracteres</span>
                  </label>
                  <div className="pm-editor-box">
                    <div className="pm-editor-toolbar">
                      <div className="pm-toolbar-btns">
                        <button type="button" title="Negrito" onClick={() => insertMd('**', '**')}><b>B</b></button>
                        <button type="button" title="Itálico" onClick={() => insertMd('*', '*')}><i>I</i></button>
                        <button type="button" title="Título" onClick={() => insertMd('\n## ', '')}>H</button>
                        <button type="button" title="Lista" onClick={() => insertMd('\n- ', '')}>-</button>
                        <button type="button" title="Lista numerada" onClick={() => insertMd('\n1. ', '')}>1.</button>
                        <button type="button" title="Código" onClick={() => insertMd('`', '`')}>&lt;/&gt;</button>
                        <button type="button" title="Citação" onClick={() => insertMd('\n> ', '')}>"</button>
                      </div>
                      <button
                        type="button"
                        className={`pm-preview-toggle ${showPreview ? 'active' : ''}`}
                        onClick={() => setShowPreview(p => !p)}
                      >
                        {showPreview ? 'Editar' : 'Preview'}
                      </button>
                    </div>
                    {showPreview ? (
                      <div className="pm-preview-pane">
                        {form.content.trim() ? (
                          <ReactMarkdown>{form.content}</ReactMarkdown>
                        ) : (
                          <span className="pm-preview-empty">Nenhum conteúdo para exibir</span>
                        )}
                      </div>
                    ) : (
                      <textarea
                        ref={textareaRef}
                        id="prompt-content"
                        name="content"
                        value={form.content}
                        onChange={handleChange}
                        placeholder="Digite o conteúdo do prompt..."
                        disabled={saving}
                        rows={12}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Ações */}
            <div className="pm-form-actions">
              <button
                type="button"
                className="pm-btn-secondary"
                onClick={() => handleNew()}
                disabled={saving}
              >
                Limpar
              </button>
              <button
                type="submit"
                className="pm-btn-primary pm-btn-large"
                disabled={saving || !form.name.trim() || !form.content.trim()}
              >
                {saving ? (
                  <>
                    <div className="pm-spinner-small"></div>
                    Salvando...
                  </>
                ) : editingPrompt ? (
                  <>
                    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                      <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
                    </svg>
                    Salvar alterações
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                    </svg>
                    Criar prompt
                  </>
                )}
              </button>
            </div>
          </form>
        </main>
        </>
        )}
      </div>
    </div>
  );
};

export default PromptsManager;
