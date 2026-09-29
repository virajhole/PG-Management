import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import * as customerService from '../services/customerService.js';
import * as cycleService from '../services/cycleService.js';
import * as lightBillService from '../services/lightBillService.js';
import * as transactionService from '../services/transactionService.js';
import * as migrationService from '../services/migrationService.js';
import { loadSettings, saveSettings } from '../services/settingsService.js';
import { ensureSeeded } from '../services/seedService.js';
import { dayjs } from '../utils/dateLogic.js';
import { getPendingList, getOutstandingTotals, getMonthTotal, monthKey } from '../utils/ledger.js';

/**
 * Single source of truth for the whole ledger.
 *
 * Components call the service functions through this context and re-read
 * afterwards; nothing above this file knows whether records live in
 * localStorage, IndexedDB or a remote API.
 */
const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [customers, setCustomers] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [lightBills, setLightBills] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [settings, setSettings] = useState(() => loadSettings());
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [today, setToday] = useState(() => dayjs().startOf('day'));

  const refresh = useCallback(async () => {
    try {
      const [customerList, cycleList, billList, txList] = await Promise.all([
        customerService.listCustomers(),
        cycleService.listCycles(),
        lightBillService.listLightBills(),
        transactionService.listTransactions(),
      ]);
      setCustomers(customerList);
      setCycles(cycleList);
      setLightBills(billList);
      setTransactions(txList);
      setStatus('ready');
      setError(null);
    } catch (err) {
      setError(err);
      setStatus('error');
    }
  }, []);

  // First load: upgrade old data (if any), seed the demo records on a fresh
  // install, then read everything back.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        await migrationService.runMigration();
        await ensureSeeded();
        const [customerList, cycleList, billList, txList] = await Promise.all([
          customerService.listCustomers(),
          cycleService.listCycles(),
          lightBillService.listLightBills(),
          transactionService.listTransactions(),
        ]);
        if (cancelled) return;
        setCustomers(customerList);
        setCycles(cycleList);
        setLightBills(billList);
        setTransactions(txList);
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
      // Remove the tenant and everything their ledger refers to.
      await Promise.all([
        customerService.deleteCustomer(id),
        cycleService.deleteCyclesForCustomer(id),
        lightBillService.deleteLightBillsForCustomer(id),
        transactionService.deleteTransactionsForCustomer(id),
      ]);
      await refresh();
    },
    [refresh],
  );

  // ------------------------------------------------------------------ ledger

  const recordRentPayment = useCallback(
    async ({ customerId, amount, date, mode, note }) => {
      const result = await transactionService.recordRentPayment({ customerId, amount, date, mode, note });
      await refresh();
      return result;
    },
    [refresh],
  );

  const previewRentPayment = useCallback(
    async ({ customerId, amount }) => transactionService.previewRentPayment({ customerId, amount }),
    [],
  );

  const saveLightBill = useCallback(
    async (bill) => {
      const saved = await transactionService.saveLightBill(bill);
      await refresh();
      return saved;
    },
    [refresh],
  );

  const recordLightBillPayment = useCallback(
    async ({ customerId, billId, amount, date, mode, note }) => {
      const result = await transactionService.recordLightBillPayment({ customerId, billId, amount, date, mode, note });
      await refresh();
      return result;
    },
    [refresh],
  );

  const deleteTransaction = useCallback(
    async (id) => {
      const result = await transactionService.deleteTransaction(id);
      await refresh();
      return result;
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

  // ---------------------------------------------------------- derived views
  // Kept in the context so the dashboard, list and details pages all read the
  // same numbers instead of recomputing them with slightly different input.

  const openCycleByCustomer = useMemo(() => {
    const map = new Map();
    for (const cycle of cycles) {
      // First write wins - cycles are produced newest-last, so the final map
      // entry for each tenant is their newest cycle.
      if (!map.has(cycle.customerId)) map.set(cycle.customerId, cycle);
    }
    return map;
  }, [cycles]);

  const pendingList = useMemo(
    () => getPendingList({ customers, cycles, lightBills, today }),
    [customers, cycles, lightBills, today],
  );

  const outstandingTotals = useMemo(() => getOutstandingTotals({ cycles, lightBills }), [cycles, lightBills]);

  const thisMonthKey = useMemo(() => monthKey(today), [today]);
  const monthTotal = useMemo(
    () => getMonthTotal(transactions, thisMonthKey),
    [transactions, thisMonthKey],
  );

  const value = useMemo(
    () => ({
      customers,
      cycles,
      lightBills,
      transactions,
      settings,
      status,
      error,
      today,
      openCycleByCustomer,
      pendingList,
      outstandingTotals,
      monthTotal,
      thisMonthKey,
      refresh,
      resync,
      createCustomer,
      updateCustomer,
      deleteCustomer,
      recordRentPayment,
      previewRentPayment,
      saveLightBill,
      recordLightBillPayment,
      deleteTransaction,
      setCustomerImage,
      updateSettings,
    }),
    [
      customers,
      cycles,
      lightBills,
      transactions,
      settings,
      status,
      error,
      today,
      openCycleByCustomer,
      pendingList,
      outstandingTotals,
      monthTotal,
      thisMonthKey,
      refresh,
      resync,
      createCustomer,
      updateCustomer,
      deleteCustomer,
      recordRentPayment,
      previewRentPayment,
      saveLightBill,
      recordLightBillPayment,
      deleteTransaction,
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