import { planRentPayment } from '../utils/ledger.js';

// Same names the real data layer exposes, so a `vi.mock` of the real module
// satisfies every import the services make.
export const TABLES = {
  customers: 'customers',
  cycles: 'rent_cycles',
  cyclesView: 'rent_cycles_view',
  lightBills: 'light_bills',
  lightBillsView: 'light_bills_view',
  transactions: 'transactions',
  settings: 'settings',
};

/**
 * In-memory stand-in for Supabase, used by every test in this repo.
 *
 * Tests swap the backend with one line:
 *   vi.mock('../services/supabase.js', async () => await import('../test/supabaseFake.js'));
 *
 * It mirrors the real thing where it matters: the same table/column names, the
 * same camelCase row shapes, the same "created_at ascending" ordering, and RPCs
 * that reuse the *production* ledger maths (src/utils/ledger.js) so a change to
 * the payment rules cannot pass here and fail in Postgres.
 */

// ------------------------------------------------------------------- storage

const db = {
  customers: [],
  cycles: [],
  lightBills: [],
  transactions: [],
  settings: new Map(),
  images: new Map(),
  session: null,
  listeners: new Set(),
};

let idCounter = 0;
const nextId = (prefix) => `${prefix}_${Date.now().toString(36)}${(idCounter += 1).toString(36)}`;

const isoNow = () => new Date().toISOString();

const clone = (value) => (value === undefined || value === null ? value : structuredClone(value));

function tableRows(table) {
  switch (table) {
    case TABLES.customers:
      return db.customers;
    case TABLES.cycles:
      return db.cycles;
    case TABLES.lightBills:
      return db.lightBills;
    case TABLES.transactions:
      return db.transactions;
    default:
      throw new Error(`Unknown table: ${table}`);
  }
}

/**
 * Rows come back already camelCased, exactly like the real layer (which gets
 * them from PostgREST + the computed views). Cycles and bills also carry the
 * derived remaining/status columns.
 */
function decorate(table, row) {
  if (!row) return null;
  switch (table) {
    case TABLES.customers:
      return {
        id: row.id, code: row.code, name: row.name, mobile: row.mobile, email: row.email,
        guardianName: row.guardian_name, guardianPhone: row.guardian_phone, address: row.address,
        occupation: row.occupation, proofType: row.proof_type, proofId: row.proof_id,
        joiningDate: row.joining_date, sharingType: row.sharing_type,
        rentAmount: Number(row.rent_amount), depositAmount: Number(row.deposit_amount),
        depositPaid: row.deposit_paid, roomNo: row.room_no, bedNo: row.bed_no, notes: row.notes,
        dueDay: row.due_day, nextDueDate: row.next_due_date, advanceCredit: Number(row.advance_credit),
        termsAccepted: row.terms_accepted, termsAcceptedAt: row.terms_accepted_at, status: row.status,
        photoId: row.photo_id, proofImageId: row.proof_image_id,
        payments: clone(row.payments) ?? [], createdAt: row.created_at, updatedAt: row.updated_at,
      };
    case TABLES.cycles:
      return cycleShape(row);
    case TABLES.lightBills:
      return billShape(row);
    case TABLES.transactions:
      return txShape(row);
    default:
      return clone(row);
  }
}

