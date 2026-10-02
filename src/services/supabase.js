import { getSupabase, isSupabaseConfigured } from '../supabase/client.js';

/**
 * The ONLY module that talks to Supabase directly.
 *
 * Every service above this file uses the tiny query surface exposed here, so
 * tests can swap the whole backend for an in-memory fake with a single
 * `vi.mock('../services/supabase.js', ...)`. Rows cross this boundary in
 * camelCase (the shape the UI already speaks); the snake_case <-> camelCase
 * mapping lives here and only here.
 */

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
  // Operations (003).
  complaints: 'complaints',
  notices: 'notices',
  enquiries: 'enquiries',
  visitors: 'visitors',
  // Tenant tooling (004).
  rentRevisions: 'rent_revisions',
  meterReadings: 'meter_readings',
  agreements: 'agreements',
  lateFees: 'late_fees',
  assets: 'assets',
  messMenu: 'mess_menu',
};

const IMAGE_BUCKET = 'identity-docs';

// --------------------------------------------------------- access allowlist
// `admins` is keyed by e-mail, not by auth uid: the owner adds an address
// before that person has ever signed in. RLS on this table is driven by the
// `is_admin()` SQL function, so the checks below are a convenience layer on
// top of the real enforcement, not a replacement for it.

const ADMIN_COLUMNS = ['email', 'role', 'createdAt'];

/**
 * Did PostgREST/Postgres refuse the query because the relation is not there?
 *
 * A project that has only had the first migrations applied answers
 * `PGRST205 Could not find the table 'public.admins' in the schema cache`
 * (or `42P01 ... does not exist` over SQL). That is a *setup* problem, not an
 * *access* problem, and telling somebody they are not on the allowlist when the
 * allowlist itself is missing sends them off to Settings that they cannot reach.
 */
function isMissingRelation(error) {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '').toLowerCase();
  return (
    code === '42P01'
    || code === 'PGRST205'
    || code === 'PGRST204'
    || code === 'PGRST203'
    || message.includes('does not exist')
    || message.includes('could not find the table')
    || message.includes('schema cache')
  );
}

/**
 * What state is the allowlist itself in?
 *
 * `{ ok: false, missing: true }` means the `admins` table has not been created
 * yet (run supabase/schema.sql or supabase/repair.sql). `{ ok: true, empty }`
 * means a fresh project where the first person to sign in claims ownership.
 * Distinguishing these three lets the UI say the true reason for a rejection.
 */
export async function inspectAllowlist() {
  const sb = getSupabase();
  const { data, error } = await sb.from('admins').select('email').limit(1);
  if (error) {
    return { ok: false, missing: isMissingRelation(error), empty: false, error: error.message };
  }
  return { ok: true, missing: false, empty: (data ?? []).length === 0, error: null };
}

export async function isAdminEmail(email) {
  const clean = String(email ?? '').trim().toLowerCase();
  if (!clean) return false;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('admins')
    .select('role')
    .eq('email', clean)
    .maybeSingle();
  // A missing table means the owner has not run the schema yet; treat it as
  // "nobody is on the list" rather than letting the read reject.
  if (error) return false;
  return Boolean(data);
}

/**
 * Claim ownership on a brand-new install.
 *
 * Without this the app has a chicken-and-egg problem: the allowlist is the only
 * door, and the door is empty until somebody opens it. `bootstrap_owner` only
 * inserts when the table has zero rows and only for the calling account, so the
 * very first person to sign in on a fresh project becomes the owner, and every
 * later stranger is rejected.
 */
export async function bootstrapOwner(email) {
  const clean = String(email ?? '').trim().toLowerCase();
  if (!clean) return false;
  const sb = getSupabase();
  const { data, error } = await sb.rpc('bootstrap_owner', { p_email: clean });
  if (error) return false;
  return Boolean(data);
}

/**
 * The allowlist decision, in one place: are they on the list, or is this a
 * fresh project they can claim?
 *
 * Every rejection path fails closed, including the ones that are really setup
 * bugs - a missing `admins` table must never read as "you are welcome here".
 * `inspectAllowlist()` is what lets the caller explain *why* it failed.
 */
