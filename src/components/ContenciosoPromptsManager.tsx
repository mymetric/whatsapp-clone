import React, { useEffect, useState } from 'react';
import { Prompt } from '../services/api';
import { firestoreRestContenciosoPromptService } from '../services/firestoreRestService';
import './PromptsManager.css';

interface ContenciosoPromptsManagerProps {
  onClose?: () => void;
  onSelectPrompt?: (prompt: Prompt) => void;
}

const emptyPrompt: Omit<Prompt, 'id'> = {
  name: '',
  description: '',
  content: ''
};

const ContenciosoPromptsManager: React.FC<ContenciosoPromptsManagerProps> = ({ onClose, onSelectPrompt }) => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [form, setForm] = useState<Omit<Prompt, 'id'>>(emptyPrompt);

  const loadPrompts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await firestoreRestContenciosoPromptService.getPrompts();
      setPrompts(data);
    } catch (err: any) {
      console.error('Erro ao carregar prompts de contencioso:', err);
      const errorMessage = err?.message || 'Erro desconhecido';
      setError(`❌ ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPrompts();
  }, []);

  const handleEdit = (prompt: Prompt) => {
    setEditingPrompt(prompt);
    setForm({
      name: prompt.name,
      description: prompt.description || '',
      content: prompt.content
    });
  };

  const handleDelete = async (prompt: Prompt) => {
    if (!window.confirm(`Remover o prompt "${prompt.name}"?`)) return;
    setSaving(true);
    setError(null);
    try {
      await firestoreRestContenciosoPromptService.deletePrompt(prompt.id);
      setPrompts(prev => prev.filter(p => p.id !== prompt.id));
      if (editingPrompt?.id === prompt.id) {
        setEditingPrompt(null);
        setForm(emptyPrompt);
      }
    } catch (err: any) {
      console.error('Erro ao remover prompt:', err);
      const errorMessage = err?.message || 'Não foi possível remover o prompt.';
      setError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.content.trim()) {
      setError('Nome e conteúdo do prompt são obrigatórios.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingPrompt) {
        const updated = await firestoreRestContenciosoPromptService.updatePrompt(editingPrompt.id, form);
        setPrompts(prev =>
          prev.map(p => (p.id === updated.id ? updated : p))
        );
        setEditingPrompt(updated);
      } else {
        const created = await firestoreRestContenciosoPromptService.createPrompt(form);
        setPrompts(prev => [created, ...prev]);
        setForm(emptyPrompt);
      }
    } catch (err: any) {
      console.error('Erro ao salvar prompt:', err);
      const errorMessage = err?.message || 'Erro desconhecido';
      setError(`❌ Erro ao salvar: ${errorMessage}`);
    } finally {
      setSaving(false);
    }
  };

  const handleNew = () => {
    setEditingPrompt(null);
    setForm(emptyPrompt);
  };

  const handleSelect = (prompt: Prompt) => {
    if (onSelectPrompt) {
      onSelectPrompt(prompt);
    }
  };

  return (
    <div className="prompts-manager">
      <div className="prompts-header">
        <div>
          <h3>Prompts de Contencioso</h3>
          <p>Cadastre prompts personalizados para análise de processos judiciais.</p>
        </div>
        {onClose && (
          <button
            className="prompts-close-btn"
            onClick={onClose}
            title="Fechar"
          >
            ×
          </button>
        )}
      </div>

      <div className="prompts-content">
        <div className="prompts-list">
          <div className="prompts-list-header">
            <span>Prompts cadastrados</span>
            <button
              className="prompts-new-btn"
              onClick={handleNew}
              disabled={saving}
            >
              + Novo prompt
            </button>
          </div>
          {loading ? (
            <div className="prompts-loading">Carregando prompts...</div>
          ) : error && error.includes('Backend não configurado') ? (
            <div className="prompts-empty" style={{ padding: '20px', textAlign: 'center' }}>
              <div style={{ marginBottom: '12px', fontSize: '48px' }}>⚠️</div>
              <div style={{ fontWeight: '600', marginBottom: '8px', color: '#dc2626' }}>
                Backend não configurado
              </div>
              <div style={{ fontSize: '13px', color: '#6b7280', lineHeight: '1.5', maxWidth: '400px', margin: '0 auto' }}>
                {error}
              </div>
            </div>
          ) : prompts.length === 0 ? (
            <div className="prompts-empty">Nenhum prompt cadastrado ainda.</div>
          ) : (
            <ul>
              {prompts.map(prompt => (
                <li
                  key={prompt.id}
                  className={
                    editingPrompt?.id === prompt.id
                      ? 'prompt-item active'
                      : 'prompt-item'
                  }
                  onClick={() => handleEdit(prompt)}
                >
                  <div className="prompt-item-main">
                    <strong>{prompt.name}</strong>
                    {prompt.description && (
                      <span className="prompt-description">
                        {prompt.description}
                      </span>
                    )}
                    <p className="prompt-preview">
                      {prompt.content.length > 120
                        ? `${prompt.content.slice(0, 120)}...`
                        : prompt.content}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {onSelectPrompt && (
                      <button
                        className="prompt-select-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(prompt);
                        }}
                        disabled={saving}
                        title="Usar este prompt"
                      >
                        ✓
                      </button>
                    )}
                    <button
                      className="prompt-delete-btn"
                      onClick={e => {
                        e.stopPropagation();
                        handleDelete(prompt);
                      }}
                      disabled={saving}
                      title="Remover prompt"
                    >
                      🗑
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="prompts-form-wrapper">
          <h4>{editingPrompt ? 'Editar prompt' : 'Novo prompt'}</h4>
          {error && <div className="prompts-error">{error}</div>}
          <form className="prompts-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="prompt-name">Nome</label>
              <input
                id="prompt-name"
                name="name"
                type="text"
                value={form.name}
                onChange={handleChange}
                placeholder="Ex: Análise de risco processual"
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label htmlFor="prompt-description">Descrição (opcional)</label>
              <input
                id="prompt-description"
                name="description"
                type="text"
                value={form.description}
                onChange={handleChange}
                placeholder="Ex: Para processos com alto valor"
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label htmlFor="prompt-content">Conteúdo do prompt</label>
              <textarea
                id="prompt-content"
                name="content"
                rows={6}
                value={form.content}
                onChange={handleChange}
                placeholder="Texto que será usado como instrução para a IA ao analisar processos..."
                disabled={saving}
              />
            </div>
            <div className="prompts-form-actions">
              <button
                type="submit"
                className="prompts-save-btn"
                disabled={saving}
              >
                {saving ? 'Salvando...' : 'Salvar prompt'}
              </button>
              {editingPrompt && (
                <button
                  type="button"
                  className="prompts-cancel-btn"
                  onClick={handleNew}
                  disabled={saving}
                >
                  Cancelar edição
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ContenciosoPromptsManager;

