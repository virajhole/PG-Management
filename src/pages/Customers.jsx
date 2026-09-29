import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import CustomerList from '../components/CustomerList.jsx';
import { ErrorState, SkeletonList } from '../components/States.jsx';
import { UserPlusIcon } from '../components/icons.jsx';
import { useData } from '../context/DataContext.jsx';
import { customerService } from '../services/index.js';
import { formatRupees } from '../utils/format.js';

/** Full tenant directory - same list as the dashboard, without the stat cards. */
export default function Customers() {
  const { customers, status, error, today, refresh } = useData();
  const navigate = useNavigate();

  const sorted = useMemo(() => customerService.sortByDueDate(customers, today), [customers, today]);
  const summary = useMemo(() => customerService.summarise(customers, today), [customers, today]);

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
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">All tenants</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {status === 'loading'
              ? 'Loading…'
              : `${summary.total} ${summary.total === 1 ? 'tenant' : 'tenants'} · ${formatRupees(summary.expected)} per month`}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => navigate('/admission')}>
          <UserPlusIcon className="size-4" />
          New admission
        </button>
      </header>

      {status === 'loading' ? <SkeletonList count={6} /> : <CustomerList customers={sorted} />}
    </div>
  );
}
