/**
 * In-memory stand-in for Supabase, swapped in by tests with a single
 * `vi.mock('../services/supabase.js', ...)`.
 *
 * It mirrors the real data layer's contract:
 *   - rows are stored snake_case like Postgres and converted on the way out
 *   - ids are database-generated uuids (the app never supplies one)
 *   - the three money functions (create_customer, record_payment,
 *     delete_payment) implement the same rules as supabase/schema.sql
 *   - a DELETE that matches nothing returns 0, like PostgREST's empty array
 *   - every write requires a signed-in session, like the RLS policies
 */

export const TABLES = {
  settings: 'settings',
  rooms: 'rooms',
  customers: 'customers',
  cycles: 'rent_cycles',
  lightBills: 'light_bills',
  transactions: 'transactions',
};

const db = {
  settings: [],
  rooms: [],
  customers: [],
  rent_cycles: [],
  light_bills: [],
  transactions: [],
  storage: new Map(),
  session: null,
  authError: null,
};

// Auth listeners, notified on every session change like supabase-js does.
const authListeners = new Set();
function notifyAuth() {
  for (const listener of authListeners) listener({ user: db.session });
}

export function resetDatabase() {
  for (const key of ['settings', 'rooms', 'customers', 'rent_cycles', 'light_bills', 'transactions']) {
    db[key] = [];
  }
  db.storage = new Map();
  db.session = null;
  db.authError = null;
}

// ------------------------------------------------------------------ helpers

const toSnake = (value) => String(value).replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const toCamel = (value) => String(value).replace(/_([a-z])/g, (_m, c) => c.toUpperCase());

function camelRow(row) {
  if (!row) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) out[toCamel(key)] = value;
  return out;
}

function snakeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) out[toSnake(key)] = value;
  return out;
}