export async function resolveAccess(email) {
  const clean = String(email ?? '').trim().toLowerCase();
  if (!clean) return false;

  if (await isAdminEmail(clean)) return true;

  const state = await inspectAllowlist();
  if (!state.ok) return false; // unreadable allowlist: fail closed
  if (state.empty) {
    const claimed = await bootstrapOwner(clean);
    if (claimed) return true;
    // Lost the claim. `state.empty` was read before the claim round-trip, so
    // this is usually *us* a moment earlier - two checks for one account
    // overlap on every sign-in (the handler and the session effect both run).
    // Re-read membership before rejecting, or the first person to sign in on a
    // fresh project bounces themselves off their own allowlist.
    return isAdminEmail(clean);
  }

  // The list is not empty, so somebody owns the project and only they can
  // admit people - but re-read our own membership before saying no. Two checks
  // for the *same* account legitimately overlap (the sign-in handler and the
  // session effect both run, and a retry lands while the first claim is still
  // in flight); the loser of that race must not reject the winner.
  return isAdminEmail(clean);
}

export async function listAdmins() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('admins')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => camelRow(row, ADMIN_COLUMNS));
}

export async function addAdmin({ email, role = 'admin' }) {
  const sb = getSupabase();
  const clean = String(email ?? '').trim().toLowerCase();
  const { data, error } = await sb
    .from('admins')
    .upsert({ email: clean, role }, { onConflict: 'email' })
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return camelRow(data, ADMIN_COLUMNS);
}

export async function removeAdmin(email) {
  const sb = getSupabase();
  const clean = String(email ?? '').trim().toLowerCase();
  const { error } = await sb.from('admins').delete().eq('email', clean);
  if (error) throw new Error(error.message);
  return true;
}

// --------------------------------------------------------------- auth surface

export function isConfigured() {
  return isSupabaseConfigured();
}

export async function getSession() {
  const sb = getSupabase();
  const { data } = await sb.auth.getUser();
  return { user: toAppUser(data?.user) };
}

/**
 * Shape every layer above the data module expects: id, email and the Google
 * profile fields the header menu renders. Keeping the mapping in one place
 * means the OAuth path and the password path cannot drift apart.
 */
function toAppUser(user) {
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? '',
    name: meta.full_name ?? meta.name ?? user.user_metadata?.preferred_username ?? '',
    avatarUrl: meta.picture ?? meta.avatar_url ?? '',
    provider: user.app_metadata?.provider ?? user.provider ?? 'email',
  };
}

export function onAuthStateChange(callback) {
  const sb = getSupabase();
  const { data } = sb.auth.onAuthStateChange((_event, session) => {
    callback({ user: toAppUser(session?.user) });
  });
  return data?.subscription?.unsubscribe ?? (() => {});
}

export async function signInWithPassword({ email, password }) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { user: null, error: error.message };
  return { user: toAppUser(data.user), error: null };
}

export async function signUpWithPassword({ email, password }) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) return { user: null, error: error.message };
  // If email confirmation is on, signUp returns no session; the user must
  // confirm first. Report that so the login screen can say so.
  return {
    user: toAppUser(data.session?.user),
    pending: Boolean(data.session === null),
    error: null,
  };
}

/**
 * "Continue with Google".
 *
 * Supabase redirects the browser to Google and back to `redirectTo`, so there
 * is no user object to return here - the session arrives later through
 * `onAuthStateChange` (and `detectSessionInUrl` parses the callback). `skipBrowserRedirect`
 * is never set: the full-page round trip is what keeps the session cookie and
 * the localStorage copy in sync.
 *
 * Only the error is returned, so the button can show "Google sign-in is not
 * configured" when the provider is disabled in the Supabase dashboard instead
 * of failing silently.
 */
export async function signInWithGoogle({ redirectTo } = {}) {
  const sb = getSupabase();
  const target =
    redirectTo ?? (typeof window !== 'undefined' ? window.location.origin : undefined);
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: target },
  });
  return { error: error ? error.message : null };
}

export async function signOut() {
  const sb = getSupabase();
  await sb.auth.signOut();
}

