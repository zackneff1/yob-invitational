import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { getStoredAuth, setStoredAuth, StoredAuth } from './api/client';

interface AuthContextValue {
  auth: StoredAuth | null;
  login: (auth: StoredAuth) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => getStoredAuth());

  const login = useCallback((next: StoredAuth) => {
    setStoredAuth(next);
    setAuth(next);
  }, []);

  const logout = useCallback(() => {
    setStoredAuth(null);
    setAuth(null);
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setAuth(null);
    window.addEventListener('yob-unauthorized', onUnauthorized);
    return () => window.removeEventListener('yob-unauthorized', onUnauthorized);
  }, []);

  return <AuthContext.Provider value={{ auth, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
