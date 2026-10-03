import { TABLES, listRows, getRow, updateRow, deleteRow, notReturned, rpc } from './supabase.js';
import * as imageService from './imageService.js';
import { getNextDueDate, getRentStatus, getRentStatusLabel, daysDiff, todayISO, dayjs } from '../utils/dateLogic.js';
import { getRemaining } from '../utils/ledger.js';

/**
 * Customers. One service per table; plain reads and writes, with admission
 * going through the create_customer() Postgres function so the customer and
 * their first rent cycle are written together. Ids come from the database.
 */

export function normalizeCustomer(raw = {}) {
  const joiningDate = raw.joiningDate || todayISO();
  return {
    id: raw.id ?? null,
    name: raw.name || '',
    mobile: raw.mobile || '',
    email: raw.email || '',
    guardianName: raw.guardianName || '',
    guardianPhone: raw.guardianPhone || '',
    address: raw.address || '',
    occupation: raw.occupation || '',
    proofType: raw.proofType || 'AADHAAR',
    proofId: raw.proofId || '',
    proofPath: raw.proofPath || null,
    photoPath: raw.photoPath || null,
    joiningDate,
    sharingType: Number(raw.sharingType) || 1,
    rentAmount: Number(raw.rentAmount) || 0,
    depositAmount: Number(raw.depositAmount) || 0,
    roomId: raw.roomId || null,
    roomNo: raw.roomNo || '',
    bedNo: raw.bedNo || '',
    notes: raw.notes || '',
    dueDay: Number(raw.dueDay) || dayjs(joiningDate).date(),
    nextDueDate: raw.nextDueDate || getNextDueDate(joiningDate, 1, raw.dueDay),
    advanceCredit: Number(raw.advanceCredit) || 0,
    status: raw.status || 'active',
    vacatedOn: raw.vacatedOn || null,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

// ---------------------------------------------------------------- selectors

/** 'overdue' | 'soon' | 'ok' from the tenant's next due date. */
export function getCustomerStatus(customer, today = dayjs()) {
  return getRentStatus(customer.nextDueDate, today);
}

export function getCustomerStatusLabel(customer, today = dayjs()) {
  return getRentStatusLabel(customer.nextDueDate, today);
}

/** Active tenants only, nearest due first, overdue on top. */
export function sortByDueDate(list, today = dayjs()) {
  return [...list]
    .filter((c) => c.status !== 'vacated')
    .sort((a, b) => {
      const weight = { overdue: 0, soon: 1, ok: 2 };
      const statusDelta = weight[getRentStatus(a.nextDueDate, today)] - weight[getRentStatus(b.nextDueDate, today)];
      if (statusDelta !== 0) return statusDelta;
      const dateDelta = daysDiff(today, a.nextDueDate) - daysDiff(today, b.nextDueDate);
      if (dateDelta !== 0) return dateDelta;
      return String(a.name).localeCompare(String(b.name));
    });
}

// ------------------------------------------------------------------ queries

export async function listCustomers() {
  return (await listRows(TABLES.customers)).map(normalizeCustomer);
}

export async function getCustomer(id) {
  const row = await getRow(TABLES.customers, id);
  return row ? normalizeCustomer(row) : null;
}

// ---------------------------------------------------------------- mutations

/**
 * Admit a tenant. create_customer() writes the customer and their first rent
 * cycle together, and re-checks the room's free bed under a lock.
 */
export async function createCustomer(data) {
  const customer = normalizeCustomer(data);
  const result = await rpc('create_customer', {
    customer,
    roomId: customer.roomId || null,
    bedNo: customer.bedNo || null,
  });
  const created = result?.id ? await getCustomer(result.id) : null;
  if (!created) {
    // The write succeeded but the read-back saw nothing: surface the real
    // error instead of showing a local copy that is not in the database.
    throw notReturned('insert', TABLES.customers, result?.id ?? '(no id)');
  }
  return created;
}

export async function updateCustomer(id, patch) {
  const payload = { ...patch, updatedAt: new Date().toISOString() };
  // The edit form sends numbers as strings; store the numeric columns as
  // numbers so filters and sums never compare text.
  for (const key of ['sharingType', 'rentAmount', 'depositAmount', 'advanceCredit', 'dueDay']) {
    if (key in payload) payload[key] = Number(payload[key]) || 0;
  }
  if (payload.joiningDate && !('dueDay' in payload)) {
    payload.dueDay = dayjs(payload.joiningDate).date();
  }
  return normalizeCustomer(await updateRow(TABLES.customers, id, payload));
}

/**
 * Delete one tenant (their cycles, bills and payments go with them via the
 * foreign keys). Throws the real database error when nothing was removed.
 */
export async function deleteCustomer(id) {
  const customer = await getCustomer(id).catch(() => null);
  const removed = await deleteRow(TABLES.customers, id);
  if (removed === 0) {
    throw notReturned('delete', TABLES.customers, id);
  }
  if (customer) {
    // Best effort - the row is already gone, so a failed image delete is
    // logged but never blocks anything.
    await Promise.allSettled([
      imageService.deleteImage(customer.photoPath),
      imageService.deleteImage(customer.proofPath),
    ]);
  }
  return true;
}

/** Vacate: keep the record, free the bed, stop showing them as due rent. */
export async function vacateCustomer(id, vacatedOn = todayISO()) {
  return updateCustomer(id, { status: 'vacated', vacatedOn });
}

// ------------------------------------------------------------------- images

export async function setCustomerImage(id, kind, dataUrl) {
  const field = kind === 'photo' ? 'photoPath' : 'proofPath';
  const customer = await getCustomer(id).catch(() => null);
  const path = `tenants/${id}-${kind}-${Date.now().toString(36)}.jpg`;
  await imageService.putImage(path, dataUrl);
  const previous = customer?.[field];
  if (previous && previous !== path) await imageService.deleteImage(previous).catch(() => {});
  return updateCustomer(id, { [field]: path });
}

export function getCustomerImage(imagePath) {
  return imageService.getImage(imagePath);
}
