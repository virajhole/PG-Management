import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as customerService from '../services/customerService.js';
import * as cycleService from '../services/cycleService.js';
import * as lightBillService from '../services/lightBillService.js';
import * as transactionService from '../services/transactionService.js';
import * as agreementsService from '../services/agreementsService.js';
import * as roomService from '../services/roomService.js';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../services/settingsService.js';
import { useOnlineStatus } from '../hooks/useOnlineStatus.js';
import { useAuth } from './AuthContext.jsx';
import { dayjs } from '../utils/dateLogic.js';
import { getPendingList, getOutstandingTotals, getMonthTotal, monthKey } from '../utils/ledger.js';

/**
 * Single source of truth for the whole ledger, read from Supabase.
 *
 * Components call the service functions through this context and re-read
 * afterwards; nothing above this file knows whether records live in Postgres,
 * a REST API or the fake in-memory database the tests use.
 */
const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [customers, setCustomers] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [lightBills, setLightBills] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS }));
  // Rooms live here too. Global search, the assets inventory and the operations
  // sheets all read the room list from this context, so it has to be part of the
  // same always-an-array guarantee as the ledger collections. `roomsStatus` is
  // separate because rooms are optional (a fresh account has none, and the
  // table may not even exist on an older backend) - a room load failure must
  // never take the whole ledger down with it.
  const [rooms, setRooms] = useState([]);
  const [roomsStatus, setRoomsStatus] = useState('idle'); // idle | loading | ready | error
  const [roomsError, setRoomsError] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [today, setToday] = useState(() => dayjs().startOf('day'));
  const online = useOnlineStatus();
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id ?? null;

  /**
   * Reload rooms on their own. Failures land in `roomsError` instead of
   * rejecting, so callers can render an inline notice and carry on.
   */
  const refreshRooms = useCallback(async () => {
    setRoomsStatus('loading');
    try {
      const list = await roomService.listRooms();
      setRooms(Array.isArray(list) ? list : []);
      setRoomsError(null);
      setRoomsStatus('ready');
      return true;
    } catch (err) {
      setRooms([]);
      setRoomsError(err);
      setRoomsStatus('error');
      return false;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [customerList, cycleList, billList, txList] = await Promise.all([
        customerService.listCustomers(),
        cycleService.listCycles(),
        lightBillService.listLightBills(),
        transactionService.listTransactions(),
      ]);
      setCustomers(Array.isArray(customerList) ? customerList : []);
      setCycles(Array.isArray(cycleList) ? cycleList : []);
      setLightBills(Array.isArray(billList) ? billList : []);
      setTransactions(Array.isArray(txList) ? txList : []);
      setStatus('ready');
      setError(null);
    } catch (err) {
      setError(err);
      setStatus('error');
    }
  }, []);

  // First load for the signed-in account: upgrade any leftover on-device data
  // into it (one time, only if there is some), then read everything back. Note
  // there is no auto-seeding any more - this is a real ledger, not a demo.
  //
  // RLS scopes every query to `auth.uid()`, so this must not run while signed
  // out. Keying on the user also means signing in reloads the ledger: the
  // provider sits above the route gate, and a load that happened on the login
  // screen would only ever see empty results.
  useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated) {
      setCustomers([]);
      setCycles([]);
      setLightBills([]);
      setTransactions([]);
      setSettings({ ...DEFAULT_SETTINGS });
      setRooms([]);
      setRoomsError(null);
      setRoomsStatus('idle');
      setError(null);
      setStatus('ready');
      return undefined;
    }

    (async () => {
      setStatus('loading');
      // Rooms are optional; never let their failure block the ledger load.
      refreshRooms();
      try {
        // On-device data is *not* imported automatically: it is a one-way,
        // user-initiated action offered from Settings, so a stale browser copy
        // can never quietly change the ledger someone is looking at.
        const [customerList, cycleList, billList, txList] = await Promise.all([
          customerService.listCustomers(),
          cycleService.listCycles(),
          lightBillService.listLightBills(),
          transactionService.listTransactions(),
        ]);
        const loadedSettings = await loadSettings();
        if (cancelled) return;
        // Defensive: every consumer treats these as arrays, so a service that
        // ever hands back null (a partial response, a mocked backend) must not
        // become a `.map of undefined` three screens later.
        setCustomers(Array.isArray(customerList) ? customerList : []);
        setCycles(Array.isArray(cycleList) ? cycleList : []);
        setLightBills(Array.isArray(billList) ? billList : []);
        setTransactions(Array.isArray(txList) ? txList : []);
        setSettings(loadedSettings);
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
  }, [isAuthenticated, userId, refreshRooms]);

  // Coming back online after a dropped connection: whatever was on screen is
  // stale, so pull the ledger again rather than showing numbers that moved
  // elsewhere.
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

  const updateSettings = useCallback(async (next) => {
    const saved = await saveSettings(next);
    setSettings(saved);
    return saved;
  }, []);

  // Digital agreement: store the generated PDF + signature and refresh the
  // customer list (the agreement row itself is read on the details page).
  const createAgreement = useCallback(async ({ customer, blob, signatureDataUrl }) => {
    const row = await agreementsService.createAgreement({ customer, blob, signatureDataUrl });
    return row;
  }, []);

  const resync = useCallback(async () => {
    await Promise.all([refresh(), refreshRooms()]);
  }, [refresh, refreshRooms]);

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
      rooms,
      roomsStatus,
      roomsError,
      refreshRooms,
      status,
      error,
      online,
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
      createAgreement,
    }),
    [
      customers,
      cycles,
      lightBills,
      transactions,
      settings,
      rooms,
      roomsStatus,
      roomsError,
      refreshRooms,
      status,
      error,
      online,
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
      createAgreement,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>.');
  return ctx;
}