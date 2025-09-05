export interface Phone {
  _name: string;
  _id: string;
  _createTime: string;
  _updateTime: string;
  last_message: string;
}

export interface Message {
  _name: string;
  _id: string;
  _createTime: string;
  _updateTime: string;
  chat_phone: string;
  source: 'Contact' | 'Member';
  content: string;
}

export interface Chat {
  phone: string;
  messages: Message[];
  lastMessage?: string;
  lastMessageTime?: string;
}

export interface User {
  email: string;
  password: string;
  name: string;
  role: 'admin' | 'user';
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthContextType {
  user: User | null;
  login: (credentials: LoginCredentials) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
}