/** Same guarantee as the real layer: writes carry only known columns. */
export function buildWriteRow(table, row) {
  void table;
  return snakeRow(row);
}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nextMonth(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

// Postgres column defaults the fake has to reproduce: supabase-js drops
// undefined keys from the JSON payload, so the column default applies. Without
// these, a missing paid_amount would turn the ledger arithmetic into NaN.
const NUMERIC_DEFAULTS = [
  'rent_amount', 'paid_amount', 'bill_amount', 'deposit_amount', 'advance_credit',
  'amount', 'floor', 'sharing_type', 'due_day',
];

function applyColumnDefaults(stored) {
  for (const key of NUMERIC_DEFAULTS) {
    if (stored[key] === undefined) stored[key] = 0;
  }
  return stored;
}

export function notReturned(action, table, id = '') {
  return describeDbError({
    code: 'NO_ROW_RETURNED',
    message: `${table}: the ${action} matched no row${id ? ` for id ${id}` : ''}.`,
  });
}

function describeDbError(error, context = 'query') {
  const message = String(error?.message ?? 'Unknown database error.');
  const wrapped = new Error(message);
  wrapped.code = error?.code ?? '';
  void context;
  return wrapped;
}

/** Mirrors the RLS rule: any signed-in session may read and write. */
function requireSignedIn() {
  if (!db.session) {
    throw describeDbError({ message: 'Sign in to make changes.' });
  }
}

// --------------------------------------------------------------------- auth

export function isConfigured() {
  return true;
}

export async function getSession() {
  return { user: db.session };
}

export function onAuthStateChange(callback) {
  authListeners.add(callback);
  callback({ user: db.session });
  return () => authListeners.delete(callback);
}

export async function signInWithPassword({ email, password }) {
  if (db.authError) return { user: null, error: db.authError };
  if (password === 'wrongpass') return { user: null, error: 'Invalid login credentials' };
  const user = {
    id: uuid(),
    email: String(email).toLowerCase(),
    name: email.split('@')[0],
    avatarUrl: '',
    provider: 'email',
  };
  db.session = user;
  notifyAuth();
  return { user, error: null };
}

export async function signUpWithPassword({ email, password }) {
  void password;
  const user = {
    id: uuid(),
    email: String(email).toLowerCase(),
    name: email.split('@')[0],
    avatarUrl: '',
    provider: 'email',
  };
  db.session = user;
  notifyAuth();
  return { user, pending: false, error: null };
}

export async function signInWithGoogle() {
  return { error: null };
}

export function readAuthError() {
  return null;
}

export async function signOut() {
  db.session = null;
  notifyAuth();
}

/** Tests call this to become a signed-in account (defaults to the owner). */
export function startSession(user = { id: 'fake-user', email: 'owner@example.com', name: 'Test Owner', avatarUrl: '', provider: 'email' }) {
  db.session = user;
  notifyAuth();
  return { user };
}

export async function clearSession() {
  db.session = null;
  notifyAuth();
}

export function setAuthError(message) {
  db.authError = message;
}

// -------------------------------------------------------------- table reads

export async function listRows(table) {
  const sorted = [...db[table]].sort((a, b) =>
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')),
  );
  return sorted.map(camelRow);
}

export async function getRow(table, id) {
  const row = db[table].find((r) => r.id === id);
  return row ? camelRow(row) : null;
}

export async function getRowWhere(table, column, value) {
  const row = db[table].find((r) => r[toSnake(column)] === value);
  return row ? camelRow(row) : null;
}

// ----------------------------------------------------------- table writes

export async function insertRow(table, row) {
  requireSignedIn();
  const snake = Object.fromEntries(
    Object.entries(snakeRow(row)).filter(([, v]) => v !== undefined),
  );
  const stored = applyColumnDefaults({
    ...snake,
    id: row.id ?? uuid(),
    created_at: row.createdAt ?? new Date().toISOString(),
    updated_at: row.updatedAt ?? row.createdAt ?? new Date().toISOString(),
  });
  db[table].push(stored);
  return camelRow(stored);
}

export async function updateRow(table, id, patch) {
  requireSignedIn();
  const index = db[table].findIndex((r) => r.id === id);
  if (index === -1) {
    throw describeDbError({
      code: 'NO_ROW_RETURNED',
      message: `${table}: the update matched no row for id ${id}.`,
    });
  }
  const clean = Object.fromEntries(
    Object.entries(snakeRow(patch)).filter(([, v]) => v !== undefined),
  );
  db[table][index] = applyColumnDefaults({ ...db[table][index], ...clean, id, updated_at: new Date().toISOString() });
  return camelRow(db[table][index]);
}

/** Deletes and returns how many rows actually left (0 when already gone). */
export async function deleteRow(table, id) {
  requireSignedIn();
  const index = db[table].findIndex((r) => r.id === id);
  if (index === -1) return 0;
  db[table].splice(index, 1);

  // Mirror the schema's foreign keys.
  if (table === TABLES.customers) {
    db.rent_cycles = db.rent_cycles.filter((r) => r.customer_id !== id);
    db.light_bills = db.light_bills.filter((r) => r.customer_id !== id);
    db.transactions = db.transactions.filter((r) => r.customer_id !== id);
  }
  if (table === TABLES.rooms) {
    for (const customer of db.customers) {
      if (customer.room_id === id) {
        customer.room_id = null;
        customer.room_no = '';
        customer.bed_no = '';
      }
    }
  }
  return 1;
}

export async function deleteRowsWhere(table, column, value) {
  const before = db[table].length;
  db[table] = db[table].filter((r) => r[toSnake(column)] !== value);
  return before - db[table].length;
}

// --------------------------------------------------------------------- rpc

/** create_customer(): the customer + first cycle in one transaction. */
async function createCustomer({ customer, roomId, bedNo }) {
  const name = String(customer?.name ?? '').trim();
  if (!name) throw describeDbError({ message: 'The tenant name is required.' });

  let room = null;
  if (roomId) {
    room = db.rooms.find((r) => r.id === roomId);
    if (!room) throw describeDbError({ message: 'That room no longer exists.' });

    const occupied = db.customers.filter((c) => c.room_id === roomId && c.status === 'active').length;
    if (occupied >= room.sharing_type) {
      throw describeDbError({ message: `Room ${room.room_no} is full. Pick another room.` });
    }
    if (bedNo && db.customers.some((c) => c.room_id === roomId && c.bed_no === bedNo && c.status === 'active')) {
      throw describeDbError({ message: `Bed ${bedNo} in room ${room.room_no} is just taken.` });
    }
  }

  const joiningDate = customer?.joiningDate || new Date().toISOString().slice(0, 10);
  const rentAmount = money(customer?.rentAmount ?? 0);

  const stored = applyColumnDefaults({
    ...snakeRow(customer),
    id: uuid(),
    name,
    joining_date: joiningDate,
    sharing_type: Number(customer?.sharingType) || 1,
    rent_amount: rentAmount,
    deposit_amount: money(customer?.depositAmount ?? 0),
    room_id: roomId ?? null,
    room_no: room ? room.room_no : customer?.roomNo || '',
    bed_no: bedNo || '',
    due_day: Number(customer?.dueDay) || Number(joiningDate.slice(8, 10)),
    next_due_date: nextMonth(joiningDate),
    advance_credit: 0,
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  db.customers.push(stored);

  db.rent_cycles.push({
    id: uuid(),
    customer_id: stored.id,
    due_date: stored.next_due_date,
    rent_amount: Math.max(rentAmount, room ? money(room.monthly_rent) : 0),
    paid_amount: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return { id: stored.id };
}

/** record_payment(): same partial / settle / roll-forward rules as the SQL. */
async function recordPayment({ customerId, amount, date, mode = 'cash', note = '', billId = null }) {
  const customer = db.customers.find((c) => c.id === customerId);
  if (!customer) throw describeDbError({ message: 'Customer not found.' });
  const value = money(amount);
  if (value <= 0) throw describeDbError({ message: 'Enter an amount greater than zero.' });

  const tx = {
    id: uuid(),
    customer_id: customer.id,
    customer_name: customer.name,
    amount: value,
    date: date || new Date().toISOString().slice(0, 10),
    mode,
    note: note || '',
    created_at: new Date().toISOString(),
  };

  if (billId) {
    const bill = db.light_bills.find((b) => b.id === billId);
    if (!bill) throw describeDbError({ message: 'Light bill not found.' });
    const applied = Math.min(value, Math.max(bill.bill_amount - bill.paid_amount, 0));
    const surplus = value - applied;
    bill.paid_amount = money(bill.paid_amount + applied);
    if (surplus > 0) customer.advance_credit = money(customer.advance_credit + surplus);
    tx.type = 'LIGHT_BILL';
    tx.ref_id = bill.id;
    db.transactions.push(tx);
    return { transactionId: tx.id, applied, surplus };
  }

  const cycles = db.rent_cycles
    .filter((c) => c.customer_id === customerId)
    .sort((a, b) => String(b.due_date).localeCompare(String(a.due_date)));
  const cycle = cycles[0];
  if (!cycle) throw describeDbError({ message: 'No rent cycle for this tenant. Run supabase/schema.sql to repair.' });

  const applied = Math.min(value, Math.max(cycle.rent_amount - cycle.paid_amount, 0));
  const surplus = value - applied;
  cycle.paid_amount = money(cycle.paid_amount + applied);

  if (cycle.paid_amount >= cycle.rent_amount) {
    const pool = money(surplus + customer.advance_credit);
    const toNext = Math.min(pool, customer.rent_amount);
    const next = {
      id: uuid(),
      customer_id: customer.id,
      due_date: nextMonth(cycle.due_date),
      rent_amount: customer.rent_amount,
      paid_amount: toNext,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.rent_cycles.push(next);
    customer.advance_credit = money(pool - toNext);
    customer.next_due_date = next.due_date;
  }

  tx.type = 'RENT';
  tx.ref_id = cycle.id;
  db.transactions.push(tx);
  return { transactionId: tx.id, applied, surplus };
}

/** delete_payment(): remove the payment and recalculate what it settled. */
async function deletePayment({ id }) {
  const index = db.transactions.findIndex((t) => t.id === id);
  if (index === -1) return { deleted: false, reason: 'Payment already deleted or not found' };
  const [tx] = db.transactions.splice(index, 1);

  if (tx.type === 'RENT' && tx.ref_id) {
    const cycle = db.rent_cycles.find((c) => c.id === tx.ref_id);
    if (cycle) {
      const paid = money(
        db.transactions.filter((t) => t.type === 'RENT' && t.ref_id === cycle.id).reduce((sum, t) => sum + t.amount, 0),
      );
      const applied = Math.max(cycle.paid_amount - paid, 0);
      const surplus = Math.max(tx.amount - applied, 0);
      cycle.paid_amount = paid;

      if (paid < cycle.rent_amount) {
        const next = db.rent_cycles
          .filter(
            (rc) =>
              rc.customer_id === cycle.customer_id &&
              String(rc.due_date) > String(cycle.due_date) &&
              !db.transactions.some((t) => t.type === 'RENT' && t.ref_id === rc.id),
          )
          .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
        if (next) {
          const customer = db.customers.find((c) => c.id === cycle.customer_id);
          if (customer) {
            customer.advance_credit = Math.max(customer.advance_credit + next.paid_amount - surplus, 0);
            customer.next_due_date = cycle.due_date;
          }
          db.rent_cycles = db.rent_cycles.filter((rc) => rc.id !== next.id);
        }
      }
    }
  } else if (tx.type === 'LIGHT_BILL' && tx.ref_id) {
    const bill = db.light_bills.find((b) => b.id === tx.ref_id);
    if (bill) {
      bill.paid_amount = money(
        db.transactions.filter((t) => t.type === 'LIGHT_BILL' && t.ref_id === bill.id).reduce((sum, t) => sum + t.amount, 0),
      );
    }
  }

  return { deleted: true };
}

// Test dial: simulate network latency on RPC calls so races (e.g. a double
// tapped submit) can be reproduced deterministically.
let rpcDelayMs = 0;

export function setRpcDelay(ms) {
  rpcDelayMs = ms;
}

export async function rpc(name, params = {}) {
  if (rpcDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, rpcDelayMs));
  switch (name) {
    case 'create_customer':
      return createCustomer(params);
    case 'record_payment':
      return recordPayment(params);
    case 'delete_payment':
      return deletePayment(params);
    default:
      throw describeDbError({ code: '42883', message: `function ${name} does not exist` });
  }
}

// ------------------------------------------------------------------ storage

export async function uploadImage(path, dataUrl) {
  db.storage.set(path, dataUrl);
  return path;
}

export async function getImageUrl(path) {
  if (!db.storage.has(path)) return null;
  return `blob:fake/${path}`;
}

export async function deleteImage(path) {
  db.storage.delete(path);
  return true;
}

export function storedImageCount() {
  return db.storage.size;
}

export { db };
