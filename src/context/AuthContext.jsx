import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import { verifyPin, readSession, startSession, clearSession, isPinConfigured } from '../services/authService.js';

const AuthContext = createContext(null);

/**
 * Guards routes behind a PIN, because the app stores Aadhaar/PAN scans on the
 * device. A PIN is a speed bump, not real security - see the README.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => readSession());
  const [checking, setChecking] = useState(false);
  const [pinSet, setPinSet] = useState(() => isPinConfigured());

  useEffect(() => {
    // Re-check on focus so a session that expired in the background is caught.
    const onFocus = () => setSession(readSession());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const login = useCallback(async (pin) => {
    setChecking(true);
    try {
      const ok = await verifyPin(pin);
      if (!ok) return { ok: false, error: 'Incorrect PIN. Please try again.' };
      const next = startSession();
      setSession(next);
      setPinSet(true);
      return { ok: true };
    } finally {
      setChecking(false);
    }
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ isAuthenticated: Boolean(session), session, pinSet, checking, login, logout }),
    [session, pinSet, checking, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
