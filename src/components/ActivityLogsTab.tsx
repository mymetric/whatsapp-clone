import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../services/apiClient';
import './ActivityLogsTab.css';

interface ActivityLog {
  id: string;
  action: string;
  userEmail: string;
  userName: string;
  metadata: Record<string, any>;
  timestamp: string;
}

interface Summary {
  total: number;
  byAction: Record<string, number>;
  byUser: Record<string, number>;
}

const ACTION_LABELS: Record<string, string> = {
  message_sent: 'Mensagem Enviada',
  ai_suggestion: 'Sugestão IA',
  ai_contencioso: 'IA Contencioso',
  login: 'Login',
  logout: 'Logout',
};

const ACTION_COLORS: Record<string, string> = {
  message_sent: '#2196F3',
  ai_suggestion: '#9C27B0',
  ai_contencioso: '#FF9800',
  login: '#4CAF50',
  logout: '#607D8B',
};

const ActivityLogsTab: React.FC = () => {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [filterDate, setFilterDate] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterAction) params.set('action', filterAction);
      if (filterUser) params.set('userEmail', filterUser);
      if (filterDate) {
        params.set('startDate', `${filterDate}T00:00:00.000Z`);
        params.set('endDate', `${filterDate}T23:59:59.999Z`);
      }
      params.set('limit', '500');

      const res = await apiFetch(`/api/activity-logs?${params.toString()}`);
      if (!res.ok) throw new Error('Erro ao buscar logs');
      const data = await res.json();
      setLogs(data.logs || []);
      setSummary(data.summary || null);
    } catch (err) {
      console.error('Erro ao buscar logs:', err);
    } finally {
      setLoading(false);
    }
  }, [filterAction, filterUser, filterDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const formatDate = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  };

  const uniqueUsers = Array.from(new Set(logs.map((l) => l.userEmail))).sort();

  return (
    <div className="activity-logs-tab">
      <div className="activity-logs-header">
        <h2>Logs de Atividade</h2>
        <button className="refresh-btn" onClick={fetchLogs} disabled={loading}>
          {loading ? 'Carregando...' : 'Atualizar'}
        </button>
      </div>

      {summary && (
        <div className="activity-summary">
          <div className="summary-card">
            <span className="summary-number">{summary.total}</span>
            <span className="summary-label">Total</span>
          </div>
          {Object.entries(summary.byAction).map(([action, count]) => (
            <div key={action} className="summary-card" style={{ borderLeftColor: ACTION_COLORS[action] || '#999' }}>
              <span className="summary-number">{count}</span>
              <span className="summary-label">{ACTION_LABELS[action] || action}</span>
            </div>
          ))}
        </div>
      )}

      <div className="activity-filters">
        <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
          <option value="">Todas as ações</option>
          <option value="message_sent">Mensagens Enviadas</option>
          <option value="ai_suggestion">Sugestões IA</option>
          <option value="ai_contencioso">IA Contencioso</option>
          <option value="login">Login</option>
        </select>
        <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)}>
          <option value="">Todos os usuários</option>
          {uniqueUsers.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          placeholder="Filtrar por data"
        />
        {(filterAction || filterUser || filterDate) && (
          <button className="clear-filters-btn" onClick={() => { setFilterAction(''); setFilterUser(''); setFilterDate(''); }}>
            Limpar filtros
          </button>
        )}
      </div>

      <div className="activity-logs-table-wrapper">
        <table className="activity-logs-table">
          <thead>
            <tr>
              <th>Data/Hora</th>
              <th>Usuário</th>
              <th>Ação</th>
              <th>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && !loading && (
              <tr><td colSpan={4} className="empty-state">Nenhum log encontrado</td></tr>
            )}
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="log-date">{formatDate(log.timestamp)}</td>
                <td className="log-user">
                  <span className="user-name">{log.userName}</span>
                  <span className="user-email">{log.userEmail}</span>
                </td>
                <td>
                  <span className="action-badge" style={{ backgroundColor: ACTION_COLORS[log.action] || '#999' }}>
                    {ACTION_LABELS[log.action] || log.action}
                  </span>
                </td>
                <td className="log-metadata">
                  {log.action === 'message_sent' && (
                    <span>Tel: {log.metadata.phone} ({log.metadata.messageLength} chars)</span>
                  )}
                  {log.action === 'ai_suggestion' && (
                    <span>Modelo: {log.metadata.model} | {log.metadata.messagesCount} msgs | Resp: {log.metadata.responseLength} chars</span>
                  )}
                  {log.action === 'ai_contencioso' && (
                    <span>Processo: {log.metadata.numeroProcesso} | {log.metadata.filesCount} arquivos | {log.metadata.question}</span>
                  )}
                  {log.action === 'login' && <span>Login realizado</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ActivityLogsTab;
