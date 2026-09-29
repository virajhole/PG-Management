import { readJSON, writeJSON, removeKey, KEYS } from './localStore.js';
import { createId, nowISO, todayISO, dayjs } from '../utils/dateLogic.js';
import { getRemaining, statusFor, money, toAmount, monthKey } from '../utils/ledger.js';

/**
 * Rent cycles - one row per tenant per month.
 *
 * This module is the only writer of `KEYS.cycles`. Everything is async on
 * purpose, so a later move to a REST/Firestore backend is a reimplementation of
 * this file and nothing else has to change.
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
    // `remainingAmount` is derived; it is stored so exports and reports can be
    // read without re-running the maths, but getRemaining() is the source.
    remainingAmount: remaining,
    status: statusFor({ rentAmount, paidAmount }),
    settledAt: raw.settledAt ?? null,
    createdAt: raw.createdAt || nowISO(),
    updatedAt: raw.updatedAt || nowISO(),
  };
}

function readAll() {
  const stored = readJSON(KEYS.cycles, []);
  if (!Array.isArray(stored)) return [];
  return stored.map(normalizeCycle);
}

function writeAll(cycles) {
  writeJSON(KEYS.cycles, cycles);
  return cycles;
}

export async function listCycles() {
  return readAll();
}

/** Cycles for one tenant, newest due date last (history reads bottom-up). */
export async function listCyclesForCustomer(customerId) {
  return readAll()
    .filter((cycle) => cycle.customerId === customerId)
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
}

/**
 * The open cycle for a tenant: the newest one that is not yet settled.
 * Returns null only if the tenant has somehow been left with no open cycle.
 */
export async function getOpenCycle(customerId) {
  const cycles = readAll().filter((cycle) => cycle.customerId === customerId);
  if (cycles.length === 0) return null;
  const open = cycles.filter((cycle) => cycle.status !== 'paid');
  const pool = open.length > 0 ? open : cycles;
  return pool.reduce((newest, cycle) => (cycle.dueDate > newest.dueDate ? cycle : newest), pool[0]);
}

export async function getCycle(id) {
  return readAll().find((cycle) => cycle.id === id) ?? null;
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
  const cycles = readAll();
  const cycle = normalizeCycle({ customerId, dueDate, rentAmount, paidAmount });
  cycles.push(cycle);
  writeAll(cycles);
  return cycle;
}

/** Overwrite one cycle by id, keeping the stored remaining/status in step. */
export async function updateCycle(id, patch) {
  const cycles = readAll();
  const index = cycles.findIndex((cycle) => cycle.id === id);
  if (index === -1) throw new Error('Rent cycle not found.');

  const updated = normalizeCycle({ ...cycles[index], ...patch, id, updatedAt: nowISO() });
  cycles[index] = updated;
  writeAll(cycles);
  return updated;
}

/**
 * Re-derive paid/remaining/status from a fresh set of payment amounts.
 * Used after a transaction is deleted, so the balance can never drift from the
 * transactions that justify it.
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
  writeAll(readAll().filter((cycle) => cycle.id !== id));
  return true;
}

/** Remove every cycle a deleted customer leaves behind. */
export async function deleteCyclesForCustomer(customerId) {
  writeAll(readAll().filter((cycle) => cycle.customerId !== customerId));
  return true;
}

/** Used by the wipe in Settings and by the migration. */
export async function clearAllCycles() {
  removeKey(KEYS.cycles);
  return [];
}

export { monthKey, dayjs };
