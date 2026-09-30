import { TABLES, listRows, getRow, getRowWhereAll, updateRow, deleteRow, deleteRowsWhere, clearTable, rpc } from './supabase.js';
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

/** Newest month first, which is how the history table is displayed. */
export async function listLightBills() {
  return (await listRows(TABLES.lightBills))
    .map(normalizeLightBill)
    .sort((a, b) => (a.month < b.month ? 1 : -1));
}

export async function listLightBillsForCustomer(customerId) {
  return (await listLightBills()).filter((bill) => bill.customerId === customerId);
}

export async function getLightBill(id) {
  const row = await getRow(TABLES.lightBills, id);
  return row ? normalizeLightBill(row) : null;
}

/** Only one bill per tenant per month, so re-saving updates the existing row. */
export async function getLightBillForMonth(customerId, month) {
  const row = await getRowWhereAll(TABLES.lightBills, { customerId, month });
  return row ? normalizeLightBill(row) : null;
}

/** Create the bill via the atomic RPC so the one-per-month rule cannot race. */
export async function createLightBill(data) {
  const bill = await rpc('save_light_bill', {
    customerId: data.customerId,
    billId: null,
    month: data.month || monthKey(),
    units: data.units ?? null,
    ratePerUnit: data.ratePerUnit ?? null,
    billAmount: data.billAmount != null ? toAmount(data.billAmount) : null,
    note: data.note || '',
  });
  return normalizeLightBill(bill);
}

export async function updateLightBill(id, patch) {
  const existing = await getLightBill(id);
  if (!existing) throw new Error('Light bill not found.');

  // Changing units x rate re-derives the amount, but never below what is
  // already paid - otherwise editing a bill could silently make it negative.
  const merged = { ...existing, ...patch, id };
  if (patch.units != null && patch.ratePerUnit != null && patch.billAmount == null) {
    merged.billAmount = toAmount(Number(patch.units) * Number(patch.ratePerUnit));
  }
  if (merged.billAmount < existing.paidAmount) {
    throw new Error('The bill amount cannot be less than the amount already paid.');
  }

  const updated = normalizeLightBill({ ...merged, updatedAt: nowISO() });
  return normalizeLightBill(await updateRow(TABLES.lightBills, id, updated));
}

/** Re-derive paid/remaining after a transaction is deleted. */
export async function recomputeLightBillFromPayments(id, payments) {
  const bill = await getLightBill(id);
  if (!bill) throw new Error('Light bill not found.');
  const paidAmount = money(payments.reduce((sum, payment) => sum + toAmount(payment.amount), 0));
  return updateLightBill(id, { paidAmount });
}

export async function deleteLightBill(id) {
  await deleteRow(TABLES.lightBills, id);
  return true;
}

/** Remove every light bill a deleted customer leaves behind. */
export async function deleteLightBillsForCustomer(customerId) {
  await deleteRowsWhere(TABLES.lightBills, 'customerId', customerId);
  return true;
}

export async function clearAllLightBills() {
  await clearTable(TABLES.lightBills);
  return [];
}

/** Outstanding electricity across every tenant. */
export async function getLightBillOutstanding() {
  return money((await listLightBills()).reduce((sum, bill) => sum + getRemaining(bill), 0));
}

export { dayjs };