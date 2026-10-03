import { TABLES, listRows, buildWriteRow, insertRow, updateRow } from './supabase.js';

/**
 * The one settings row: PG name, UPI id, sharing prices, default deposit,
 * Terms text and the WhatsApp reminder template. Kept in Supabase so every
 * signed-in admin sees the same values.
 */

export const SHARING_TYPES = [1, 2, 3, 4, 5];

export const DEFAULT_TERMS = `1. Rent Payment
• Monthly rent must be paid on or before the due date shown on the dashboard.
• Payment modes accepted: Cash, UPI and Bank transfer.

2. Notice Period
• One month's prior notice is required before leaving the PG.
• Rent is non-refundable for the notice month.

3. Security Deposit
• A refundable deposit is collected at the time of joining.
• The deposit is refunded after vacating, after deducting dues and damage charges.

4. House Rules
• No smoking, alcohol or illegal substances inside the premises.
• Visitors are allowed only between 8:00 AM and 8:00 PM.
• Keep your room and the common areas clean.`;

export const DEFAULT_WHATSAPP_TEMPLATE =
  'Hello {name}, your rent of {amount} was due on {due}. Kindly pay at your earliest. - {pg}';

export const DEFAULT_SETTINGS = {
  pgName: 'My PG',
  upiId: '',
  sharingPrices: { 1: 18000, 2: 15000, 3: 13000, 4: 11500, 5: 10500 },
  defaultDeposit: 5000,
  terms: DEFAULT_TERMS,
  whatsappTemplate: DEFAULT_WHATSAPP_TEMPLATE,
};

function normalize(raw = {}) {
  return {
    pgName: raw.pgName ?? DEFAULT_SETTINGS.pgName,
    upiId: raw.upiId ?? '',
    sharingPrices: { ...DEFAULT_SETTINGS.sharingPrices, ...(raw.sharingPrices ?? {}) },
    defaultDeposit: Number(raw.defaultDeposit) || 0,
    terms: raw.terms ?? DEFAULT_TERMS,
    whatsappTemplate: raw.whatsappTemplate ?? DEFAULT_WHATSAPP_TEMPLATE,
  };
}

/** The settings row, or the defaults before the first save. */
export async function loadSettings() {
  const rows = await listRows(TABLES.settings);
  return normalize(rows[0] ?? {});
}

export async function saveSettings(settings) {
  const clean = normalize(settings);
  const rows = await listRows(TABLES.settings);
  const existing = rows[0];
  const payload = buildWriteRow(TABLES.settings, { ...clean, updatedAt: new Date().toISOString() });
  // Update the row in place when it exists, otherwise insert the first one.
  if (existing?.id) {
    await updateRow(TABLES.settings, existing.id, payload);
  } else {
    await insertRow(TABLES.settings, payload);
  }
  return clean;
}

export function getRentForSharing(settings, sharingType) {
  const price = settings?.sharingPrices?.[String(sharingType)];
  return Number.isFinite(Number(price)) ? Number(price) : 0;
}
