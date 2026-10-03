import { TABLES, listRows, insertRow, updateRow, deleteRow } from './supabase.js';
import { todayISO } from '../utils/dateLogic.js';
import { getRemaining, statusFor, toAmount } from '../utils/ledger.js';

/**
 * Rent cycles - one row per tenant per month. The open cycle is the newest
 * one; its remaining amount is computed here, never stored.
 */

export function normalizeCycle(raw = {}) {
  const rentAmount = toAmount(raw.rentAmount);
  const paidAmount = toAmount(raw.paidAmount);
  return {
    id: raw.id ?? null,
    customerId: raw.customerId || '',
    dueDate: raw.dueDate || todayISO(),
    rentAmount,
    paidAmount,
    remainingAmount: getRemaining({ rentAmount, paidAmount }),
    status: statusFor({ rentAmount, paidAmount }),
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

export async function listCycles() {
  return (await listRows(TABLES.cycles)).map(normalizeCycle);
}

/** Newest due date first, so history reads top-down. */
export async function listCyclesForCustomer(customerId) {
  return (await listCycles())
    .filter((cycle) => cycle.customerId === customerId)
    .sort((a, b) => String(b.dueDate).localeCompare(String(a.dueDate)));
}

/** The cycle a tenant is being billed for right now: the newest one. */
export async function getOpenCycle(customerId) {
  const cycles = await listCyclesForCustomer(customerId);
  return cycles[0] ?? null;
}

/** Create the open cycle for a tenant when none exists yet. */
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

export async function updateCycle(id, patch) {
  const merged = normalizeCycle(patch);
  return normalizeCycle(await updateRow(TABLES.cycles, id, merged));
}

export async function deleteCycle(id) {
  await deleteRow(TABLES.cycles, id);
  return true;
}
