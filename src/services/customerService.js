import { readJSON, writeJSON, removeKey, KEYS } from './localStore.js';
import {
  createId,
  getNextDueDate,
  advanceDueDate,
  getCycleStart,
  getRentStatus,
  getRentStatusLabel,
  daysDiff,
  nowISO,
  todayISO,
  dayjs,
} from '../utils/dateLogic.js';
import { putImage, getImage, deleteImage } from './imageService.js';

/**
 * Customer persistence.
 *
 * This module is the *only* place that knows where records live. Every export is
 * async, so swapping localStorage for Firestore or a Node/Mongo API later means
 * reimplementing these functions and changing nothing above this layer.
 *
 *   listCustomers / getCustomer / createCustomer / updateCustomer /
 *   deleteCustomer / addPayment / removePayment /
 *   getCustomerImage / setCustomerImage / clearAllData
 */

const SORT_WEIGHT = { overdue: 0, soon: 1, ok: 2 };

export function normalizeCustomer(raw = {}) {
  const joiningDate = raw.joiningDate || todayISO();
  return {
    id: raw.id || createId('cus'),
    code: raw.code || '',
    name: raw.name || '',
    mobile: raw.mobile || '',
    email: raw.email || '',
    guardianName: raw.guardianName || '',
    guardianPhone: raw.guardianPhone || '',
    address: raw.address || '',
    occupation: raw.occupation || '',
    proofType: raw.proofType || 'AADHAAR',
    proofId: raw.proofId || '',
    joiningDate,
    sharingType: Number(raw.sharingType) || 1,
    rentAmount: Number(raw.rentAmount) || 0,
    depositAmount: Number(raw.depositAmount) || 0,
    depositPaid: raw.depositPaid ?? false,
    roomNo: raw.roomNo || '',
    bedNo: raw.bedNo || '',
    notes: raw.notes || '',
    // dueDay is the day-of-month anchor taken from the joining date. Keeping it
    // explicit stops a 31st-joiner from drifting to the 28th after February.
    dueDay: Number(raw.dueDay) || dayjs(joiningDate).date(),
    nextDueDate: raw.nextDueDate || getNextDueDate(joiningDate, 1, raw.dueDay),
    termsAccepted: raw.termsAccepted ?? false,
    termsAcceptedAt: raw.termsAcceptedAt || null,
    status: raw.status || 'active',
    photoId: raw.photoId || null,
    proofImageId: raw.proofImageId || null,
    payments: Array.isArray(raw.payments) ? raw.payments : [],
    createdAt: raw.createdAt || nowISO(),
    updatedAt: raw.updatedAt || nowISO(),
  };
}

function readAll() {
  const stored = readJSON(KEYS.customers, []);
  if (!Array.isArray(stored)) return [];
  return stored.map(normalizeCustomer);
}

function writeAll(customers) {
  writeJSON(KEYS.customers, customers);
  return customers;
}

/**
 * Derive the next PG-000N code from what already exists, so codes stay unique
 * even after deletions or across a re-seed.
 */
