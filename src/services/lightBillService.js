import { TABLES, listRows, insertRow, updateRow } from './supabase.js';
import { toAmount, monthKey } from '../utils/ledger.js';

/**
 * Light bills - one row per tenant per month, tracked completely separately
 * from rent. Bill money never moves a rent due date or a row colour.
 */

export function normalizeBill(raw = {}) {
  return {
    id: raw.id ?? null,
    customerId: raw.customerId || '',
    month: raw.month || monthKey(),
    billAmount: toAmount(raw.billAmount),
    paidAmount: toAmount(raw.paidAmount),
    note: raw.note || '',
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

export async function listLightBills() {
  return (await listRows(TABLES.lightBills)).map(normalizeBill);
}

export async function listBillsForCustomer(customerId) {
  return (await listLightBills())
    .filter((bill) => bill.customerId === customerId)
    .sort((a, b) => String(b.month).localeCompare(String(a.month)));
}

/** Insert or update one bill (the dialog edits the current month's bill). */
export async function saveLightBill(bill) {
  const clean = normalizeBill(bill);
  if (clean.id) {
    return normalizeBill(await updateRow(TABLES.lightBills, clean.id, clean));
  }
  return normalizeBill(await insertRow(TABLES.lightBills, clean));
}
