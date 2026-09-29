import { readJSON, writeJSON, removeKey, KEYS } from './localStore.js';
import { createId, nowISO, dayjs } from '../utils/dateLogic.js';
import { getRemaining, statusFor, money, toAmount, monthKey } from '../utils/ledger.js';

/**
 * Electricity (light) bills - deliberately a *separate* ledger from rent.
 *
 * Nothing here reads or writes a rent cycle, and rent maths never looks at these
 * records: a pending light bill must not colour a rent row, change a rent
 * remaining amount or move a rent due date. The only shared value is the
 * customer id.
 */

export function normalizeLightBill(raw = {}) {
  const billAmount = toAmount(raw.billAmount);
  const paidAmount = toAmount(raw.paidAmount);
  const units = raw.units === '' || raw.units == null ? null : Number(raw.units);
  const rate = raw.ratePerUnit === '' || raw.ratePerUnit == null ? null : Number(raw.ratePerUnit);

  return {
    id: raw.id || createId('bil'),
    customerId: raw.customerId || '',
    month: raw.month || monthKey(),
    units: Number.isFinite(units) ? units : null,
    ratePerUnit: Number.isFinite(rate) ? rate : null,
    billAmount,
    paidAmount,
    remainingAmount: getRemaining({ billAmount, paidAmount }),
    status: statusFor({ billAmount, paidAmount }),
    note: raw.note || '',
    createdAt: raw.createdAt || nowISO(),
    updatedAt: raw.updatedAt || nowISO(),
  };
}

function readAll() {
  const stored = readJSON(KEYS.lightBills, []);
  if (!Array.isArray(stored)) return [];
  return stored.map(normalizeLightBill);
}

function writeAll(bills) {
  writeJSON(KEYS.lightBills, bills);
  return bills;
}

/** Newest month first, which is how the history table is displayed. */
export async function listLightBills() {
  return readAll().sort((a, b) => (a.month < b.month ? 1 : -1));
}

export async function listLightBillsForCustomer(customerId) {
  return listLightBills().then((bills) => bills.filter((bill) => bill.customerId === customerId));
}

export async function getLightBill(id) {
  return readAll().find((bill) => bill.id === id) ?? null;
}

/** Only one bill per tenant per month, so re-saving updates the existing row. */
export async function getLightBillForMonth(customerId, month) {
  return readAll().find((bill) => bill.customerId === customerId && bill.month === month) ?? null;
}

export async function createLightBill(data) {
  const bills = readAll();
  const bill = normalizeLightBill(data);
  bills.push(bill);
  writeAll(bills);
  return bill;
}

export async function updateLightBill(id, patch) {
  const bills = readAll();
  const index = bills.findIndex((bill) => bill.id === id);
  if (index === -1) throw new Error('Light bill not found.');

  // Changing units x rate re-derives the amount, but never below what is
  // already paid - otherwise editing a bill could silently make it negative.
  const merged = { ...bills[index], ...patch, id };
  if (patch.units != null && patch.ratePerUnit != null && patch.billAmount == null) {
    merged.billAmount = toAmount(Number(patch.units) * Number(patch.ratePerUnit));
  }
  if (merged.billAmount < bills[index].paidAmount) {
    throw new Error('The bill amount cannot be less than the amount already paid.');
  }

  const updated = normalizeLightBill({ ...merged, updatedAt: nowISO() });
  bills[index] = updated;
  writeAll(bills);
  return updated;
}

/** Re-derive paid/remaining after a transaction is deleted. */
export async function recomputeLightBillFromPayments(id, payments) {
  const bill = await getLightBill(id);
  if (!bill) throw new Error('Light bill not found.');
  const paidAmount = money(payments.reduce((sum, payment) => sum + toAmount(payment.amount), 0));
  return updateLightBill(id, { paidAmount });
}

export async function deleteLightBill(id) {
  writeAll(readAll().filter((bill) => bill.id !== id));
  return true;
}

/** Remove every light bill a deleted customer leaves behind. */
export async function deleteLightBillsForCustomer(customerId) {
  writeAll(readAll().filter((bill) => bill.customerId !== customerId));
  return true;
}

export async function clearAllLightBills() {
  removeKey(KEYS.lightBills);
  return [];
}

/** Outstanding electricity across every tenant. */
export async function getLightBillOutstanding() {
  return money(readAll().reduce((sum, bill) => sum + getRemaining(bill), 0));
}

export { dayjs };
