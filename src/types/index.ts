export interface Phone {
  _name: string;
  _id: string;
  _createTime: string;
  _updateTime: string;
  last_message: string;
  lead_name?: string;
  email?: string;
  etiqueta?: string;
  status?: string;
  board?: string;
  pulse_id?: string;
  board_id?: string;
}

export interface Message {
  _name: string;
  _id: string;
  _createTime: string;
  _updateTime: string;
  chat_phone: string;
  source: 'Contact' | 'Member' | 'Bot';
  content: string;
  image?: string;
  audio?: boolean | string;
}

export interface DocumentImage {
  fileId: string;
  url: string;
  extractedText?: string;
  raw?: any;
}

export interface DocumentRecord {
  id: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  text?: string;
  origin: 'email' | 'phone';
  direction?: 'sent' | 'received';
  images: DocumentImage[];
  metadata?: Record<string, any>;
  raw?: any;
}

export interface Chat {
  phone: string;
  messages: Message[];
  lastMessage?: string;
  lastMessageTime?: string;
}

export type TabPermission = 'conversas-leads' | 'file-processing' | 'whatsapp' | 'contencioso' | 'prompts' | 'admin';

export interface User {
  email: string;
  password?: string;
  name: string;
  role: 'admin' | 'user';
  permissions: TabPermission[];
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthContextType {
  user: User | null;
  login: (credentials: LoginCredentials) => Promise<boolean>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  hasPermission: (tab: TabPermission) => boolean;
}

export interface ApiConfig {
  sendMessageUrl: string;
  baseUrl?: string;
  apiKey?: string;
}
