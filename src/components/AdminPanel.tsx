import React, { useState, useEffect, useCallback } from 'react';
import { TabPermission } from '../types';
import { apiFetch } from '../services/apiClient';
import './AdminPanel.css';

const ALL_PERMISSIONS: { id: TabPermission; label: string }[] = [
  { id: 'conversas-leads', label: 'Conversas & Leads' },
  { id: 'file-processing', label: 'Arquivos' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'contencioso', label: 'Contencioso' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'admin', label: 'Admin' },
];

interface UserRow {
  email: string;
  name: string;
  role: 'admin' | 'user';
  permissions: TabPermission[];
  dirty?: boolean;
  saving?: boolean;
}

const AdminPanel: React.FC = () => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New user form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [creating, setCreating] = useState(false);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/api/users');
      if (!res.ok) throw new Error('Erro ao carregar usuários');
      const data = await res.json();
      setUsers(data.map((u: UserRow) => ({ ...u, dirty: false, saving: false })));
    } catch (err: any) {
      showMessage('error', err.message || 'Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const togglePermission = (email: string, perm: TabPermission) => {
    setUsers(prev =>
      prev.map(u => {
        if (u.email !== email) return u;
        const has = u.permissions.includes(perm);
        const newPerms = has
          ? u.permissions.filter(p => p !== perm)
          : [...u.permissions, perm];
        return { ...u, permissions: newPerms, dirty: true };
      })
    );
  };

  const savePermissions = async (email: string) => {
    const user = users.find(u => u.email === email);
    if (!user) return;

    setUsers(prev => prev.map(u => u.email === email ? { ...u, saving: true } : u));

    try {
      const res = await apiFetch(`/api/users/${encodeURIComponent(email)}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: user.permissions }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao salvar');
      }
      setUsers(prev => prev.map(u => u.email === email ? { ...u, dirty: false, saving: false } : u));
      showMessage('success', `Permissões de ${email} atualizadas`);
    } catch (err: any) {
      setUsers(prev => prev.map(u => u.email === email ? { ...u, saving: false } : u));
      showMessage('error', err.message);
    }
  };

  const createUser = async () => {
    if (!newName.trim() || !newEmail.trim() || !newPassword.trim()) {
      showMessage('error', 'Preencha todos os campos');
      return;
    }

    setCreating(true);
    try {
      const res = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          email: newEmail.trim(),
          password: newPassword.trim(),
          role: newRole,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao criar usuário');
      }
      showMessage('success', `Usuário ${newEmail} criado`);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('user');
      await loadUsers();
    } catch (err: any) {
      showMessage('error', err.message);
    } finally {
      setCreating(false);
    }
  };

  const resetPassword = async (email: string) => {
    const newPwd = window.prompt(`Nova senha para ${email}:`);
    if (!newPwd || !newPwd.trim()) return;

    try {
      const res = await apiFetch(`/api/users/${encodeURIComponent(email)}`, {
        method: 'PUT',
        body: JSON.stringify({ password: newPwd.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao resetar senha');
      }
      showMessage('success', `Senha de ${email} atualizada`);
    } catch (err: any) {
      showMessage('error', err.message);
    }
  };

  const deleteUser = async (email: string) => {
    if (!window.confirm(`Tem certeza que deseja deletar o usuário ${email}?`)) return;

    try {
      const res = await apiFetch(`/api/users/${encodeURIComponent(email)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao deletar');
      }
      showMessage('success', `Usuário ${email} deletado`);
      await loadUsers();
    } catch (err: any) {
      showMessage('error', err.message);
    }
  };

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <div className="admin-header-left">
          <div className="admin-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
          </div>
          <div className="admin-title">
            <h1>Painel Administrativo</h1>
            <p>Gerenciar usuários e permissões de acesso</p>
          </div>
        </div>
      </div>

      <div className="admin-body">
        {message && (
          <div className={`admin-message ${message.type}`}>
            {message.text}
          </div>
        )}

        {/* Criar novo usuário */}
        <div className="admin-section">
          <div className="admin-section-header">
            <h2>Novo Usuário</h2>
          </div>
          <div className="admin-new-user-form">
            <div className="admin-form-group">
              <label>Nome</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Nome completo"
              />
            </div>
            <div className="admin-form-group">
              <label>Email</label>
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="email@exemplo.com"
              />
            </div>
            <div className="admin-form-group">
              <label>Senha</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Senha"
              />
            </div>
            <div className="admin-form-group">
              <label>Role</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value as 'admin' | 'user')}>
                <option value="user">Usuário</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              className="admin-btn admin-btn-primary"
              onClick={createUser}
              disabled={creating}
            >
              {creating ? 'Criando...' : 'Criar Usuário'}
            </button>
          </div>
        </div>

        {/* Lista de usuários */}
        <div className="admin-section">
          <div className="admin-section-header">
            <h2>Usuários ({users.length})</h2>
            <button className="admin-btn admin-btn-secondary" onClick={loadUsers} disabled={loading}>
              Atualizar
            </button>
          </div>

          {loading ? (
            <div className="admin-loading">
              <div className="admin-spinner" />
              <span>Carregando usuários...</span>
            </div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Permissões</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.email}>
                    <td>{user.name}</td>
                    <td>{user.email}</td>
                    <td>
                      <span className={`admin-role-badge ${user.role}`}>
                        {user.role}
                      </span>
                    </td>
                    <td>
                      <div className="admin-permissions-grid">
                        {ALL_PERMISSIONS.map(perm => (
                          <label
                            key={perm.id}
                            className={`admin-permission-chip ${user.permissions.includes(perm.id) ? 'active' : ''}`}
                          >
                            <input
                              type="checkbox"
                              className="admin-permission-checkbox"
                              checked={user.permissions.includes(perm.id)}
                              onChange={() => togglePermission(user.email, perm.id)}
                            />
                            {perm.label}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="admin-actions">
                        {user.dirty && (
                          <button
                            className="admin-btn admin-btn-success"
                            onClick={() => savePermissions(user.email)}
                            disabled={user.saving}
                          >
                            {user.saving ? 'Salvando...' : 'Salvar'}
                          </button>
                        )}
                        <button
                          className="admin-btn admin-btn-secondary"
                          onClick={() => resetPassword(user.email)}
                        >
                          Resetar Senha
                        </button>
                        <button
                          className="admin-btn admin-btn-danger"
                          onClick={() => deleteUser(user.email)}
                        >
                          Deletar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
