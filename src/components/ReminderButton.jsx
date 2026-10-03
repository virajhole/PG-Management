import { useData } from '../context/DataContext.jsx';
import { buildReminderMessage, waLink } from '../utils/whatsapp.js';
import { MessageIcon } from './icons.jsx';

/**
 * "Remind" opens WhatsApp with a prefilled rent reminder. The message comes
 * from the Settings template ({name}, {amount}, {due}, {pg}); `remaining`
 * (the open-cycle balance) is used when there is one.
 */
export default function ReminderButton({ customer, remaining = null, className = 'btn-secondary', label = 'Remind', compact = false }) {
  const { settings } = useData();
  const href = waLink(customer.mobile, buildReminderMessage(customer, remaining, settings.whatsappTemplate, settings.pgName));
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
