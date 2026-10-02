import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { LockIcon, HomeIcon } from '../components/icons.jsx';
import { Spinner } from '../components/States.jsx';
import { useData } from '../context/DataContext.jsx';

/**
 * Sign in / create account.
 *
 * First run of a new install has no account yet, so the same screen offers
 * "Create account" until a sign-in fails. Identity is a real Supabase account,
 * which is what lets Row Level Security keep the data private.
 */
export default function Login() {
  const { login, signup, loginWithGoogle, checking, busy, configured, authError } = useAuth();
  const { settings } = useData();

  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const canSubmit = configured && email.trim().length > 3 && password.length >= 6 && !busy && !checking;

  async function continueWithGoogle() {
    setError('');
    setNotice('');
    const result = await loginWithGoogle();
    // On success the browser is already navigating away to Google, so there is
    // nothing to render. Only a failure lands back here.
    if (!result.ok) {
      setError(
        result.error?.includes('not enabled') || result.error?.includes('provider')
          ? 'Google sign-in is not enabled yet. Ask the owner to turn on the Google provider in Supabase, or use email and password below.'
          : result.error || 'Google sign-in failed. Try again, or use email and password below.',
      );
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');

    if (!email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Your password must be at least 6 characters.');
      return;
    }

    const result = mode === 'signup' ? await signup(email, password) : await login(email, password);

    if (!result.ok) {
      // An allowlist rejection already has its own screen; do not also offer to
      // flip this form into "create account".
      if (result.denied) {
        setError(result.error);
        return;
      }
      // A first sign-in attempt failing is usually just "no such account yet".
      if (mode === 'signin') setMode('signup');
      setError(result.error);
      return;
    }

    if (result.pending) {
      setNotice('Account created. Check your email for the confirmation link, then sign in.');
      setMode('signin');
    }
  }

  const isSignup = mode === 'signup';

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center text-white">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-raised/15 backdrop-blur">
            <HomeIcon className="size-8" />
          </div>
          <h1 className="text-2xl font-bold">{settings.pgName || 'PG Manager'}</h1>
          <p className="mt-1 text-sm text-white/70">Tenant &amp; rent management</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl bg-raised p-6 shadow-2xl">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <LockIcon className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">
                {isSignup ? 'Create your account' : 'Sign in with email'}
              </h2>
              <p className="text-xs text-ink-subtle">
                {isSignup
                  ? 'One account per PG. Your tenants stay private to it.'
                  : 'Fallback for accounts without Google.'}
              </p>
            </div>
          </div>

          {authError && !error && (
            <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-800">
              Google sign-in did not complete: {authError}
            </div>
          )}

          {!configured && (
            <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
              Supabase is not configured. Copy <span className="font-semibold">.env.example</span> to{' '}
              <span className="font-semibold">.env</span>, add your project URL and anon key, then restart the
              dev server.
            </div>
          )}

          {/* Google is the primary path; email/password stays as the fallback. */}
          <button
            type="button"
            onClick={continueWithGoogle}
            disabled={!configured || busy || checking}
            className="flex min-h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink transition hover:bg-sunken disabled:opacity-60"
          >
            <GoogleMark />
            Continue with Google
          </button>

          <div className="my-4 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[10px] font-bold tracking-widest text-ink-muted uppercase">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <div className="space-y-3">
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-semibold text-ink">
                Email
              </label>
              <input
                id="email"
                ref={inputRef}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                }}
                placeholder="you@example.com"
                className={`field-input ${error ? 'field-input-error' : ''}`}
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-semibold text-ink">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                placeholder="At least 6 characters"
                className={`field-input ${error ? 'field-input-error' : ''}`}
              />
            </div>
          </div>

          {error && <p className="field-error mt-2">{error}</p>}
          {notice && <p className="mt-2 text-xs leading-relaxed text-emerald-700">{notice}</p>}

          <button type="submit" className="btn-primary mt-4 w-full" disabled={!canSubmit}>
            {busy || checking ? (
              <>
                <Spinner className="size-4" />
                Working…
              </>
            ) : isSignup ? (
              'Create account'
            ) : (
              'Sign in'
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(isSignup ? 'signin' : 'signup');
              setError('');
              setNotice('');
            }}
            className="mt-3 w-full text-center text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            {isSignup ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-white/50">
          Tenant records and ID documents are stored in your own Supabase project. Do not use shared devices.
        </p>
      </div>
    </div>
  );
}

/** The four-colour Google "G", inline so there is no extra network request. */
function GoogleMark({ className = 'size-4' }) {
  return (
    <svg viewBox="0 0 18 18" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.77h2.92c1.7-1.57 2.68-3.88 2.68-7.13Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.77c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.84A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.21a5.4 5.4 0 0 1 0-3.45V3.92H.96a9 9 0 0 0 0 8.13l3.01-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 3.92l3.01 2.84C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}