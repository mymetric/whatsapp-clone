import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, LoginCredentials, AuthContextType, TabPermission } from '../types';
import { authService } from '../services/auth';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pending2FA, setPending2FA] = useState<{ email: string } | null>(null);

  useEffect(() => {
    const currentUser = authService.getCurrentUser();
    if (currentUser) {
      setUser(currentUser);
      setIsAuthenticated(true);
    }
  }, []);

  const login = async (credentials: LoginCredentials): Promise<boolean | '2fa'> => {
    try {
      const result = await authService.login(credentials);
      if (!result) return false;

      if ('requires2FA' in result && result.requires2FA) {
        setPending2FA({ email: result.email });
        return '2fa';
      }

      setUser(result as User);
      setIsAuthenticated(true);
      return true;
    } catch (error) {
      console.error('Erro no login:', error);
      return false;
    }
  };

  const verify2FA = async (code: string): Promise<boolean> => {
    if (!pending2FA) return false;
    try {
      const verifiedUser = await authService.verify2FA(pending2FA.email, code);
      if (verifiedUser) {
        setUser(verifiedUser);
        setIsAuthenticated(true);
        setPending2FA(null);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Erro na verificação 2FA:', error);
      return false;
    }
  };

  const logout = async (): Promise<void> => {
    await authService.logout();
    setUser(null);
    setIsAuthenticated(false);
    setPending2FA(null);
  };

  const hasPermission = (tab: TabPermission): boolean => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.permissions?.includes(tab) ?? false;
  };

  const value: AuthContextType = {
    user,
    login,
    logout,
    isAuthenticated,
    hasPermission,
    pending2FA,
    verify2FA,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
};
