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
};

const IMAGE_BUCKET = 'identity-docs';

// --------------------------------------------------------------- auth surface

export function isConfigured() {
  return isSupabaseConfigured();
}

export async function getSession() {
  const sb = getSupabase();
  const { data } = await sb.auth.getUser();
  return { user: data?.user ? { id: data.user.id, email: data.user.email } : null };
}

export function onAuthStateChange(callback) {
  const sb = getSupabase();
  const { data } = sb.auth.onAuthStateChange((_event, session) => {
    callback({ user: session?.user ? { id: session.user.id, email: session.user.email } : null });
  });
  return data?.subscription?.unsubscribe ?? (() => {});
}

export async function signInWithPassword({ email, password }) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { user: null, error: error.message };
  return { user: data.user ? { id: data.user.id, email: data.user.email } : null, error: null };
}

export async function signUpWithPassword({ email, password }) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) return { user: null, error: error.message };
  // If email confirmation is on, signUp returns no session; the user must
  // confirm first. Report that so the login screen can say so.
  return {
    user: data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null,
    pending: Boolean(data.session === null),
    error: null,
  };
}

export async function signOut() {
  const sb = getSupabase();
  await sb.auth.signOut();
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
];

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
    default:
      return [];
  }
}