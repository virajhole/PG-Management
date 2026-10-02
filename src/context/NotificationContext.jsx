import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useData } from './DataContext.jsx';
import { dayjs, daysDiff } from '../utils/dateLogic.js';
import { listComplaints, listEnquiries, listNotices } from '../services/operationsService.js';
import { getStoredNotifs, markNotifsRead, dismissNotifs } from '../utils/notificationsStore.js';

/**
 * Notification centre state, derived on the client from data the app already
 * loads: overdue rents, dues in the next 5 days, open complaints, enquiry
 * follow-ups, tenants leaving soon and new notices. No new database reads are
 * introduced beyond the two light operations lists.
 */

const NotificationContext = createContext(null);

function notifId(...parts) {
  return parts.filter((p) => p !== undefined && p !== null).join(':');
}

export function NotificationProvider({ children }) {
  const { customers, pendingList, status, today } = useData();
  const [complaints, setComplaints] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [notices, setNotices] = useState([]);
  const [readIds, setReadIds] = useState(() => new Set(getStoredNotifs().read));
  const [dismissedIds, setDismissedIds] = useState(() => new Set(getStoredNotifs().dismissed));

  // The operations tables may not exist yet (migration 003 pending), so a
  // failure simply degrades to zero operational notifications.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listComplaints(), listEnquiries(), listNotices()])
      .then(([c, e, n]) => {
        if (cancelled) return;
        setComplaints(c);
        setEnquiries(e);
        setNotices(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status]);

  const notifications = useMemo(() => {
    if (status !== 'ready') return [];
    const out = [];
    const todayStr = today.format('YYYY-MM-DD');

    for (const row of pendingList) {
      if (row.daysOverdue > 0 && row.rentRemaining > 0) {
        out.push({
          id: notifId('overdue', row.customerId, row.dueDate),
          kind: 'overdue',
          tone: 'danger',
          title: `${row.name} is overdue`,
          body: `₹${Number(row.totalRemaining).toLocaleString('en-IN')} pending · due ${row.dueDate}`,
          to: `/customer/${row.customerId}`,
          date: row.dueDate,
        });
      }
    }

    // Rents due within 5 days (not overdue). Balance shown when known.
    const balanceByCustomer = new Map(pendingList.map((r) => [r.customerId, r.totalRemaining]));
    for (const c of customers) {
      if (c.status === 'vacated') continue;
      const delta = daysDiff(todayStr, c.nextDueDate);
      if (delta >= 0 && delta <= 5) {
        const balance = balanceByCustomer.get(c.id) ?? 0;
        out.push({
          id: notifId('due', c.id, c.nextDueDate),
          kind: 'due',
          tone: 'warning',
          title: `${c.name} — rent due ${delta === 0 ? 'today' : `in ${delta} day${delta === 1 ? '' : 's'}`}`,
          body: balance > 0 ? `₹${Number(balance).toLocaleString('en-IN')} pending${c.roomNo ? ` · Room ${c.roomNo}` : ''}` : c.roomNo ? `Room ${c.roomNo}` : 'Rent cycle due',
          to: `/customer/${c.id}`,
          date: c.nextDueDate,
        });
      }
    }

    for (const complaint of complaints) {
      if (complaint.status !== 'resolved') {
        out.push({
          id: notifId('complaint', complaint.id, complaint.updatedAt ?? complaint.createdAt),
          kind: 'complaint',
          tone: complaint.priority === 'high' ? 'danger' : 'warning',
          title: `Complaint: ${complaint.title || complaint.category}`,
          body: `${complaint.roomNo ? `Room ${complaint.roomNo} · ` : ''}${complaint.status === 'open' ? 'Open' : 'In progress'}${complaint.priority === 'high' ? ' · high priority' : ''}`,
          to: '/operations?tab=complaints',
          date: complaint.createdAt,
        });
      }
    }

    for (const enquiry of enquiries) {
      if (['new', 'contacted'].includes(enquiry.status)) {
        out.push({
          id: notifId('enquiry', enquiry.id, enquiry.status),
          kind: 'enquiry',
          tone: 'brand',
          title: `Follow up: ${enquiry.name}`,
          body: `Enquiry ${enquiry.status} · ${enquiry.phone}`,
          to: '/operations?tab=enquiries',
          date: enquiry.createdAt,
        });
      }
    }

    for (const c of customers) {
      if (c.status !== 'notice' || !c.expectedLeavingDate) continue;
      const delta = daysDiff(todayStr, c.expectedLeavingDate);
      if (delta >= 0 && delta <= 30) {
        out.push({
          id: notifId('leaving', c.id, c.expectedLeavingDate),
          kind: 'leaving',
          tone: 'warning',
          title: `${c.name} leaves ${delta === 0 ? 'today' : `in ${delta} day${delta === 1 ? '' : 's'}`}`,
          body: c.roomNo ? `Room ${c.roomNo} · checkout prep` : 'Checkout prep',
          to: `/customer/${c.id}`,
          date: c.expectedLeavingDate,
        });
      }
    }

    for (const n of notices) {
      if (n.date && daysDiff(todayStr, n.date) <= 0) {
        out.push({
          id: notifId('notice', n.id, n.date),
          kind: 'notice',
          tone: 'accent',
          title: `Notice: ${n.title}`,
          body: n.body?.slice(0, 90) ?? '',
          to: '/operations?tab=notices',
          date: n.date,
        });
      }
    }

    return out
      .filter((n) => !dismissedIds.has(n.id))
      .sort((a, b) => {
        const order = { danger: 0, warning: 1, brand: 2, accent: 3 };
        if (order[a.tone] !== order[b.tone]) return order[a.tone] - order[b.tone];
        return String(b.date ?? '').localeCompare(String(a.date ?? ''));
      });
  }, [pendingList, customers, complaints, enquiries, notices, status, today, dismissedIds]);

  const unreadCount = useMemo(() => notifications.filter((n) => !readIds.has(n.id)).length, [notifications, readIds]);

  const markAllRead = () => {
    const ids = notifications.map((n) => n.id);
    setReadIds((prev) => new Set([...prev, ...ids]));
    markNotifsRead(ids);
  };

  const markRead = (id) => {
    setReadIds((prev) => new Set([...prev, id]));
    markNotifsRead([id]);
  };

  const dismiss = (id) => {
    setDismissedIds((prev) => new Set([...prev, id]));
    dismissNotifs([id]);
  };

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAllRead, markRead, dismiss }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationProvider>.');
  return ctx;
}
