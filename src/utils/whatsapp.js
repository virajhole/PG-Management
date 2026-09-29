import { formatCurrency, formatDate } from './format.js';

/** Digits only, as WhatsApp needs: no +, spaces, dashes or brackets. */
export function normalisePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/** 10-digit Indian mobile gets the 91 country prefix. */
export function toInternational(phone) {
  const digits = normalisePhone(phone);
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function waLink(phone, message) {
  const number = toInternational(phone);
  if (!number) return '';
  return `https://wa.me/${number}?text=${encodeURIComponent(message || '')}`;
}

/** Plain-text reminder with the amount, sharing type and due date. */
export function buildReminderMessage(customer) {
  const name = String(customer.name || '').split(' ')[0] || 'there';
  const rent = formatCurrency(customer.rentAmount);
  const due = formatDate(customer.nextDueDate);
  const room = customer.roomNo ? ` (Room ${customer.roomNo}${customer.bedNo ? `-${customer.bedNo}` : ''})` : '';

  return (
    `Hello ${name},${room}\n\n` +
    `This is a friendly reminder that your PG rent of ${rent} ` +
    `for ${customer.sharingType} sharing was due on ${due}.\n\n` +
    `Kindly clear the pending rent at your convenience. ` +
    `For any queries, please contact the PG management.\n\n` +
    `Thank you!`
  );
}
