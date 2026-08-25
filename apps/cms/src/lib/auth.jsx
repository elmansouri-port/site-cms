import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, setToken, getToken } from './api.js';

const AuthContext = createContext(null);

/**
 * Session state. On mount it tries a silent refresh so a reload does not throw
 * an editor back to the login screen, and it schedules the next refresh a few
 * minutes before the access token expires.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.refresh()
      .then((data) => { if (!cancelled) setUser(data.user); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    // Access tokens live 30 minutes; renew at 25 to stay ahead of it.
    const timer = setInterval(() => {
      api.refresh().catch(() => setUser(null));
    }, 25 * 60 * 1000);
    return () => clearInterval(timer);
  }, [user]);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* the session is going away regardless */ }
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user,
    ready,
    login,
    logout,
    can: (role) => rank(user?.role) >= rank(role),
    token: getToken(),
  }), [user, ready, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const RANKS = { viewer: 1, editor: 2, admin: 3 };
const rank = (role) => RANKS[role] || 0;

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
