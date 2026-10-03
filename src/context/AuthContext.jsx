import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  getSession,
  onAuthStateChange,
  signInWithPassword,
  signUpWithPassword,
  signInWithGoogle,
  readAuthError,
  signOut,
  isConfigured,
} from '../services/supabase.js';

const AuthContext = createContext(null);

/**
 * Supabase Auth: Google OAuth first, email + password as the fallback.
 *
 * There is no allow-list: anyone who completes sign-in (Google or
 * email + password) can use the app. `checking` keeps the app on a spinner
 * until the session is known so a signed-in user never flashes the login
 * screen.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState(null);
  const configured = useMemo(() => isConfigured(), []);

  // Restore an existing session on load, then follow sign-in/sign-out events
  // so a token that expires in another tab logs this one out too.
  useEffect(() => {
    if (!configured) {
      setUser(null);
      setChecking(false);
      return undefined;
    }

    let active = true;
    setAuthError(readAuthError());

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

  // Hand off to Google: the browser leaves the page and the session comes
  // back through onAuthStateChange.
  const loginWithGoogle = useCallback(async () => {
    setBusy(true);
    try {
      const { error } = await signInWithGoogle({ redirectTo: window.location.origin });
      if (error) return { ok: false, error };
      return { ok: true, redirected: true };
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
    () => ({
      user,
      isAuthenticated: Boolean(user),
      checking,
      busy,
      configured,
      authError,
      login,
      signup,
      loginWithGoogle,
      logout,
    }),
    [user, checking, busy, configured, authError, login, signup, loginWithGoogle, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
