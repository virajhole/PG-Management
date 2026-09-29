import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from './Avatar.jsx';
import StatusBadge, { rentRowClass } from './StatusBadge.jsx';
import ReminderButton from './ReminderButton.jsx';
import PaymentDialog from './PaymentDialog.jsx';
import { EmptyState } from './States.jsx';
import { SearchIcon, UsersIcon, CheckIcon } from './icons.jsx';
import { formatCurrency, formatDate } from '../utils/format.js';
import { customerService } from '../services/index.js';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'soon', label: 'Due Soon' },
  { key: 'paid', label: 'Paid' },
];

function matchesFilter(customer, filter, today) {
  if (filter === 'all') return true;
  const status = customerService.getCustomerStatus(customer, today);
  if (filter === 'overdue') return status === 'overdue';
  if (filter === 'soon') return status === 'soon';
  if (filter === 'paid') return customerService.isPaidForCurrentCycle(customer, today);
  return true;
}

function FilterChip({ active, onClick, children, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`chip ${
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      {children}
      {count !== undefined && (
        <span
          className={`ml-0.5 rounded-full px-1.5 text-[11px] font-semibold ${
            active ? 'bg-white/20' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function MarkPaidButton({ customer, onClick }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick(customer);
      }}
      className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-emerald-300 bg-white
                 px-3 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 active:scale-[0.97]"
    >
      <CheckIcon className="size-4" />
      Mark Paid
    </button>
  );
}

/** Mobile card. The whole card is the tap target for the details page. */
function CustomerCard({ customer, today, onOpen, onPay }) {
  return (
    <li>
      <div
        className={`rent-row overflow-hidden rounded-2xl border border-l-4 shadow-sm transition active:scale-[0.995]
                    ${rentRowClass(customer, today)}`}
      >
        <button
          type="button"
          onClick={() => onOpen(customer)}
          className="block w-full px-4 pt-3.5 text-left"
        >
          <div className="flex items-start gap-3">
            <Avatar customer={customer} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-[15px] leading-tight font-semibold text-slate-900">{customer.name}</p>
                <StatusBadge customer={customer} today={today} className="mt-0.5" />
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">
                {customer.mobile} · {customer.sharingType} sharing
                {customer.roomNo ? ` · Room ${customer.roomNo}` : ''}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-slate-500">Monthly rent</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-800">{formatCurrency(customer.rentAmount)}</p>
            </div>
            <div>
              <p className="text-slate-500">Next due</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-800">{formatDate(customer.nextDueDate)}</p>
            </div>
          </div>
        </button>

        <div className="mt-3 flex items-center gap-2 border-t border-black/5 px-3 py-2.5">
          <MarkPaidButton customer={customer} onClick={onPay} />
          <ReminderButton customer={customer} className="btn-secondary min-h-10 px-3" compact />
        </div>
      </div>
    </li>
  );
}

/** Desktop table row. */
function CustomerRow({ customer, today, onOpen, onPay }) {
  return (
    <tr
      className={`rent-row cursor-pointer border-l-4 transition hover:brightness-[0.985] ${rentRowClass(customer, today)}`}
      onClick={() => onOpen(customer)}
    >
      <td className="py-3 pr-3 pl-4">
        <div className="flex items-center gap-3">
          <Avatar customer={customer} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{customer.name}</p>
            <p className="truncate text-xs text-slate-500">{customer.code}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 text-sm whitespace-nowrap text-slate-700">{customer.mobile}</td>
      <td className="px-3 py-3 text-sm whitespace-nowrap text-slate-700">{customer.sharingType} sharing</td>
      <td className="px-3 py-3 text-sm whitespace-nowrap text-slate-700">
        {customer.roomNo || <span className="text-slate-400">—</span>}
      </td>
      <td className="px-3 py-3 text-sm font-semibold whitespace-nowrap text-slate-900">
        {formatCurrency(customer.rentAmount)}
      </td>
      <td className="px-3 py-3 text-sm whitespace-nowrap text-slate-700">{formatDate(customer.nextDueDate)}</td>
      <td className="px-3 py-3">
        <StatusBadge customer={customer} today={today} />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-2">
          <ReminderButton customer={customer} className="btn-ghost min-h-9 px-2" compact />
          <MarkPaidButton customer={customer} onClick={onPay} />
        </div>
      </td>
    </tr>
  );
}

