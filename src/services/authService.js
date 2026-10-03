import {
  signInWithPassword,
  signUpWithPassword,
  signInWithGoogle,
  signOut as supabaseSignOut,
  getSession,
  onAuthStateChange,
  readAuthError,
  startSession as dataStartSession,
  clearSession as dataClearSession,
  isConfigured as supabaseConfigured,
} from './supabase.js';

/**
 * Auth facade over Supabase Auth: Google OAuth first, email + password as the
 * fallback. Anyone who completes sign-in can use the app.
 */

export { signInWithPassword, signUpWithPassword, signInWithGoogle, readAuthError, supabaseConfigured };

export async function getSessionUser() {
  const { user } = await getSession();
  return user;
}

export function watchSession(callback) {
  return onAuthStateChange(callback);
}

export async function logout() {
  await supabaseSignOut();
}

/** Test hook: against the real backend this just reads the current session;
    the in-memory fake uses it to become signed in. */
export async function startSession(user = null) {
  return user ? dataStartSession(user) : dataStartSession();
}

export async function clearSession() {
  await dataClearSession();
  return null;
}
