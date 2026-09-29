import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import CustomerList from '../components/CustomerList.jsx';
import { ErrorState, SkeletonList, EmptyState } from '../components/States.jsx';
import { UsersIcon, AlertIcon, ClockIcon, WalletIcon, UserPlusIcon } from '../components/icons.jsx';
import { customerService } from '../services/index.js';
import { useData } from '../context/DataContext.jsx';
import { formatRupees } from '../utils/format.js';
import { formatDate } from '../utils/dateLogic.js';

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
  const { customers, status, error, today, refresh, settings } = useData();
  const navigate = useNavigate();

  const sorted = useMemo(() => customerService.sortByDueDate(customers, today), [customers, today]);
  const summary = useMemo(() => customerService.summarise(customers, today), [customers, today]);

  const nextUp = sorted.find((c) => customerService.getCustomerStatus(c, today) !== 'overdue') ?? null;

  if (status === 'error') {
    return (
      <ErrorState
        title="Could not load your tenants"
        message={error?.message || 'There was a problem reading the stored data on this device.'}
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
          sub={status === 'loading' ? undefined : `${summary.ok} on schedule`}
          icon={UsersIcon}
          tone="brand"
        />
        <StatCard
          label="Rent overdue"
          value={status === 'loading' ? '—' : summary.overdue}
          sub={summary.overdue > 0 ? 'Needs follow-up' : 'All clear'}
          icon={AlertIcon}
          tone={summary.overdue > 0 ? 'red' : 'slate'}
        />
        <StatCard
          label="Due within 5 days"
          value={status === 'loading' ? '—' : summary.dueSoon}
          sub={summary.dueSoon > 0 ? 'Send a reminder' : 'Nothing imminent'}
          icon={ClockIcon}
          tone={summary.dueSoon > 0 ? 'amber' : 'slate'}
        />
        <StatCard
          label="Expected rent / month"
          value={status === 'loading' ? '—' : formatRupees(summary.expected)}
          sub={status === 'loading' ? undefined : `${formatRupees(summary.outstanding)} outstanding`}
          icon={WalletIcon}
          tone="slate"
        />
      </section>

      {nextUp && status === 'ready' && (
        <p className="text-xs text-slate-500">
          Next due: <span className="font-medium text-slate-700">{nextUp.name}</span> ·{' '}
          {formatRupees(nextUp.rentAmount)} on {formatDate(nextUp.nextDueDate)}
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
        {settings.pgName} · data is stored on this device only
      </p>
    </div>
  );
}
