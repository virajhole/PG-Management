import { TABLES, listRows, rpc } from './supabase.js';
import { toAmount, TX_RENT, TX_LIGHT_BILL } from '../utils/ledger.js';

/**
 * The payment ledger. Every money-changing write goes through the record_payment
 * / delete_payment Postgres functions, so the partial / full / overpayment
 * rules live in exactly one place (see supabase/schema.sql). Deleting a
 * payment recalculates the balances it had changed.
 */

export function normalizeTransaction(raw = {}) {
  return {
    id: raw.id ?? null,
    customerId: raw.customerId || '',
    customerName: raw.customerName || '',
    type: raw.type || TX_RENT,
    refId: raw.refId || null,
    amount: toAmount(raw.amount),
    date: raw.date,
    mode: raw.mode || 'cash',
    note: raw.note || '',
    createdAt: raw.createdAt || null,
  };
}

export async function listTransactions() {
  return (await listRows(TABLES.transactions)).map(normalizeTransaction);
}

/** Record a rent payment. Partial keeps the due date; full opens the next cycle. */
export async function recordRentPayment({ customerId, amount, date, mode = 'cash', note = '' }) {
  const result = await rpc('record_payment', { customerId, amount: toAmount(amount), date, mode, note });
  return { transactionId: result?.transactionId ?? null, ...result };
}

/** Record a payment against one light bill. */
export async function recordLightBillPayment({ customerId, billId, amount, date, mode = 'cash', note = '' }) {
  const result = await rpc('record_payment', { customerId, amount: toAmount(amount), date, mode, note, billId });
  return { transactionId: result?.transactionId ?? null, ...result };
}

/**
 * Delete a payment. The Postgres function recalculates the cycle or bill the
 * payment had settled; the caller refreshes so the new balances show.
 */
export async function deleteTransaction(id) {
  const result = await rpc('delete_payment', { id });
  if (result && result.deleted === false) {
    throw new Error(result.reason || 'Payment already deleted or not found.');
  }
  return true;
}

export { TX_RENT, TX_LIGHT_BILL };
