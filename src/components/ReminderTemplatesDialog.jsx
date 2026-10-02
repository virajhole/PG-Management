import { useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { Badge, Button } from './ui.jsx';
import { REMINDER_TEMPLATES, fillTemplate } from '../utils/upi.js';
import { waLink } from '../utils/whatsapp.js';
import { useData } from '../context/DataContext.jsx';
import { formatDate } from '../utils/dateLogic.js';
import { formatCurrency } from '../utils/format.js';
import { MessageCircle as MessageIcon, Send as SendIcon } from 'lucide-react';

/**
 * Template-driven WhatsApp reminders.
 *
 * Three built-in templates (first / due today / overdue) with placeholders.
 * "Send to all overdue" opens wa.me one tenant at a time with a progress
 * counter - the browser cannot batch WhatsApp sends silently, so the admin
 * taps Send for each tenant and the dialog advances.
 */
export default function ReminderTemplatesDialog({ open, onClose, customer = null, template: presetTemplate = null }) {
  const { settings, pendingList, openCycleByCustomer, customers } = useData();
  const [templateId, setTemplateId] = useState(presetTemplate?.id ?? 'first');
  const [queue, setQueue] = useState(null); // { ids: [], index: 0 } while bulk sending

  const template = REMINDER_TEMPLATES[templateId] ?? REMINDER_TEMPLATES.first;

  const overdueRows = useMemo(
    () => pendingList.filter((r) => r.daysOverdue > 0 && r.rentRemaining > 0),
    [pendingList],
  );

  // Rows to send for the bulk flow, or the single tenant passed in.
  const sendRows = useMemo(() => {
    if (queue) return overdueRows;
    if (customer) {
      const cycle = openCycleByCustomer.get(customer.id) ?? null;
      const remaining = cycle ? cycle.remainingAmount : customer.rentAmount;
      return [{ customerId: customer.id, name: customer.name, totalRemaining: remaining, dueDate: customer.nextDueDate }];
    }
    return [];
  }, [queue, overdueRows, customer, openCycleByCustomer]);

  const currentIndex = queue ? Math.min(queue.index, overdueRows.length - 1) : 0;
  const current = sendRows[currentIndex] ?? null;

  function buildMessage(row) {
    const name = String(row.name || '').split(' ')[0] || 'there';
    const amount = formatCurrency(row.totalRemaining);
    const dueDate = formatDate(row.dueDate);
    const upiLink = settings.upiId
      ? `upi://pay?pa=${encodeURIComponent(settings.upiId)}&am=${Number(row.totalRemaining).toFixed(2)}&cu=INR`
      : '';
    return fillTemplate(template.body, { name, amount, dueDate, upiLink });
  }

  const currentRow = current ? { ...current, message: buildMessage(current) } : null;

  function openSend() {
    if (!currentRow) return;
    window.open(waLink(customerPhone(current), currentRow.message), '_blank', 'noopener');
    if (queue) {
      setQueue({ ...queue, index: queue.index + 1 });
    }
  }

  function customerPhone(row) {
    const c = customers.find((x) => x.id === row.customerId);
    return c?.mobile ?? '';
  }

  function startBulk() {
    setQueue({ index: 0 });
  }

  function stopBulk() {
    setQueue(null);
  }

  const done = queue && queue.index >= overdueRows.length;

  return (
    <Modal open={open} onClose={onClose} title="Send rent reminder" size="md">
      <div className="space-y-4">
        <div>
          <p className="field-label">Template</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.values(REMINDER_TEMPLATES).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplateId(t.id)}
                aria-pressed={templateId === t.id}
                className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition ${
                  templateId === t.id
                    ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-200'
                    : 'border-line bg-raised text-ink-muted hover:bg-sunken'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {currentRow ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">{currentRow.name}</p>
                <p className="text-xs text-ink-subtle">
                  {formatCurrency(currentRow.totalRemaining)} · due {formatDate(currentRow.dueDate)}
                </p>
              </div>
              {queue && (
                <Badge tone="brand">
                  {Math.min(queue.index + 1, overdueRows.length)} / {overdueRows.length}
                </Badge>
              )}
            </div>

            <pre className="max-h-48 overflow-auto rounded-xl border border-line bg-sunken px-3.5 py-3 font-sans text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
              {currentRow.message}
            </pre>

            <div className="flex flex-col gap-2 sm:flex-row">
              {queue ? (
                <>
                  <Button variant="gradient" className="flex-1" onClick={openSend} disabled={done}>
                    <SendIcon className="size-4" /> {done ? 'All sent' : `Send to ${currentRow.name.split(' ')[0]}`}
                  </Button>
                  <Button variant="secondary" onClick={stopBulk}>
                    {done ? 'Close queue' : 'Stop'}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="gradient" className="flex-1" onClick={openSend}>
                    <MessageIcon className="size-4" /> Open WhatsApp
                  </Button>
                  {overdueRows.length > 1 && (
                    <Button variant="secondary" onClick={startBulk}>
                      Send to all overdue ({overdueRows.length})
                    </Button>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <p className="rounded-xl bg-sunken px-3.5 py-3 text-xs text-ink-subtle">
            No tenant owes rent right now - nothing to remind.
          </p>
        )}

        <p className="text-[11px] leading-relaxed text-ink-subtle">
          Placeholders available: {'{name}'} {'{amount}'} {'{dueDate}'} {'{upiLink}'}. The UPI link pre-fills the exact balance when a UPI ID is set in Settings.
        </p>
      </div>
    </Modal>
  );
}
