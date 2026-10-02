import { useRef, useState } from 'react';
import { motion, useMotionValue, useTransform, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import Avatar from './Avatar.jsx';
import StatusBadge, { rentRowClass } from './StatusBadge.jsx';
import { Badge, ProgressBar } from './ui.jsx';
import { CheckIcon, MessageIcon, ChevronRightIcon } from './icons.jsx';
import { formatCurrency, formatDate, formatRupees } from '../utils/format.js';
import { getRemaining, getPaidPercent } from '../utils/ledger.js';
import { buildReminderMessage, waLink } from '../utils/whatsapp.js';

/**
 * Mobile customer card with swipe actions:
 *   swipe right -> Record Payment
 *   swipe left  -> WhatsApp reminder
 *
 * The gestures are additive: the row buttons still work, so the feature also
 * works on desktop and for reduced-motion users (drag is disabled there).
 */
export default function SwipeCustomerCard({ customer, cycle, billTotal = 0, today, onPay }) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [fired, setFired] = useState(null);
  const triggerLock = useRef(false);

  const x = useMotionValue(0);
  const payOpacity = useTransform(x, [24, 96], [0, 1]);
  const waOpacity = useTransform(x, [-96, -24], [1, 0]);

  const remaining = getRemaining(cycle);
  const percent = getPaidPercent(cycle);
  const rowClass = rentRowClass(customer, today, cycle);

  function handleDragEnd(_, info) {
    if (triggerLock.current) {
      triggerLock.current = false;
      return;
    }
    if (info.offset.x > 96 && Math.abs(info.velocity.x) > 120) {
      setFired('pay');
    } else if (info.offset.x < -96 && Math.abs(info.velocity.x) > 120) {
      setFired('wa');
    }
  }

  const waHref = waLink(customer.mobile, buildReminderMessage(customer, remaining > 0 ? remaining : null));

  return (
    <li className="relative overflow-hidden rounded-2xl">
      {/* Underlay: revealed by the swipe. */}
      <div className="absolute inset-0 flex items-stretch justify-between" aria-hidden="true">
        <motion.div
          style={{ opacity: payOpacity }}
          className="flex w-24 flex-col items-center justify-center gap-1 rounded-l-2xl bg-emerald-500 text-white"
        >
          <CheckIcon className="size-5" />
          <span className="text-[10px] font-bold">Record</span>
        </motion.div>
        <motion.div
          style={{ opacity: waOpacity }}
          className="flex w-24 flex-col items-center justify-center gap-1 rounded-r-2xl bg-[#25D366] text-white"
        >
          <MessageIcon className="size-5" />
          <span className="text-[10px] font-bold">Remind</span>
        </motion.div>
      </div>

      <motion.div
        drag={reduceMotion ? false : 'x'}
        dragConstraints={{ left: -140, right: 140 }}
        dragElastic={0.35}
        onDragEnd={handleDragEnd}
        className={`rent-row relative rounded-2xl border shadow-sm ${rowClass}`}
      >
        <button type="button" onClick={() => navigate(`/customer/${customer.id}`)} className="block w-full px-4 pt-3.5 text-left">
          <div className="flex items-start gap-3">
            <Avatar customer={customer} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-[15px] leading-tight font-semibold text-ink">{customer.name}</p>
                <StatusBadge customer={customer} today={today} cycle={cycle} className="mt-0.5" />
              </div>
              <p className="mt-1 truncate text-xs text-ink-subtle">
                {customer.mobile} · {customer.sharingType} sharing
                {customer.roomNo ? ` · Room ${customer.roomNo}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {remaining > 0 && (
                  <Badge tone="danger">Balance {formatRupees(remaining)}</Badge>
                )}
                {billTotal > 0 && <Badge tone="brand">Elec {formatRupees(billTotal)}</Badge>}
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-2 pb-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-ink-subtle">Monthly rent</p>
                <p className="mt-0.5 text-sm font-semibold text-ink">{formatCurrency(customer.rentAmount)}</p>
              </div>
              <div>
                <p className="text-ink-subtle">Next due</p>
                <p className="mt-0.5 text-sm font-semibold text-ink">{formatDate(customer.nextDueDate)}</p>
              </div>
            </div>
            <ProgressBar percent={percent} tone={percent >= 100 ? 'accent' : percent > 0 ? 'warning' : 'muted'} label="Paid progress" />
          </div>
        </button>

        {/* Buttons mirror the swipes so the actions stay discoverable. */}
        <div className="flex items-center gap-2 border-t border-black/5 px-3 py-2.5 dark:border-white/10">
          <button
            type="button"
            onClick={() => onPay(customer)}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-white/70 px-3 text-xs font-semibold text-emerald-700 active:scale-[0.97] dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
          >
            <CheckIcon className="size-4" /> Record
          </button>
          {waHref && (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-white/70 px-3 text-xs font-semibold text-[#128C7E] active:scale-[0.97] dark:bg-white/5 dark:text-accent-300"
            >
              <MessageIcon className="size-4" /> Remind
            </a>
          )}
          <button
            type="button"
            onClick={() => navigate(`/customer/${customer.id}`)}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-white/70 px-2.5 text-ink-subtle active:scale-[0.97] dark:bg-white/5"
            aria-label={`Open ${customer.name}`}
          >
            <ChevronRightIcon className="size-4" />
          </button>
        </div>
      </motion.div>

      {fired === 'pay' && null}
    </li>
  );
}
