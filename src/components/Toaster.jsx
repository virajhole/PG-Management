import { useToast } from '../context/ToastContext.jsx';

const TONES = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-line bg-raised text-ink',
};

const ICONS = {
  success: (
    <path d="M20 6 9 17l-5-5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" strokeWidth="2" />
      <path d="M12 8v4m0 4h.01" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  warning: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 9v4m0 4h.01" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" strokeWidth="2" />
      <path d="M12 16v-4m0-4h.01" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
};

export default function Toaster() {
  const { toasts, dismiss } = useToast();
  if (!toasts.length) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4
                 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end sm:px-0"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={`animate-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3
                      rounded-xl border px-4 py-3 shadow-lg ${TONES[toast.type] ?? TONES.info}`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="mt-0.5 size-5 shrink-0"
            aria-hidden="true"
          >
            {ICONS[toast.type] ?? ICONS.info}
          </svg>
          <p className="flex-1 text-sm leading-snug font-medium break-words">{toast.message}</p>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action.onClick?.();
                dismiss(toast.id);
              }}
              className="shrink-0 rounded-lg bg-black/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wide hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20"
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            className="-mr-1 shrink-0 rounded-lg p-1 opacity-60 transition hover:bg-black/5 hover:opacity-100"
            aria-label="Dismiss notification"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
