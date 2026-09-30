import { TABLES, listRows, rpc } from './supabase.js';
import { createId, nowISO, todayISO } from '../utils/dateLogic.js';
import { toAmount, money, TX_RENT } from '../utils/ledger.js';

/**
 * The payment ledger - now backed entirely by Supabase RPCs.
 *
 * All writes that change money are atomic (record_rent_payment,
 * record_light_bill_payment, delete_transaction). Reads are straight from the DB.
 */

function normalizeTransaction(raw = {}) {
  if (!raw) return raw;
  return {
    id: raw.id || createId('txn'),
    customerId: raw.customerId || '',
    customerName: raw.customerName || '',
    type: raw.type || TX_RENT,
    cycleId: raw.cycleId ?? null,
    billId: raw.billId ?? null,
    amount: toAmount(raw.amount),
    date: raw.date || todayISO(),
    mode: raw.mode || 'cash',
    note: raw.note || '',
    createdAt: raw.createdAt || nowISO(),
    openedCycleId: raw.openedCycleId ?? null,
    creditBefore: raw.creditBefore ?? null,
    creditAfter: raw.creditAfter ?? null,
    settledAt: raw.settledAt ?? null,
    dueDateBefore: raw.dueDateBefore ?? null,
    dueDateAfter: raw.dueDateAfter ?? null,
    billMonth: raw.billMonth ?? null,
  };
}

export async function listTransactions() {
  const rows = await listRows(TABLES.transactions);
  return rows.map(normalizeTransaction);
}

export async function getTransaction(id) {
  return normalizeTransaction((await listTransactions()).find((tx) => tx.id === id) ?? null);
}

/** Run the rent plan for a prospective amount. Writes nothing. */
export async function previewRentPayment({ customerId, amount, nextRentAmount }) {
  const plan = await rpc('preview_rent_payment', {
    customerId,
    amount,
    nextRent: nextRentAmount ?? null,
  });
  return plan;
}

/** Record rent against the tenant's open cycle (atomic). */
export async function recordRentPayment({ customerId, amount, date, mode = 'cash', note = '' }) {
  const result = await rpc('record_rent_payment', {
    customerId,
    amount,
    date,
    mode,
    note,
  });

  return {
    transaction: normalizeTransaction(result.transaction),
    cycle: result.cycle,
    nextCycle: result.nextCycle,
    plan: result.plan,
  };
}

/** Create or update this month's bill for a tenant (atomic). */
export async function saveLightBill({ customerId, billId, month, units, ratePerUnit, billAmount, note = '' }) {
  const bill = await rpc('save_light_bill', {
    customerId,
    billId: billId || null,
    month: month || null,
    units: units ?? null,
    ratePerUnit: ratePerUnit ?? null,
    billAmount: billAmount != null ? toAmount(billAmount) : null,
    note: note || '',
  });
  return bill;
}

/** Record a payment against a light bill (atomic). */
export async function recordLightBillPayment({ customerId, billId, amount, date, mode = 'cash', note = '' }) {
  const result = await rpc('record_light_bill_payment', {
    customerId,
    billId,
    amount,
    date,
    mode,
    note,
  });
  return {
    transaction: normalizeTransaction(result.transaction),
    bill: result.bill,
    result: result.result,
  };
}

/** Delete a transaction and restore the balances it changed (atomic). */
export async function deleteTransaction(id) {
  const result = await rpc('delete_transaction', { id });
  return {
    transaction: normalizeTransaction(result.transaction),
    cycle: result.cycle,
  };
}

export async function clearAllTransactions() {
  // Wipe happens via wipe_all RPC at a higher level (Settings). Tests use the
  // fake's clear table, but this is left for API completeness.
  const rows = await listTransactions();
  await Promise.allSettled(rows.map((tx) => rpc('delete_transaction', { id: tx.id })));
  return [];
}

/** Remove every transaction a deleted customer leaves behind. */
export async function deleteTransactionsForCustomer(customerId) {
  const rows = await listTransactions();
  await Promise.allSettled(rows.filter((tx) => tx.customerId === customerId).map((tx) => rpc('delete_transaction', { id: tx.id })));
  return true;
}

export { money };