import { getSettings as readSettingsRow, saveSettingsRow as writeSettingsRow } from './supabase.js';

/**
 * Admin-configurable pricing + policy text - now stored in Supabase.
 * The admission form reads these as its defaults; every field stays overridable
 * per customer.
 */

export const DEFAULT_TERMS = `1. Rent Payment
• Monthly rent must be paid on or before the 10th of every month.
• Rent is to be paid in advance for the coming month.
• A late fee of Rs 50 per day applies after the due date (max Rs 500).
• Payment modes accepted: Cash, UPI and Bank transfer.

2. Notice Period
• One month's prior written notice is required before leaving the PG.
• The notice must be given to the warden on paper or by email.
• Rent is non-refundable for the notice month.

3. Security Deposit
• A refundable deposit is collected at the time of joining.
• The deposit is refunded after vacating, after deducting dues, damage charges
  and the cost of replacing keys/ID cards.
• Deposit refund is completed within 15 days of vacating the room.

4. House Rules
• No smoking, alcohol, tobacco or illegal substances inside the premises.
• No drugs or prohibited substances are permitted at any time.
• Visitors are allowed only between 8:00 AM and 8:00 PM, and must be registered
  with the warden. Visitors are not allowed after 8:00 PM.
• House is kept locked between 10:00 PM and 5:30 AM. Late entry is not allowed.
• Guests are strictly not allowed inside the rooms.

5. Electricity & Water
• Electricity charges are billed separately as per meter reading and are
  payable along with the rent.
• Water charges are shared equally among all residents.
• Switching off fans, lights and appliances when not in use is mandatory.

6. Damage & Maintenance
• Residents are responsible for any damage caused to furniture, fittings or
  building property and will be charged the repair/replacement cost.
• Rooms must be returned in the same condition as handed over.
• Maintenance complaints must be reported to the warden immediately.

7. General
• Rooms allotted are subject to availability; the management reserves the right
  to shift a resident if required.
• PG rules are subject to change with one month's notice.
• Residents must keep their rooms clean and hygienic.`;

export const DEFAULT_SETTINGS = {
  sharingPrices: {
    1: 18000,
    2: 15000,
    3: 13000,
    4: 11500,
    5: 10500,
  },
  defaultDeposit: 5000,
  rentDueDayOfMonth: 10,
  terms: DEFAULT_TERMS,
  pgName: 'Sunrise Paying Guest',
  ownerName: 'PG Manager',
  ownerMobile: '',
  currencyNote: '',
  // UPI deep links / QR codes (receipts + reminders).
  upiId: '',
  // Late fee: 'none' | 'fixed' (₹/day) | 'percent' (% of balance/day), applied
  // after the grace period, optionally capped. The admin confirms each fee.
  lateFeeMode: 'none',
  lateFeeValue: 0,
  lateFeeGraceDays: 0,
  lateFeeMax: null,
  // Mess (optional).
  messEnabled: false,
  messCharges: 0,
};

export async function loadSettings() {
  try {
    const stored = await readSettingsRow();
    if (!stored) return { ...DEFAULT_SETTINGS };
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      sharingPrices: { ...DEFAULT_SETTINGS.sharingPrices, ...(stored.sharingPrices || {}) },
      lateFeeMax: stored.lateFeeMax ?? null,
      messEnabled: Boolean(stored.messEnabled),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings) {
  const merged = {
    ...settings,
    sharingPrices: { ...settings.sharingPrices },
  };
  await writeSettingsRow(merged);
  return merged;
}

export async function resetSettings() {
  await writeSettingsRow({ ...DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
}

export function getRentForSharing(settings, sharingType) {
  const price = settings?.sharingPrices?.[String(sharingType)];
  return Number.isFinite(Number(price)) ? Number(price) : 0;
}

export const SHARING_TYPES = [1, 2, 3, 4, 5];