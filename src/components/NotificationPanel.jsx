import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext.jsx';
import { BottomSheet, Card, Badge, EmptyState } from './ui.jsx';
import { AlertIcon, ClockIcon, WrenchIcon, UserCheckIcon, MegaphoneIcon, CheckIcon, WalletIcon } from './icons.jsx';

const KIND_ICON = {
  overdue: AlertIcon,
  due: ClockIcon,
  complaint: WrenchIcon,
  enquiry: UserCheckIcon,
  leaving: ClockIcon,
  notice: MegaphoneIcon,
};

const KIND_LABEL = {
  overdue: 'Overdue',
  due: 'Due soon',
  complaint: 'Complaint',
  enquiry: 'Enquiry',
  leaving: 'Leaving',
  notice: 'Notice',
};

/**
 * Notification centre. One flat list, newest/most-urgent first: overdue rents,
 * dues in the next 5 days, open complaints, enquiry follow-ups, leaving-soon
 * and posted notices.
 */
export default function NotificationPanel({ open, onClose }) {
  const { notifications, unreadCount, markAllRead, markRead, dismiss } = useNotifications();
  const navigate = useNavigate();

  function openNotification(n) {
    markRead(n.id);
    onClose();
    if (n.to) navigate(n.to);
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={`Notifications${unreadCount ? ` · ${unreadCount} new` : ''}`}>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={markAllRead} className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
          Mark all read
        </button>
      </div>

      {notifications.length === 0 ? (
        <EmptyState icon={CheckIcon} tone="accent" title="All clear" message="No overdue rents, dues, open complaints or follow-ups right now." />
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => {
            const Icon = KIND_ICON[n.kind] ?? WalletIcon;
            const unread = !n.read;
            return (
              <li key={n.id}>
                <Card hover className="flex items-start gap-3 p-3">
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
                      n.tone === 'danger'
                        ? 'bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400'
                        : n.tone === 'warning'
                          ? 'bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400'
                          : 'bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300'
                    }`}
                  >
                    <Icon className="size-4.5" />
                  </span>
                  <button type="button" onClick={() => openNotification(n)} className="min-w-0 flex-1 text-left">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">{n.title}</span>
                      {unread && <span className="size-2 shrink-0 rounded-full bg-brand-500" aria-label="Unread" />}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-subtle">{n.body}</span>
                    <Badge tone={n.tone === 'danger' ? 'danger' : n.tone === 'warning' ? 'warning' : 'brand'} className="mt-1.5">
                      {KIND_LABEL[n.kind] ?? 'Info'}
                    </Badge>
                  </button>
                  <button
                    type="button"
                    onClick={() => dismiss(n.id)}
                    className="shrink-0 rounded-lg p-1.5 text-ink-subtle hover:bg-sunken hover:text-ink"
                    aria-label={`Dismiss: ${n.title}`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
                      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                    </svg>
                  </button>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </BottomSheet>
  );
}
