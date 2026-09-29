import { buildReminderMessage, waLink } from '../utils/whatsapp.js';
import { MessageIcon } from './icons.jsx';

/**
 * "Send reminder" opens WhatsApp with a prefilled, plain-text rent reminder.
 * The number is normalised to international form (no +, spaces or dashes)
 * because wa.me rejects anything else.
 */
export default function ReminderButton({ customer, className = 'btn-secondary', label = 'Remind', compact = false }) {
  const href = waLink(customer.mobile, buildReminderMessage(customer));
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={`Send rent reminder to ${customer.name}`}
    >
      <MessageIcon className="size-4 shrink-0" />
      {!compact && <span>{label}</span>}
    </a>
  );
}