function nextCustomerCode(existing) {
  const max = existing.reduce((acc, c) => {
    const n = Number(String(c.code || '').replace(/\D/g, ''));
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `PG-${String(max + 1).padStart(4, '0')}`;
}
// ---------------------------------------------------------------- selectors

/** 'overdue' | 'soon' | 'ok' for a customer, based on the next rent due date. */
export function getCustomerStatus(customer, today = dayjs()) {
  return getRentStatus(customer.nextDueDate, today);
}

export function getCustomerStatusLabel(customer, today = dayjs()) {
  return getRentStatusLabel(customer.nextDueDate, today);
}

/** Start of the billing cycle that `nextDueDate` closes. */
export function getCurrentCycleStart(customer) {
  return getCycleStart(customer.nextDueDate, customer.dueDay);
}

/**
 * Every payment records `paidForDueDate`: the due date it settled at the time
 * it was made. That explicit link is what makes "has this tenant paid?" a
 * question with a clean answer, instead of guessing from payment timestamps.
 */
export function getLastPaidThrough(customer) {
  const stamps = customer.payments
    .map((p) => p.paidForDueDate || p.date)
    .filter(Boolean)
    .sort();
  return stamps.length ? stamps[stamps.length - 1] : null;
}

/**
 * "Paid" = nothing is outstanding right now: the next due date has not passed
 * *and* the tenant has already settled the cycle that is running. A newly
 * admitted tenant who simply is not due yet is neither overdue nor paid.
 */
export function isPaidForCurrentCycle(customer, today = dayjs()) {
  const paidThrough = getLastPaidThrough(customer);
  if (!paidThrough) return false;
  if (daysDiff(today, customer.nextDueDate) < 0) return false; // rent is overdue again
  return !dayjs(paidThrough).startOf('day').isBefore(dayjs(getCurrentCycleStart(customer)).startOf('day'));
}

/** Total rent collected against the most recently settled due date. */
export function getPaidAmountForCurrentCycle(customer) {
  const lastSettled = getLastPaidThrough(customer);
  if (!lastSettled) return 0;
  return customer.payments
    .filter((p) => (p.paidForDueDate || p.date) === lastSettled)
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
}

/** Nearest due date first, overdue before due-soon before healthy. */
export function sortByDueDate(list, today = dayjs()) {
  return [...list].sort((a, b) => {
    const statusDelta =
      SORT_WEIGHT[getRentStatus(a.nextDueDate, today)] - SORT_WEIGHT[getRentStatus(b.nextDueDate, today)];
    if (statusDelta !== 0) return statusDelta;
    const dateDelta = daysDiff(today, a.nextDueDate) - daysDiff(today, b.nextDueDate);
    if (dateDelta !== 0) return dateDelta;
    return String(a.name).localeCompare(String(b.name));
  });
}

export function summarise(list, today = dayjs()) {
  const active = list.filter((c) => c.status !== 'inactive');
  let overdue = 0;
  let dueSoon = 0;
  let expected = 0;
  let collected = 0;
  let paidCount = 0;

  for (const c of active) {
    const status = getRentStatus(c.nextDueDate, today);
    if (status === 'overdue') overdue += 1;
    if (status === 'soon') dueSoon += 1;
    expected += Number(c.rentAmount) || 0;
    if (isPaidForCurrentCycle(c)) {
      paidCount += 1;
      collected += getPaidAmountForCurrentCycle(c);
    }
  }

  return {
    total: active.length,
    overdue,
    dueSoon,
    ok: Math.max(0, active.length - overdue - dueSoon),
    expected,
    collected,
    outstanding: Math.max(0, expected - collected),
    paid: paidCount,
  };
}

// ------------------------------------------------------------------ queries

export async function listCustomers() {
  // Async on purpose: a network backend would be a fetch here.
  return readAll();
}

export async function getCustomer(id) {
  return readAll().find((c) => c.id === id) ?? null;
}

// ----------------------------------------------------------------- mutations

export async function createCustomer(data) {
  const all = readAll();
  const dueDay = Number(data.dueDay) || dayjs(data.joiningDate || todayISO()).date();
  const customer = normalizeCustomer({
    ...data,
    dueDay,
    nextDueDate: data.nextDueDate || getNextDueDate(data.joiningDate, 1, dueDay),
    code: data.code || nextCustomerCode(all),
    createdAt: nowISO(),
  });
  all.push(customer);
  writeAll(all);
  return customer;
}

export async function updateCustomer(id, patch) {
  const all = readAll();
  const index = all.findIndex((c) => c.id === id);
  if (index === -1) throw new Error('Customer not found.');

  const merged = normalizeCustomer({ ...all[index], ...patch, id, updatedAt: nowISO() });

  // Re-derive the due anchor + date when the joining date or rent anchor moved.
  if (patch.joiningDate && patch.joiningDate !== all[index].joiningDate) {
    merged.dueDay = Number(patch.dueDay) || dayjs(patch.joiningDate).date();
    merged.nextDueDate = getNextDueDate(patch.joiningDate, 1, merged.dueDay);
  } else if (patch.dueDay && patch.dueDay !== all[index].dueDay && !patch.nextDueDate) {
    merged.nextDueDate = getNextDueDate(merged.joiningDate, 1, merged.dueDay);
  }

  all[index] = merged;
  writeAll(all);
  return merged;
}

export async function deleteCustomer(id) {
  const all = readAll();
  const target = all.find((c) => c.id === id);
  if (!target) throw new Error('Customer not found.');

  // Best-effort cleanup; a failed image delete must not block the record delete.
  await Promise.allSettled([deleteImage(target.photoId), deleteImage(target.proofImageId)]);

  writeAll(all.filter((c) => c.id !== id));
  return true;
}

/**
 * Record a rent payment and roll the due date forward one month from the
 * *current* due date, so an overdue tenant catches up month by month instead of
 * jumping ahead. The day-of-month anchor is preserved.
 */
export async function addPayment(id, { amount, date, mode = 'cash', note = '' }) {
  const all = readAll();
  const index = all.findIndex((c) => c.id === id);
  if (index === -1) throw new Error('Customer not found.');

  const customer = all[index];
  const payment = {
    id: createId('pay'),
    amount: Number(amount) || 0,
    date: date || todayISO(),
    mode,
    note: note || '',
    // Capture the due date this payment settles before it rolls forward.
    paidForDueDate: customer.nextDueDate,
    createdAt: nowISO(),
  };

  const updated = {
    ...customer,
    payments: [...customer.payments, payment],
    nextDueDate: advanceDueDate(customer.nextDueDate, 1, customer.dueDay),
    depositPaid: customer.depositPaid || false,
    updatedAt: nowISO(),
  };

  all[index] = updated;
  writeAll(all);
  return { customer: updated, payment };
}

export async function removePayment(id, paymentId) {
  const all = readAll();
  const index = all.findIndex((c) => c.id === id);
  if (index === -1) throw new Error('Customer not found.');

  const updated = { ...all[index], payments: all[index].payments.filter((p) => p.id !== paymentId) };
  all[index] = updated;
  writeAll(all);
  return updated;
}

export async function toggleDepositPaid(id) {
  const all = readAll();
  const index = all.findIndex((c) => c.id === id);
  if (index === -1) throw new Error('Customer not found.');
  const updated = { ...all[index], depositPaid: !all[index].depositPaid, updatedAt: nowISO() };
  all[index] = updated;
  writeAll(all);
  return updated;
}

export async function setCustomerStatus(id, status) {
  return updateCustomer(id, { status });
}

// -------------------------------------------------------------------- images

export async function setCustomerImage(id, kind, dataUrl) {
  const field = kind === 'photo' ? 'photoId' : 'proofImageId';
  const all = readAll();
  const index = all.findIndex((c) => c.id === id);
  if (index === -1) throw new Error('Customer not found.');

  const previous = all[index][field];
  const imageId = createId('img');
  await putImage(imageId, dataUrl);
  if (previous) await deleteImage(previous).catch(() => {});

  all[index] = { ...all[index], [field]: imageId, updatedAt: nowISO() };
  writeAll(all);
  return all[index];
}

export function getCustomerImage(imageId) {
  return getImage(imageId);
}

// ------------------------------------------------------------------- resets

export async function clearAllCustomers() {
  removeKey(KEYS.customers);
  return [];
}
