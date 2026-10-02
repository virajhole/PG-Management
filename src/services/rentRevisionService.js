import { TABLES, listRows, insertRow, updateRow } from './supabase.js';
import { createId, nowISO, todayISO } from '../utils/dateLogic.js';
import { toAmount } from '../utils/ledger.js';

/**
 * Rent revision history (migration 004).
 *
 * A revision records the audit trail: who moved from which rent to which rent
 * and from what date. Updating the tenant's rent_amount itself stays in
 * customerService - this module wraps the pair so the UI cannot write one
 * without the other.
 */

function normalizeRevision(raw = {}) {
  return {
    id: raw.id || createId('rev'),
    customerId: raw.customerId || raw.customer_id || '',
    customerName: raw.customerName || raw.customer_name || '',
    oldRent: toAmount(raw.oldRent ?? raw.old_rent),
    newRent: toAmount(raw.newRent ?? raw.new_rent),
    effectiveDate: raw.effectiveDate || raw.effective_date || todayISO(),
    note: raw.note || '',
    createdAt: raw.createdAt || raw.created_at || nowISO(),
  };
}

export async function listRevisions() {
  const rows = await listRows(TABLES.rentRevisions);
  return rows.map(normalizeRevision);
}

export async function listRevisionsForCustomer(customerId) {
  return (await listRevisions())
    .filter((r) => r.customerId === customerId)
    .sort((a, b) => String(b.effectiveDate).localeCompare(String(a.effectiveDate)));
}

/**
 * Apply a new rent to one tenant and write the history row. `updateCustomer`
 * is imported lazily so this module can be imported from anywhere without
 * cycles (customerService imports supabase only).
 */
export async function applyRevision({ customerId, customerName = '', oldRent = 0, newRent, effectiveDate = todayISO(), note = '', updateCustomer }) {
  const value = toAmount(newRent);
  if (value <= 0) throw new Error('The new rent must be greater than zero.');

  const row = await insertRow(TABLES.rentRevisions, {
    customerId,
    customerName,
    oldRent: toAmount(oldRent),
    newRent: value,
    effectiveDate,
    note,
  });

  if (updateCustomer) {
    await updateCustomer(customerId, { rentAmount: value });
  }

  return normalizeRevision(row);
}

/** Bulk: same new rent (or a percent bump) for many tenants at once. */
export async function applyBulkRevision({ customers, newRent, percentBump = 0, effectiveDate = todayISO(), note = '', updateCustomer }) {
  const results = [];
  for (const customer of customers) {
    const target =
      newRent != null
        ? toAmount(newRent)
        : Math.round(toAmount(customer.rentAmount) * (1 + toAmount(percentBump) / 100));
    results.push(
      await applyRevision({
        customerId: customer.id,
        customerName: customer.name,
        oldRent: customer.rentAmount,
        newRent: target,
        effectiveDate,
        note,
        updateCustomer,
      }),
    );
  }
  return results;
}

/** Fix a mistyped history row (the tenant's rent itself is not touched). */
export async function updateRevision(id, patch) {
  const row = await updateRow(TABLES.rentRevisions, id, patch);
  return normalizeRevision(row);
}
