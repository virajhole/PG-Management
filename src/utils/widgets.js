/**
 * Customizable dashboard widgets. The admin can hide/show and reorder them;
 * the preference is saved per browser (per Supabase account, scoped by the
 * user id available at call time).
 */

export const WIDGETS = [
  { key: 'hero', label: 'Collection hero' },
  { key: 'stats', label: 'Stat cards' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'charts', label: 'Mini charts' },
  { key: 'occupancy', label: 'Occupancy' },
  { key: 'customers', label: 'Tenant list' },
];

const KEY = (userId) => `pg-manager:widgets:${userId ?? 'default'}`;

export function loadWidgetOrder(userId) {
  try {
    const raw = localStorage.getItem(KEY(userId));
    if (!raw) return WIDGETS.map((w) => w.key);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return WIDGETS.map((w) => w.key);
    // Keep any new widget keys that were introduced after the preference.
    const known = parsed.filter((k) => WIDGETS.some((w) => w.key === k));
    const missing = WIDGETS.map((w) => w.key).filter((k) => !known.includes(k));
    return [...known, ...missing];
  } catch {
    return WIDGETS.map((w) => w.key);
  }
}

export function saveWidgetOrder(userId, order) {
  try {
    localStorage.setItem(KEY(userId), JSON.stringify(order));
  } catch {
    /* ignore */
  }
}

export function loadWidgetHidden(userId) {
  try {
    const raw = localStorage.getItem(`pg-manager:widgets-hidden:${userId ?? 'default'}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveWidgetHidden(userId, hidden) {
  try {
    localStorage.setItem(`pg-manager:widgets-hidden:${userId ?? 'default'}`, JSON.stringify(hidden));
  } catch {
    /* ignore */
  }
}
