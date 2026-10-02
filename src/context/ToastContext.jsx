import { createContext, useContext, useCallback, useMemo, useRef, useState } from 'react';
import { createId } from '../utils/dateLogic.js';

/**
 * Lightweight toast queue. Lives in context so any page can call
 * `toast.success('Saved')` without prop drilling.
 *
 * Toasts are kept in a module-level registry so a `toast.success()` fired
 * immediately before a page navigation still renders: the classic case is the
 * admission form, whose success toast races its own `navigate('/')`.
 */

const ToastContext = createContext(null);

// Module-level mirror of the queue, written synchronously by push() before any
// navigation unmounts the caller.
const toastLog = [];

export function getQueuedToasts() {
  return toastLog;
}

const DEFAULT_DURATION = 3200;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message, { type = 'info', duration = DEFAULT_DURATION, action } = {}) => {
      const id = createId('toast');
      toastLog.push({ id, message, type, action });
      if (toastLog.length > 10) toastLog.shift();
      setToasts((list) => [...list.slice(-2), { id, message, type, action }]);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  /**
   * Destructive-action safety net: runs `perform` immediately, then offers a
   * 10-second Undo window. `undo` reverses it. If the user never taps Undo
   * the action simply stands.
   */
  const withUndo = useCallback(
    async (perform, undo, { pendingMessage = 'Done', undoneMessage = 'Undone.' } = {}) => {
      const result = await perform();
      let undone = false;
      push(pendingMessage, {
        type: 'success',
        duration: 10_000,
        action: {
          label: 'Undo',
          onClick: async () => {
            if (undone) return;
            undone = true;
            try {
              await undo();
              push(undoneMessage, { type: 'info' });
            } catch (err) {
              push(err.message || 'Could not undo.', { type: 'error' });
            }
          },
        },
      });
      return result;
    },
    [push],
  );

  const value = useMemo(
    () => ({
      toasts,
      dismiss,
      success: (message, options) => push(message, { ...options, type: 'success' }),
      error: (message, options) => push(message, { ...options, type: 'error', duration: 4500 }),
      warning: (message, options) => push(message, { ...options, type: 'warning' }),
      info: (message, options) => push(message, { ...options, type: 'info' }),
      withUndo,
    }),
    [toasts, push, dismiss, withUndo],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>.');
  return ctx;
}
