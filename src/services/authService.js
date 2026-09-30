import {
  signInWithPassword,
  signUpWithPassword,
  signOut,
  getSession,
  startSession as dataStartSession,
  clearSession as dataClearSession,
  isConfigured as supabaseConfigured,
} from './supabase.js';

/**
 * Auth facade over Supabase Auth (email + password).
 *
 * Replaces the old local PIN gate, which only hid data on one device. Identity
 * is now a real account, so the same data follows you across browsers and RLS
 * can guarantee no one else reads your tenants.
 */

export function isConfigured() {
  return supabaseConfigured();
}

/**
 * Sign in. Returns `{ user, error }` rather than throwing, so the login screen
 * can show the message inline.
 */
export async function login(email, password) {
  const { user, error } = await signInWithPassword({
    email: String(email || '').trim(),
    password: String(password || ''),
  });
  return { user, error };
}

/**
 * Create the account for this email and sign in. If email confirmation is on in
 * the Supabase project, `pending` is true and no session exists yet.
 */
export async function signup(email, password) {
  const { user, pending, error } = await signUpWithPassword({
    email: String(email || '').trim(),
    password: String(password || ''),
  });
  return { user, pending, error };
}

export async function logout() {
  await signOut();
}

/**
 * Test/dev shims kept so nothing that used to call the PIN helpers breaks.
 * Against a real backend the session is owned by supabase-js, so these are
 * effectively pass-throughs.
 */
export function startSession() {
  return dataStartSession();
}

export function clearSession() {
  return dataClearSession();
}

export async function readSession() {
  const { user } = await getSession();
  return user ? { authenticatedAt: new Date().toISOString(), user } : null;
}