/**
 * Was the OAuth callback rejected by Supabase itself (provider disabled,
 * redirect URL not allow-listed)? Returns a short human reason or null.
 */
export function readAuthError() {
  if (typeof window === 'undefined') return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const description = hash.get('error_description') || hash.get('error');
  if (description) return description;
  const search = new URLSearchParams(window.location.search);
  const searchDescription = search.get('error_description') || search.get('error');
  return searchDescription || null;
}

/**
 * Dev/test shims. The real session lifecycle is owned by supabase-js (persisted
 * in its own storage); these are only used by tests against the in-memory fake
 * and by the guest screen. `startSession` returns the current session, behaving
 * as a harmless identity function against a real backend.
 */
export async function startSession() {
  return getSession();
}

export async function clearSession() {
  await signOut();
  return null;
}

// ------------------------------------------------------------- row mapping

const CUSTOMER_COLUMNS = [
  'id', 'code', 'name', 'mobile', 'email', 'guardianName', 'guardianPhone', 'address',
  'occupation', 'proofType', 'proofId', 'joiningDate', 'sharingType', 'rentAmount',
  'depositAmount', 'depositPaid', 'roomNo', 'bedNo', 'notes', 'dueDay', 'nextDueDate',
  'advanceCredit', 'termsAccepted', 'termsAcceptedAt', 'status', 'photoId', 'proofImageId',
  'payments', 'createdAt', 'updatedAt',
  // Lifecycle columns added in 002. Old rows have them null and stay valid.
  'roomId', 'expectedLeavingDate', 'noticeGivenAt', 'noticeNote',
  'vacatedAt', 'damageCharges', 'depositRefund',
];

const ROOM_COLUMNS = [
  'id', 'floor', 'roomNo', 'sharingType', 'monthlyRent', 'hasAc', 'hasAttachedBathroom',
  'notes', 'isActive', 'createdAt', 'updatedAt',
  // Computed by the rooms_occupancy view, never stored.
  'capacity', 'occupied', 'vacant', 'occupancyStatus', 'occupants',
];

const ROOM_HISTORY_COLUMNS = [
  'id', 'customerId', 'roomId', 'bedNo', 'fromDate', 'toDate', 'note', 'createdAt',
];

const EXPENSE_COLUMNS = ['id', 'category', 'amount', 'date', 'note', 'createdAt'];

const COMPLAINT_COLUMNS = [
  'id', 'title', 'category', 'priority', 'status', 'roomNo', 'customerId', 'description',
  'photoId', 'assignedTo', 'resolvedDate', 'createdAt', 'updatedAt',
];

const NOTICE_COLUMNS = ['id', 'title', 'body', 'date', 'createdAt', 'updatedAt'];

const ENQUIRY_COLUMNS = [
  'id', 'name', 'phone', 'preferredSharing', 'budget', 'expectedJoinDate', 'status', 'note', 'createdAt', 'updatedAt',
];

const VISITOR_COLUMNS = ['id', 'name', 'phone', 'visitingWhom', 'purpose', 'inTime', 'outTime', 'date', 'createdAt'];

const REVISION_COLUMNS = [
  'id', 'customerId', 'oldRent', 'newRent', 'effectiveDate', 'note', 'createdAt',
];

const METER_COLUMNS = [
  'id', 'roomId', 'roomNo', 'month', 'previousReading', 'currentReading', 'ratePerUnit',
  'totalUnits', 'totalAmount', 'createdAt',
];

const AGREEMENT_COLUMNS = [
  'id', 'customerId', 'createdAt', 'signedAt', 'signaturePath', 'pdfPath', 'rentAmount',
  'depositAmount', 'startDate', 'endDate',
];

const LATE_FEE_COLUMNS = [
  'id', 'customerId', 'cycleId', 'amount', 'daysLate', 'waived', 'note', 'createdAt',
];

const ASSET_COLUMNS = [
  'id', 'roomId', 'roomNo', 'item', 'quantity', 'condition', 'note', 'createdAt', 'updatedAt',
];

const MESS_COLUMNS = ['id', 'day', 'meal', 'items', 'updatedAt'];

