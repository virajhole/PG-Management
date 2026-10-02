import { useEffect, useRef } from 'react';
import { AlertIcon } from './icons.jsx';

/** Accessible modal: focus trap on open, Escape to close, click-outside to dismiss. */
export default function Modal({ open, onClose, title, description, children, footer, size = 'md', dismissible = true }) {
  const panelRef = useRef(null);
  const previousFocus = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previousFocus.current = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    // Move focus into the dialog on the next frame, once it has rendered.
    const raf = requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector('[data-autofocus]') ?? panelRef.current;
      target?.focus?.();
    });

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(raf);
      document.body.style.overflow = overflow;
      previousFocus.current?.focus?.();
    };
  }, [open, onClose, dismissible]);

  if (!open) return null;

  const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={dismissible ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`animate-toast-in relative flex max-h-[92vh] w-full flex-col overflow-hidden
                    rounded-t-3xl bg-raised shadow-2xl outline-none sm:rounded-2xl ${width}`}
      >
        {title && (
          <header className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="flex-1">
              <h2 className="text-base font-semibold text-ink">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-ink-subtle">{description}</p>}
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                className="-mr-1 -mt-1 rounded-lg p-2 text-ink-subtle transition hover:bg-sunken hover:text-ink-muted"
                aria-label="Close dialog"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </header>
        )}

        <div className="scroll-slim flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && <footer className="border-t border-line bg-sunken px-5 py-4">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
            data-autofocus
          >
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      }
    >
      <div className="flex gap-3">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
            tone === 'danger' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
          }`}
        >
          <AlertIcon className="size-5" />
        </div>
        <p className="pt-1.5 text-sm leading-relaxed text-ink-muted">{message}</p>
      </div>
    </Modal>
  );
}
