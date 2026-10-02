import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { ShieldAlertIcon, LogoutIcon, MailIcon, DatabaseIcon, TerminalIcon } from '../components/icons.jsx';

/**
 * Shown when someone authenticated successfully but could not be let in.
 *
 * Two very different failures land here, and telling somebody the wrong one
 * wastes their afternoon:
 *
 *   * `setupIncomplete` - the `admins` table is missing or unreadable, i.e. the
 *     database migrations were never run. This is by far the most common case
 *     after pointing the app at a project that only has migrations 001-002, and
 *     the person hitting it is usually the *owner*, who cannot reach
 *     Settings -> Team to fix it. So this variant prints the SQL to run.
 *   * otherwise the address genuinely is not on the allowlist, and the owner
 *     has to add it under Settings -> Team.
 *
 * The session has already been signed out by `verifyAccess` before this
 * renders, so there is nothing to protect - this screen exists purely to
 * explain *why* they are looking at it.
 */
export default function AccessDenied({ email }) {
  const navigate = useNavigate();
  const { logout, configured, allowlist, setupIncomplete } = useAuth();
  const address = email ?? '';

  // An empty list means bootstrap_owner() itself could not run, which lands on
  // the same fix as a missing table.
  const missingSchema = setupIncomplete || Boolean(allowlist?.empty);

  async function goBack() {
    try {
      await logout();
    } finally {
      navigate('/login', { replace: true });
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-5 py-12">
      <div className="card w-full max-w-md p-6 text-center sm:p-8">
        <div
          className={
            missingSchema
              ? 'mx-auto flex size-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300'
              : 'mx-auto flex size-16 items-center justify-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300'
          }
        >
          {missingSchema ? <DatabaseIcon className="size-8" /> : <ShieldAlertIcon className="size-8" />}
        </div>

        {missingSchema ? (
          <>
            <h1 className="mt-4 text-xl font-bold text-ink">Database not set up</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-subtle">
              Sign-in worked, but this project has no <span className="font-semibold text-ink">admins</span> table,
              so nobody can be let in yet. Nobody is locked out &mdash; the migrations just need to run once.
            </p>

            <div className="mt-4 rounded-xl border border-line bg-sunken p-3 text-left">
              <p className="flex items-center gap-2 text-xs font-semibold text-ink">
                <TerminalIcon className="size-3.5" />
                Supabase dashboard &rarr; SQL Editor &rarr; New query
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
                paste &amp; run supabase/repair.sql{'\n'}
                (or supabase/schema.sql for a full rebuild)
              </pre>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
                Safe to run twice &mdash; every statement is <code className="text-ink-subtle">if not exists</code>. Then
                sign in again: the first account to sign in on an empty list becomes the owner.
              </p>
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-xl font-bold text-ink">Access denied</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-subtle">
              Your Google account is not on this PG&rsquo;s allowlist, so there is no ledger for you to see. The
              owner has to add your address under{' '}
              <span className="font-semibold text-ink">Settings → Team</span> first.
            </p>
          </>
        )}

        {address && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-lg bg-sunken px-3 py-2 text-xs font-medium text-ink-muted">
            <MailIcon className="size-3.5" />
            {address}
          </p>
        )}

        {!configured && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Supabase is not configured on this build, so the allowlist could not be checked at all.
          </p>
        )}

        <button type="button" className="btn-primary mt-6 w-full" onClick={goBack}>
          <LogoutIcon className="size-4" />
          Back to sign in
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-ink-muted">
          {missingSchema
            ? 'Already ran the SQL? Sign in again - the check re-runs on every sign-in.'
            : 'Already added? Ask the owner to double-check the spelling of the address, then sign in again.'}
        </p>
      </div>
    </div>
  );
}