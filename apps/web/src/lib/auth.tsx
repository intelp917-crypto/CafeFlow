import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ModuleKey } from '@cafeflow/shared';
import { ApiError, api, errorMessage } from './api';
import type { MeResponse } from './types';

interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
  mfaEnabled: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  modules: ModuleKey[];
  loading: boolean;
  error: string | null;
  login: (username: string, password: string, code?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  isModuleEnabled: (moduleKey: ModuleKey) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [modules, setModules] = useState<ModuleKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const data = await api.get<MeResponse>('/auth/me');
      setUser(data.user);
      setModules(data.modules);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 0)) {
        setUser(null);
        setModules([]);
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // iOS restores a page from the back-forward cache, or brings the app back from
  // the background, without re-running the mount effect. The session is
  // re-read then so an expired session lands on the login page instead of a
  // screen whose every action will fail. Offline it is skipped: a failed check
  // must not look like a logout.
  useEffect(() => {
    const refresh = () => {
      if (navigator.onLine === false) return;
      void loadSession();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadSession]);

  const login = useCallback(
    async (username: string, password: string, code?: string) => {
      await api.post<{ user: AuthUser; modules: ModuleKey[] }>('/auth/login', {
        username,
        password,
        ...(code ? { code } : {}),
      });
      // Re-read the session so permissions and module flags come from the same
      // backend source as every later request.
      const data = await api.get<MeResponse>('/auth/me');
      setUser(data.user);
      setModules(data.modules);
      setError(null);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
      setModules([]);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      modules,
      loading,
      error,
      login,
      logout,
      refresh: loadSession,
      hasPermission: (permission: string) => Boolean(user?.permissions.includes(permission)),
      isModuleEnabled: (moduleKey: ModuleKey) => modules.includes(moduleKey),
    }),
    [user, modules, loading, error, login, logout, loadSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
