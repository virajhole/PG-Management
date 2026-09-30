import { TABLES, listRows, getRow, insertRow, updateRow, deleteRow, deleteRowsWhere, clearTable } from './supabase.js';
import { createId, nowISO, todayISO, dayjs } from '../utils/dateLogic.js';
import { getRemaining, statusFor, money, toAmount, monthKey } from '../utils/ledger.js';

/**
 * Rent cycles - one row per tenant per month, stored in Supabase.
 *
 * This module is the only writer of the `rent_cycles` table. Everything is async
 * on purpose, and every call goes through the tiny query surface in supabase.js,
 * so swapping the backend (or mocking it in tests) is a one-file change.
 *
 * A tenant always has exactly one *open* cycle (status pending or partial) - that
 * is the one the dashboard shows and the one payments are applied to. Settling
 * it creates the next one, a month later.
 */

export function normalizeCycle(raw = {}) {
  const rentAmount = toAmount(raw.rentAmount);
  const paidAmount = toAmount(raw.paidAmount);
  const remaining = getRemaining({ rentAmount, paidAmount });

  return {
    id: raw.id || createId('cyc'),
    customerId: raw.customerId || '',
    dueDate: raw.dueDate || todayISO(),
    rentAmount,
    paidAmount,
    // `remainingAmount` is derived; getRemaining() is the source of truth.
    remainingAmount: remaining,
    status: statusFor({ rentAmount, paidAmount }),
    settledAt: raw.settledAt ?? null,
    createdAt: raw.createdAt || nowISO(),
    updatedAt: raw.updatedAt || nowISO(),
  };
}

export async function listCycles() {
  return (await listRows(TABLES.cycles)).map(normalizeCycle);
}

/** Cycles for one tenant, newest due date last (history reads bottom-up). */
export async function listCyclesForCustomer(customerId) {
  return (await listCycles())
    .filter((cycle) => cycle.customerId === customerId)
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
}

/**
 * The open cycle for a tenant: the newest one that is not yet settled.
 * Returns null only if the tenant has somehow been left with no open cycle.
 */
export async function getOpenCycle(customerId) {
  const cycles = (await listCycles()).filter((cycle) => cycle.customerId === customerId);
  if (cycles.length === 0) return null;
  const open = cycles.filter((cycle) => cycle.status !== 'paid');
  const pool = open.length > 0 ? open : cycles;
  return pool.reduce((newest, cycle) => (cycle.dueDate > newest.dueDate ? cycle : newest), pool[0]);
}

export async function getCycle(id) {
  const row = await getRow(TABLES.cycles, id);
  return row ? normalizeCycle(row) : null;
}

/** Create (or return) the open cycle for a tenant. */
export async function ensureOpenCycle(customer) {
  const existing = await getOpenCycle(customer.id);
  if (existing) return existing;
  return createCycle({
    customerId: customer.id,
    dueDate: customer.nextDueDate,
    rentAmount: customer.rentAmount,
  });
}

export async function createCycle({ customerId, dueDate, rentAmount, paidAmount = 0 }) {
  const cycle = normalizeCycle({ customerId, dueDate, rentAmount, paidAmount });
  return normalizeCycle(await insertRow(TABLES.cycles, cycle));
}

/** Overwrite one cycle by id; the DB recomputes remaining/status from the amounts. */
export async function updateCycle(id, patch) {
  const existing = await getCycle(id);
  if (!existing) throw new Error('Rent cycle not found.');

  const merged = normalizeCycle({ ...existing, ...patch, id, updatedAt: nowISO() });
  return normalizeCycle(await updateRow(TABLES.cycles, id, merged));
}

/**
 * Re-derive paid/remaining/status from a fresh set of payment amounts.
 * Used after a transaction is deleted, so balances can never drift from the
 * transactions that justify them.
 */
export async function recomputeCycleFromPayments(id, payments) {
  const cycle = await getCycle(id);
  if (!cycle) throw new Error('Rent cycle not found.');
  const paidAmount = money(payments.reduce((sum, payment) => sum + toAmount(payment.amount), 0));
  return updateCycle(id, {
    paidAmount,
    settledAt: paidAmount >= cycle.rentAmount ? (cycle.settledAt || nowISO()) : null,
  });
}

/** Follows a tenant's rent, e.g. when the monthly price is edited. */
export async function updateOpenCycleAmount(customerId, rentAmount) {
  const open = await getOpenCycle(customerId);
  if (!open) return null;
  return updateCycle(open.id, { rentAmount });
}

export async function deleteCycle(id) {
  await deleteRow(TABLES.cycles, id);
  return true;
}

/** Remove every cycle a deleted customer leaves behind. */
export async function deleteCyclesForCustomer(customerId) {
  await deleteRowsWhere(TABLES.cycles, 'customerId', customerId);
  return true;
}

/** Used by the wipe in Settings and by test resets. */
export async function clearAllCycles() {
  await clearTable(TABLES.cycles);
  return [];
}

export { monthKey, dayjs };