import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setCsrfToken, setUnauthorizedHandler } from './api';

export interface User {
  id: number;
  username: string;
  fullName: string;
  roleName: string;
  isAdmin: boolean;
  permissions: string[];
}

interface Status { setupRequired: boolean; user: User | null; csrfToken: string | null; sessionExpired: boolean; businessName: string | null }

interface AuthCtx {
  ready: boolean;
  bootError: string | null;
  user: User | null;
  setupRequired: boolean;
  sessionExpired: boolean;
  businessName: string | null;
  login: (username: string, password: string) => Promise<void>;
  setup: (data: { username: string; fullName: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  can: (...perms: string[]) => boolean;
  refresh: () => Promise<void>;
  setBusinessName: (n: string | null) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [businessName, setBusinessName] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.get<Status>('/auth/status');
      setCsrfToken(s.csrfToken);
      setUser(s.user);
      setSetupRequired(s.setupRequired);
      setSessionExpired(s.sessionExpired);
      setBusinessName(s.businessName);
      setBootError(null);
    } catch (e) {
      // 404 أو استجابة غير JSON تعني أن الواجهة منشورة بدون خادم النظام
      const err = e as Error & { status?: number };
      setBootError(err.status === 404 || err.message === 'استجابة غير متوقعة من الخادم'
        ? 'خادم النظام غير متاح على هذا الرابط. هذا النشر يحتوي على الواجهة فقط، ويجب تشغيل خادم النظام (npm start) لتسجيل الدخول وحفظ البيانات.'
        : err.message);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    // أي استجابة 401 أثناء الاستخدام تعني انتهاء الجلسة
    setUnauthorizedHandler(() => {
      setCsrfToken(null);
      setUser((u) => { if (u) setSessionExpired(true); return null; });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.post<{ user: User; csrfToken: string }>('/auth/login', { username, password });
    setCsrfToken(r.csrfToken);
    setSessionExpired(false);
    setUser(r.user);
  }, []);

  const setup = useCallback(async (data: { username: string; fullName: string; password: string }) => {
    const r = await api.post<{ user: User; csrfToken: string }>('/auth/setup', data);
    setCsrfToken(r.csrfToken);
    setSetupRequired(false);
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } finally {
      setCsrfToken(null);
      setSessionExpired(false);
      setUser(null);
    }
  }, []);

  const can = useCallback((...perms: string[]) => !!user && (user.isAdmin || perms.some((p) => user.permissions.includes(p))), [user]);

  const value = useMemo(() => ({ ready, bootError, user, setupRequired, sessionExpired, businessName, login, setup, logout, can, refresh, setBusinessName }),
    [ready, bootError, user, setupRequired, sessionExpired, businessName, login, setup, logout, can, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside provider');
  return c;
}
