import dayjs from 'dayjs';
import relativeTimePlugin from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTimePlugin);

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  currencyDisplay: 'symbol',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
});

/** Indian-style currency, e.g. 11500 -> "₹11,500". */
export function formatCurrency(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '₹0';
  return inrFormatter.format(n);
}

/** "Rs 11,500" style, used where the rupee word reads better than the glyph. */
export function formatRupees(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 'Rs 0';
  return `Rs ${numberFormatter.format(n)}`;
}

export function formatNumber(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '0';
  return numberFormatter.format(n);
}

/** Coerce form input (string | number | null) to a finite number. */
export function toNumber(value, fallback = 0) {
  const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

/** "2025-06" -> "Jun 2025", for light-bill month labels. */
export function formatBillMonth(key) {
  const [year, month] = String(key || '').split('-');
  if (!year || !month) return String(key || '');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(month) - 1]} ${year}`;
}

/** Compact one/two letter initials for the avatar fallback. */
export function getInitials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

export function getAge(joiningDate) {
  if (!joiningDate) return '—';
  const months = dayjs().diff(dayjs(joiningDate), 'month');
  if (months < 1) return 'New';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y} yr ${m} mo`;
}

export function relativeTime(iso) {
  if (!iso) return '';
  const d = dayjs(iso);
  return d.isValid() ? d.from(dayjs()) : '';
}

/* Display helpers that live next to the date maths are re-exported here so a
   component only ever needs one formatting import. */
export { formatDate, formatDateShort } from './dateLogic.js';
export { formatBytes } from './image.js';
