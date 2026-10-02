import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getSession,
  onAuthStateChange,
  signInWithPassword,
  signUpWithPassword,
  signInWithGoogle,
  readAuthError,
  signOut,
  isConfigured,
  resolveAccess,
  inspectAllowlist,
} from '../services/supabase.js';

const AuthContext = createContext(null);

/**
 * Supabase Auth: Google OAuth first, email + password as the fallback.
 *
 * Access is allow-listed. Signing in successfully is not enough - the address
 * also has to appear in the `admins` table (see is_admin() in schema.sql), so
 * a colleague who guesses a shared login link still cannot read the ledger.
 * `access` carries the result of that check and `accessChecking` keeps the app
 * on a spinner rather than flashing the dashboard at someone who is about to
 * be signed out.
 *
 * The provider also owns the OAuth callback: Supabase parses the `#access_token`
 * fragment itself (detectSessionInUrl), so the session arrives through
 * onAuthStateChange and `getSession` confirms it on boot.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [access, setAccess] = useState(null); // { allowed, email } | null
  // Kept separately from `access` because signing a rejected account out clears
  // `user`, and the generic "signed out means no access" effect would wipe the
  // verdict the route gate needs to explain itself.
  const [deniedEmail, setDeniedEmail] = useState(null);
  const [accessChecking, setAccessChecking] = useState(false);
  // Why the last check failed, when it did. `missing` means the database itself
  // is not set up (no `admins` table) - a different screen from "not invited".
  const [allowlist, setAllowlist] = useState(null);
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState(null);
  const configured = useMemo(() => isConfigured(), []);
  // One allow-list check per identity. Signing in calls verifyAccess directly
  // and the session effect fires for the same user, so without this token the
  // two overlap - and the second one could otherwise sign the account out on
  // the strength of a verdict that is already stale.
  const checkToken = useRef(0);

  // Restore an existing session on load, then follow sign-in/sign-out events so
  // a token that expires in another tab logs this one out too.
  useEffect(() => {
    // Without credentials there is no backend to ask, and the data layer throws.
    // Stop at `checking: false` so the login screen can show its setup notice.
    if (!configured) {
      setUser(null);
      setAccess(null);
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

  /**
   * Confirm the signed-in address is on the owner's allowlist.
   *
   * A miss is signed out immediately: the account has proven it can reach
   * Supabase but is not allowed to reach this PG's data, and leaving the
   * session alive would let them retry on every page load.
   */
  const verifyAccess = useCallback(
    async (account) => {
      const email = String(account?.email ?? '').toLowerCase();
      if (!account || !email) {
      setAccess({ allowed: false, email: email || '' });
      return { allowed: false, email };
    }

      setAccessChecking(true);
      checkToken.current += 1;
      const token = checkToken.current;
      try {
        const allowed = await resolveAccess(email);
        // A newer check has already spoken for this identity; let it finish.
        if (token !== checkToken.current) return { allowed, email };
        const verdict = { allowed, email };
        setAccess(verdict);
        setDeniedEmail(allowed ? null : email);
        if (allowed) {
          setAllowlist(null);
        } else {
          // Work out *why* before signing them out: an unreadable or missing
          // `admins` table is a setup bug, and the "not on the allowlist"
          // message would be a dead end because they cannot reach Settings.
          const state = await inspectAllowlist().catch(() => null);
          setAllowlist(state);
          // Sign out from a rejected account, but keep `deniedEmail` so the
          // caller can explain what happened instead of silently bouncing to
          // /login.
          try {
            await signOut();
          } catch {
            /* the session may already be gone; nothing to clean up */
          }
          setUser(null);
        }
        return verdict;
      } catch {
        // The admins table could not be read. Fail closed: an unreadable
        // allowlist must not become an open door.
        setAccess({ allowed: false, email });
        setDeniedEmail(email);
        return { allowed: false, email };
      } finally {
        if (token === checkToken.current) setAccessChecking(false);
      }
    },
    [],
  );

  // Re-check whenever the signed-in identity changes (including the OAuth
  // redirect landing, which swaps in a new user object).
  useEffect(() => {
    if (checking) return;
    if (!user) {
      // A denial already recorded above is not a plain sign-out.
      if (!deniedEmail) setAccess(null);
      return;
    }
    verifyAccess(user);
  }, [user, checking, verifyAccess, deniedEmail]);

  const login = useCallback(
    async (email, password) => {
      setBusy(true);
      try {
        const result = await signInWithPassword({ email, password });
        if (result.error) return { ok: false, error: result.error };
        setUser(result.user);
        const verdict = await verifyAccess(result.user);
        if (!verdict.allowed) {
          return {
            ok: false,
            denied: true,
            error: 'Access denied, contact the owner.',
          };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      } finally {
        setBusy(false);
      }
    },
    [verifyAccess],
  );

  const signup = useCallback(
    async (email, password) => {
      setBusy(true);
      try {
        const result = await signUpWithPassword({ email, password });
        if (result.error) return { ok: false, error: result.error };
        if (result.user) setUser(result.user);
        // A brand-new account is never on the allowlist until the owner adds
        // it, so say that plainly instead of letting it fail later.
        if (result.user) await verifyAccess(result.user);
        return { ok: true, pending: Boolean(result.pending) };
      } catch (err) {
        return { ok: false, error: err.message };
      } finally {
        setBusy(false);
      }
    },
    [verifyAccess],
  );

  /**
   * Hand off to Google. There is no result object: the browser leaves the page
   * and the session comes back through onAuthStateChange, which triggers the
   * allowlist check above.
   */
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
      setAccess(null);
      setDeniedEmail(null);
      setAllowlist(null);
      setAuthError(null);
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
      access,
      accessChecking,
      // Set the moment the allowlist check rejects an account, so the route
      // gate can show "Access denied" rather than a bare redirect.
      accessDenied: Boolean(deniedEmail),
      deniedEmail,
      /** `{ ok, missing, empty, error }` for the last rejection, or null. */
      allowlist,
      /** True when the rejection was caused by an un-created `admins` table. */
      setupIncomplete: Boolean(allowlist && !allowlist.ok),
      login,
      signup,
      loginWithGoogle,
      logout,
      recheckAccess: () => verifyAccess(user),
    }),
    [
      user,
      checking,
      busy,
      configured,
      authError,
      access,
      accessChecking,
      deniedEmail,
      allowlist,
      login,
      signup,
      loginWithGoogle,
      logout,
      verifyAccess,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}