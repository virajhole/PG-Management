import dayjs from 'dayjs';

export { dayjs };

/** Number of days in the month that `date` falls in. */
export function daysInMonth(date) {
  const d = dayjs(date);
  return d.daysInMonth();
}

/** Canonical storage format for a calendar date: "YYYY-MM-DD". */
function toISODate(value) {
  const d = dayjs.isDayjs(value) ? value : dayjs(value);
  return d.isValid() ? d.format('YYYY-MM-DD') : null;
}

/**
 * Build a date for a specific "day of month" anchor, clamping to the last day
 * of the target month when the anchor does not exist there.
 *   anchorDay 31, monthsAhead +1 from Jan 2024 -> 2024-02-29
 *   anchorDay 31, monthsAhead +1 from Mar 2024 -> 2024-04-30
 */
export function dateForAnchor(fromDate, anchorDay, monthsAhead = 0) {
  const base = dayjs(fromDate);
  const day = Number(anchorDay) || base.date();
  const target = base.add(monthsAhead, 'month');
  return toISODate(target.date(Math.min(day, target.daysInMonth())));
}

/**
 * The first rent due date for a customer = same day-of-month as the joining
 * date, one month after joining. Month-end cases clamp to the last day of the
 * shorter month (joined 31 Jan -> due 29 Feb in a leap year, 28 Feb otherwise).
 */
export function getNextDueDate(joiningDate, monthsAhead = 1, anchorDay) {
  return dateForAnchor(joiningDate, anchorDay, monthsAhead);
}

/**
 * Move an existing due date forward by `months` while preserving the original
 * day-of-month anchor, so a customer who joined on the 31st keeps being billed
 * on the 31st (clamped) rather than drifting to the 28th.
 */
export function advanceDueDate(currentDueDate, months = 1, anchorDay) {
  return dateForAnchor(currentDueDate, anchorDay, months);
}

/**
 * Whole days from `from` to `to`, ignoring the time of day.
 * Negative when `to` is in the past. `daysDiff(today, due)` -> 0 when due today.
 */
export function daysDiff(from, to) {
  const a = dayjs(from).startOf('day');
  const b = dayjs(to).startOf('day');
  return b.diff(a, 'day');
}

/**
 * Rent bucket for a due date relative to today.
 *   overdue -> due date has already passed
 *   soon    -> due today or within the next 5 days (inclusive)
 *   ok      -> more than 5 days away
 */
export function getRentStatus(dueDate, today = dayjs(), soonWindowDays = 5) {
  const delta = daysDiff(today, dueDate);
  if (delta < 0) return 'overdue';
  if (delta <= soonWindowDays) return 'soon';
  return 'ok';
}

/** Human label for a due date + status: "Overdue by 4 days" / "Due in 3 days". */
export function getRentStatusLabel(dueDate, today = dayjs()) {
  const delta = daysDiff(today, dueDate);
  if (delta < 0) {
    const n = Math.abs(delta);
    return `Overdue by ${n} ${n === 1 ? 'day' : 'days'}`;
  }
  if (delta === 0) return 'Due today';
  return `Due in ${delta} ${delta === 1 ? 'day' : 'days'}`;
}

/** Start date of the billing cycle that `dueDate` closes. */
export function getCycleStart(dueDate, anchorDay) {
  return dateForAnchor(dueDate, anchorDay, -1);
}

export function formatDate(value, fallback = '—') {
  if (!value) return fallback;
  const d = dayjs(value);
  return d.isValid() ? d.format('DD MMM YYYY') : fallback;
}

export function formatDateShort(value, fallback = '—') {
  if (!value) return fallback;
  const d = dayjs(value);
  return d.isValid() ? d.format('DD MMM') : fallback;
}

export function todayISO() {
  return dayjs().format('YYYY-MM-DD');
}

export function nowISO() {
  return dayjs().toISOString();
}

/** Fresh unique id (no crypto dependency, works in every target browser). */
export function createId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** "YYYY-MM-DD" <-> native <input type="date"> value. */
export function toDateInput(value) {
  if (!value) return '';
  const d = dayjs(value);
  return d.isValid() ? d.format('YYYY-MM-DD') : '';
}
