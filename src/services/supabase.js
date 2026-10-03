import { getSupabase, isSupabaseConfigured } from '../supabase/client.js';

/**
 * The ONLY module that talks to Supabase directly.
 *
 * One tiny helper per shape of call. Rows cross this boundary in camelCase
 * (the shape the UI speaks); the snake_case mapping lives here and only here.
 * Tests swap this whole file for src/test/supabaseFake.js.
 *
 * Ids are database-generated uuids - the app never invents one.
 */

export const TABLES = {
  settings: 'settings',
  rooms: 'rooms',
  customers: 'customers',
  cycles: 'rent_cycles',
  lightBills: 'light_bills',
  transactions: 'transactions',
};

const COLUMNS = {
  [TABLES.settings]: ['id', 'pgName', 'upiId', 'sharingPrices', 'defaultDeposit', 'terms', 'whatsappTemplate', 'updatedAt'],
  [TABLES.rooms]: ['id', 'floor', 'roomNo', 'sharingType', 'monthlyRent', 'notes', 'createdAt', 'updatedAt'],
  [TABLES.customers]: [
    'id', 'name', 'mobile', 'email', 'guardianName', 'guardianPhone', 'address',
    'occupation', 'proofType', 'proofId', 'proofPath', 'photoPath', 'joiningDate',
    'sharingType', 'rentAmount', 'depositAmount', 'roomId', 'roomNo', 'bedNo',
    'notes', 'dueDay', 'nextDueDate', 'advanceCredit', 'status', 'vacatedOn',
    'createdAt', 'updatedAt',
  ],
  [TABLES.cycles]: ['id', 'customerId', 'dueDate', 'rentAmount', 'paidAmount', 'createdAt', 'updatedAt'],
  [TABLES.lightBills]: ['id', 'customerId', 'month', 'billAmount', 'paidAmount', 'note', 'createdAt', 'updatedAt'],
  [TABLES.transactions]: ['id', 'customerId', 'customerName', 'type', 'refId', 'amount', 'date', 'mode', 'note', 'createdAt'],
};

// Argument names of the three Postgres functions, in camelCase -> SQL form.
const RPC_PARAMS = {
  create_customer: { customer: 'p_customer', roomId: 'p_room_id', bedNo: 'p_bed_no' },
  record_payment: {
    customerId: 'p_customer_id', amount: 'p_amount', date: 'p_date',
    mode: 'p_mode', note: 'p_note', billId: 'p_bill_id',
  },
  delete_payment: { id: 'p_id' },
};

const toSnake = (value) => String(value).replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

/** Pick a camelCase object's supported keys, renamed for Postgres. */
export function buildWriteRow(table, row) {
  const out = {};
  for (const key of COLUMNS[table] ?? []) {
    if (key in row) out[toSnake(key)] = row[key];
  }
  return out;
}

/** Rename a Postgres row back to the camelCase shape the UI speaks. */
function camelRow(row, table) {
  if (!row) return row;
  const out = {};
  for (const key of COLUMNS[table] ?? []) {
    out[key] = row[toSnake(key)];
  }
  // Keep any extra columns (e.g. fields added in SQL later) untouched.
  for (const key of Object.keys(row)) {
    if (!(key in out)) out[key] = row[key];
  }
  return out;
}

/** Turn a Supabase error into a short, human-readable Error. */
export function describeDbError(error, context = 'query') {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? 'Unknown database error.');
  const hint = String(error?.hint ?? '');
  // eslint-disable-next-line no-console
  console.error(`[pg-manager] ${context} failed`, { code, message, hint });
  const wrapped = new Error(hint ? `${message} ${hint}` : message);
  wrapped.code = code;
  return wrapped;
}

/**
 * The write matched no row: PostgREST answers a refused write with 200 and an
 * empty array, so this is the only way the app can tell. The message carries
 * the table and the id; the UI shows it verbatim.
 */
export function notReturned(action, table, id = '') {
  return describeDbError(
    {
      code: 'NO_ROW_RETURNED',
      message: `${table}: the ${action} matched no row${id ? ` for id ${id}` : ''}.`,
      hint: 'The record may already be deleted, or the database policies are out of date. Run supabase/schema.sql in the Supabase SQL editor.',
    },
    `${action} ${table}`,
  );
}

// ------------------------------------------------------------------- reads

function orderFor(table) {
  switch (table) {
    case TABLES.customers:
    case TABLES.rooms:
    case TABLES.cycles:
    case TABLES.lightBills:
    case TABLES.transactions:
      return { column: 'created_at', ascending: true };
    default:
      return null;
  }
}

