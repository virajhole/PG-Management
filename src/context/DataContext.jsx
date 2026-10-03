import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as customerService from '../services/customerService.js';
import * as cycleService from '../services/cycleService.js';
import * as lightBillService from '../services/lightBillService.js';
import * as transactionService from '../services/transactionService.js';
import * as roomService from '../services/roomService.js';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../services/settingsService.js';
import { useOnlineStatus } from '../hooks/useOnlineStatus.js';
import { useAuth } from './AuthContext.jsx';
import { dayjs } from '../utils/dateLogic.js';
import { openCycleByCustomer as openCycleMap, getTodayTotal, getMonthTotal, monthKey, getOutstandingTotals } from '../utils/ledger.js';

/**
 * Single source of truth for the whole ledger, read from Supabase.
 * Every mutation re-reads the ledger afterwards, so what is on screen is
 * always exactly what is in the database - no local copies, ever.
 */
const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [customers, setCustomers] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [lightBills, setLightBills] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [roomsStatus, setRoomsStatus] = useState('idle'); // idle | loading | ready | error
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS }));
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [today, setToday] = useState(() => dayjs().startOf('day'));
  const online = useOnlineStatus();
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id ?? null;

  /** Reload just the room list (used by pages that change room data). */
  const refreshRooms = useCallback(async () => {
    setRoomsStatus('loading');
    try {
      const list = await roomService.listRooms();
      setRooms(list);
      setRoomsStatus('ready');
      return list;
    } catch {
      setRooms([]);
      setRoomsStatus('error');
      return [];
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [customerList, cycleList, billList, txList, roomList] = await Promise.all([
        customerService.listCustomers(),
        cycleService.listCycles(),
        lightBillService.listLightBills(),
        transactionService.listTransactions(),
        roomService.listRooms().catch(() => []),
      ]);
      setCustomers(customerList);
      setCycles(cycleList);
      setLightBills(billList);
      setTransactions(txList);
      setRooms(roomList);
      setRoomsStatus('ready');
      setStatus('ready');
      setError(null);
      return customerList;
    } catch (err) {
      setError(err);
      setStatus('error');
      return null;
    }
  }, []);

  // First load for the signed-in account.
  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) {
      setCustomers([]);
      setCycles([]);
      setLightBills([]);
      setTransactions([]);
      setRooms([]);
      setRoomsStatus('idle');
      setSettings({ ...DEFAULT_SETTINGS });
      setError(null);
      setStatus('ready');
      return undefined;
    }
    (async () => {
      setStatus('loading');
      const loadedSettings = await loadSettings().catch(() => ({ ...DEFAULT_SETTINGS }));
      if (cancelled) return;
      setSettings(loadedSettings);
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, userId, refresh]);

  // Coming back online: whatever was on screen may be stale.
  const wasOnlineRef = useRef(false);
  useEffect(() => {
    if (wasOnlineRef.current && online) refresh();
    wasOnlineRef.current = online;
  }, [online, refresh]);

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

  // -------------------------------------------------------------- mutations
  // Each one re-reads the ledger afterwards. If the database refuses a write
  // or a re-read cannot see the row, the real Supabase error surfaces - the
  // screens never show data that is not in the database.

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
      // Throws the real database error when nothing was removed. Postgres
      // cascades clear the child tables server-side.
      await customerService.deleteCustomer(id);
      await refresh();
    },
    [refresh],
  );

  const vacateCustomer = useCallback(
    async (id, date) => {
      const updated = await customerService.vacateCustomer(id, date);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const recordRentPayment = useCallback(
    async ({ customerId, amount, date, mode, note }) => {
      const result = await transactionService.recordRentPayment({ customerId, amount, date, mode, note });
      await refresh();
      return result;
    },
    [refresh],
  );

  const saveLightBill = useCallback(
    async (bill) => {
      const saved = await lightBillService.saveLightBill(bill);
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

  const updateSettings = useCallback(async (next) => {
    const saved = await saveSettings(next);
    setSettings(saved);
    return saved;
  }, []);

  // ---------------------------------------------------------- derived views

  const openCycleByCustomer = useMemo(() => openCycleMap(cycles), [cycles]);
  const todayTotal = useMemo(() => getTodayTotal(transactions, today), [transactions, today]);
  const thisMonthKey = useMemo(() => monthKey(today), [today]);
  const monthTotal = useMemo(() => getMonthTotal(transactions, thisMonthKey), [transactions, thisMonthKey]);
  const outstandingTotals = useMemo(() => getOutstandingTotals({ cycles, lightBills }), [cycles, lightBills]);

  const value = useMemo(
    () => ({
      customers,
      cycles,
      lightBills,
      transactions,
      rooms,
      roomsStatus,
      refreshRooms,
      settings,
      status,
      error,
      online,
      today,
      openCycleByCustomer,
      todayTotal,
      monthTotal,
      outstandingTotals,
      thisMonthKey,
      refresh,
      createCustomer,
      updateCustomer,
      deleteCustomer,
      vacateCustomer,
      recordRentPayment,
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
      rooms,
      roomsStatus,
      refreshRooms,
      settings,
      status,
      error,
      online,
      today,
      openCycleByCustomer,
      todayTotal,
      monthTotal,
      outstandingTotals,
      thisMonthKey,
      refresh,
      createCustomer,
      updateCustomer,
      deleteCustomer,
      vacateCustomer,
      recordRentPayment,
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
