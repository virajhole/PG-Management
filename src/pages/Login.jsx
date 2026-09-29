import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { LockIcon, HomeIcon } from '../components/icons.jsx';
import { Spinner } from '../components/States.jsx';
import { useData } from '../context/DataContext.jsx';

export default function Login() {
  const { login, checking, pinSet } = useAuth();
  const { settings } = useData();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (pin.length < 4) {
      setError('Enter at least 4 digits.');
      return;
    }
    const result = await login(pin);
    if (!result.ok) {
      setError(result.error);
      setPin('');
      inputRef.current?.focus();
    }
  }

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
              <h2 className="text-base font-semibold text-slate-900">Enter your PIN</h2>
              <p className="text-xs text-slate-500">
                {pinSet ? 'ID documents are stored on this device' : 'First-time setup: choose any 4-6 digit PIN'}
              </p>
            </div>
          </div>

          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            maxLength={6}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ''));
              setError('');
            }}
            placeholder="••••"
            aria-label="PIN"
            aria-invalid={error ? 'true' : 'false'}
            className={`field-input text-center text-2xl tracking-[0.4em] ${error ? 'field-input-error' : ''}`}
          />
          {error && <p className="field-error text-center">{error}</p>}

          <button type="submit" className="btn-primary mt-4 w-full" disabled={pin.length < 4 || checking}>
            {checking ? (
              <>
                <Spinner className="size-4" />
                Checking…
              </>
            ) : (
              'Unlock'
            )}
          </button>

          {!pinSet && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-center text-[11px] leading-relaxed text-amber-800">
              This PIN is stored on this device only. If you forget it, clear the site data in your browser to
              reset everything.
            </p>
          )}
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-white/50">
          All tenant data is stored locally in this browser. Do not use shared devices.
        </p>
      </div>
    </div>
  );
}