const CYCLE_COLUMNS = [
  'id', 'customerId', 'dueDate', 'rentAmount', 'paidAmount', 'settledAt', 'createdAt', 'updatedAt',
];

const BILL_COLUMNS = [
  'id', 'customerId', 'month', 'units', 'ratePerUnit', 'billAmount', 'paidAmount',
  'note', 'createdAt', 'updatedAt',
];

const TRANSACTION_COLUMNS = [
  'id', 'customerId', 'customerName', 'type', 'cycleId', 'billId', 'amount', 'date',
  'mode', 'note', 'createdAt', 'openedCycleId', 'creditBefore', 'creditAfter', 'settledAt',
  'dueDateBefore', 'dueDateAfter', 'billMonth', 'migratedFrom',
];

const SETTINGS_COLUMNS = [
  'sharingPrices', 'defaultDeposit', 'rentDueDayOfMonth', 'terms', 'pgName',
  'ownerName', 'ownerMobile', 'currencyNote',
  // 004 additions.
  'upiId', 'lateFeeMode', 'lateFeeValue', 'lateFeeGraceDays', 'lateFeeMax',
  'messEnabled', 'messCharges',
];

const toSnake = (value) =>
  String(value).replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

/** Pick a camelCase object's supported keys and rename them to snake_case. */
function snakeRow(row, columns, extra = {}) {
  const out = { ...extra };
  for (const key of columns) {
    if (key in row) out[toSnake(key)] = row[key];
  }
  return out;
}

/** Rename the snake_case DB row keys back to the camelCase object keys. */
function camelRow(row, columns) {
  if (!row) return row;
  const out = { ...row };
  for (const col of columns) {
    const snake = toSnake(col);
    if (snake in out) {
      out[col] = out[snake];
      delete out[snake];
    }
  }
  // Computed view columns stay as booleans/strings straight from Postgres.
  return out;
}

const tableSource = (table) => {
  switch (table) {
    case TABLES.cycles:
      return TABLES.cyclesView;
    case TABLES.lightBills:
      return TABLES.lightBillsView;
    default:
      return table;
  }
};

function columnsFor(table) {
  switch (table) {
    case TABLES.customers:
      return CUSTOMER_COLUMNS;
    case TABLES.cycles:
      return CYCLE_COLUMNS;
    case TABLES.lightBills:
      return BILL_COLUMNS;
    case TABLES.transactions:
      return TRANSACTION_COLUMNS;
    case TABLES.rooms:
      return ROOM_COLUMNS;
    case TABLES.roomHistory:
      return ROOM_HISTORY_COLUMNS;
    case TABLES.expenses:
      return EXPENSE_COLUMNS;
    case TABLES.complaints:
      return COMPLAINT_COLUMNS;
    case TABLES.notices:
      return NOTICE_COLUMNS;
    case TABLES.enquiries:
      return ENQUIRY_COLUMNS;
    case TABLES.visitors:
      return VISITOR_COLUMNS;
    case TABLES.rentRevisions:
      return REVISION_COLUMNS;
    case TABLES.meterReadings:
      return METER_COLUMNS;
    case TABLES.agreements:
      return AGREEMENT_COLUMNS;
    case TABLES.lateFees:
      return LATE_FEE_COLUMNS;
    case TABLES.assets:
      return ASSET_COLUMNS;
    case TABLES.messMenu:
      return MESS_COLUMNS;
    default:
      return [];
  }
}

// -------------------------------------------------------------- table reads

/** All rows for a table (view for cycles/bills). Oldest created first. */
export async function listRows(table) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(tableSource(table))
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const columns = columnsFor(table);
  return (data ?? []).map((row) => camelRow(row, columns));
}

export async function getRow(table, id) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(tableSource(table))
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return camelRow(data, columnsFor(table));
}

/** First row matching one equality filter, or null. */
export async function getRowWhere(table, column, value) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(tableSource(table))
    .select('*')
    .eq(toSnake(column), value)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return camelRow(data, columnsFor(table));
}

/** First row matching every `{ column: value }` filter, or null. */
export async function getRowWhereAll(table, filters) {
  const sb = getSupabase();
  let query = sb.from(tableSource(table)).select('*').limit(1);
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(toSnake(column), value);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return camelRow(data, columnsFor(table));
}

