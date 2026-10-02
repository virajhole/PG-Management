import { money } from './ledger.js';

/**
 * UPI deep links and payment QR payloads.
 *
 * `upi://pay?pa=VPA&pn=Name&am=Amount&cu=INR&tn=Note` is the de-facto standard
 * understood by GPay / PhonePe / Paytm / BHIM. The QR code is generated from
 * the same string (see useQrCode), so what the camera reads and what the deep
 * link opens can never disagree.
 */

/** Build the UPI deep link, or '' when required parts are missing. */
export function buildUpiLink({ payeeVpa, payeeName = '', amount = 0, note = '' }) {
  const vpa = String(payeeVpa || '').trim();
  if (!vpa || !vpa.includes('@')) return '';
  const am = money(amount);
  if (am <= 0) return '';

  // encodeURIComponent (not URLSearchParams) so spaces stay %20 - the form
  // UPI URIs conventionally use, and what the camera-scanned QR must match.
  const parts = [`pa=${encodeURIComponent(vpa)}`];
  if (payeeName) parts.push(`pn=${encodeURIComponent(String(payeeName).slice(0, 40))}`);
  parts.push(`am=${am.toFixed(2)}`);
  parts.push('cu=INR');
  if (note) parts.push(`tn=${encodeURIComponent(String(note).slice(0, 50))}`);

  return `upi://pay?${parts.join('&')}`;
}

/**
 * Reminder message templates. Placeholders:
 *   {name} {amount} {dueDate} {upiLink}
 * `amount` is the exact outstanding balance so a single tap pays it off.
 */
export const REMINDER_TEMPLATES = {
  first: {
    id: 'first',
    label: 'First reminder',
    body:
      'Hello {name},\n\nThis is a gentle reminder that your PG rent of {amount} was due on {dueDate}. Kindly pay at your earliest convenience.\n\nPay instantly via UPI: {upiLink}\n\nThank you!',
  },
  dueToday: {
    id: 'dueToday',
    label: 'Due today',
    body:
      'Hello {name},\n\nA quick reminder that your PG rent of {amount} is due today ({dueDate}). You can pay instantly via UPI: {upiLink}\n\nThank you!',
  },
  overdue: {
    id: 'overdue',
    label: 'Overdue reminder',
    body:
      'Hello {name},\n\nYour PG rent of {amount} was due on {dueDate} and is now overdue. Please clear the balance today to avoid late fees.\n\nPay via UPI: {upiLink}\n\nThank you!',
  },
};

export const TEMPLATE_PLACEHOLDERS = ['{name}', '{amount}', '{dueDate}', '{upiLink}'];

export function fillTemplate(template, { name, amount, dueDate, upiLink }) {
  return String(template || '')
    .replaceAll('{name}', name ?? '')
    .replaceAll('{amount}', amount ?? '')
    .replaceAll('{dueDate}', dueDate ?? '')
    .replaceAll('{upiLink}', upiLink ?? '');
}
