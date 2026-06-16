import { create } from 'zustand';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  permissions: string[];
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: User, token: string, permissions?: string[]) => void;
  logout: () => void;
  loadFromStorage: () => void;
  hasPermission: (moduleCode: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  permissions: [],
  isAuthenticated: false,
  isLoading: true,

  login: (user, token, permissions = []) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('permissions', JSON.stringify(permissions));
    set({ user, token, permissions, isAuthenticated: true, isLoading: false });
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('permissions');
    set({ user: null, token: null, permissions: [], isAuthenticated: false, isLoading: false });
  },

  loadFromStorage: () => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    const permsStr = localStorage.getItem('permissions');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr) as User;
        const permissions = permsStr ? JSON.parse(permsStr) as string[] : [];
        set({ user, token, permissions, isAuthenticated: true, isLoading: false });
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('permissions');
        set({ isLoading: false });
      }
    } else {
      set({ isLoading: false });
    }
  },

  hasPermission: (moduleCode: string) => {
    const { user, permissions } = get();
    // admin 角色拥有所有权限
    if (user?.role === 'admin') return true;
    return permissions.includes(moduleCode);
  },
}));
