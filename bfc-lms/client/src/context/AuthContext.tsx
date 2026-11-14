import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setCsrfToken } from '@/lib/api';
import type { Auth } from '@/lib/types';

interface AuthContextValue {
  auth: Auth | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<Auth>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  has: (...codes: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((next: Auth | null) => {
    setCsrfToken(next?.csrfToken ?? '');
    setAuth(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<Auth>('/auth/me');
      apply(me);
    } catch {
      apply(null);
    }
  }, [apply]);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (identifier: string, password: string) => {
    const result = await api.post<Auth>('/auth/login', { identifier, password });
    apply(result);
    return result;
  }, [apply]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      apply(null);
    }
  }, [apply]);

  const has = useCallback((...codes: string[]) => !!auth && codes.some((c) => auth.permissions.includes(c)), [auth]);

  const value = useMemo<AuthContextValue>(() => ({ auth, loading, login, logout, refresh, has }), [auth, loading, login, logout, refresh, has]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}