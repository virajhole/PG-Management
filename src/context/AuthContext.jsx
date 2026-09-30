import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import { getSession, onAuthStateChange, signInWithPassword, signUpWithPassword, signOut, isConfigured } from '../services/supabase.js';

const AuthContext = createContext(null);

/**
 * Supabase Auth (email + password).
 *
 * The old PIN only hid data from someone standing at the device; an account
 * makes the data reachable from any browser while Row Level Security keeps it
 * private to one user.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const configured = useMemo(() => isConfigured(), []);

  // Restore an existing session on load, then follow sign-in/sign-out events so a
  // token that expires in another tab logs this one out too.
  useEffect(() => {
    // Without credentials there is no backend to ask, and the data layer throws.
    // Stop at `checking: false` so the login screen can show its setup notice.
    if (!configured) {
      setUser(null);
      setChecking(false);
      return undefined;
    }

    let active = true;

    getSession()
      .then(({ user: current }) => {
        if (active) setUser(current);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setChecking(false);
      });

    const unsubscribe = onAuthStateChange(({ user: next }) => {
      setUser(next);
      setChecking(false);
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [configured]);

  const login = useCallback(async (email, password) => {
    setBusy(true);
    try {
      const result = await signInWithPassword({ email, password });
      if (result.error) return { ok: false, error: result.error };
      setUser(result.user);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      setBusy(false);
    }
  }, []);

  const signup = useCallback(async (email, password) => {
    setBusy(true);
    try {
      const result = await signUpWithPassword({ email, password });
      if (result.error) return { ok: false, error: result.error };
      if (result.user) setUser(result.user);
      return { ok: true, pending: Boolean(result.pending) };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      setBusy(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setUser(null);
      setBusy(false);
    }
  }, []);

  const value = useMemo(
    () => ({ user, isAuthenticated: Boolean(user), checking, busy, configured, login, signup, logout }),
    [user, checking, busy, configured, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}