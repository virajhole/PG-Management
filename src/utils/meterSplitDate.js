import { dayjs } from './dateLogic.js';

/** Canonical 'YYYY-MM' key for a date-ish value (defaults to now). */
export function monthKeyOf(value = dayjs()) {
  const d = dayjs(value);
  return d.isValid() ? d.format('YYYY-MM') : dayjs().format('YYYY-MM');
}

/** Fresh unique id, mirroring dateLogic's createId. */
export function createId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
