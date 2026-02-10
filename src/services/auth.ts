import { User, LoginCredentials, ApiConfig, TabPermission } from '../types';

const SERVER_BASE = process.env.REACT_APP_SERVER_URL || '';

interface AuthSession {
  token: string;
  user: User;
}

class AuthService {
  private apiConfig: ApiConfig | null = null;

  constructor() {
    this.loadApiConfig();
  }

  private loadApiConfig() {
    const sendMessageUrl = process.env.REACT_APP_SEND_MESSAGE_URL;
    const apiBaseUrl = process.env.REACT_APP_API_BASE_URL;
    const apiKey = process.env.REACT_APP_API_KEY;

    if (sendMessageUrl) {
      this.apiConfig = { sendMessageUrl, baseUrl: apiBaseUrl, apiKey };
    } else {
      this.apiConfig = { sendMessageUrl: 'https://api.exemplo.com/webhook' };
    }
  }

  async login(credentials: LoginCredentials): Promise<User | null> {
    try {
      const response = await fetch(`${SERVER_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        console.warn('❌ Login falhou:', err.error || response.statusText);
        return null;
      }

      const data = await response.json();
      const session: AuthSession = {
        token: data.token,
        user: data.user,
      };

      localStorage.setItem('auth_session', JSON.stringify(session));
      console.log('✅ Login realizado:', session.user.email);
      return session.user;
    } catch (error) {
      console.error('❌ Erro no login:', error);
      return null;
    }
  }

  async logout(): Promise<void> {
    const token = this.getToken();
    if (token) {
      try {
        await fetch(`${SERVER_BASE}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (err) {
        console.warn('⚠️ Erro ao fazer logout no servidor:', err);
      }
    }
    localStorage.removeItem('auth_session');
  }

  getCurrentUser(): User | null {
    const sessionStr = localStorage.getItem('auth_session');
    if (sessionStr) {
      try {
        const session: AuthSession = JSON.parse(sessionStr);
        return session.user;
      } catch {
        return null;
      }
    }
    return null;
  }

  getToken(): string | null {
    const sessionStr = localStorage.getItem('auth_session');
    if (sessionStr) {
      try {
        const session: AuthSession = JSON.parse(sessionStr);
        return session.token;
      } catch {
        return null;
      }
    }
    return null;
  }

  hasPermission(tab: TabPermission): boolean {
    const user = this.getCurrentUser();
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.permissions?.includes(tab) ?? false;
  }

  isAuthenticated(): boolean {
    return this.getCurrentUser() !== null && this.getToken() !== null;
  }

  getApiConfig(): ApiConfig | null {
    return this.apiConfig;
  }
}

export const authService = new AuthService();
