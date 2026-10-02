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
  rooms: 'rooms',
  roomHistory: 'room_history',
  expenses: 'expenses',
  // Operations + tenant tooling (003/004), same names as the real layer.
  complaints: 'complaints',
  notices: 'notices',
  enquiries: 'enquiries',
  visitors: 'visitors',
  rentRevisions: 'rent_revisions',
  meterReadings: 'meter_readings',
  agreements: 'agreements',
  lateFees: 'late_fees',
  assets: 'assets',
  messMenu: 'mess_menu',
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
  // Added in 002: rooms, the room history trail, running costs and the audit log.
  rooms: [],
  roomHistory: [],
  expenses: [],
  audit: [],
  // Added in 003/004: operations and tenant tooling tables.
  complaints: [],
  notices: [],
  enquiries: [],
  visitors: [],
  rentRevisions: [],
  meterReadings: [],
  agreements: [],
  lateFees: [],
  assets: [],
  messMenu: [],
  admins: [],
  /**
   * Set true to emulate a project where the access migrations were never
   * applied, so PostgREST answers PGRST205 for `admins`.
   */
  adminsTableMissing: false,
  session: null,
  listeners: new Set(),
  /** Addresses the OAuth flow would accept; mirrors is_admin() in SQL. */
  googleProviderEnabled: true,
  /** Redirect URI recorded by the last signInWithGoogle call, for assertions. */
  lastGoogleRedirectTo: null,
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
    case TABLES.rooms:
      return db.rooms;
    case TABLES.roomHistory:
      return db.roomHistory;
    case TABLES.expenses:
      return db.expenses;
    case TABLES.complaints:
      return db.complaints;
    case TABLES.notices:
      return db.notices;
    case TABLES.enquiries:
      return db.enquiries;
    case TABLES.visitors:
      return db.visitors;
    case TABLES.rentRevisions:
      return db.rentRevisions;
    case TABLES.lateFees:
      return db.lateFees;
    case TABLES.meterReadings:
      return db.meterReadings;
    case TABLES.agreements:
      return db.agreements;
    case TABLES.assets:
      return db.assets;
    case TABLES.messMenu:
      return db.messMenu;
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
        // Lifecycle columns from 002. Old rows legitimately have these unset.
        roomId: row.room_id ?? null, vacatedAt: row.vacated_at ?? null,
        noticeGivenAt: row.notice_given_at ?? null, noticeNote: row.notice_note ?? '',
        expectedLeavingDate: row.expected_leaving_date ?? null,
        damageCharges: Number(row.damage_charges) || 0,
        depositRefund: Number(row.deposit_refund) || 0,
      };
    case TABLES.cycles:
      return cycleShape(row);
    case TABLES.lightBills:
      return billShape(row);
    case TABLES.transactions:
      return txShape(row);
    case TABLES.rooms:
      return roomShape(row);
    case TABLES.roomHistory:
      return roomHistoryShape(row);
    case TABLES.expenses:
      return expenseShape(row);
    default:
      return clone(row);
  }
}

