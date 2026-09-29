import { getRentStatus, getRentStatusLabel } from '../utils/dateLogic.js';
import { isPaidForCurrentCycle } from '../services/customerService.js';
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

export function rentRowClass(customer, today) {
  return RENT_ROW_CLASS[getRentStatus(customer.nextDueDate, today)] ?? RENT_ROW_CLASS.ok;
}

export default function StatusBadge({ customer, today, className = '' }) {
  // A settled, up-to-date tenant reads better as "Paid" than as a countdown.
  const paid = isPaidForCurrentCycle(customer, today);
  const status = paid ? 'paid' : getRentStatus(customer.nextDueDate, today);
  const label = paid ? 'Paid' : getRentStatusLabel(customer.nextDueDate, today);
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
