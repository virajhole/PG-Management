import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import CustomerList from '../components/CustomerList.jsx';
import { ErrorState, SkeletonList, EmptyState } from '../components/States.jsx';
import { UsersIcon, AlertIcon, WalletIcon, UserPlusIcon, BoltIcon } from '../components/icons.jsx';
import { customerService } from '../services/index.js';
import { useData } from '../context/DataContext.jsx';
import { formatRupees } from '../utils/format.js';
import { formatDate } from '../utils/dateLogic.js';
import { getRentStatus } from '../utils/dateLogic.js';
import { getRemaining } from '../utils/ledger.js';

function StatCard({ label, value, sub, icon: Icon, tone = 'slate' }) {
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

export default function Dashboard() {
  const { customers, status, error, today, refresh, settings, openCycleByCustomer, monthTotal, outstandingTotals, pendingList } = useData();
  const navigate = useNavigate();

  const sorted = useMemo(() => customerService.sortByDueDate(customers, today), [customers, today]);

  // Ledger-driven headline stats: a partially paid, overdue tenant still counts.
  const summary = useMemo(() => {
    const active = customers.filter((c) => c.status !== 'inactive');
    let overdue = 0;
    let onSchedule = 0;
    for (const c of active) {
      const cycle = openCycleByCustomer.get(c.id) ?? null;
      if (getRemaining(cycle) > 0 && getRentStatus(c.nextDueDate, today) === 'overdue') overdue += 1;
      else onSchedule += 1;
    }
    return { total: active.length, overdue, onSchedule };
  }, [customers, openCycleByCustomer, today]);

  const mostOverdue = pendingList[0] ?? null;

  if (status === 'error') {
    return (
      <ErrorState
        title="Could not load your tenants"
        message={error?.message || 'There was a problem reading your data from the cloud.'}
        onRetry={refresh}
      />
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {status === 'loading'
              ? 'Loading your tenants…'
              : `${summary.total} ${summary.total === 1 ? 'tenant' : 'tenants'} · ${formatDate(today.format('YYYY-MM-DD'))}`}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => navigate('/admission')}>
          <UserPlusIcon className="size-4" />
          New admission
        </button>
      </header>

      {/* ------------------------------------------------------- summary */}
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Total tenants"
          value={status === 'loading' ? '—' : summary.total}
          sub={status === 'loading' ? undefined : `${summary.onSchedule} on schedule`}
          icon={UsersIcon}
          tone="brand"
        />
        <StatCard
          label="Rent overdue"
          value={status === 'loading' ? '—' : summary.overdue}
          sub={summary.overdue > 0 ? 'Balance still pending' : 'All clear'}
          icon={AlertIcon}
          tone={summary.overdue > 0 ? 'red' : 'slate'}
        />
        <StatCard
          label="Collected this month"
          value={status === 'loading' ? '—' : formatRupees(monthTotal.total)}
          sub={status === 'loading' ? undefined : `${formatRupees(monthTotal.rent)} rent · ${formatRupees(monthTotal.lightBill)} elec`}
          icon={WalletIcon}
          tone="amber"
        />
        <StatCard
          label="Outstanding"
          value={status === 'loading' ? '—' : formatRupees(outstandingTotals.rent + outstandingTotals.lightBill)}
          sub={status === 'loading' ? undefined : `${formatRupees(outstandingTotals.rent)} rent · ${formatRupees(outstandingTotals.lightBill)} elec`}
          icon={BoltIcon}
          tone={outstandingTotals.rent + outstandingTotals.lightBill > 0 ? 'red' : 'slate'}
        />
      </section>

      {mostOverdue && status === 'ready' && (
        <p className="text-xs text-slate-500">
          Most overdue: <span className="font-medium text-slate-700">{mostOverdue.name}</span> ·{' '}
          {formatRupees(mostOverdue.totalRemaining)} pending, was due {formatDate(mostOverdue.dueDate)}
        </p>
      )}

      {/* ---------------------------------------------------------- list */}
      <section aria-label="Tenants">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-700">
            Rent status
            {status === 'ready' && sorted.length > 0 && (
              <span className="ml-1.5 font-normal text-slate-400">({sorted.length})</span>
            )}
          </h2>
        </div>

        {status === 'loading' ? (
          <SkeletonList count={5} />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            tone="brand"
            title="No tenants yet"
            message="Add your first paying guest to start tracking rent. Three sample tenants are available from Settings if you want to try the colour coding first."
            action={
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" className="btn-primary" onClick={() => navigate('/admission')}>
                  <UserPlusIcon className="size-4" />
                  New admission
                </button>
                <button type="button" className="btn-secondary" onClick={() => navigate('/settings')}>
                  Load sample data
                </button>
              </div>
            }
          />
        ) : (
          <CustomerList customers={sorted} />
        )}
      </section>

      <p className="pt-2 text-center text-xs text-slate-400">
        {settings.pgName} · stored in your own Supabase account
      </p>
    </div>
  );
}