const sorted = (rows) => [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

const round2 = (n) => Number(Number(n).toFixed(2));

function cycleShape(row) {
  const remaining = round2(Number(row.rent_amount) - Number(row.paid_amount));
  return {
    id: row.id, customerId: row.customer_id, dueDate: row.due_date,
    rentAmount: Number(row.rent_amount), paidAmount: Number(row.paid_amount),
    remainingAmount: remaining,
    status: remaining <= 0 ? 'paid' : Number(row.paid_amount) > 0 ? 'partial' : 'pending',
    settledAt: row.settled_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function billShape(row) {
  const remaining = round2(Number(row.bill_amount) - Number(row.paid_amount));
  return {
    id: row.id, customerId: row.customer_id, month: row.month,
    units: row.units, ratePerUnit: row.rate_per_unit,
    billAmount: Number(row.bill_amount), paidAmount: Number(row.paid_amount),
    remainingAmount: remaining,
    status: remaining <= 0 ? 'paid' : Number(row.paid_amount) > 0 ? 'partial' : 'pending',
    note: row.note, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function txShape(row) {
  return {
    id: row.id, customerId: row.customer_id, customerName: row.customer_name, type: row.type,
    cycleId: row.cycle_id, billId: row.bill_id, amount: Number(row.amount), date: row.date,
    mode: row.mode, note: row.note, createdAt: row.created_at,
    openedCycleId: row.opened_cycle_id, creditBefore: row.credit_before, creditAfter: row.credit_after,
    settledAt: row.settled_at, dueDateBefore: row.due_date_before, dueDateAfter: row.due_date_after,
    billMonth: row.bill_month,
  };
}

// ---------------------------------------------------------------------- auth

export function isConfigured() {
  return true;
}

export async function getSession() {
  return { user: clone(db.session) };
}

export function onAuthStateChange(callback) {
  db.listeners.add(callback);
  return () => db.listeners.delete(callback);
}

function emit() {
  for (const listener of db.listeners) listener({ user: clone(db.session) });
}

export async function signInWithPassword({ email, password }) {
  if (!email || !password) return { user: null, error: 'Invalid login credentials.' };
  db.session = { id: `fake-${email}`, email };
  emit();
  return { user: clone(db.session), error: null };
}

export async function signUpWithPassword({ email, password }) {
  if (!email || !password) return { user: null, error: 'Password should be at least 6 characters.' };
  db.session = { id: `fake-${email}`, email };
  emit();
  return { user: clone(db.session), pending: false, error: null };
}

export async function signOut() {
  db.session = null;
  emit();
}

/** Test shims: pretend someone signed in, or drop them. */
export function startSession(user = { id: 'fake-user', email: 'test@example.com' }) {
  db.session = clone(user);
  emit();
  return Promise.resolve({ user: clone(db.session) });
}

export function clearSession() {
  db.session = null;
  emit();
  return Promise.resolve(null);
}

// --------------------------------------------------------------- table reads

export async function listRows(table) {
  return sorted(tableRows(table)).map((row) => decorate(table, row));
}

export async function getRow(table, id) {
  return decorate(table, tableRows(table).find((row) => row.id === id) ?? null);
}

export async function getRowWhere(table, column, value) {
  return decorate(table, tableRows(table).find((row) => row[toSnake(column)] === value) ?? null);
}

export async function getRowWhereAll(table, filters) {
  const row = tableRows(table).find((r) => Object.entries(filters).every(([c, v]) => r[toSnake(c)] === v));
  return decorate(table, row ?? null);
}

// -------------------------------------------------------------- table writes

const toSnake = (value) => String(value).replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

export async function insertRow(table, row) {
  const snake = Object.fromEntries(Object.entries(row).map(([k, v]) => [toSnake(k), v]));
  const stored = {
    ...snake,
    id: snake.id || nextId(table.slice(0, 3)),
    user_id: db.session?.id ?? 'fake-user',
    created_at: snake.created_at || isoNow(),
    updated_at: snake.updated_at || snake.created_at || isoNow(),
  };
  tableRows(table).push(stored);
  return decorate(table, clone(stored));
}

export async function updateRow(table, id, patch) {
  const rows = tableRows(table);
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) throw new Error('Record not found.');
  const snake = Object.fromEntries(Object.entries(patch).map(([k, v]) => [toSnake(k), v]));
  rows[index] = { ...rows[index], ...snake, id, updated_at: isoNow() };
  return decorate(table, clone(rows[index]));
}

export async function deleteRow(table, id) {
  const rows = tableRows(table);
  const index = rows.findIndex((row) => row.id === id);
  if (index !== -1) rows.splice(index, 1);
  return true;
}

export async function deleteRowsWhere(table, column, value) {
  const rows = tableRows(table);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i][toSnake(column)] === value) rows.splice(i, 1);
  }
  return true;
}

export async function clearTable(table) {
  tableRows(table).length = 0;
  return true;
}

// ----------------------------------------------------------------- settings

/**
 * Keyed by user id, like the real table. RLS means one row per account, and
 * tests that sign in as two different users must not see each other's settings.
 */
const ownerId = () => db.session?.id ?? null;

export async function getSettings() {
  const s = ownerId() ? db.settings.get(ownerId()) : undefined;
  if (!s) return null;
  return {
    sharingPrices: clone(s.sharing_prices ?? {}),
    defaultDeposit: Number(s.default_deposit) || 0,
    rentDueDayOfMonth: Number(s.rent_due_day_of_month) || 10,
    terms: s.terms ?? '',
    pgName: s.pg_name ?? '',
    ownerName: s.owner_name ?? '',
    ownerMobile: s.owner_mobile ?? '',
    currencyNote: s.currency_note ?? '',
  };
}

export async function saveSettingsRow(settings) {
  const user = ownerId();
  if (!user) throw new Error('Sign in to save settings.');
  const snake = Object.fromEntries(Object.entries(settings).map(([k, v]) => [toSnake(k), v]));
  db.settings.set(user, { ...snake, user_id: user, updated_at: isoNow() });
  return getSettings();
}

// ------------------------------------------------------------------- images

export async function uploadImage(appPath, dataUrl) {
  db.images.set(appPath, dataUrl);
  return appPath;
}

export async function getImageUrl(appPath) {
  return db.images.has(appPath) ? db.images.get(appPath) : null;
}

export async function deleteImage(appPath) {
  if (appPath) db.images.delete(appPath);
  return true;
}

export async function emptyStorage() {
  db.images.clear();
  return true;
}

// ---------------------------------------------------------------------- rpc

function customerRow(id) {
  const row = db.customers.find((c) => c.id === id);
  if (!row) throw new Error('Customer not found.');
  return row;
}

function openCycleRow(customerId) {
  const all = db.cycles.filter((c) => c.customer_id === customerId);
  if (!all.length) throw new Error('No open rent cycle for this tenant.');
  const open = all.filter((c) => Number(c.rent_amount) - Number(c.paid_amount) > 0);
  const pool = open.length ? open : all;
  return pool.reduce((newest, c) => (c.due_date > newest.due_date ? c : newest), pool[0]);
}

/**
 * Mirror of the real layer's camelCase -> `p_`-prefixed snake_case translation
 * (see `RPC_PARAMS` in `services/supabase.js`). Duplicated rather than imported
 * because this module *replaces* that one under `vi.mock`, so importing from it
 * would be circular.
 */
const RPC_PARAMS = {
  record_rent_payment: { customerId: 'p_customer_id', amount: 'p_amount', date: 'p_date', mode: 'p_mode', note: 'p_note' },
  preview_rent_payment: { customerId: 'p_customer_id', amount: 'p_amount', nextRent: 'p_next_rent' },
  save_light_bill: {
    customerId: 'p_customer_id',
    billId: 'p_bill_id',
    month: 'p_month',
    units: 'p_units',
    ratePerUnit: 'p_rate_per_unit',
    billAmount: 'p_bill_amount',
    note: 'p_note',
  },
  record_light_bill_payment: {
    customerId: 'p_customer_id',
    billId: 'p_bill_id',
    amount: 'p_amount',
    date: 'p_date',
    mode: 'p_mode',
    note: 'p_note',
  },
  delete_transaction: { id: 'p_id' },
  import_backup: { customers: 'p_customers', cycles: 'p_cycles', bills: 'p_bills', transactions: 'p_transactions' },
};

function toRpcParams(name, params) {
  const map = RPC_PARAMS[name];
  if (!map) return params;
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    const target = map[key];
    if (target) out[target] = value;
  }
  return out;
}

