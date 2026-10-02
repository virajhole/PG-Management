import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';

/**
 * Small reusable component library on top of the design tokens:
 * Button, Card, Badge, Input, Select, Modal, BottomSheet, Tabs, Avatar,
 * ProgressBar, StatCard, EmptyState, Skeleton.
 *
 * Everything reads semantic tokens (surface / line / ink / brand / accent), so
 * one implementation themes both light and dark. Motion respects
 * prefers-reduced-motion via `useReducedMotion`.
 */

// ------------------------------------------------------------------ Button

const BUTTON_VARIANTS = {
  primary: 'btn-primary',
  gradient: 'btn-gradient',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
  accent: 'btn-accent',
};

const BUTTON_SIZES = {
  sm: 'min-h-9 px-3 text-xs',
  md: '',
  lg: 'min-h-12 px-6 text-base',
  icon: 'size-10 p-0',
};

export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`${BUTTON_VARIANTS[variant] ?? variant} ${BUTTON_SIZES[size] ?? ''} ${className}`}
      {...props}
    />
  );
}

// -------------------------------------------------------------------- Card

export function Card({ as: Tag = 'div', hover = false, className = '', children, ...props }) {
  return (
    <Tag className={`card ${hover ? 'card-hover' : ''} ${className}`} {...props}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        {title && <h3 className="section-title truncate">{title}</h3>}
        {subtitle && <p className="mt-0.5 truncate text-xs text-ink-subtle">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ------------------------------------------------------------------- Badge

const BADGE_TONES = {
  neutral: 'border-line bg-surface-muted text-ink-muted',
  brand: 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950/60 dark:text-brand-300',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300',
  warning: 'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300',
  danger: 'border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300',
  accent: 'border-accent-200 bg-accent-50 text-accent-700 dark:border-accent-900 dark:bg-accent-950/50 dark:text-accent-300',
};

export function Badge({ tone = 'neutral', className = '', children, ...props }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
        BADGE_TONES[tone] ?? tone
      } ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------- Input family

export function Input({ className = '', error = false, ...props }) {
  return <input className={`field-input ${error ? 'field-input-error' : ''} ${className}`} {...props} />;
}

export function Select({ className = '', error = false, children, ...props }) {
  return (
    <select
      className={`field-input appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-10
                  ${error ? 'field-input-error' : ''} ${className}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7590' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({ className = '', error = false, rows = 3, ...props }) {
  return <textarea rows={rows} className={`field-input resize-y ${error ? 'field-input-error' : ''} ${className}`} {...props} />;
}

export function Field({ id, label, error, hint, required = false, className = '', children }) {
  return (
    <div className={className}>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : (
        hint && (
          <p className="field-hint" id={`${id}-hint`}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

// ------------------------------------------------------------------- Modal

export function Modal({ open, onClose, title, description, children, footer, size = 'md', dismissible = true }) {
  const panelRef = useRef(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return undefined;

    const previousFocus = document.activeElement;
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
    const raf = requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector('[data-autofocus]') ?? panelRef.current;
      target?.focus?.();
    });

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(raf);
      document.body.style.overflow = overflow;
      previousFocus?.focus?.();
    };
  }, [open, onClose, dismissible]);

  if (!open) return null;

  const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={dismissible ? onClose : undefined} aria-hidden="true" />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className={`relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-line
                    bg-raised shadow-2xl outline-none sm:rounded-2xl ${width}`}
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
                className="-mr-1 -mt-1 rounded-lg p-2 text-ink-subtle transition hover:bg-sunken hover:text-ink"
                aria-label="Close dialog"
              >
                <X className="size-5" />
              </button>
            )}
          </header>
        )}

        <div className="scroll-slim flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && <footer className="border-t border-line bg-surface-muted px-5 py-4">{footer}</footer>}
      </motion.div>
    </div>
  );
}

// -------------------------------------------------------------- BottomSheet

/**
 * Mobile-first sliding sheet (slides up from the bottom edge). Used by the FAB
 * quick-action menu, the notification centre and swipe-action confirmations.
 * On desktop it renders centred like a modal.
 */
export function BottomSheet({ open, onClose, title, children, maxHeight = '85dvh' }) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return undefined;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <motion.div
            className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={reduceMotion ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduceMotion ? undefined : { y: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            drag={reduceMotion ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => info.offset.y > 90 && onClose?.()}
            className="relative flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-line
                       bg-raised pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-w-lg sm:rounded-2xl"
            style={{ maxHeight }}
          >
            <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-2">
              <span className="mx-auto h-1.5 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden="true" />
              <button
                type="button"
                onClick={onClose}
                className="absolute top-3 right-3 rounded-lg p-2 text-ink-subtle hover:bg-sunken hover:text-ink"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
            {title && <h2 className="px-5 pb-2 text-base font-semibold text-ink">{title}</h2>}
            <div className="scroll-slim flex-1 overflow-y-auto px-5 pt-1 pb-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// -------------------------------------------------------------------- Tabs

export function Tabs({ tabs, active, onChange, className = '' }) {
  return (
    <div className={`no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface-muted p-1 ${className}`} role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.value === active;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange?.(tab.value)}
            className={`relative flex-1 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition ${
              isActive ? 'text-ink' : 'text-ink-subtle hover:text-ink'
            }`}
          >
            {isActive && (
              <motion.span
                layoutId={tab.layoutGroup ? `tab-pill-${tab.layoutGroup}` : 'tab-pill'}
                className="absolute inset-0 rounded-lg bg-raised shadow-sm ring-1 ring-line"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative flex items-center justify-center gap-1.5">
              {tab.icon && <tab.icon className="size-4" />}
              {tab.label}
              {tab.count !== undefined && (
                <span className={`rounded-full px-1.5 text-[10px] font-bold ${isActive ? 'bg-brand-600 text-white' : 'bg-line text-ink-subtle'}`}>
                  {tab.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Avatar

const AVATAR_HUES = ['from-indigo-500 to-violet-500', 'from-teal-500 to-emerald-500', 'from-amber-500 to-orange-500', 'from-rose-500 to-pink-500', 'from-sky-500 to-cyan-500'];

function hueFor(name) {
  let sum = 0;
  for (const ch of String(name || '')) sum += ch.codePointAt(0);
  return AVATAR_HUES[sum % AVATAR_HUES.length];
}

export function Avatar({ name = '', src = null, size = 'md', className = '' }) {
  const sizes = { xs: 'size-7 text-[10px]', sm: 'size-9 text-xs', md: 'size-11 text-sm', lg: 'size-14 text-lg', xl: 'size-20 text-2xl' };
  const initials = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '?';

  if (src) {
    return <img src={src} alt={name} className={`${sizes[size]} shrink-0 rounded-full object-cover ring-2 ring-white/70 dark:ring-white/10 ${className}`} />;
  }
  return (
    <span
      className={`inline-flex ${sizes[size]} shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-white ${hueFor(name)} ${className}`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

// ------------------------------------------------------------- ProgressBar

export function ProgressBar({ percent = 0, tone = 'brand', className = '', label }) {
  const reduceMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const tones = {
    brand: 'bg-gradient-to-r from-brand-500 to-violet-500',
    accent: 'bg-gradient-to-r from-accent-500 to-emerald-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
    muted: 'bg-line-strong',
  };
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-sunken ${className}`}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <motion.div
        className={`h-full rounded-full ${tones[tone] ?? tones.brand}`}
        initial={reduceMotion ? false : { width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- StatCard

/** Animated number counter (also the revenue hero). Honours reduced motion. */
export function AnimatedNumber({ value, format = (n) => String(n), className = '' }) {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(reduceMotion ? value : 0);
  // `null` means "the mount animation has not started yet". Initialising to
  // `value` instead made the counter freeze at 0 whenever the number never
  // changed after mount (from === to short-circuits the effect).
  const previous = useRef(null);

  useEffect(() => {
    if (reduceMotion) {
      previous.current = value;
      setDisplay(value);
      return undefined;
    }
    const from = previous.current ?? 0;
    const to = value;
    previous.current = value;
    if (from === to) {
      setDisplay(to);
      return undefined;
    }

    const duration = 550;
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduceMotion]);

  return <span className={`tabular-nums ${className}`}>{format(display)}</span>;
}

const STAT_TONES = {
  brand: { icon: 'bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300', value: 'text-ink' },
  accent: { icon: 'bg-accent-50 text-accent-600 dark:bg-accent-950/60 dark:text-accent-300', value: 'text-ink' },
  danger: { icon: 'bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400', value: 'text-red-600 dark:text-red-400' },
  warning: { icon: 'bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400', value: 'text-amber-700 dark:text-amber-400' },
  neutral: { icon: 'bg-sunken text-ink-subtle', value: 'text-ink' },
};

export function StatCard({ label, value, sub, icon: Icon, tone = 'brand', animated = false, format, className = '' }) {
  const t = STAT_TONES[tone] ?? STAT_TONES.brand;
  const isNumeric = typeof value === 'number';
  return (
    <Card hover className={`flex items-center gap-3 p-4 ${className}`}>
      {Icon && (
        <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${t.icon}`}>
          <Icon className="size-5" />
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-ink-subtle">{label}</p>
        <p className={`mt-0.5 truncate text-xl leading-tight font-bold ${t.value}`}>
          {isNumeric && animated ? <AnimatedNumber value={value} format={format} /> : value}
        </p>
        {sub && <p className="mt-0.5 truncate text-[11px] text-ink-subtle">{sub}</p>}
      </div>
    </Card>
  );
}

// -------------------------------------------------------------- EmptyState

export function EmptyState({ icon: Icon, title, message, action, tone = 'brand' }) {
  const tones = {
    slate: 'bg-sunken text-ink-subtle',
    brand: 'bg-brand-50 text-brand-500 dark:bg-brand-950/60 dark:text-brand-300',
    accent: 'bg-accent-50 text-accent-600 dark:bg-accent-950/60 dark:text-accent-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300',
  };
  return (
    <motion.div
      initial={false}
      className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong bg-raised/60 px-6 py-14 text-center"
    >
      {Icon && (
        <div className={`flex size-16 items-center justify-center rounded-2xl ${tones[tone] ?? tones.brand}`}>
          <Icon className="size-8" />
        </div>
      )}
      {/* Simple inline "illustration": layered dots. */}
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-line-strong"
            animate={{ scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ repeat: Infinity, duration: 1.6, delay: i * 0.2 }}
          />
        ))}
      </div>
      <div>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {message && <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-subtle">{message}</p>}
      </div>
      {action}
    </motion.div>
  );
}

// ---------------------------------------------------------------- Skeleton

export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function SkeletonList({ count = 5 }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="flex items-center gap-3 p-4">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-20" />
        </Card>
      ))}
    </div>
  );
}

export function SkeletonBlock({ className = 'h-32' }) {
  return (
    <Card className={`p-4 ${className}`}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="mt-3 h-3 w-1/2" />
      <Skeleton className="mt-2 h-3 w-2/5" />
    </Card>
  );
}

// ----------------------------------------------------------------- helpers

/** Motion presets shared by pages for list-item enter animations. */
export const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

export const listItemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
};

export { AnimatePresence, motion, useReducedMotion };
