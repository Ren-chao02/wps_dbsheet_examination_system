import { create } from 'zustand';
import type { User, WpsTokenInfo } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  permissions: string[];
  wpsToken: WpsTokenInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: User, token: string, permissions?: string[]) => void;
  logout: () => void;
  loadFromStorage: () => void;
  hasPermission: (moduleCode: string) => boolean;
  setWpsToken: (wpsToken: WpsTokenInfo) => void;
  clearWpsToken: () => void;
  getWpsTokenRemainingSeconds: () => number;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  permissions: [],
  wpsToken: null,
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
    localStorage.removeItem('wps_token');
    set({ user: null, token: null, permissions: [], wpsToken: null, isAuthenticated: false, isLoading: false });
  },

  loadFromStorage: () => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    const permsStr = localStorage.getItem('permissions');
    const wpsTokenStr = localStorage.getItem('wps_token');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr) as User;
        const permissions = permsStr ? JSON.parse(permsStr) as string[] : [];
        const wpsToken = wpsTokenStr ? JSON.parse(wpsTokenStr) as WpsTokenInfo : null;
        set({ user, token, permissions, wpsToken, isAuthenticated: true, isLoading: false });
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('permissions');
        localStorage.removeItem('wps_token');
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

  setWpsToken: (wpsToken) => {
    localStorage.setItem('wps_token', JSON.stringify(wpsToken));
    set({ wpsToken });
  },

  clearWpsToken: () => {
    localStorage.removeItem('wps_token');
    set({ wpsToken: null });
  },

  getWpsTokenRemainingSeconds: () => {
    const { wpsToken } = get();
    if (!wpsToken || !wpsToken.expiresAt) return 0;
    const remaining = Math.floor((wpsToken.expiresAt - Date.now()) / 1000);
    return Math.max(0, remaining);
  },
}));
