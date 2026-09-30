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
  const { login, signup, checking, busy, configured } = useAuth();
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
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
            <HomeIcon className="size-8" />
          </div>
          <h1 className="text-2xl font-bold">{settings.pgName || 'PG Manager'}</h1>
          <p className="mt-1 text-sm text-white/70">Tenant &amp; rent management</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl bg-white p-6 shadow-2xl">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <LockIcon className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {isSignup ? 'Create your account' : 'Sign in'}
              </h2>
              <p className="text-xs text-slate-500">
                {isSignup
                  ? 'One account per PG. Your tenants stay private to it.'
                  : 'Your tenant data lives in your own Supabase account'}
              </p>
            </div>
          </div>

          {!configured && (
            <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
              Supabase is not configured. Copy <span className="font-semibold">.env.example</span> to{' '}
              <span className="font-semibold">.env</span>, add your project URL and anon key, then restart the
              dev server.
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-semibold text-slate-700">
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
              <label htmlFor="password" className="mb-1 block text-xs font-semibold text-slate-700">
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