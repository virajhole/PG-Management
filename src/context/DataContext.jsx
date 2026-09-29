import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import * as customerService from '../services/customerService.js';
import { loadSettings, saveSettings } from '../services/settingsService.js';
import { ensureSeeded } from '../services/seedService.js';
import { dayjs } from '../utils/dateLogic.js';

/**
 * Single source of truth for customers + settings.
 *
 * Components call the service functions through this context and re-read
 * afterwards; nothing above this file knows whether records live in
 * localStorage, IndexedDB or a remote API.
 */
const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [customers, setCustomers] = useState([]);
  const [settings, setSettings] = useState(() => loadSettings());
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [today, setToday] = useState(() => dayjs().startOf('day'));

  const refresh = useCallback(async () => {
    try {
      const list = await customerService.listCustomers();
      setCustomers(list);
      setStatus('ready');
      setError(null);
    } catch (err) {
      setError(err);
      setStatus('error');
    }
  }, []);

  // First load: seed the demo records, then read everything back.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        await ensureSeeded();
        const list = await customerService.listCustomers();
        if (cancelled) return;
        setCustomers(list);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err);
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep "today" honest if the app stays open across midnight.
  useEffect(() => {
    const tick = () => {
      const now = dayjs().startOf('day');
      setToday((prev) => (prev.isSame(now) ? prev : now));
    };
    const interval = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const createCustomer = useCallback(
    async (data) => {
      const created = await customerService.createCustomer(data);
      await refresh();
      return created;
    },
    [refresh],
  );

  const updateCustomer = useCallback(
    async (id, patch) => {
      const updated = await customerService.updateCustomer(id, patch);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const deleteCustomer = useCallback(
    async (id) => {
      await customerService.deleteCustomer(id);
      await refresh();
    },
    [refresh],
  );

  const addPayment = useCallback(
    async (id, payment) => {
      const result = await customerService.addPayment(id, payment);
      await refresh();
      return result;
    },
    [refresh],
  );

  const removePayment = useCallback(
    async (id, paymentId) => {
      await customerService.removePayment(id, paymentId);
      await refresh();
    },
    [refresh],
  );

  const setCustomerImage = useCallback(
    async (id, kind, dataUrl) => {
      const updated = await customerService.setCustomerImage(id, kind, dataUrl);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const updateSettings = useCallback((next) => {
    const saved = saveSettings(next);
    setSettings(saved);
    return saved;
  }, []);

  const resync = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      customers,
      settings,
      status,
      error,
      today,
      refresh,
      resync,
      createCustomer,
      updateCustomer,
      deleteCustomer,
      addPayment,
      removePayment,
      setCustomerImage,
      updateSettings,
    }),
    [
      customers,
      settings,
      status,
      error,
      today,
      refresh,
      resync,
      createCustomer,
      updateCustomer,
      deleteCustomer,
      addPayment,
      removePayment,
      setCustomerImage,
      updateSettings,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>.');
  return ctx;
}

/** Convenience: sorted + filtered list for the dashboard. */
export function useCustomers() {
  const { customers, today } = useData();
  return useMemo(
    () => customerService.sortByDueDate(customers, today),
    [customers, today],
  );
}
