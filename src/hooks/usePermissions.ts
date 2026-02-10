import { useAuth } from '../contexts/AuthContext';
import { TabPermission } from '../types';

export function usePermissions() {
  const { user, hasPermission } = useAuth();

  return {
    hasPermission: (tab: TabPermission) => hasPermission(tab),
    isAdmin: user?.role === 'admin',
    permissions: user?.permissions ?? [],
  };
}
