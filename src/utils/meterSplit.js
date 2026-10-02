import { money } from './ledger.js';

/**
 * Electricity meter maths, shared by the Meters page and its tests.
 *
 * A reading is per room per month. The bill is split *equally* among the
 * room's active occupants (the common PG convention), with any rounding
 * remainder absorbed by the last tenant so the parts always sum exactly to the
 * total. Light bills stay completely separate from rent, as before.
 */

/** Units consumed between two readings. */
export function unitsConsumed(previousReading, currentReading) {
  const units = Number(currentReading) - Number(previousReading);
  return Number.isFinite(units) && units > 0 ? money(units) : 0;
}

/** Bill for a reading: units x rate. */
export function billForUnits(units, ratePerUnit) {
  return money(Math.max(units, 0) * Math.max(Number(ratePerUnit) || 0, 0));
}

/**
 * Split a total equally across `count` people.
 * Returns exact 2-decimal parts summing to the total.
 */
export function splitEqually(total, count) {
  const n = Math.max(Number(count) || 0, 0);
  const totalR = money(Math.max(total, 0));
  if (n === 0 || totalR <= 0) return [];
  if (n === 1) return [totalR];

  const base = Math.floor((totalR / n) * 100) / 100;
  const parts = Array.from({ length: n }, () => base);
  // Distribute the leftover paise one by one, from the last share backwards,
  // so the last tenant absorbs the rounding as documented.
  let remainder = Math.round((totalR - base * n) * 100);
  let i = 0;
  while (remainder > 0) {
    const idx = n - 1 - (i % n);
    parts[idx] = money(parts[idx] + 0.01);
    remainder -= 1;
    i += 1;
  }
  return parts;
}

/**
 * Full plan for applying one reading: what each occupant owes as a separate
 * light bill entry for the given month.
 */
export function planMeterSplit({ reading, occupants }) {
  const totalUnits = unitsConsumed(reading.previousReading, reading.currentReading);
  const totalAmount = billForUnits(totalUnits, reading.ratePerUnit);
  const active = (occupants ?? []).filter((o) => o.status === 'active' || o.status === 'notice');
  const parts = splitEqually(totalAmount, active.length);

  const entries = active.map((o, i) => ({
    customerId: o.id,
    customerName: o.name,
    share: parts[i] ?? 0,
  }));

  return {
    totalUnits,
    totalAmount,
    perPerson: active.length ? money(totalAmount / active.length) : 0,
    entries,
  };
}