export default function CustomerList({ customers, emptyAction }) {
  const { today, addPayment } = useData();
  const toast = useToast();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [payingCustomer, setPayingCustomer] = useState(null);
  const [saving, setSaving] = useState(false);

  const counts = useMemo(
    () => ({
      all: customers.length,
      overdue: customers.filter((c) => customerService.getCustomerStatus(c, today) === 'overdue').length,
      soon: customers.filter((c) => customerService.getCustomerStatus(c, today) === 'soon').length,
      paid: customers.filter((c) => customerService.isPaidForCurrentCycle(c, today)).length,
    }),
    [customers, today],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((customer) => {
      if (!matchesFilter(customer, filter, today)) return false;
      if (!q) return true;
      return (
        customer.name.toLowerCase().includes(q) ||
        customer.mobile.includes(q) ||
        (customer.roomNo || '').toLowerCase().includes(q) ||
        (customer.code || '').toLowerCase().includes(q)
      );
    });
  }, [customers, filter, query, today]);

  async function confirmPayment(payment) {
    setSaving(true);
    try {
      const { customer } = await addPayment(payingCustomer.id, payment);
      toast.success(
        `Payment recorded for ${customer.name}. Next rent due ${formatDate(customer.nextDueDate)}.`,
      );
      setPayingCustomer(null);
    } catch (error) {
      toast.error(error.message || 'Could not record that payment.');
    } finally {
      setSaving(false);
    }
  }

  const openCustomer = (customer) => navigate(`/customer/${customer.id}`);

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------- search */}
      <div className="space-y-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, mobile or room…"
            className="field-input pl-10"
            aria-label="Search tenants"
          />
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
          {FILTERS.map((f) => (
            <FilterChip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)} count={counts[f.key]}>
              {f.label}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* ----------------------------------------------------------- list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={customers.length === 0 ? 'No tenants yet' : 'Nothing matches this filter'}
          message={
            customers.length === 0
              ? 'Add your first paying guest using the Admission form.'
              : 'Try a different search term or switch back to the All filter.'
          }
          action={
            customers.length === 0 ? (
              emptyAction ?? (
                <button type="button" className="btn-primary" onClick={() => navigate('/admission')}>
                  New admission
                </button>
              )
            ) : (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                Clear filters
              </button>
            )
          }
        />
      ) : (
        <>
          {/* mobile: cards */}
          <ul className="space-y-3 lg:hidden" data-testid="customer-cards">
            {filtered.map((customer) => (
              <CustomerCard
                key={customer.id}
                customer={customer}
                today={today}
                onOpen={openCustomer}
                onPay={setPayingCustomer}
              />
            ))}
          </ul>

          {/* desktop: table */}
          <div className="card hidden overflow-hidden lg:block" data-testid="customer-table">
            <div className="scroll-slim max-h-[calc(100dvh-19rem)] overflow-auto">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Tenant</th>
                    <th className="px-3 py-3 font-semibold">Mobile</th>
                    <th className="px-3 py-3 font-semibold">Sharing</th>
                    <th className="px-3 py-3 font-semibold">Room</th>
                    <th className="px-3 py-3 font-semibold">Rent</th>
                    <th className="px-3 py-3 font-semibold">Next due</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-3 py-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filtered.map((customer) => (
                    <CustomerRow
                      key={customer.id}
                      customer={customer}
                      today={today}
                      onOpen={openCustomer}
                      onPay={setPayingCustomer}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <PaymentDialog
        open={Boolean(payingCustomer)}
        customer={payingCustomer}
        onClose={() => setPayingCustomer(null)}
        onConfirm={confirmPayment}
        busy={saving}
      />
    </div>
  );
}
