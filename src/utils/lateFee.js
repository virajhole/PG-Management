import { money, toAmount } from './ledger.js';
import { dayjs, daysDiff } from './dateLogic.js';

/**
 * Late fee maths.
 *
 * A late fee is an informational line the admin chooses to add after the grace
 * period - the dashboard suggests it and the admin confirms, so the ledger is
 * never changed without a human decision. Mode:
 *   fixed   -> `value` rupees per day late
 *   percent -> `value` percent of the open rent balance, per day
 */

export const LATE_FEE_MODES = [
  { value: 'none', label: 'No late fee' },
  { value: 'fixed', label: 'Fixed ₹/day' },
  { value: 'percent', label: '% of balance per day' },
];

/** Fee for one day, given the mode. Returns 0 for 'none'. */
export function lateFeePerDay({ mode = 'none', value = 0, balance = 0 }) {
  const v = Math.max(Number(value) || 0, 0);
  if (mode === 'fixed') return money(v);
  if (mode === 'percent') return money((toAmount(balance) * v) / 100);
  return 0;
}

/**
 * Total suggested late fee for a tenant.
 *   daysLate = days past (dueDate + graceDays), floored at 0
 *   capped   at `max` when provided
 */
export function computeLateFee({ mode = 'none', value = 0, graceDays = 0, max = null, dueDate, balance = 0, today = dayjs() }) {
  if (mode === 'none' || toAmount(balance) <= 0 || !dueDate) {
    return { daysLate: 0, perDay: 0, amount: 0, capped: false };
  }

  const graceEnd = dayjs(dueDate).startOf('day').add(Math.max(Number(graceDays) || 0, 0), 'day');
  const todayD = dayjs(today).startOf('day');
  const daysLate = Math.max(daysDiff(graceEnd.format('YYYY-MM-DD'), todayD.format('YYYY-MM-DD')), 0);
  const perDay = lateFeePerDay({ mode, value, balance });

  if (daysLate <= 0 || perDay <= 0) {
    return { daysLate, perDay, amount: 0, capped: false };
  }

  const raw = money(daysLate * perDay);
  const capped = max != null && Number(max) > 0 && raw > Number(max);
  return {
    daysLate,
    perDay,
    amount: capped ? money(Number(max)) : raw,
    capped,
  };
}

/** Suggestions for a whole pending list (dashboard "apply late fees" flow). */
export function suggestLateFees(pendingList = [], settings = {}, today = dayjs()) {
  if (!settings || settings.lateFeeMode === 'none') return [];
  return pendingList
    .filter((row) => row.daysOverdue > 0 && row.rentRemaining > 0)
    .map((row) => ({
      customerId: row.customerId,
      name: row.name,
      balance: row.rentRemaining,
      dueDate: row.dueDate,
      ...computeLateFee({
        mode: settings.lateFeeMode,
        value: settings.lateFeeValue,
        graceDays: settings.lateFeeGraceDays,
        max: settings.lateFeeMax,
        dueDate: row.dueDate,
        balance: row.rentRemaining,
        today,
      }),
    }))
    .filter((s) => s.amount > 0);
}