export async function listRows(table) {
  const sb = getSupabase();
  const order = orderFor(table);
  let query = sb.from(table).select('*');
  if (order) query = query.order(order.column, { ascending: order.ascending });
  const { data, error } = await query;
  if (error) throw describeDbError(error, `list ${table}`);
  return (data ?? []).map((row) => camelRow(row, table));
}

export async function getRow(table, id) {
  const sb = getSupabase();
  const { data, error } = await sb.from(table).select('*').eq('id', id).maybeSingle();
  if (error) throw describeDbError(error, `read ${table}/${id}`);
  return data ? camelRow(data, table) : null;
}

export async function getRowWhere(table, column, value) {
  const sb = getSupabase();
  const { data, error } = await sb.from(table).select('*').eq(toSnake(column), value).limit(1).maybeSingle();
  if (error) throw describeDbError(error, `read ${table} by ${column}`);
  return data ? camelRow(data, table) : null;
}

// ------------------------------------------------------------------ writes

export async function insertRow(table, row) {
  const sb = getSupabase();
  const { data, error } = await sb.from(table).insert(buildWriteRow(table, row)).select().maybeSingle();
  if (error) throw describeDbError(error, `insert into ${table}`);
  if (!data) throw notReturned('insert', table);
  return camelRow(data, table);
}

export async function updateRow(table, id, patch) {
  const sb = getSupabase();
  const { data, error } = await sb.from(table).update(buildWriteRow(table, patch)).eq('id', id).select().maybeSingle();
  if (error) throw describeDbError(error, `update ${table}/${id}`);
  if (!data) throw notReturned('update', table, id);
  return camelRow(data, table);
}

/**
 * Delete one row, reading back what left. A DELETE that matches nothing is a
 * success with an empty array in PostgREST, so the only way to know is to ask.
 * Returns the number of rows actually removed.
 */
export async function deleteRow(table, id) {
  const sb = getSupabase();
  const { data, error } = await sb.from(table).delete().eq('id', id).select();
  if (error) throw describeDbError(error, `delete ${table}/${id}`);
  return (data ?? []).length;
}

// --------------------------------------------------------------------- rpc

export async function rpc(name, params = {}) {
  const sb = getSupabase();
  const map = RPC_PARAMS[name];
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    out[map?.[key] ?? key] = value;
  }
  const { data, error } = await sb.rpc(name, out);
  if (error) throw describeDbError(error, `rpc ${name}`);
  return data;
}

// ------------------------------------------------------------------ storage

const BUCKET = 'identity-docs';

function dataUrlToBlob(dataUrl) {
  const [head, body] = String(dataUrl).split(',');
  const mime = /\/(.*?)(?:;|$)/.exec(head)?.[1] ?? '';
  const base64 = head.includes(';base64');
  const bytes = base64 ? atob(body) : decodeURIComponent(body);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime ? `image/${mime}` : 'image/jpeg' });
}

export async function uploadImage(path, dataUrl) {
  const sb = getSupabase();
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(path, dataUrlToBlob(dataUrl), { upsert: true, contentType: 'image/jpeg' });
  if (error) throw describeDbError(error, 'upload a document');
  return path;
}

export async function getImageUrl(path) {
  if (!path) return null;
  const sb = getSupabase();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 21600);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function deleteImage(path) {
  if (!path) return true;
  const sb = getSupabase();
  const { error } = await sb.storage.from(BUCKET).remove([path]);
  if (error) throw describeDbError(error, 'delete a document');
  return true;
}

// -------------------------------------------------------------------- auth

export function isConfigured() {
  return isSupabaseConfigured();
}

export async function getSession() {
  const sb = getSupabase();
  const { data } = await sb.auth.getUser();
  return { user: toAppUser(data?.user) };
}

function toAppUser(user) {
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? '',
    name: meta.full_name ?? meta.name ?? meta.preferred_username ?? '',
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
  return {
    user: toAppUser(data.session?.user),
    pending: data.session === null, // e-mail confirmation is on
    error: null,
  };
}

export async function signInWithGoogle({ redirectTo } = {}) {
  const sb = getSupabase();
  const target = redirectTo ?? (typeof window !== 'undefined' ? window.location.origin : undefined);
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: target } });
  return { error: error ? error.message : null };
}

export async function signOut() {
  const sb = getSupabase();
  await sb.auth.signOut();
}

export function readAuthError() {
  if (typeof window === 'undefined') return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const description = hash.get('error_description') || hash.get('error');
  if (description) return description;
  const search = new URLSearchParams(window.location.search);
  return search.get('error_description') || search.get('error') || null;
}

// Dev/test shims. The real session lifecycle is owned by supabase-js; these
// exist so tests can drive the in-memory fake through the same door.
export async function startSession(_user = null) {
  return getSession();
}

export async function clearSession() {
  await signOut();
  return null;
}
