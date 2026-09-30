import { createClient } from '@supabase/supabase-js';

/**
 * Single Supabase client.
 *
 * The app runs happily *without* configuration (the UI shows a setup notice on
 * the login screen and every service call throws a helpful error). Only when
 * both env vars are present is the client actually created.
 */

const url = import.meta.env?.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY?.trim();

export const supabase = isSupabaseConfigured()
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/** True when both required env vars are set at build time. */
export function isSupabaseConfigured() {
  return Boolean(url && anonKey && /^https?:\/\//.test(url));
}

/** The shared client, or a clear error when the app is not configured. */
export function getSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to a .env file, then restart the dev server.',
    );
  }
  return supabase;
}