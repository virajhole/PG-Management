import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import CustomerList from '../components/CustomerList.jsx';
import { ErrorState } from '../components/States.jsx';
import { StatCard } from '../components/ui.jsx';
import {
  UsersIcon,
  AlertIcon,
  WalletIcon,
  UserPlusIcon,
  BoltIcon,
  CheckCircleIcon,
} from '../components/icons.jsx';
import { customerService } from '../services/index.js';
import { useData } from '../context/DataContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatRupees } from '../utils/format.js';
import { getRemaining } from '../utils/ledger.js';

/**
 * The dashboard: summary cards, search and filters, and every active tenant
 * sorted by their next due date. Red = overdue, yellow = due within 5 days,
 * green = fine.
 */
export default function Dashboard() {
  const { customers, status, error, today, refresh, openCycleByCustomer, todayTotal, outstandingTotals, settings } = useData();
  const { user } = useAuth();
  const navigate = useNavigate();

  const currentTenants = useMemo(
    () => customers.filter((c) => c.status === 'active' || !c.status),
    [customers],
  );

  const sorted = useMemo(
    () => customerService.sortByDueDate(currentTenants, today),
    [currentTenants, today],
  );

  const summary = useMemo(() => {
    let overdue = 0;
    let dueSoon = 0;
    for (const c of currentTenants) {
      const cycle = openCycleByCustomer.get(c.id) ?? null;
      const hasBalance = getRemaining(cycle) > 0;
      const bucket = customerService.getCustomerStatus(c, today);
      if (hasBalance && bucket === 'overdue') overdue += 1;
      else if (hasBalance && bucket === 'soon') dueSoon += 1;
    }
    return {
      total: currentTenants.length,
      overdue,
      dueSoon,
      remainingRent: outstandingTotals.rent,
      collectedToday: todayTotal.total,
    };
  }, [currentTenants, openCycleByCustomer, today, outstandingTotals, todayTotal]);

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
          <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
            {user?.name ? `Hello, ${user.name.split(' ')[0]}` : settings.pgName || 'Dashboard'}
          </h1>
          <p className="mt-0.5 text-sm text-ink-subtle">{today.format('dddd, DD MMMM YYYY')}</p>
        </div>
        <button type="button" onClick={() => navigate('/admission')} className="btn-primary min-h-10">
          <UserPlusIcon className="size-4" />
          New admission
        </button>
      </header>

      <section aria-label="Summary" className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 xl:grid-cols-5">
        <StatCard label="Total customers" value={summary.total} sub={summary.total ? `${sorted.length} active` : 'No tenants yet'} icon={UsersIcon} tone="brand" />
        <StatCard label="Overdue" value={summary.overdue} sub={summary.overdue ? 'Balance pending' : 'All clear'} icon={AlertIcon} tone={summary.overdue ? 'danger' : 'neutral'} />
        <StatCard label="Due in 5 days" value={summary.dueSoon} sub={summary.dueSoon ? 'Send reminders' : 'Nothing due'} icon={WalletIcon} tone={summary.dueSoon ? 'warning' : 'neutral'} />
        <StatCard label="Remaining rent" value={formatRupees(summary.remainingRent)} icon={BoltIcon} tone={summary.remainingRent > 0 ? 'danger' : 'neutral'} />
        <StatCard label="Today's collection" value={formatRupees(summary.collectedToday)} icon={CheckCircleIcon} tone="accent" />
      </section>

      <CustomerList customers={sorted} />
    </div>
  );
}