export async function rpc(name, rawParams = {}) {
  // SQL takes `p_`-prefixed snake_case, services pass camelCase, and `rpc()`
  // does the translation. The handlers below therefore always see the same
  // shape the production data layer would hand Postgres.
  const params = toRpcParams(name, rawParams);
  switch (name) {
    case 'preview_rent_payment': {
      const customer = customerRow(params.p_customer_id);
      const cycle = openCycleRow(params.p_customer_id);
      const plan = planRentPayment({
        cycle: cycleShape(cycle),
        amount: params.p_amount,
        dueDay: Number(customer.due_day),
        nextRentAmount: params.p_next_rent ?? Number(customer.rent_amount),
        advanceCredit: Number(customer.advance_credit),
      });
      return clone(plan);
    }

    case 'record_rent_payment': {
      const customer = customerRow(params.p_customer_id);
      const cycle = openCycleRow(params.p_customer_id);
      const plan = planRentPayment({
        cycle: cycleShape(cycle),
        amount: params.p_amount,
        dueDay: Number(customer.due_day),
        nextRentAmount: Number(customer.rent_amount),
        advanceCredit: Number(customer.advance_credit),
      });

      if (plan.applied <= 0 && plan.surplus <= 0) throw new Error('Enter an amount greater than zero.');

      cycle.paid_amount = plan.paidAfter;
      cycle.settled_at = plan.settled ? isoNow() : null;
      cycle.updated_at = isoNow();

      let openedId = null;
      let nextShape = null;
      if (plan.settled) {
        openedId = nextId('cyc_');
        const next = {
          id: openedId, user_id: customer.user_id, customer_id: params.p_customer_id,
          due_date: plan.nextCycle.dueDate, rent_amount: plan.nextCycle.rentAmount,
          paid_amount: plan.nextCycle.paidAmount, settled_at: null,
          created_at: isoNow(), updated_at: isoNow(),
        };
        db.cycles.push(next);
        nextShape = cycleShape(next);
      }

      const tx = {
        id: nextId('txn_'), user_id: customer.user_id, customer_id: params.p_customer_id,
        customer_name: customer.name, type: 'RENT', cycle_id: cycle.id, bill_id: null,
        amount: round2(params.p_amount), date: params.p_date, mode: params.p_mode, note: params.p_note,
        opened_cycle_id: openedId, credit_before: plan.previousCredit, credit_after: plan.creditAfter,
        settled_at: plan.settled ? isoNow() : null, due_date_before: cycle.due_date,
        due_date_after: plan.settled ? plan.nextCycle.dueDate : cycle.due_date,
        bill_month: null, created_at: isoNow(),
      };
      db.transactions.push(tx);

      customer.advance_credit = plan.creditAfter;
      customer.next_due_date = plan.settled ? plan.nextCycle.dueDate : cycle.due_date;
      customer.updated_at = isoNow();

      return { transaction: txShape(tx), cycle: cycleShape(cycle), nextCycle: nextShape, plan: clone(plan) };
    }

    case 'save_light_bill': {
      const customer = customerRow(params.p_customer_id);
      const month = params.p_month || isoNow().slice(0, 7);
      const computed = round2(Math.max(Number(params.p_bill_amount ?? (Number(params.p_units) * Number(params.p_rate_per_unit))) || 0, 0));
      if (computed <= 0) throw new Error('Enter a bill amount greater than zero.');

      const existing = db.lightBills.find(
        (b) => b.customer_id === params.p_customer_id && (params.p_bill_id ? b.id === params.p_bill_id : b.month === month),
      );

      if (existing) {
        if (Number(existing.paid_amount) > computed) {
          throw new Error('The bill amount cannot be less than the amount already paid.');
        }
        Object.assign(existing, {
          month, units: params.p_units, rate_per_unit: params.p_rate_per_unit,
          bill_amount: computed, note: params.p_note, updated_at: isoNow(),
        });
        return billShape(clone(existing));
      }

      const row = {
        id: nextId('bil_'), user_id: customer.user_id, customer_id: params.p_customer_id, month,
        units: params.p_units, rate_per_unit: params.p_rate_per_unit, bill_amount: computed, paid_amount: 0,
        note: params.p_note, created_at: isoNow(), updated_at: isoNow(),
      };
      db.lightBills.push(row);
      return billShape(clone(row));
    }

    case 'record_light_bill_payment': {
      const customer = customerRow(params.p_customer_id);
      const bill = db.lightBills.find((b) => b.id === params.p_bill_id);
      if (!bill) throw new Error('Light bill not found.');

      const total = Number(bill.bill_amount);
      const paidBefore = Number(bill.paid_amount);
      const remainingBefore = Math.max(total - paidBefore, 0);
      const requested = Math.max(Number(params.p_amount) || 0, 0);
      if (requested <= 0) throw new Error('Enter an amount greater than zero.');

      const applied = Math.min(requested, remainingBefore);
      const surplus = Math.max(requested - applied, 0);
      const paidAfter = round2(paidBefore + applied);
      const remainingAfter = Math.max(remainingBefore - applied, 0);

      bill.paid_amount = paidAfter;
      bill.updated_at = isoNow();

      const tx = {
        id: nextId('txn_'), user_id: customer.user_id, customer_id: params.p_customer_id,
        customer_name: customer.name, type: 'LIGHT_BILL', cycle_id: null, bill_id: bill.id,
        amount: round2(params.p_amount), date: params.p_date, mode: params.p_mode, note: params.p_note,
        bill_month: bill.month, created_at: isoNow(),
      };
      db.transactions.push(tx);

      return {
        transaction: txShape(tx),
        bill: billShape(clone(bill)),
        result: {
          kind: remainingBefore <= 0 ? 'excess' : surplus > 0 ? 'over' : remainingAfter <= 0 ? 'exact' : 'partial',
          requested, applied, surplus, paidBefore, paidAfter, remainingBefore, remainingAfter,
          settled: remainingAfter <= 0,
          status: remainingAfter <= 0 ? 'paid' : applied > 0 ? 'partial' : 'pending',
        },
      };
    }

    case 'delete_transaction': {
      const index = db.transactions.findIndex((t) => t.id === params.p_id);
      if (index === -1) throw new Error('Transaction not found.');
      const [tx] = db.transactions.splice(index, 1);

      if (tx.type === 'LIGHT_BILL') {
        const bill = db.lightBills.find((b) => b.id === tx.bill_id);
        if (bill) {
          const sum = db.transactions
            .filter((t) => t.bill_id === tx.bill_id)
            .reduce((s, t) => s + Number(t.amount), 0);
          bill.paid_amount = round2(sum);
          bill.updated_at = isoNow();
        }
        return { transaction: txShape(tx), cycle: null };
      }

      const cycle = db.cycles.find((c) => c.id === tx.cycle_id);
      if (cycle) {
        const sum = db.transactions
          .filter((t) => t.cycle_id === tx.cycle_id)
          .reduce((s, t) => s + Number(t.amount), 0);
        cycle.paid_amount = round2(sum);
        cycle.settled_at = round2(sum) >= Number(cycle.rent_amount) ? (cycle.settled_at || isoNow()) : null;
        cycle.updated_at = isoNow();
      }

      if (tx.opened_cycle_id) {
        const used = db.transactions.some((t) => t.cycle_id === tx.opened_cycle_id);
        if (!used) {
          const openedIndex = db.cycles.findIndex((c) => c.id === tx.opened_cycle_id);
          if (openedIndex !== -1) db.cycles.splice(openedIndex, 1);
        }
      }

      let nextDue = tx.due_date_before;
      let openShape = null;
      try {
        const open = openCycleRow(tx.customer_id);
        nextDue = open.due_date;
        openShape = cycleShape(open);
      } catch {
        openShape = null;
      }

      const customer = db.customers.find((c) => c.id === tx.customer_id);
      if (customer) {
        customer.advance_credit = tx.credit_before ?? 0;
        customer.next_due_date = nextDue;
        customer.updated_at = isoNow();
      }

      return { transaction: txShape(tx), cycle: openShape };
    }

    case 'import_backup': {
      // Counts are keyed by snapshot name, not table name, to match the RPC.
      const counts = { customers: 0, cycles: 0, bills: 0, transactions: 0 };
      const push = (table, rows, stored, key) => {
        for (const row of rows ?? []) {
          if (tableRows(table).some((r) => r.id === row.id)) continue;
          tableRows(table).push(stored(row));
          counts[key] += 1;
        }
      };

      push(TABLES.customers, params.p_customers, (r) => toStoredCustomer(r), 'customers');
      push(TABLES.cycles, params.p_cycles, (r) => ({
        id: r.id, user_id: db.session?.id ?? 'fake-user', customer_id: r.customerId,
        due_date: r.dueDate, rent_amount: Number(r.rentAmount ?? 0), paid_amount: Number(r.paidAmount ?? 0),
        settled_at: r.settledAt ?? null, migrated_from: r.migratedFrom ?? null,
        created_at: r.createdAt || isoNow(), updated_at: r.updatedAt || isoNow(),
      }), 'cycles');
      push(TABLES.lightBills, params.p_bills, (r) => ({
        id: r.id, user_id: db.session?.id ?? 'fake-user', customer_id: r.customerId, month: r.month,
        units: r.units ?? null, rate_per_unit: r.ratePerUnit ?? null,
        bill_amount: Number(r.billAmount ?? 0), paid_amount: Number(r.paidAmount ?? 0),
        note: r.note ?? '', migrated_from: r.migratedFrom ?? null,
        created_at: r.createdAt || isoNow(), updated_at: r.updatedAt || isoNow(),
      }), 'bills');
      push(TABLES.transactions, params.p_transactions, (r) => ({
        id: r.id, user_id: db.session?.id ?? 'fake-user', customer_id: r.customerId,
        customer_name: r.customerName ?? '', type: r.type ?? 'RENT',
        cycle_id: r.cycleId ?? null, bill_id: r.billId ?? null, amount: Number(r.amount ?? 0),
        date: r.date, mode: r.mode ?? 'cash', note: r.note ?? '',
        opened_cycle_id: r.openedCycleId ?? null, credit_before: r.creditBefore ?? null,
        credit_after: r.creditAfter ?? null, settled_at: r.settledAt ?? null,
        due_date_before: r.dueDateBefore ?? null, due_date_after: r.dueDateAfter ?? null,
        bill_month: r.billMonth ?? null, migrated_from: r.migratedFrom ?? null,
        created_at: r.createdAt || isoNow(),
      }), 'transactions');

      return counts;
    }

    case 'wipe_all': {
      const counts = {
        customers: db.customers.length,
        cycles: db.cycles.length,
        lightBills: db.lightBills.length,
        transactions: db.transactions.length,
      };
      db.customers = [];
      db.cycles = [];
      db.lightBills = [];
      db.transactions = [];
      return counts;
    }

    default:
      throw new Error(`Unknown RPC: ${name}`);
  }
}

