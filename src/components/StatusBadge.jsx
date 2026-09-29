import { getRentStatus, getRentStatusLabel } from '../utils/dateLogic.js';
import { getRemaining } from '../utils/ledger.js';
import { CheckCircleIcon, ClockIcon, AlertIcon } from './icons.jsx';

const STYLES = {
  overdue: 'border-red-200 bg-red-100 text-red-800',
  soon: 'border-amber-200 bg-amber-100 text-amber-800',
  ok: 'border-emerald-200 bg-emerald-100 text-emerald-800',
  paid: 'border-emerald-200 bg-emerald-100 text-emerald-800',
};

const ICONS = {
  overdue: AlertIcon,
  soon: ClockIcon,
  ok: ClockIcon,
  paid: CheckCircleIcon,
};

/** Row tint classes - kept next to the badge so the two can never drift. */
export const RENT_ROW_CLASS = {
  overdue: 'rent-overdue rent-row border-l-4',
  soon: 'rent-soon rent-row border-l-4',
  ok: 'rent-ok rent-row border-l-4',
};

/**
 * The colour rules, driven by the open cycle:
 *   red    overdue rent still carries a balance
 *   amber  due within 5 days and still carries a balance
 *   green  paid up (no balance) OR simply not due yet
 * A partially paid cycle keeps its colour - partial payment never clears it.
 */
export function cycleBucket(cycle, customer, today) {
  if (getRemaining(cycle) <= 0) return 'paid';
  return getRentStatus(customer.nextDueDate, today);
}

export function rentRowClass(customer, today, cycle = null) {
  return RENT_ROW_CLASS[cycleBucket(cycle, customer, today)] ?? RENT_ROW_CLASS.ok;
}

export default function StatusBadge({ customer, today, cycle = null, className = '' }) {
  const status = cycleBucket(cycle, customer, today);
  const label = status === 'paid' ? 'Paid' : getRentStatusLabel(customer.nextDueDate, today);
  const Icon = ICONS[status] ?? ClockIcon;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold
                  whitespace-nowrap ${STYLES[status]} ${className}`}
    >
      <Icon className="size-3.5 shrink-0" />
      {label}
    </span>
  );
}