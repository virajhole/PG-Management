import { Component } from 'react';
import { AlertIcon, HomeIcon } from './icons.jsx';

/**
 * Error boundaries.
 *
 * A render-time throw anywhere below used to blank the entire app: React
 * unmounts the whole tree when an error escapes the root, so one broken page
 * (a null field from an un-migrated table, a malformed row, a missing map
 * target) took the shell, the sidebar and the session with it.
 *
 * `RouteBoundary` wraps each route so only the page content is replaced, and
 * `AppErrorBoundary` is the last-resort net at the root for anything thrown
 * by a provider above the router (theme, toast, auth).
 *
 * Both render the same friendly screen with a Retry button that clears the
 * captured error and re-renders. Retry is a reset rather than a reload: the
 * route stays where it was, so the admin does not lose their place, and the
 * ledger is re-read by the data layer on its next refresh.
 */
class ErrorBoundaryBase extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the real stack for the console; the UI never shows raw internals.
    // eslint-disable-next-line no-console
    console.error('[pg-manager] render error', error, info?.componentStack);
    this.props.onError?.(error, info);
  }

  reset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, label = 'This page', compact = false } = this.props;

    if (!error) return children;
    return <ErrorScreen error={error} label={label} compact={compact} onRetry={this.reset} />;
  }
}

function ErrorScreen({ error, label, compact, onRetry }) {
  const message =
    error?.message && typeof error.message === 'string'
      ? error.message
      : 'An unexpected error stopped this screen from loading.';

  return (
    <div
      role="alert"
      className={
        compact
          ? 'flex min-h-[50dvh] flex-col items-center justify-center gap-4 px-4 text-center'
          : 'flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center'
      }
    >
      <div className="flex size-16 items-center justify-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300">
        <AlertIcon className="size-8" />
      </div>
      <div>
        <h1 className="text-lg font-bold text-ink sm:text-xl">Something went wrong</h1>
        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-ink-subtle">
          {label} ran into a problem. Your data is safe - nothing was changed. Try again, and if it keeps
          happening reload the app.
        </p>
      </div>
      <details className="max-w-md text-left text-xs text-ink-muted">
        <summary className="cursor-pointer font-medium">Technical detail</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-sunken p-3 text-[11px] whitespace-pre-wrap">
          {message}
        </pre>
      </details>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" className="btn-primary" onClick={onRetry}>
          Retry
        </button>
        <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>
          Reload app
        </button>
        {!compact && (
          <a href="/" className="btn-ghost">
            <HomeIcon className="size-4" />
            Go to dashboard
          </a>
        )}
      </div>
    </div>
  );
}

/** Root-level net. Wraps the whole app, providers included. */
export function AppErrorBoundary({ children }) {
  return (
    <ErrorBoundaryBase label="The app">
      {children}
    </ErrorBoundaryBase>
  );
}

/**
 * Per-route net. `key` should include the pathname so navigating between two
 * broken pages clears the previous error instead of showing the old screen.
 */
export function RouteBoundary({ children, routeKey, label = 'This page' }) {
  return (
    <ErrorBoundaryBase key={routeKey} label={label} compact>
      {children}
    </ErrorBoundaryBase>
  );
}

export { ErrorBoundaryBase as ErrorBoundary };
export default AppErrorBoundary;