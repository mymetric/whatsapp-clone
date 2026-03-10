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

interface ActivityLog {
  id: string;
  action: string;
  userEmail: string;
  userName: string;
  metadata: Record<string, any>;
  timestamp: string;
}

interface ActivitySummary {
  total: number;
  byAction: Record<string, number>;
  byUser: Record<string, number>;
}

interface ErrorReportRow {
  id: string;
  description: string;
  leadId: string | null;
  leadName: string | null;
  reportedBy: string;
  reportedByName: string;
  status: string;
  url: string | null;
  userAgent: string | null;
  createdAt: string;
}

type AdminTab = 'users' | 'error-reports' | 'usage';

const AdminPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New user form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [creating, setCreating] = useState(false);

  // Error reports
  const [errorReports, setErrorReports] = useState<ErrorReportRow[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [reportsLoaded, setReportsLoaded] = useState(false);

  // Activity logs
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [activitySummary, setActivitySummary] = useState<ActivitySummary | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [activityLoaded, setActivityLoaded] = useState(false);
  const [activityFilterAction, setActivityFilterAction] = useState('');
  const [activityFilterEmail, setActivityFilterEmail] = useState('');
  const [activityStartDate, setActivityStartDate] = useState('');
  const [activityEndDate, setActivityEndDate] = useState('');

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

  const loadErrorReports = useCallback(async () => {
    try {
      setLoadingReports(true);
      const res = await apiFetch('/api/error-reports');
      if (!res.ok) throw new Error('Erro ao carregar reports');
      const data = await res.json();
      setErrorReports(data.reports || []);
      setReportsLoaded(true);
    } catch (err: any) {
      showMessage('error', err.message || 'Erro ao carregar reports');
    } finally {
      setLoadingReports(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'error-reports' && !reportsLoaded) {
      loadErrorReports();
    }
  }, [activeTab, reportsLoaded, loadErrorReports]);

  const loadActivityLogs = useCallback(async (action?: string, email?: string, startDate?: string, endDate?: string) => {
    try {
      setLoadingActivity(true);
      const params = new URLSearchParams();
      if (action) params.set('action', action);
      if (email) params.set('userEmail', email);
      if (startDate) params.set('startDate', `${startDate}T00:00:00.000Z`);
      if (endDate) params.set('endDate', `${endDate}T23:59:59.999Z`);
      params.set('limit', '500');
      const qs = params.toString();
      const res = await apiFetch(`/api/activity-logs?${qs}`);
      if (!res.ok) throw new Error('Erro ao carregar logs de atividade');
      const data = await res.json();
      setActivityLogs(data.logs || []);
      setActivitySummary(data.summary || null);
      setActivityLoaded(true);
    } catch (err: any) {
      showMessage('error', err.message || 'Erro ao carregar logs de atividade');
    } finally {
      setLoadingActivity(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'usage' && !activityLoaded) {
      loadActivityLogs();
    }
  }, [activeTab, activityLoaded, loadActivityLogs]);

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

  const resolveReport = async (id: string) => {
    try {
      const res = await apiFetch(`/api/error-reports/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved' }),
      });
      if (!res.ok) throw new Error('Erro ao resolver report');
      setErrorReports(prev => prev.map(r => r.id === id ? { ...r, status: 'resolved' } : r));
      showMessage('success', 'Report marcado como resolvido');
    } catch (err: any) {
      showMessage('error', err.message);
    }
  };

  const reopenReport = async (id: string) => {
    try {
      const res = await apiFetch(`/api/error-reports/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'open' }),
      });
      if (!res.ok) throw new Error('Erro ao reabrir report');
      setErrorReports(prev => prev.map(r => r.id === id ? { ...r, status: 'open' } : r));
      showMessage('success', 'Report reaberto');
    } catch (err: any) {
      showMessage('error', err.message);
    }
  };

  const deleteReport = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja deletar este report?')) return;
    try {
      const res = await apiFetch(`/api/error-reports/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Erro ao deletar report');
      setErrorReports(prev => prev.filter(r => r.id !== id));
      showMessage('success', 'Report deletado');
    } catch (err: any) {
      showMessage('error', err.message);
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  const openReports = errorReports.filter(r => r.status === 'open');
  const resolvedReports = errorReports.filter(r => r.status !== 'open');

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

      {/* Sub-tabs */}
      <div className="admin-tabs-row">
        <button
          className={`admin-tab-btn ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          Usuarios
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'error-reports' ? 'active' : ''} ${openReports.length > 0 ? 'has-items' : ''}`}
          onClick={() => setActiveTab('error-reports')}
        >
          Erros Reportados {reportsLoaded && openReports.length > 0 ? `(${openReports.length})` : ''}
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'usage' ? 'active' : ''}`}
          onClick={() => setActiveTab('usage')}
        >
          Uso
        </button>
      </div>

      <div className="admin-body">
        {message && (
          <div className={`admin-message ${message.type}`}>
            {message.text}
          </div>
        )}

        {activeTab === 'users' && (
          <>
            {/* Criar novo usuário */}
            <div className="admin-section">
              <div className="admin-section-header">
                <h2>Novo Usuario</h2>
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
                    <option value="user">Usuario</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={createUser}
                  disabled={creating}
                >
                  {creating ? 'Criando...' : 'Criar Usuario'}
                </button>
              </div>
            </div>

            {/* Lista de usuários */}
            <div className="admin-section">
              <div className="admin-section-header">
                <h2>Usuarios ({users.length})</h2>
                <button className="admin-btn admin-btn-secondary" onClick={loadUsers} disabled={loading}>
                  Atualizar
                </button>
              </div>

              {loading ? (
                <div className="admin-loading">
                  <div className="admin-spinner" />
                  <span>Carregando usuarios...</span>
                </div>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Permissoes</th>
                      <th>Acoes</th>
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
          </>
        )}

        {activeTab === 'error-reports' && (
          <div className="admin-section">
            <div className="admin-section-header">
              <h2>Erros Reportados ({errorReports.length})</h2>
              <button
                className="admin-btn admin-btn-secondary"
                onClick={() => { setReportsLoaded(false); loadErrorReports(); }}
                disabled={loadingReports}
              >
                Atualizar
              </button>
            </div>

            {loadingReports ? (
              <div className="admin-loading">
                <div className="admin-spinner" />
                <span>Carregando reports...</span>
              </div>
            ) : errorReports.length === 0 ? (
              <div className="admin-empty-state">
                Nenhum erro reportado ainda.
              </div>
            ) : (
              <div className="admin-reports-list">
                {openReports.length > 0 && (
                  <>
                    <div className="admin-reports-group-title">Abertos ({openReports.length})</div>
                    {openReports.map(report => (
                      <div key={report.id} className="admin-report-card open">
                        <div className="admin-report-card-header">
                          <span className="admin-report-status open">aberto</span>
                          <span className="admin-report-date">{formatDate(report.createdAt)}</span>
                        </div>
                        <div className="admin-report-description">{report.description}</div>
                        <div className="admin-report-meta">
                          <span>Por: <strong>{report.reportedByName || report.reportedBy}</strong></span>
                          {report.leadName && <span>Lead: <strong>{report.leadName}</strong>{report.leadId ? ` (${report.leadId})` : ''}</span>}
                          {report.url && <span className="admin-report-url">{report.url}</span>}
                        </div>
                        <div className="admin-report-actions">
                          <button className="admin-btn admin-btn-success" onClick={() => resolveReport(report.id)}>
                            Resolver
                          </button>
                          <button className="admin-btn admin-btn-danger" onClick={() => deleteReport(report.id)}>
                            Deletar
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {resolvedReports.length > 0 && (
                  <>
                    <div className="admin-reports-group-title">Resolvidos ({resolvedReports.length})</div>
                    {resolvedReports.map(report => (
                      <div key={report.id} className="admin-report-card resolved">
                        <div className="admin-report-card-header">
                          <span className="admin-report-status resolved">{report.status}</span>
                          <span className="admin-report-date">{formatDate(report.createdAt)}</span>
                        </div>
                        <div className="admin-report-description">{report.description}</div>
                        <div className="admin-report-meta">
                          <span>Por: <strong>{report.reportedByName || report.reportedBy}</strong></span>
                          {report.leadName && <span>Lead: <strong>{report.leadName}</strong>{report.leadId ? ` (${report.leadId})` : ''}</span>}
                        </div>
                        <div className="admin-report-actions">
                          <button className="admin-btn admin-btn-secondary" onClick={() => reopenReport(report.id)}>
                            Reabrir
                          </button>
                          <button className="admin-btn admin-btn-danger" onClick={() => deleteReport(report.id)}>
                            Deletar
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'usage' && (
          <div className="admin-section">
            <div className="admin-section-header">
              <h2>Logs de Atividade</h2>
              <button
                className="admin-btn admin-btn-secondary"
                onClick={() => { setActivityLoaded(false); loadActivityLogs(activityFilterAction, activityFilterEmail, activityStartDate, activityEndDate); }}
                disabled={loadingActivity}
              >
                Atualizar
              </button>
            </div>

            {/* Summary cards */}
            {activitySummary && (
              <div className="admin-activity-summary">
                <div className="admin-summary-card">
                  <span className="admin-summary-number">{activitySummary.total}</span>
                  <span className="admin-summary-label">Total</span>
                </div>
                {Object.entries(activitySummary.byAction).map(([action, count]) => (
                  <div key={action} className={`admin-summary-card admin-summary-${action}`}>
                    <span className="admin-summary-number">{count}</span>
                    <span className="admin-summary-label">
                      {action === 'message_sent' ? 'Mensagens' : action === 'ai_suggestion' ? 'Sugestoes IA' : action === 'ai_contencioso' ? 'IA Contencioso' : action === 'login' ? 'Logins' : action}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Filters */}
            <div className="admin-usage-filters">
              <div className="admin-form-group">
                <label>Acao</label>
                <select
                  value={activityFilterAction}
                  onChange={e => setActivityFilterAction(e.target.value)}
                >
                  <option value="">Todas</option>
                  <option value="message_sent">Mensagens Enviadas</option>
                  <option value="ai_suggestion">Sugestoes IA</option>
                  <option value="ai_contencioso">IA Contencioso</option>
                  <option value="login">Login</option>
                </select>
              </div>
              <div className="admin-form-group">
                <label>Usuario</label>
                <select
                  value={activityFilterEmail}
                  onChange={e => setActivityFilterEmail(e.target.value)}
                >
                  <option value="">Todos</option>
                  {users.map(u => (
                    <option key={u.email} value={u.email}>{u.name} ({u.email})</option>
                  ))}
                </select>
              </div>
              <div className="admin-form-group">
                <label>Data inicio</label>
                <input
                  type="date"
                  value={activityStartDate}
                  onChange={e => setActivityStartDate(e.target.value)}
                />
              </div>
              <div className="admin-form-group">
                <label>Data fim</label>
                <input
                  type="date"
                  value={activityEndDate}
                  onChange={e => setActivityEndDate(e.target.value)}
                />
              </div>
              <button
                className="admin-btn admin-btn-primary"
                onClick={() => { setActivityLoaded(false); loadActivityLogs(activityFilterAction, activityFilterEmail, activityStartDate, activityEndDate); }}
                disabled={loadingActivity}
              >
                Filtrar
              </button>
              {(activityFilterAction || activityFilterEmail || activityStartDate || activityEndDate) && (
                <button
                  className="admin-btn admin-btn-danger"
                  onClick={() => { setActivityFilterAction(''); setActivityFilterEmail(''); setActivityStartDate(''); setActivityEndDate(''); setActivityLoaded(false); loadActivityLogs(); }}
                >
                  Limpar
                </button>
              )}
            </div>

            {loadingActivity ? (
              <div className="admin-loading">
                <div className="admin-spinner" />
                <span>Carregando logs de atividade...</span>
              </div>
            ) : activityLogs.length === 0 ? (
              <div className="admin-empty-state">
                Nenhum log de atividade encontrado.
              </div>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Data/Hora</th>
                    <th>Usuario</th>
                    <th>Acao</th>
                    <th>Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {activityLogs.map(log => (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '12px', color: '#64748b' }}>{formatDate(log.timestamp)}</td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>{log.userName}</div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>{log.userEmail}</div>
                      </td>
                      <td>
                        <span className={`admin-activity-badge admin-activity-${log.action}`}>
                          {log.action === 'message_sent' ? 'Msg Enviada' : log.action === 'ai_suggestion' ? 'Sugestao IA' : log.action === 'ai_contencioso' ? 'IA Contencioso' : log.action === 'login' ? 'Login' : log.action}
                        </span>
                      </td>
                      <td style={{ fontSize: '12px', color: '#64748b' }}>
                        {log.action === 'message_sent' && (
                          <>Tel: {log.metadata.phone} ({log.metadata.messageLength} chars)</>
                        )}
                        {log.action === 'ai_suggestion' && (
                          <>{log.metadata.model} | {log.metadata.messagesCount} msgs | Resp: {log.metadata.responseLength} chars</>
                        )}
                        {log.action === 'ai_contencioso' && (
                          <>Proc: {log.metadata.numeroProcesso} | {log.metadata.filesCount} arq | {log.metadata.question}</>
                        )}
                        {log.action === 'login' && 'Login realizado'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPanel;