// ------------------------------------------------------------ table writes

export async function insertRow(table, row) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(table)
    .insert(snakeRow(row, columnsFor(table)))
    .select()
    .single();
  if (error) throw new Error(error.message);
  return camelRow(data, columnsFor(table));
}

export async function updateRow(table, id, patch) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(table)
    .update(snakeRow(patch, columnsFor(table)))
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Record not found.');
  return camelRow(data, columnsFor(table));
}

export async function deleteRow(table, id) {
  const sb = getSupabase();
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) throw new Error(error.message);
  return true;
}

export async function deleteRowsWhere(table, column, value) {
  const sb = getSupabase();
  const { error } = await sb.from(table).delete().eq(toSnake(column), value);
  if (error) throw new Error(error.message);
  return true;
}

export async function clearTable(table) {
  const sb = getSupabase();
  const { error } = await sb.from(table).delete().neq('id', '__pgm_never__');
  if (error) throw new Error(error.message);
  return true;
}

// --------------------------------------------------------------- settings

/**
 * The signed-in account's settings row, or null before the first save. The row
 * is keyed by `user_id`, so there is nothing to filter on: RLS already scopes
 * the select to the caller and this can only ever return their own row.
 */
export async function getSettings() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(TABLES.settings)
    .select('*')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    sharingPrices: data.sharing_prices ?? {},
    defaultDeposit: Number(data.default_deposit) || 0,
    rentDueDayOfMonth: Number(data.rent_due_day_of_month) || 10,
    terms: data.terms ?? '',
    pgName: data.pg_name ?? '',
    ownerName: data.owner_name ?? '',
    ownerMobile: data.owner_mobile ?? '',
    currencyNote: data.currency_note ?? '',
    upiId: data.upi_id ?? '',
    lateFeeMode: data.late_fee_mode ?? 'none',
    lateFeeValue: Number(data.late_fee_value) || 0,
    lateFeeGraceDays: Number(data.late_fee_grace_days) || 0,
    lateFeeMax: data.late_fee_max == null ? null : Number(data.late_fee_max),
    messEnabled: Boolean(data.mess_enabled),
    messCharges: Number(data.mess_charges) || 0,
  };
}

export async function saveSettingsRow(settings) {
  const sb = getSupabase();
  const patch = snakeRow(settings, SETTINGS_COLUMNS, { updated_at: new Date().toISOString() });
  const { error } = await sb
    .from(TABLES.settings)
    .upsert(patch, { onConflict: 'user_id' })
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return getSettings();
}

// ---------------------------------------------------------------------- rpc

/**
 * The SQL functions take `p_`-prefixed snake_case arguments, while the services
 * speak the app's camelCase vocabulary. Translate here so the service layer
 * never has to know Postgres naming.
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
  record_flat_transaction: {
    type: 'p_type',
    customerId: 'p_customer_id',
    cycleId: 'p_cycle_id',
    amount: 'p_amount',
    date: 'p_date',
    mode: 'p_mode',
    note: 'p_note',
  },
  import_backup: { customers: 'p_customers', cycles: 'p_cycles', bills: 'p_bills', transactions: 'p_transactions' },

  // Rooms and the tenant lifecycle (002).
  admit_customer: { customer: 'p_customer', roomId: 'p_room_id', bedNo: 'p_bed_no' },
  move_customer: {
    customerId: 'p_customer_id',
    roomId: 'p_room_id',
    bedNo: 'p_bed_no',
    effectiveDate: 'p_effective_date',
  },
  give_notice: {
    customerId: 'p_customer_id',
    expectedLeavingDate: 'p_expected_leaving_date',
    note: 'p_note',
  },
  vacate_customer: {
    customerId: 'p_customer_id',
    pendingRent: 'p_pending_rent',
    pendingBill: 'p_pending_bill',
    damageCharges: 'p_damage_charges',
    refundAmount: 'p_refund_amount',
    refundMode: 'p_refund_mode',
    note: 'p_note',
  },
  delete_room: { roomId: 'p_room_id' },
  upcoming_vacates: { days: 'p_days' },
  monthly_finance: { months: 'p_months' },
  log_audit: {
    action: 'p_action',
    entityType: 'p_entity_type',
    entityId: 'p_entity_id',
    summary: 'p_summary',
    amount: 'p_amount',
  },
  audit_feed: { limit: 'p_limit' },
};

/**
 * RPCs whose result is already the app's shape. `list_rooms` in particular
 * returns nested occupants and computed occupancy, so there is nothing to map
 * on the way out.
 */
