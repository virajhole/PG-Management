import { TABLES, listRows, insertRow, updateRow, rpc } from './supabase.js';
import { createId, nowISO, todayISO } from '../utils/dateLogic.js';
import { toAmount, money, TX_LATE_FEE } from '../utils/ledger.js';

/**
 * Late fee records (migration 004).
 *
 * A fee is always admin-confirmed: the dashboard/details screen *suggests* an
 * amount (see utils/lateFee.js), and recording it writes two things - a row in
 * late_fees for the audit trail and a LATE_FEE transaction on the tenant's
 * open cycle, so the balance and the reports both move by the fee amount.
 * Waiving keeps the history but writes no transaction.
 */

function normalizeLateFee(raw = {}) {
  return {
    id: raw.id || createId('fee'),
    customerId: raw.customerId || raw.customer_id || '',
    customerName: raw.customerName || raw.customer_name || '',
    cycleId: raw.cycleId ?? raw.cycle_id ?? null,
    amount: toAmount(raw.amount),
    daysLate: Number(raw.daysLate ?? raw.days_late) || 0,
    waived: Boolean(raw.waived),
    note: raw.note || '',
    createdAt: raw.createdAt || raw.created_at || nowISO(),
  };
}

export async function listLateFees() {
  const rows = await listRows(TABLES.lateFees);
  return rows.map(normalizeLateFee);
}

export async function listLateFeesForCustomer(customerId) {
  return (await listLateFees()).filter((fee) => fee.customerId === customerId);
}

/**
 * Record a confirmed late fee. The transaction is written through the ledger
 * RPC so the cycle's balance stays exact; the late_fees row is the audit trail.
 */
export async function recordLateFee({ customerId, cycleId = null, amount, daysLate = 0, note = '', date = todayISO() }) {
  const value = toAmount(amount);
  if (value <= 0) throw new Error('The late fee amount must be greater than zero.');

  const transaction = await rpc('record_flat_transaction', {
    type: TX_LATE_FEE,
    customerId,
    cycleId: cycleId || null,
    amount: value,
    date,
    mode: 'cash',
    note: note || `Late fee for ${daysLate} day${daysLate === 1 ? '' : 's'}`,
  });

  const fee = normalizeLateFee({
    customerId,
    cycleId,
    amount: value,
    daysLate,
    note: note || `Late fee for ${daysLate} day${daysLate === 1 ? '' : 's'}`,
  });
  const row = await insertRow(TABLES.lateFees, {
    id: fee.id,
    customerId: fee.customerId,
    cycleId: fee.cycleId,
    amount: money(fee.amount),
    daysLate: fee.daysLate,
    waived: fee.waived,
    note: fee.note,
    createdAt: fee.createdAt,
  });
  return { fee: normalizeLateFee(row), transaction };
}

/** Keep the fee in history but mark it waived - writes no transaction. */
export async function waiveLateFee(id, note = 'Waived by admin') {
  const row = await updateRow(TABLES.lateFees, id, { waived: true, note });
  return normalizeLateFee(row);
}
