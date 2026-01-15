import { User, LoginCredentials, ApiConfig } from '../types';
import { firestoreRestUserService } from './firestoreRestService';

class AuthService {
  private users: User[] = [];
  private apiConfig: ApiConfig | null = null;
  private usersLoaded: boolean = false;

  constructor() {
    this.loadCredentials();
  }

  private async loadCredentials() {
    // Tentar carregar usuários do Firestore
    try {
      console.log('📡 Carregando usuários do Firestore...');
      const firestoreUsers = await firestoreRestUserService.getUsers();
      if (firestoreUsers && firestoreUsers.length > 0) {
        this.users = firestoreUsers;
        this.usersLoaded = true;
        console.log('✅ Usuários carregados do Firestore:', firestoreUsers.length);
      } else {
        console.warn('⚠️ Nenhum usuário encontrado no Firestore');
        this.users = [];
        this.usersLoaded = true;
      }
    } catch (error) {
      console.error('❌ Erro ao carregar usuários do Firestore:', error);
      this.users = [];
      this.usersLoaded = true;
    }

    // Carregar apiConfig do .env
    const sendMessageUrl = process.env.REACT_APP_SEND_MESSAGE_URL;
    const apiBaseUrl = process.env.REACT_APP_API_BASE_URL;
    const apiKey = process.env.REACT_APP_API_KEY;
    
    if (sendMessageUrl) {
      this.apiConfig = {
        sendMessageUrl: sendMessageUrl,
        baseUrl: apiBaseUrl,
        apiKey: apiKey
      };
      console.log('✅ API config carregado do .env');
    } else {
      this.apiConfig = {
        sendMessageUrl: "https://api.exemplo.com/webhook"
      };
      console.warn('⚠️ REACT_APP_SEND_MESSAGE_URL não encontrado, usando URL padrão');
    }
  }

  async login(credentials: LoginCredentials): Promise<User | null> {
    // Tentar buscar usuário específico do Firestore primeiro (mais eficiente)
    try {
      const firestoreUser = await firestoreRestUserService.getUserByEmail(credentials.email);
      if (firestoreUser && firestoreUser.password === credentials.password) {
        const user: User = {
          email: firestoreUser.email,
          password: firestoreUser.password,
          name: firestoreUser.name,
          role: firestoreUser.role
        };
        // Salvar no localStorage
        localStorage.setItem('user', JSON.stringify(user));
        console.log('✅ Login realizado com usuário do Firestore:', user.email);
        return user;
      }
    } catch (error) {
      console.warn('⚠️ Erro ao buscar usuário do Firestore, usando cache local:', error);
    }
    
    // Fallback: garantir que as credenciais foram carregadas
    if (!this.usersLoaded) {
      await this.loadCredentials();
    }
    
    // Buscar no array de usuários carregados
    const user = this.users.find(
      u => u.email === credentials.email && u.password === credentials.password
    );

    if (user) {
      // Salvar no localStorage
      localStorage.setItem('user', JSON.stringify(user));
      console.log('✅ Login realizado com usuário do cache local:', user.email);
      return user;
    }

    console.warn('❌ Credenciais inválidas para:', credentials.email);
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