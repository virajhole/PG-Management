import { useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/Modal.jsx';
import PaymentDialog from '../components/PaymentDialog.jsx';
import ReminderButton from '../components/ReminderButton.jsx';
import { EmptyState } from '../components/States.jsx';
import { CheckCircleIcon, ClockIcon, DownloadIcon, TrashIcon, BoltIcon } from '../components/icons.jsx';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatRupees, formatNumber, formatDate } from '../utils/format.js';
import {
  filterTransactions,
  getMonthTotal,
  toCsv,
  TX_RENT,
  TX_LIGHT_BILL,
  monthKey,
  monthRange,
  formatMonthLabel,
} from '../utils/ledger.js';

const TYPE_LABEL = { [TX_RENT]: 'Rent', [TX_LIGHT_BILL]: 'Light bill' };
const MODE_LABEL = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer' };

const RANGES = [
  { value: 'all', label: 'All time' },
  { value: 'month', label: 'This month' },
  { value: 'today', label: 'Today' },
  { value: 'custom', label: 'Custom' },
];

function SummaryCard({ label, value, sub, icon: Icon, tone = 'slate' }) {
  const tones = {
    slate: 'text-slate-900',
    red: 'text-red-600',
    amber: 'text-amber-600',
    brand: 'text-brand-600',
  };
  const iconTones = {
    slate: 'bg-slate-100 text-slate-500',
    red: 'bg-red-100 text-red-600',
    amber: 'bg-amber-100 text-amber-600',
    brand: 'bg-brand-50 text-brand-600',
  };
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${iconTones[tone]}`}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-500">{label}</p>
        <p className={`mt-0.5 truncate text-xl leading-tight font-bold ${tones[tone]}`}>{value}</p>
        {sub && <p className="mt-0.5 truncate text-[11px] text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

export default function TransactionsPage() {
  const { customers, transactions, today, openCycleByCustomer, pendingList, deleteTransaction, recordRentPayment, settings } = useData();
  const toast = useToast();

  const [month, setMonth] = useState(() => monthKey(today));
  const [tab, setTab] = useState('all'); // all | pending
  const [typeFilter, setTypeFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');
  const [range, setRange] = useState('month');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [payTarget, setPayTarget] = useState(null);
  const [saving, setSaving] = useState(false);

  const monthLabel = formatMonthLabel(month);
  const monthStats = useMemo(() => getMonthTotal(transactions, month), [transactions, month]);

  const visible = useMemo(
    () =>
      filterTransactions(transactions, {
        range,
        from: fromDate,
        to: toDate,
        type: typeFilter,
        mode: modeFilter,
        query,
      }),
    [transactions, range, fromDate, toDate, typeFilter, modeFilter, query],
  );

  const totalShown = useMemo(
    () => visible.reduce((sum, tx) => sum + Number(tx.amount || 0), 0),
    [visible],
  );

  function exportCsv() {
    const csv = toCsv(visible);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug(settings.pgName) || 'pg-manager'}-transactions-${month}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setSaving(true);
    try {
      await deleteTransaction(deleting.id);
      toast.success('Transaction deleted and balances restored.');
      setDeleting(null);
    } catch (error) {
      toast.error(error.message || 'Could not delete that transaction.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmPayment(payment) {
    setSaving(true);
    try {
      await recordRentPayment({
        customerId: payTarget.customer.id,
        amount: payment.amount,
        date: payment.date,
        mode: payment.mode,
        note: payment.note,
      });
      toast.success('Payment recorded.');
      setPayTarget(null);
    } catch (error) {
      toast.error(error.message || 'Could not record that payment.');
    } finally {
      setSaving(false);
    }
  }

  function openPayFor(customerId) {
    const customer = customers.find((c) => c.id === customerId) ?? null;
    if (!customer) return;
    setPayTarget({ kind: 'rent', customer, cycle: openCycleByCustomer.get(customerId) ?? null });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* ----------------------------------------------------------- header */}
      <header className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Transactions</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Every rupee received - rent and light bills - across all tenants.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            className="field-input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Month"
          />
          <button type="button" className="btn-secondary" onClick={exportCsv}>
            <DownloadIcon className="size-4" />
            CSV
          </button>
          <button type="button" className="btn-secondary" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </header>

      {/* -------------------------------------------------------- summaries */}
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard
          label={monthLabel}
          value={formatRupees(monthStats.total)}
          sub={`${monthStats.count} ${monthStats.count === 1 ? 'payment' : 'payments'}`}
          icon={CheckCircleIcon}
          tone="brand"
        />
        <SummaryCard label="Rent collected" value={formatRupees(monthStats.rent)} sub="this month" icon={BoltIcon} tone="slate" />
        <SummaryCard label="Light bills collected" value={formatRupees(monthStats.lightBill)} sub="this month" icon={BoltIcon} tone="amber" />
        <SummaryCard
          label="Shown"
          value={range === 'all' ? formatRupees(totalShown) : `${formatNumber(visible.length)} rows`}
          sub={range === 'all' ? `${visible.length} payments` : formatRupees(totalShown)}
          icon={ClockIcon}
          tone="slate"
        />
      </section>

      {/* -------------------------------------------------------------- tabs */}
      <div className="flex gap-2 print:hidden">
        {[
          { key: 'all', label: `All transactions (${transactions.length})` },
          { key: 'pending', label: `Remaining / pending (${pendingList.length})` },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={`chip ${
              tab === t.key
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pending' ? (
        <PendingList rows={pendingList} onPay={openPayFor} />
      ) : (
        <>
          {/* --------------------------------------------------------- filters */}
          <div className="card p-3 print:hidden">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
                Type
                <select className="field-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                  <option value="all">All</option>
                  <option value={TX_RENT}>Rent</option>
                  <option value={TX_LIGHT_BILL}>Light bill</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
                Mode
                <select className="field-input" value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
                  <option value="all">All</option>
                  {Object.entries(MODE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
                Date range
                <select className="field-input" value={range} onChange={(e) => setRange(e.target.value)}>
                  {RANGES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              {range === 'custom' ? (
                <div className="col-span-1 grid grid-cols-2 gap-2">
                  <input type="date" className="field-input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From" />
                  <input type="date" className="field-input" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To" />
                </div>
              ) : (
                <div />
              )}
              <input
                type="search"
                className="field-input"
                placeholder="Search tenant, note…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search transactions"
              />
            </div>
            {monthRangeDays(month) && (
              <p className="mt-2 text-[11px] text-slate-400">
                {monthLabel} covers {formatDate(monthRange(month).from)} to {formatDate(monthRange(month).to)}.
              </p>
            )}
          </div>

          {/* ----------------------------------------------------------- list */}
          {visible.length === 0 ? (
            <EmptyState
              icon={CheckCircleIcon}
              title="No transactions here"
              message="Record a rent payment or a light bill payment and it will show up in this table."
            />
          ) : (
            <div className="card overflow-hidden">
              <div className="scroll-slim max-h-[60dvh] overflow-auto">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-3 py-3 font-semibold">Tenant</th>
                      <th className="px-3 py-3 font-semibold">Type</th>
                      <th className="px-3 py-3 text-right font-semibold">Amount</th>
                      <th className="px-3 py-3 font-semibold">Mode</th>
                      <th className="px-3 py-3 font-semibold">Note</th>
                      <th className="px-3 py-3 print:hidden" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((tx) => (
                      <tr key={tx.id} className="group">
                        <td className="px-4 py-3 text-sm whitespace-nowrap text-slate-700 tabular-nums">
                          {formatDate(tx.date)}
                        </td>
                        <td className="px-3 py-3 text-sm font-medium text-slate-900">{tx.customerName}</td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              tx.type === TX_LIGHT_BILL ? 'bg-amber-50 text-amber-700' : 'bg-brand-50 text-brand-700'
                            }`}
                          >
                            {TYPE_LABEL[tx.type] ?? tx.type}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap text-emerald-700 tabular-nums">
                          +{formatRupees(tx.amount)}
                        </td>
                        <td className="px-3 py-3 text-xs whitespace-nowrap text-slate-500">{MODE_LABEL[tx.mode] ?? tx.mode}</td>
                        <td className="max-w-48 px-3 py-3 text-xs truncate text-slate-500">{tx.note || '—'}</td>
                        <td className="px-3 py-3 text-right print:hidden">
                          <button
                            type="button"
                            onClick={() => setDeleting(tx)}
                            className="rounded-lg p-2 text-slate-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                            aria-label={`Delete transaction of ${formatRupees(tx.amount)} on ${formatDate(tx.date)}`}
                          >
                            <TrashIcon className="size-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ----------------------------------------------------------- modals */}
      <PaymentDialog
        open={Boolean(payTarget)}
        target={payTarget}
        onClose={() => setPayTarget(null)}
        onConfirm={confirmPayment}
        busy={saving}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        busy={saving}
        title="Delete this transaction?"
        confirmLabel="Delete"
        message={
          deleting
            ? `${formatRupees(deleting.amount)} received on ${formatDate(deleting.date)} will be removed, and the cycle or bill it paid will be recalculated so balances stay accurate.`
            : ''
        }
      />

      <p className="pt-2 text-center text-xs text-slate-400 print:hidden">
        {settings.pgName} · transactions are stored on this device only
      </p>
    </div>
  );
}

function monthRangeDays(key) {
  if (!key) return false;
  const range = monthRange(key);
  return range && range.from;
}

function slug(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** The "Remaining / Pending" tab: money still owed, rent and light side by side. */
function PendingList({ rows, onPay }) {
  return (
    <div className="card overflow-hidden">
      {rows.length === 0 ? (
        <EmptyState
          icon={CheckCircleIcon}
          title="Nothing pending"
          message="Every tenant is settled up. What a day."
        />
      ) : (
        <div className="scroll-slim max-h-[60dvh] overflow-auto">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">Tenant</th>
                <th className="px-3 py-3 text-right font-semibold">Rent left</th>
                <th className="px-3 py-3 text-right font-semibold">Elec left</th>
                <th className="px-3 py-3 text-right font-semibold">Total</th>
                <th className="px-3 py-3 font-semibold">Due</th>
                <th className="px-3 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.customerId} className="group">
                  <td className="px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">{row.name}</p>
                    <p className="text-xs text-slate-500">
                      {row.roomNo ? `Room ${row.roomNo}` : row.code}
                      {row.daysOverdue > 0 ? ` · ${row.daysOverdue}d overdue` : row.daysOverdue < 0 ? '' : ' · due today'}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap text-red-600 tabular-nums">
                    {formatRupees(row.rentRemaining)}
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap text-amber-600 tabular-nums">
                    {row.lightRemaining > 0 ? formatRupees(row.lightRemaining) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-bold whitespace-nowrap text-slate-900 tabular-nums">
                    {formatRupees(row.totalRemaining)}
                  </td>
                  <td className="px-3 py-3 text-xs whitespace-nowrap text-slate-500">{formatDate(row.dueDate)}</td>
                  <td className="px-3 py-3 text-right print:hidden">
                    <div className="flex items-center justify-end gap-2">
                      <ReminderButton
                        customer={{
                          name: row.name,
                          mobile: row.mobile,
                          roomNo: row.roomNo,
                          bedNo: null,
                          sharingType: 1,
                          nextDueDate: row.dueDate,
                        }}
                        remaining={row.rentRemaining}
                        className="btn-ghost min-h-9 px-2"
                        compact
                      />
                      <button
                        type="button"
                        onClick={() => onPay(row.customerId)}
                        className="btn-secondary min-h-9 px-2.5 text-xs"
                        title="Record a rent payment"
                      >
                        Record
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}