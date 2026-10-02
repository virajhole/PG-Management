/** Shared loading / empty / error placeholders. */

export function Spinner({ className = 'size-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-subtle">
      <Spinner className="size-7 text-brand-600" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-raised p-4">
      <div className="size-11 shrink-0 animate-pulse rounded-full bg-line-strong" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-1/3 animate-pulse rounded bg-line-strong" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-sunken" />
      </div>
      <div className="h-8 w-20 animate-pulse rounded-lg bg-sunken" />
    </div>
  );
}

export function SkeletonList({ count = 5 }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading customers">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, message, action, tone = 'slate' }) {
  const tones = {
    slate: 'bg-sunken text-ink-subtle',
    brand: 'bg-brand-50 text-brand-600',
    amber: 'bg-amber-50 text-amber-600',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong bg-raised/60 px-6 py-14 text-center">
      {Icon && (
        <div className={`flex size-14 items-center justify-center rounded-full ${tones[tone]}`}>
          <Icon className="size-7" />
        </div>
      )}
      <div>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {message && <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-subtle">{message}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-6 py-12 text-center"
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-red-100 text-red-600">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-7">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4.5M12 16h.01" strokeLinecap="round" />
        </svg>
      </div>
      <div>
        <h3 className="text-base font-semibold text-red-900">{title}</h3>
        {message && <p className="mx-auto mt-1 max-w-sm text-sm text-red-700">{message}</p>}
      </div>
      {onRetry && (
        <button type="button" className="btn-secondary mt-1" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