function roomShape(row) {
  return {
    id: row.id, floor: Number(row.floor), roomNo: row.room_no,
    // null must survive as null, not 0: it is the "inherit the settings price"
    // sentinel, and Number(null) would silently make the room free.
    sharingType: Number(row.sharing_type),
    monthlyRent: row.monthly_rent == null ? null : Number(row.monthly_rent),
    hasAc: row.has_ac, hasAttachedBathroom: row.has_attached_bathroom, notes: row.notes,
    isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function roomHistoryShape(row) {
  return {
    id: row.id, customerId: row.customer_id, roomId: row.room_id, bedNo: row.bed_no,
    fromDate: row.from_date, toDate: row.to_date, note: row.note, createdAt: row.created_at,
  };
}

function expenseShape(row) {
  return {
    id: row.id, category: row.category, amount: Number(row.amount), date: row.date,
    note: row.note, createdAt: row.created_at,
  };
}

/**
 * Occupancy is derived, never stored - same as the `rooms_occupancy` view.
 * `notice` counts as occupied: a tenant who has given notice still holds their
 * bed until they actually leave.
 */
function roomOccupants(roomId) {
  return db.customers
    .filter((c) => c.room_id === roomId && ['active', 'notice'].includes(c.status))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((c) => ({ id: c.id, name: c.name, bedNo: c.bed_no ?? '', status: c.status, code: c.code ?? '' }));
}

function roomWithOccupancy(row) {
  const occupants = roomOccupants(row.id);
  const occupied = occupants.length;
  const vacant = Math.max(Number(row.sharing_type) - occupied, 0);
  return {
    ...roomShape(row),
    occupants,
    capacity: Number(row.sharing_type),
    occupied,
    vacant,
    occupancyStatus: vacant === 0 ? 'full' : occupied === 0 ? 'empty' : 'partial',
  };
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
  db.session = { id: `fake-${email}`, email, name: email.split('@')[0], avatarUrl: '', provider: 'email' };
  emit();
  return { user: clone(db.session), error: null };
}

export async function signUpWithPassword({ email, password }) {
  if (!email || !password) return { user: null, error: 'Password should be at least 6 characters.' };
  db.session = { id: `fake-${email}`, email, name: email.split('@')[0], avatarUrl: '', provider: 'email' };
  emit();
  return { user: clone(db.session), pending: false, error: null };
}

/**
 * The fake cannot leave the page for Google, so it records the call and
 * resolves. Tests drive the return leg with `startSession({...})`, which is
 * exactly what the real onAuthStateChange callback sees after the redirect.
 */
export async function signInWithGoogle({ redirectTo } = {}) {
  if (!db.googleProviderEnabled) {
    return { error: 'Provider is not enabled.' };
  }
  db.lastGoogleRedirectTo = redirectTo ?? 'http://localhost:5173';
  return { error: null };
}

/** Mirror of the OAuth callback error the real client parses from the URL. */
export function readAuthError() {
  return db.authError ?? null;
}

export async function signOut() {
  db.session = null;
  emit();
}

/** Test shims: pretend someone signed in, or drop them. */
export function startSession(user = { id: 'fake-user', email: 'test@example.com', name: 'Test Owner', avatarUrl: '', provider: 'email' }) {
  db.session = clone(user);
  emit();
  return Promise.resolve({ user: clone(db.session) });
}

export function clearSession() {
  db.session = null;
  emit();
  return Promise.resolve(null);
}

// --------------------------------------------------- access allowlist (admins)
// Mirrors is_admin() / the RLS policies in schema.sql: the table is keyed by
// lower-cased e-mail, and an unreadable table means "nobody is allowed".

export async function isAdminEmail(email) {
  const clean = String(email ?? '').trim().toLowerCase();
  if (!clean) return false;
  if (db.adminsTableMissing) return false;
  return db.admins.some((row) => row.email === clean);
}

/** Mirrors inspectAllowlist() in supabase.js, including the missing-table case. */
export async function inspectAllowlist() {
  if (db.adminsTableMissing) {
    return {
      ok: false,
      missing: true,
      empty: false,
      error: "Could not find the table 'public.admins' in the schema cache",
    };
  }
  return { ok: true, missing: false, empty: db.admins.length === 0, error: null };
}

/** Emulate (or repair) a project that is missing the `admins` table. */
export function setAdminsTableMissing(missing) {
  db.adminsTableMissing = Boolean(missing);
  return true;
}

/** Only claims ownership while the list is empty, exactly like the RPC. */
export async function bootstrapOwner(email) {
  const clean = String(email ?? '').trim().toLowerCase();
  if (!clean) return false;
  if (db.admins.length > 0) return false;
  db.admins.push({ email: clean, role: 'admin', created_at: isoNow() });
  return true;
}

export async function resolveAccess(email) {
  const clean = String(email ?? '').trim().toLowerCase();
  if (!clean) return false;
  if (db.admins.some((row) => row.email === clean)) return true;
  const state = await inspectAllowlist();
  if (!state.ok) return false;
  if (state.empty) {
    const claimed = await bootstrapOwner(clean);
    if (claimed) return true;
    // Lost the claim to a concurrent check for the same address; re-read.
    return db.admins.some((row) => row.email === clean);
  }
  // Re-read membership before rejecting: two checks for the same account
  // overlap, and the loser of that race must not reject the winner.
  return db.admins.some((row) => row.email === clean);
}

export async function listAdmins() {
  return db.admins.map((row) => ({ email: row.email, role: row.role, createdAt: row.created_at }));
}

export async function addAdmin({ email, role = 'admin' }) {
  const clean = String(email ?? '').trim().toLowerCase();
  const existing = db.admins.find((row) => row.email === clean);
  if (existing) {
    existing.role = role;
    return { ...existing };
  }
  const row = { email: clean, role, created_at: isoNow() };
  db.admins.push(row);
  return { email: row.email, role: row.role, createdAt: row.created_at };
}

export async function removeAdmin(email) {
  const clean = String(email ?? '').trim().toLowerCase();
  db.admins = db.admins.filter((row) => row.email !== clean);
  return true;
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

export async function upsertRows(table, rows) {
  const results = [];
  for (const row of rows) {
    const snake = Object.fromEntries(Object.entries(row).map(([k, v]) => [toSnake(k), v]));
    const index = tableRows(table).findIndex((r) => r.id === snake.id);
    if (index !== -1) {
      tableRows(table)[index] = { ...tableRows(table)[index], ...snake, updated_at: isoNow() };
      results.push(tableRows(table)[index]);
    } else {
      const stored = {
        ...snake,
        id: snake.id || nextId(table.slice(0, 3)),
        user_id: db.session?.id ?? 'fake-user',
        created_at: snake.created_at || isoNow(),
        updated_at: isoNow(),
      };
      tableRows(table).push(stored);
      results.push(stored);
    }
  }
  return results.map((row) => decorate(table, clone(row)));
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
    upiId: s.upi_id ?? '',
    lateFeeMode: s.late_fee_mode ?? 'none',
    lateFeeValue: Number(s.late_fee_value) || 0,
    lateFeeGraceDays: Number(s.late_fee_grace_days) || 0,
    lateFeeMax: s.late_fee_max == null ? null : Number(s.late_fee_max),
    messEnabled: Boolean(s.mess_enabled),
    messCharges: Number(s.mess_charges) || 0,
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

export async function uploadFile(appPath, blob) {
  db.images.set(appPath, blob);
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

  // Rooms and the tenant lifecycle (002).
  admit_customer: { customer: 'p_customer', roomId: 'p_room_id', bedNo: 'p_bed_no' },
  move_customer: {
    customerId: 'p_customer_id', roomId: 'p_room_id', bedNo: 'p_bed_no', effectiveDate: 'p_effective_date',
  },
  give_notice: { customerId: 'p_customer_id', expectedLeavingDate: 'p_expected_leaving_date', note: 'p_note' },
  vacate_customer: {
    customerId: 'p_customer_id', pendingRent: 'p_pending_rent', pendingBill: 'p_pending_bill',
    damageCharges: 'p_damage_charges', refundAmount: 'p_refund_amount', refundMode: 'p_refund_mode',
    note: 'p_note',
  },
  delete_room: { roomId: 'p_room_id' },
  upcoming_vacates: { days: 'p_days' },
  monthly_finance: { months: 'p_months' },
  log_audit: {
    action: 'p_action', entityType: 'p_entity_type', entityId: 'p_entity_id',
    summary: 'p_summary', amount: 'p_amount',
  },
  audit_feed: { limit: 'p_limit' },
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

    case 'record_flat_transaction': {
      // Late fees (and any future flat ledger line): applied to the open
      // cycle's paid amount like a payment, but it never rolls the due date
      // forward or opens the next cycle.
      const customer = customerRow(params.p_customer_id);
      if (params.p_type !== 'LATE_FEE') throw new Error(`Unsupported transaction type ${params.p_type}.`);
      const amount = round2(params.p_amount);
      if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');

      let cycle = null;
      if (params.p_cycle_id) {
        cycle = db.cycles.find((c) => c.id === params.p_cycle_id) ?? null;
        if (!cycle) throw new Error('That rent cycle no longer exists.');
      } else {
        cycle = db.cycles
          .filter((c) => c.customer_id === customer.id && !c.settled_at)
          .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0] ?? null;
      }
      let settled = false;
      if (cycle) {
        const newPaid = round2(Number(cycle.paid_amount) + amount);
        settled = newPaid >= Number(cycle.rent_amount);
        cycle.paid_amount = newPaid;
        cycle.settled_at = settled ? isoNow() : cycle.settled_at;
        cycle.updated_at = isoNow();
      }

      const tx = {
        id: nextId('txn_'), user_id: customer.user_id, customer_id: customer.id,
        customer_name: customer.name, type: params.p_type, cycle_id: cycle?.id ?? null, bill_id: null,
        amount, date: params.p_date || isoNow().slice(0, 10), mode: params.p_mode || 'cash',
        note: params.p_note || '', opened_cycle_id: null,
        credit_before: Number(customer.advance_credit), credit_after: Number(customer.advance_credit),
        settled_at: settled ? isoNow() : null, due_date_before: cycle?.due_date ?? null,
        due_date_after: cycle?.due_date ?? null, bill_month: null, created_at: isoNow(),
      };
      db.transactions.push(tx);
      return txShape(tx);
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

    // ---------------------------------------------------- rooms & lifecycle

    case 'list_rooms': {
      return db.rooms
        .map(roomWithOccupancy)
        .sort((a, b) => a.floor - b.floor || String(a.roomNo).localeCompare(String(b.roomNo)));
    }

    case 'admit_customer': {
      const customer = params.p_customer ?? {};
      const room = db.rooms.find((r) => r.id === params.p_room_id);
      if (!room) throw new Error('That room no longer exists.');

      // Postgres locks the room row here; this fake is single-threaded through
      // the handler body, so the capacity check below is the same guarantee.
      const occupants = roomOccupants(room.id);
      if (occupants.length >= Number(room.sharing_type)) {
        throw new Error(`Room ${room.room_no} is now full. Pick another room.`);
      }
      const bedNo = params.p_bed_no ?? '';
      if (bedNo !== '' && occupants.some((o) => String(o.bedNo) === String(bedNo))) {
        throw new Error(`Bed ${bedNo} in room ${room.room_no} is just taken.`);
      }

      const id = customer.id || nextId('cus_');
      const today = isoNow().slice(0, 10);
      db.customers.push({
        ...toStoredCustomer({
          ...customer,
          id,
          sharingType: customer.sharingType ?? Number(room.sharing_type),
          // Room rent wins over the submitted figure, same as the SQL.
          rentAmount: room.monthly_rent ?? customer.rentAmount ?? 0,
          roomNo: room.room_no,
          bedNo,
        }),
        room_id: room.id,
        bed_no: bedNo,
        status: 'active',
      });
      db.roomHistory.push({
        id: nextId('rh_'), user_id: db.session?.id ?? 'fake-user', customer_id: id,
        room_id: room.id, bed_no: bedNo, from_date: customer.joiningDate || today,
        to_date: null, note: 'Admission', created_at: isoNow(),
      });

      return {
        customerId: id, roomId: room.id, bedNo,
        occupied: occupants.length + 1, capacity: Number(room.sharing_type),
      };
    }

    case 'move_customer': {
      const customer = db.customers.find((c) => c.id === params.p_customer_id);
      if (!customer) throw new Error('Tenant not found.');
      const today = params.p_effective_date || isoNow().slice(0, 10);
      const bedNo = params.p_bed_no ?? '';

      if (customer.room_id !== params.p_room_id) {
        const room = db.rooms.find((r) => r.id === params.p_room_id);
        if (!room) throw new Error('That room no longer exists.');
        const occupants = roomOccupants(room.id);
        if (occupants.length >= Number(room.sharing_type)) throw new Error(`Room ${room.room_no} is now full.`);
        if (bedNo !== '' && occupants.some((o) => String(o.bedNo) === String(bedNo))) {
          throw new Error(`Bed ${bedNo} in room ${room.room_no} is just taken.`);
        }

        for (const history of db.roomHistory) {
          if (history.customer_id === customer.id && !history.to_date) history.to_date = today;
        }
        db.roomHistory.push({
          id: nextId('rh_'), user_id: db.session?.id ?? 'fake-user', customer_id: customer.id,
          room_id: room.id, bed_no: bedNo, from_date: today, to_date: null,
          note: 'Move', created_at: isoNow(),
        });

        customer.room_id = room.id;
        customer.room_no = room.room_no;
        customer.sharing_type = Number(room.sharing_type);
      }

      customer.bed_no = bedNo;
      customer.updated_at = isoNow();
      return { roomId: params.p_room_id, bedNo };
    }

    case 'give_notice': {
      const customer = db.customers.find((c) => c.id === params.p_customer_id);
      if (!customer) throw new Error('Tenant not found.');
      const leaving = params.p_expected_leaving_date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

      customer.status = 'notice';
      customer.notice_given_at = isoNow().slice(0, 10);
      customer.notice_note = params.p_note ?? '';
      customer.expected_leaving_date = leaving;
      customer.updated_at = isoNow();
      return { status: 'notice', expectedLeavingDate: leaving };
    }

    case 'vacate_customer': {
      const customer = db.customers.find((c) => c.id === params.p_customer_id);
      if (!customer) throw new Error('Tenant not found.');
      const today = isoNow().slice(0, 10);
      const refund = Number(params.p_refund_amount) || 0;
      let refundTransactionId = null;

      if (refund > 0) {
        refundTransactionId = nextId('txn_');
        db.transactions.push({
          id: refundTransactionId, user_id: customer.user_id, customer_id: customer.id,
          customer_name: customer.name, type: 'REFUND', cycle_id: null, bill_id: null,
          amount: round2(refund), date: today, mode: params.p_refund_mode || 'cash',
          // nullif, not coalesce: an empty note must fall through to the
          // generated breakdown rather than blanking the audit trail.
          note:
            params.p_note ||
            `Deposit refund (deducted: rent ${Number(params.p_pending_rent) || 0}, light ${Number(params.p_pending_bill) || 0}, damage ${Number(params.p_damage_charges) || 0})`,
          created_at: isoNow(),
        });
      }

      for (const history of db.roomHistory) {
        if (history.customer_id === customer.id && !history.to_date) history.to_date = today;
      }

      customer.status = 'vacated';
      customer.vacated_at = today;
      customer.damage_charges = Number(params.p_damage_charges) || 0;
      customer.deposit_refund = round2(refund);
      customer.updated_at = isoNow();

      return { customerId: customer.id, status: 'vacated', refundTransactionId, refundAmount: refund };
    }

    case 'delete_room': {
      const index = db.rooms.findIndex((r) => r.id === params.p_room_id);
      if (index === -1) throw new Error('Room not found.');
      const occupants = roomOccupants(params.p_room_id);
      if (occupants.length > 0) {
        throw new Error(
          `Room ${db.rooms[index].room_no} still has ${occupants.length} tenant(s). Move or vacate them first.`,
        );
      }
      db.rooms.splice(index, 1);
      return { deleted: true, id: params.p_room_id };
    }

    case 'dashboard_summary': {
      const active = db.rooms.filter((r) => r.is_active);
      const capacity = active.reduce((sum, r) => sum + Number(r.sharing_type), 0);
      const occupied = active.reduce((sum, r) => sum + roomOccupants(r.id).length, 0);
      const cutoff = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const leaving = db.customers.filter(
        (c) => c.status === 'notice' && c.expected_leaving_date && c.expected_leaving_date <= cutoff,
      ).length;

      return {
        totalRooms: active.length,
        totalBeds: capacity,
        occupiedBeds: occupied,
        vacantBeds: Math.max(capacity - occupied, 0),
        fullyOccupiedRooms: active.filter((r) => roomOccupants(r.id).length >= Number(r.sharing_type)).length,
        occupancyPercent: capacity ? Math.round((occupied / capacity) * 1000) / 10 : 0,
        leavingSoon: leaving,
        expectedRent: 0,
        collectedRent: 0,
        expensesThisMonth: 0,
      };
    }

    case 'upcoming_vacates': {
      const days = Number(params.p_days ?? 60);
      const cutoff = new Date(Date.now() + Math.max(days, 0) * 86400000).toISOString().slice(0, 10);
      return db.customers
        .filter((c) => c.status === 'notice' && c.expected_leaving_date && c.expected_leaving_date <= cutoff)
        .sort((a, b) => String(a.expected_leaving_date).localeCompare(String(b.expected_leaving_date)))
        .map((c) => ({
          id: c.id, code: c.code, name: c.name, mobile: c.mobile,
          roomNo: c.room_no, bedNo: c.bed_no,
          noticeGivenAt: c.notice_given_at, expectedLeavingDate: c.expected_leaving_date,
          depositAmount: Number(c.deposit_amount) || 0,
        }));
    }

    case 'monthly_finance': {
      const months = Math.max(Number(params.p_months ?? 6), 1);
      const now = new Date();
      const out = [];
      for (let i = months - 1; i >= 0; i -= 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const collected = db.transactions
          .filter((t) => t.type === 'RENT' && String(t.date).startsWith(key))
          .reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const expenses = db.expenses
          .filter((e) => String(e.date).startsWith(key))
          .reduce((sum, e) => sum + Number(e.amount || 0), 0);
        out.push({
          month: key,
          label: date.toLocaleString('en', { month: 'short' }),
          collected, expenses,
          profit: collected - expenses,
        });
      }
      return out;
    }

    case 'log_audit': {
      db.audit.push({
        id: nextId('aud_'), user_id: db.session?.id ?? 'fake-user',
        actorEmail: db.session?.email ?? '', action: params.p_action,
        entityType: params.p_entity_type ?? '', entityId: params.p_entity_id ?? null,
        summary: params.p_summary ?? '', amount: params.p_amount ?? null, created_at: isoNow(),
      });
      return { logged: true };
    }

    case 'audit_feed': {
      const limit = Math.min(Math.max(Number(params.p_limit ?? 100), 1), 500);
      return db.audit
        .slice(-limit)
        .reverse()
        .map((row) => ({
          id: row.id, actorEmail: row.actorEmail, action: row.action,
          entityType: row.entityType, entityId: row.entityId,
          summary: row.summary, amount: row.amount, createdAt: row.created_at,
        }));
    }

    default:
      throw new Error(`Unknown RPC: ${name}`);
  }
}

/** `list_rooms` returns the app's shape directly, so it needs no remapping. */
export async function listRoomsRpc() {
  return rpc('list_rooms');
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
    // Lifecycle columns from 002.
    room_id: r.roomId ?? null,
    vacated_at: r.vacatedAt ?? null,
    notice_given_at: r.noticeGivenAt ?? null,
    notice_note: r.noticeNote ?? '',
    expected_leaving_date: r.expectedLeavingDate ?? null,
    damage_charges: Number(r.damageCharges) || 0,
    deposit_refund: Number(r.depositRefund) || 0,
    created_at: r.createdAt || isoNow(), updated_at: r.updatedAt || isoNow(),
  };
}

/** Wipe everything and put the fake back to its initial state. */
export function resetDatabase() {
  // The allowlist starts empty, exactly like a fresh Supabase project: the
  // first account to sign in claims ownership, everyone else is denied.
  db.admins = [];
  db.adminsTableMissing = false;
  db.customers = [];
  db.cycles = [];
  db.lightBills = [];
  db.transactions = [];
  db.settings = new Map();
  db.images = new Map();
  db.rooms = [];
  db.roomHistory = [];
  db.expenses = [];
  db.audit = [];
  db.complaints = [];
  db.notices = [];
  db.enquiries = [];
  db.visitors = [];
  db.rentRevisions = [];
  db.meterReadings = [];
  db.agreements = [];
  db.lateFees = [];
  db.assets = [];
  db.messMenu = [];
  db.session = null;
  db.authError = null;
  db.googleProviderEnabled = true;
  db.lastGoogleRedirectTo = null;
  db.listeners.clear();
  idCounter = 0;
  return true;
}