export async function listRoomsRpc() {
  return rpc('list_rooms');
}

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

/**
 * Insert-or-update rows keyed by client id (used by the mess menu editor).
 * Implemented here so pages never hand-roll upsert loops.
 */
export async function upsertRows(table, rows) {
  const sb = getSupabase();
  const payload = rows.map((row) => snakeRow(row, columnsFor(table)));
  const { data, error } = await sb.from(table).upsert(payload, { onConflict: 'id' }).select();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => camelRow(row, columnsFor(table)));
}

/**
 * Call a Postgres function. The function is SECURITY DEFINER and re-scopes
 * every query by `auth.uid()`, so a thrown exception becomes a normal JS
 * Error whose message is safe to show in the UI.
 */
export async function rpc(name, params = {}) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc(name, toRpcParams(name, params));
  if (error) throw new Error(error.message);
  return data;
}

// ------------------------------------------------------------------ storage

function dataUrlToBlob(dataUrl) {
  const [head, body] = String(dataUrl).split(',');
  const mime = /\/(.*?)(?:;|$)/.exec(head)?.[1] ?? '';
  const base64 = head.includes(';base64');
  const bytes = base64 ? atob(body) : decodeURIComponent(body);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime ? `image/${mime}` : 'image/jpeg' });
}

async function ownerPrefix() {
  const { user } = await getSession();
  if (!user) throw new Error('Sign in to manage identity documents.');
  return user.id;
}

/** Upload a data URL into the private bucket under the owner's folder. */
export async function uploadImage(appPath, dataUrl) {
  const sb = getSupabase();
  const owner = await ownerPrefix();
  const { error } = await sb.storage.from(IMAGE_BUCKET).upload(
    `${owner}/${appPath}`,
    dataUrlToBlob(dataUrl),
    { upsert: true, contentType: 'image/jpeg' },
  );
  if (error) throw new Error(error.message);
  return appPath;
}

/**
 * Upload a raw Blob (e.g. a generated agreement PDF) into the private bucket.
 * Separate from uploadImage because the content type differs.
 */
export async function uploadFile(appPath, blob, contentType = 'application/pdf') {
  const sb = getSupabase();
  const owner = await ownerPrefix();
  const { error } = await sb.storage.from(IMAGE_BUCKET).upload(`${owner}/${appPath}`, blob, {
    upsert: true,
    contentType,
  });
  if (error) throw new Error(error.message);
  return appPath;
}

/** A short-lived signed URL for the object, or null if it does not exist. */
export async function getImageUrl(appPath) {
  const sb = getSupabase();
  const owner = await ownerPrefix();
  const { data, error } = await sb.storage.from(IMAGE_BUCKET).createSignedUrl(`${owner}/${appPath}`, 21600);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function deleteImage(appPath) {
  if (!appPath) return true;
  const sb = getSupabase();
  const owner = await ownerPrefix();
  const { error } = await sb.storage.from(IMAGE_BUCKET).remove([`${owner}/${appPath}`]);
  if (error) throw new Error(error.message);
  return true;
}

/** Remove every object under the owner's folder (Settings -> Erase all data). */
export async function emptyStorage() {
  const sb = getSupabase();
  const owner = await ownerPrefix();
  const { data, error } = await sb.storage.from(IMAGE_BUCKET).list(owner, { limit: 500 });
  if (error) throw new Error(error.message);
  if (data?.length) {
    const { error: rmError } = await sb.storage.from(IMAGE_BUCKET).remove(data.map((f) => `${owner}/${f.name}`));
    if (rmError) throw new Error(rmError.message);
  }
  return true;
}