function toStoredCustomer(r) {
  return {
    id: r.id, user_id: db.session?.id ?? 'fake-user', code: r.code ?? '', name: r.name ?? '',
    mobile: r.mobile ?? '', email: r.email ?? '', guardian_name: r.guardianName ?? '',
    guardian_phone: r.guardianPhone ?? '', address: r.address ?? '', occupation: r.occupation ?? '',
    proof_type: r.proofType ?? 'AADHAAR', proof_id: r.proofId ?? '', joining_date: r.joiningDate,
    sharing_type: Number(r.sharingType) || 1, rent_amount: Number(r.rentAmount) || 0,
    deposit_amount: Number(r.depositAmount) || 0, deposit_paid: Boolean(r.depositPaid),
    room_no: r.roomNo ?? '', bed_no: r.bedNo ?? '', notes: r.notes ?? '',
    due_day: Number(r.dueDay) || 1, next_due_date: r.nextDueDate,
    advance_credit: Number(r.advanceCredit) || 0, terms_accepted: Boolean(r.termsAccepted),
    terms_accepted_at: r.termsAcceptedAt ?? null, status: r.status ?? 'active',
    photo_id: r.photoId ?? null, proof_image_id: r.proofImageId ?? null,
    payments: Array.isArray(r.payments) ? clone(r.payments) : [],
    created_at: r.createdAt || isoNow(), updated_at: r.updatedAt || isoNow(),
  };
}

/** Wipe everything and put the fake back to its initial state. */
export function resetDatabase() {
  db.customers = [];
  db.cycles = [];
  db.lightBills = [];
  db.transactions = [];
  db.settings = new Map();
  db.images = new Map();
  db.session = null;
  db.listeners.clear();
  idCounter = 0;
  return true;
}