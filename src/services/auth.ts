import { User, LoginCredentials } from '../types';

interface ApiConfig {
  sendMessageUrl: string;
}

interface CredentialsData {
  users: User[];
  api: ApiConfig;
}

class AuthService {
  private users: User[] = [];
  private apiConfig: ApiConfig | null = null;

  constructor() {
    this.loadCredentials();
  }

  private async loadCredentials() {
    try {
      const response = await fetch('/credentials.json');
      const data: CredentialsData = await response.json();
      this.users = data.users;
      this.apiConfig = data.api;
    } catch (error) {
      console.error('Erro ao carregar credenciais:', error);
      // Fallback para desenvolvimento
      this.users = [
        {
          email: "accounts@mymetric.com.br",
          password: "hdaqzrf7rcK/ZLcoNDKhKiCbQKYSDkQqF+iuAfygro=",
          name: "MyMetric Accounts",
          role: "admin"
        },
        {
          email: "marketing@rosenbaum.adv.br",
          password: "wMe1lbDXeoFZzzeQTB2JwkQ53F4u8tsy9CLWx0v7vR4=",
          name: "Rosenbaum Marketing",
          role: "user"
        }
      ];
      this.apiConfig = {
        sendMessageUrl: "https://api.exemplo.com/webhook"
      };
    }
  }

  async login(credentials: LoginCredentials): Promise<User | null> {
    await this.loadCredentials();
    
    const user = this.users.find(
      u => u.email === credentials.email && u.password === credentials.password
    );

    if (user) {
      // Salvar no localStorage
      localStorage.setItem('user', JSON.stringify(user));
      return user;
    }

    return null;
  }

  logout(): void {
    localStorage.removeItem('user');
  }

  getCurrentUser(): User | null {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch (error) {
        console.error('Erro ao parsear usuário:', error);
        return null;
      }
    }
    return null;
  }

  isAuthenticated(): boolean {
    return this.getCurrentUser() !== null;
  }

  getApiConfig(): ApiConfig | null {
    return this.apiConfig;
  }
}

export const authService = new AuthService();
