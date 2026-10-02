import { TABLES, listRows, insertRow, updateRow, rpc } from './supabase.js';
import { createId, monthKeyOf } from '../utils/meterSplitDate.js';
import { planMeterSplit } from '../utils/meterSplit.js';

/**
 * Per-room electricity meter readings. Applying a reading splits the bill
 * equally among the room's active occupants and creates one light_bill per
 * occupant through the same save_light_bill RPC the manual flow uses, so the
 * ledger rules never fork.
 */

export async function listMeterReadings() {
  const rows = await listRows(TABLES.meterReadings);
  return rows.map(normalizeReading);
}

export function normalizeReading(raw = {}) {
  return {
    id: raw.id || createId('mtr'),
    roomId: raw.roomId || null,
    roomNo: raw.roomNo || '',
    month: raw.month || monthKeyOf(),
    previousReading: Number(raw.previousReading) || 0,
    currentReading: Number(raw.currentReading) || 0,
    ratePerUnit: Number(raw.ratePerUnit) || 0,
    totalUnits: raw.totalUnits == null ? null : Number(raw.totalUnits),
    totalAmount: raw.totalAmount == null ? null : Number(raw.totalAmount),
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

export async function saveMeterReading(input) {
  const reading = normalizeReading(input);
  if (reading.currentReading < reading.previousReading) {
    throw new Error('Current reading cannot be lower than the previous reading.');
  }
  if (reading.ratePerUnit <= 0) {
    throw new Error('Enter a rate per unit greater than zero.');
  }
  // Upsert by (room, month): the fake's insertRow has no upsert, so look first.
  const existing = (await listMeterReadings()).find(
    (r) => r.roomId === reading.roomId && r.month === reading.month,
  );
  if (existing) {
    return normalizeReading(await updateRow(TABLES.meterReadings, existing.id, reading));
  }
  return normalizeReading(await insertRow(TABLES.meterReadings, reading));
}

/**
 * Apply a reading: create/update one light bill per active occupant.
 * Returns the plan actually applied (shares may differ by a paisa from the
 * naive average so the parts sum exactly).
 */
export async function applyMeterReading({ reading, occupants }) {
  const plan = planMeterSplit({ reading, occupants });
  if (!plan.entries.length) {
    throw new Error('No active occupants in this room - nothing to bill.');
  }
  if (plan.totalAmount <= 0) {
    throw new Error('Nothing to bill - check the readings and rate.');
  }

  const saved = [];
  for (const entry of plan.entries) {
    const bill = await rpc('save_light_bill', {
      customerId: entry.customerId,
      month: reading.month,
      units: null,
      ratePerUnit: null,
      billAmount: entry.share,
      note: `Meter ${reading.roomNo} · ${reading.month}: ${plan.totalUnits} units ÷ ${plan.entries.length} occupants`,
    });
    saved.push(bill);
  }
  return { plan, bills: saved };
}
