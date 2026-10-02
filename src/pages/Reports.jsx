import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Tabs, Button, ProgressBar } from '../components/ui.jsx';
import { FileText as FileTextIcon, Download as DownloadIcon, TrendingUp as TrendingUpIcon, Users as UsersIcon, Wallet as WalletIcon, Receipt as ReceiptIcon, Building as BuildingIcon } from 'lucide-react';
import { useData } from '../context/DataContext.jsx';
import { money } from '../utils/ledger.js';
import { formatRupees } from '../utils/format.js';
import { formatDate } from '../utils/dateLogic.js';
import { roomService, occupancyTotals } from '../services/index.js';
import { getMonthlyFinance } from '../services/roomService.js';

const REPORTS = [
  { value: 'collection', label: 'Collection', icon: WalletIcon },
  { value: 'defaulters', label: 'Defaulters', icon: UsersIcon },
  { value: 'occupancy', label: 'Occupancy', icon: BuildingIcon },
  { value: 'profit', label: 'Expense & profit', icon: ReceiptIcon },
  { value: 'deposits', label: 'Deposits', icon: TrendingUpIcon },
  { value: 'yearly', label: 'Yearly', icon: FileTextIcon },
];

function downloadCsv(filename, header, rows) {
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function ReportHeader({ title, onCsv }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="section-title">{title}</h2>
      <div className="no-print flex gap-2">
        {onCsv && (
          <Button size="sm" variant="secondary" onClick={onCsv}>
            <DownloadIcon className="size-4" /> CSV
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => window.print()}>
          Print / PDF
        </Button>
      </div>
    </div>
  );
}

export default function Reports() {
  const { customers, transactions, pendingList, today } = useData();
  const [report, setReport] = useState('collection');
  const [rooms, setRooms] = useState([]);
  const [monthly, setMonthly] = useState([]);

  // Rooms and the finance roll-up are optional extras: on a backend without
  // migration 002 or the monthly_finance RPC the report still renders from the
  // ledger in memory.
  useEffect(() => {
    roomService.listRooms().then(setRooms).catch(() => setRooms([]));
    getMonthlyFinance(12).then(setMonthly).catch(() => setMonthly([]));
  }, []);

  const currentTenants = useMemo(
    () => customers.filter((c) => c.status === 'active' || c.status === 'notice' || !c.status),
    [customers],
  );

  // ------------------------------------------------------- collection
  const collectionRows = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i -= 1) {
      const m = today.subtract(i, 'month');
      const key = m.format('YYYY-MM');
      const txs = transactions.filter((t) => String(t.date).startsWith(key));
      const rent = money(txs.filter((t) => t.type === 'RENT').reduce((s, t) => s + Number(t.amount), 0));
      const bill = money(txs.filter((t) => t.type === 'LIGHT_BILL').reduce((s, t) => s + Number(t.amount), 0));
      const fees = money(txs.filter((t) => t.type === 'LATE_FEE').reduce((s, t) => s + Number(t.amount), 0));
      const refund = money(txs.filter((t) => t.type === 'REFUND').reduce((s, t) => s + Number(t.amount), 0));
      months.push({ month: key, label: m.format('MMM YYYY'), rent, bill, fees, refund, total: rent + bill + fees - refund });
    }
    return months;
  }, [transactions, today]);

  // ------------------------------------------------------- defaulters
  const defaulters = useMemo(() => pendingList.filter((r) => r.daysOverdue > 0 && r.totalRemaining > 0), [pendingList]);

  // ------------------------------------------------------- occupancy
  const beds = useMemo(() => occupancyTotals(rooms), [rooms]);

  // ------------------------------------------------------- profit
  const profitRows = useMemo(() => monthly.map((m) => ({ ...m, profit: money(m.collected - m.expenses) })), [monthly]);

  // ------------------------------------------------------- deposits
  const depositRows = useMemo(() => {
    const held = currentTenants.map((c) => ({ id: c.id, name: c.name, roomNo: c.roomNo, amount: Number(c.depositAmount) || 0, paid: c.depositPaid }));
    const vacated = customers
      .filter((c) => c.status === 'vacated')
      .map((c) => ({
        id: c.id,
        name: c.name,
        roomNo: c.roomNo,
        amount: Number(c.depositAmount) || 0,
        refund: Number(c.depositRefund) || 0,
        damage: Number(c.damageCharges) || 0,
        vacatedAt: c.vacatedAt,
      }));
    const pending = vacated.filter((v) => v.refund <= 0 && v.amount > 0);
    const done = vacated.filter((v) => v.refund > 0);
    return {
      held,
      heldTotal: money(held.reduce((s, r) => s + r.amount, 0)),
      pending,
      done,
      pendingTotal: money(pending.reduce((s, r) => s + r.amount, 0)),
      refundedTotal: money(done.reduce((s, r) => s + r.refund, 0)),
    };
  }, [customers, currentTenants]);

  // ------------------------------------------------------- yearly
  const yearly = useMemo(() => {
    const year = today.format('YYYY');
    const txs = transactions.filter((t) => String(t.date).startsWith(year));
    return {
      year,
      collected: money(txs.filter((t) => t.type !== 'REFUND').reduce((s, t) => s + Number(t.amount), 0)),
      refunds: money(txs.filter((t) => t.type === 'REFUND').reduce((s, t) => s + Number(t.amount), 0)),
      expenseTotal: money(monthly.filter((m) => String(m.month).startsWith(year)).reduce((s, m) => s + Number(m.expenses), 0)),
    };
  }, [transactions, today, monthly]);

  function exportCollectionCsv() {
    downloadCsv(
      `collection-${today.format('YYYY-MM')}.csv`,
      ['Month', 'Rent', 'Light bill', 'Late fees', 'Refunds', 'Net'],
      collectionRows.map((r) => [r.label, r.rent, r.bill, r.fees, r.refund, r.total]),
    );
  }

  function exportDefaultersCsv() {
    downloadCsv(
      `defaulters-${today.format('YYYY-MM')}.csv`,
      ['Tenant', 'Room', 'Mobile', 'Rent remaining', 'Light bill remaining', 'Total', 'Days overdue', 'Due date'],
      defaulters.map((r) => [r.name, r.roomNo, r.mobile, r.rentRemaining, r.lightRemaining, r.totalRemaining, r.daysOverdue, r.dueDate ?? '']),
    );
  }

  function exportDepositsCsv() {
    downloadCsv(
      `deposits-${today.format('YYYY-MM')}.csv`,
      ['Kind', 'Tenant', 'Room', 'Amount', 'Refund', 'Damage'],
      [
        ...depositRows.held.map((r) => ['Held', r.name, r.roomNo, r.amount, '', '']),
        ...depositRows.pending.map((r) => ['Refund pending', r.name, r.roomNo, r.amount, 0, r.damage]),
        ...depositRows.done.map((r) => ['Refunded', r.name, r.roomNo, r.amount, r.refund, r.damage]),
      ],
    );
  }

  if (status === 'loading') {
    return <p className="py-16 text-center text-sm text-ink-subtle">Loading reports…</p>;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">Reports</h1>
          <p className="mt-0.5 text-sm text-ink-subtle">Collection, defaulters, occupancy, profit and deposits · export any table.</p>
        </div>
      </header>

      <Tabs tabs={REPORTS} active={report} onChange={setReport} />

      {report === 'collection' && (
        <Card className="p-4 sm:p-6">
          <ReportHeader title="Monthly collection · last 6 months" onCsv={exportCollectionCsv} />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs tracking-wide text-ink-subtle uppercase">
                  <th className="py-2 pr-3 font-semibold">Month</th>
                  <th className="py-2 pr-3 font-semibold">Rent</th>
                  <th className="py-2 pr-3 font-semibold">Light bill</th>
                  <th className="py-2 pr-3 font-semibold">Late fees</th>
                  <th className="py-2 pr-3 font-semibold">Refunds</th>
                  <th className="py-2 text-right font-semibold">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {collectionRows.map((r) => (
                  <tr key={r.month}>
                    <td className="py-2.5 pr-3 font-semibold text-ink">{r.label}</td>
                    <td className="py-2.5 pr-3 text-ink-muted">{formatRupees(r.rent)}</td>
                    <td className="py-2.5 pr-3 text-ink-muted">{formatRupees(r.bill)}</td>
                    <td className="py-2.5 pr-3 text-ink-muted">{formatRupees(r.fees)}</td>
                    <td className="py-2.5 pr-3 text-ink-muted">{r.refund ? `− ${formatRupees(r.refund)}` : '—'}</td>
                    <td className="py-2.5 text-right font-bold text-ink">{formatRupees(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {report === 'defaulters' && (
        <Card className="p-4 sm:p-6">
          <ReportHeader title={`Defaulters · ${defaulters.length}`} onCsv={exportDefaultersCsv} />
          {defaulters.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-subtle">No overdue tenants. 🎉</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {defaulters.map((r) => (
                <li key={r.customerId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{r.name}</p>
                    <p className="text-xs text-ink-subtle">
                      {r.roomNo ? `Room ${r.roomNo} · ` : ''}
                      {r.daysOverdue}d overdue · due {formatDate(r.dueDate)}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-bold text-red-600 dark:text-red-400">{formatRupees(r.totalRemaining)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {report === 'occupancy' && (
        <Card className="p-4 sm:p-6">
          <ReportHeader title="Occupancy report" />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <MiniStat label="Occupancy" value={`${beds.occupancyPercent}%`} />
            <MiniStat label="Beds filled" value={`${beds.occupiedBeds} / ${beds.totalBeds}`} />
            <MiniStat label="Vacant beds" value={beds.vacantBeds} />
          </div>
          <ProgressBar className="mt-4" percent={beds.occupancyPercent} />
          <ul className="mt-4 divide-y divide-line">
            {rooms.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-semibold text-ink">Room {r.roomNo}</span>
                <span className="text-ink-subtle">
                  {r.occupied}/{r.capacity} · {r.sharingType}-sharing
                </span>
                <Badge tone={r.occupancyStatus === 'full' ? 'accent' : r.occupancyStatus === 'partial' ? 'warning' : 'neutral'}>{r.occupancyStatus}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {report === 'profit' && (
        <Card className="p-4 sm:p-6">
          <ReportHeader title="Expense & profit · last 12 months" />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs tracking-wide text-ink-subtle uppercase">
                  <th className="py-2 pr-3 font-semibold">Month</th>
                  <th className="py-2 pr-3 font-semibold">Collected</th>
                  <th className="py-2 pr-3 font-semibold">Expenses</th>
                  <th className="py-2 text-right font-semibold">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {profitRows.map((r) => (
                  <tr key={r.month}>
                    <td className="py-2.5 pr-3 font-semibold text-ink">{r.label}</td>
                    <td className="py-2.5 pr-3 text-ink-muted">{formatRupees(r.collected)}</td>
                    <td className="py-2.5 pr-3 text-ink-muted">{formatRupees(r.expenses)}</td>
                    <td className={`py-2.5 text-right font-bold ${r.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {formatRupees(r.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {report === 'deposits' && (
        <Card className="p-4 sm:p-6">
          <ReportHeader title="Deposit liability" onCsv={exportDepositsCsv} />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <MiniStat label="Deposits held" value={formatRupees(depositRows.heldTotal)} />
            <MiniStat label="Refunds pending" value={formatRupees(depositRows.pendingTotal)} />
            <MiniStat label="Refunded" value={formatRupees(depositRows.refundedTotal)} />
          </div>
          <h3 className="mt-5 mb-2 text-xs font-bold tracking-widest text-ink-subtle uppercase">Deposits held ({depositRows.held.length})</h3>
          <ul className="divide-y divide-line">
            {depositRows.held.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate font-medium text-ink">
                  {r.name} <span className="text-ink-subtle">{r.roomNo ? `· Room ${r.roomNo}` : ''}</span>
                </span>
                <span className="font-semibold text-ink">{formatRupees(r.amount)}</span>
              </li>
            ))}
            {depositRows.held.length === 0 && <li className="py-3 text-sm text-ink-subtle">None recorded.</li>}
          </ul>
        </Card>
      )}

      {report === 'yearly' && (
        <Card className="p-4 sm:p-6">
          <ReportHeader title={`Yearly summary · ${yearly.year}`} />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <MiniStat label="Collected" value={formatRupees(yearly.collected)} />
            <MiniStat label="Expenses" value={formatRupees(yearly.expenseTotal)} />
            <MiniStat label="Net" value={formatRupees(yearly.collected - yearly.expenseTotal)} />
          </div>
          <p className="mt-4 text-xs text-ink-subtle">Deposit refunds paid this year: {formatRupees(yearly.refunds)}.</p>
        </Card>
      )}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-xl border border-line bg-surface-muted px-3.5 py-3">
      <p className="text-xs font-medium text-ink-subtle">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-ink">{value}</p>
    </div>
  );
}
