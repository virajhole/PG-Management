import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from './Avatar.jsx';
import StatusBadge, { rentRowClass } from './StatusBadge.jsx';
import ReminderButton from './ReminderButton.jsx';
import PaymentDialog from './PaymentDialog.jsx';
import LightBillDialog from './LightBillDialog.jsx';
import { EmptyState } from './States.jsx';
import { SearchIcon, UsersIcon, CheckIcon, BoltIcon } from './icons.jsx';
import { formatCurrency, formatRupees, formatDate } from '../utils/format.js';
import { getRentStatus } from '../utils/dateLogic.js';
import { getRemaining, getPaidPercent, monthKey } from '../utils/ledger.js';
import { ensureOpenCycle } from '../services/cycleService.js';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'soon', label: 'Due Soon' },
  { key: 'paid', label: 'Paid' },
];

function FilterChip({ active, onClick, children, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`chip ${
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-line bg-raised text-ink-muted hover:border-line-strong hover:bg-sunken'
      }`}
    >
      {children}
      {count !== undefined && (
        <span
          className={`ml-0.5 rounded-full px-1.5 text-[11px] font-semibold ${
            active ? 'bg-raised/20' : 'bg-sunken text-ink-subtle'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function RecordPaymentButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-emerald-300 bg-raised
                 px-3 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 active:scale-[0.97]"
    >
      <CheckIcon className="size-4" />
      Record
    </button>
  );
}

function BillButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-raised
                 px-3 text-xs font-semibold text-ink-muted transition hover:bg-amber-50 active:scale-[0.97]"
      title="Add or edit a light bill"
    >
      <BoltIcon className="size-4" />
      Bill
    </button>
  );
}

/** Thin progress bar for how much of the open cycle has been paid. */
function Progress({ cycle }) {
  const percent = getPaidPercent(cycle);
  const tone = percent >= 100 ? 'bg-emerald-500' : percent > 0 ? 'bg-amber-500' : 'bg-line-strong';
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full ${tone} transition-all`} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

function BalanceBadge({ cycle }) {
  const remaining = getRemaining(cycle);
  if (remaining <= 0) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
      Balance {formatRupees(remaining)}
    </span>
  );
}

function AdvanceBadge({ amount }) {
  if (!amount || amount <= 0) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
      Advance {formatRupees(amount)}
    </span>
  );
}

function BillBadge({ remainingBills }) {
  if (remainingBills <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
      <BoltIcon className="size-3" />
      Elec {formatRupees(remainingBills)}
    </span>
  );
}

/** Mobile card. The whole card is the tap target for the details page. */
function CustomerCard({ customer, cycle, today, billTotal, onOpen, onPay, onBill }) {
  return (
    <li>
      <div
        className={`rent-row overflow-hidden rounded-2xl border border-l-4 shadow-sm transition active:scale-[0.995]
                    ${rentRowClass(customer, today, cycle)}`}
      >
        <button type="button" onClick={() => onOpen(customer)} className="block w-full px-4 pt-3.5 text-left">
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
                <BalanceBadge cycle={cycle} />
                <AdvanceBadge amount={customer.advanceCredit} />
                <BillBadge remainingBills={billTotal} />
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-2 text-xs">
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
            <Progress cycle={cycle} />
          </div>
        </button>

        <div className="mt-3 flex items-center gap-2 border-t border-black/5 px-3 py-2.5">
          <RecordPaymentButton onClick={() => onPay(customer)} />
          <BillButton onClick={() => onBill(customer)} />
          <ReminderButton customer={customer} remaining={getRemaining(cycle)} className="btn-secondary min-h-10 px-3" compact />
        </div>
      </div>
    </li>
  );
}

/** Desktop table row. */
function CustomerRow({ customer, cycle, billTotal, today, onOpen, onPay, onBill }) {
  return (
    <tr
      className={`rent-row cursor-pointer border-l-4 transition hover:brightness-[0.985] ${rentRowClass(customer, today, cycle)}`}
      onClick={() => onOpen(customer)}
    >
      <td className="py-3 pr-3 pl-4">
        <div className="flex items-center gap-3">
          <Avatar customer={customer} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{customer.name}</p>
            <p className="truncate text-xs text-ink-subtle">{customer.code}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <AdvanceBadge amount={customer.advanceCredit} />
              <BillBadge remainingBills={billTotal} />
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 text-sm whitespace-nowrap text-ink">{customer.mobile}</td>
      <td className="px-3 py-3 text-sm whitespace-nowrap text-ink">{customer.sharingType} sharing</td>
      <td className="px-3 py-3 text-sm whitespace-nowrap text-ink">
        {customer.roomNo || <span className="text-ink-subtle">—</span>}
      </td>
      <td className="px-3 py-3">
        <div className="min-w-24">
          <p className="text-sm font-semibold whitespace-nowrap text-ink">{formatCurrency(customer.rentAmount)}</p>
          <div className="mt-1.5">
            <Progress cycle={cycle} />
          </div>
          <BalanceBadge cycle={cycle} />
        </div>
      </td>
      <td className="px-3 py-3 text-sm whitespace-nowrap text-ink">{formatDate(customer.nextDueDate)}</td>
      <td className="px-3 py-3">
        <StatusBadge customer={customer} today={today} cycle={cycle} />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-2">
          <ReminderButton customer={customer} remaining={getRemaining(cycle)} className="btn-ghost min-h-9 px-2" compact />
          <BillButton onClick={() => onBill(customer)} />
          <RecordPaymentButton onClick={() => onPay(customer)} />
        </div>
      </td>
    </tr>
  );
}

export default function CustomerList({ customers, emptyAction }) {
  const { today, openCycleByCustomer, lightBills, recordRentPayment, saveLightBill } = useData();
  const toast = useToast();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [screen, setScreen] = useState('list'); // list | record-payment | add-bill
  const [activeCustomer, setActiveCustomer] = useState(null);
  const [paymentCycle, setPaymentCycle] = useState(null);
  const [saving, setSaving] = useState(false);

  // Summed unpaid electricity per tenant, for the bill badges.
  const billsByCustomer = useMemo(() => {
    const map = new Map();
    for (const bill of lightBills) {
      const remaining = getRemaining(bill);
      if (remaining <= 0) continue;
      map.set(bill.customerId, (map.get(bill.customerId) ?? 0) + remaining);
    }
    return map;
  }, [lightBills]);

  const counts = useMemo(() => {
    let overdue = 0;
    let soon = 0;
    let paid = 0;
    for (const customer of customers) {
      const cycle = openCycleByCustomer.get(customer.id) ?? null;
      if (getRemaining(cycle) <= 0) paid += 1;
      else if (getRentStatus(customer.nextDueDate, today) === 'overdue') overdue += 1;
      else if (getRentStatus(customer.nextDueDate, today) === 'soon') soon += 1;
    }
    return { all: customers.length, overdue, soon, paid };
  }, [customers, openCycleByCustomer, today]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((customer) => {
      const cycle = openCycleByCustomer.get(customer.id) ?? null;
      const remaining = getRemaining(cycle);
      const bucket = getRentStatus(customer.nextDueDate, today);
      if (filter === 'paid' && remaining > 0) return false;
      if (filter === 'overdue' && bucket !== 'overdue') return false;
      if (filter === 'soon' && bucket !== 'soon') return false;
      if (!q) return true;
      return (
        customer.name.toLowerCase().includes(q) ||
        customer.mobile.includes(q) ||
        (customer.roomNo || '').toLowerCase().includes(q) ||
        (customer.code || '').toLowerCase().includes(q)
      );
    });
  }, [customers, filter, query, openCycleByCustomer, today]);

  async function openPay(customer) {
    const cycle = openCycleByCustomer.get(customer.id) ?? (await ensureOpenCycle(customer));
    setActiveCustomer(customer);
    setPaymentCycle(cycle);
    setScreen('record-payment');
  }

  function openBill(customer) {
    setActiveCustomer(customer);
    setScreen('add-bill');
  }

  async function confirmPayment(payment) {
    setSaving(true);
    try {
      const result = await recordRentPayment({
        customerId: activeCustomer.id,
        amount: payment.amount,
        date: payment.date,
        mode: payment.mode,
        note: payment.note,
      });
      toast.success(`Payment recorded. ${formatRupees(result.transaction.amount)} applied to rent.`);
      setScreen('list');
      setActiveCustomer(null);
      setPaymentCycle(null);
    } catch (error) {
      toast.error(error.message || 'Could not record that payment.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmBill(bill) {
    setSaving(true);
    try {
      const saved = await saveLightBill(bill);
      toast.success(`Light bill ${formatRupees(saved.billAmount)} for ${saved.month} ${saved.id === bill.billId ? 'updated.' : 'added.'}`);
      setScreen('list');
      setActiveCustomer(null);
    } catch (error) {
      toast.error(error.message || 'Could not save that bill.');
    } finally {
      setSaving(false);
    }
  }

  const openCustomer = (customer) => navigate(`/customer/${customer.id}`);

  const paymentTarget = activeCustomer && screen === 'record-payment' ? { kind: 'rent', customer: activeCustomer, cycle: paymentCycle } : null;

  const existingBillForCustomer = useMemo(() => {
    if (!activeCustomer) return null;
    return lightBills.find((b) => b.customerId === activeCustomer.id && b.month === monthKey(today)) ?? null;
  }, [activeCustomer, lightBills, today]);

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------- search */}
      <div className="space-y-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-ink-subtle" />
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
                cycle={openCycleByCustomer.get(customer.id) ?? null}
                billTotal={billsByCustomer.get(customer.id) ?? 0}
                today={today}
                onOpen={openCustomer}
                onPay={openPay}
                onBill={openBill}
              />
            ))}
          </ul>

          {/* desktop: table */}
          <div className="card hidden overflow-hidden lg:block" data-testid="customer-table">
            <div className="scroll-slim max-h-[calc(100dvh-19rem)] overflow-auto">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-sunken text-xs tracking-wide text-ink-subtle uppercase">
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
                      cycle={openCycleByCustomer.get(customer.id) ?? null}
                      billTotal={billsByCustomer.get(customer.id) ?? 0}
                      today={today}
                      onOpen={openCustomer}
                      onPay={openPay}
                      onBill={openBill}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <PaymentDialog
        open={screen === 'record-payment' && Boolean(paymentTarget)}
        target={paymentTarget}
        onClose={() => {
          setScreen('list');
          setActiveCustomer(null);
        }}
        onConfirm={confirmPayment}
        busy={saving}
      />

      {screen === 'add-bill' && activeCustomer && (
        <LightBillDialog
          open
          customer={activeCustomer}
          existingBill={existingBillForCustomer}
          onClose={() => {
            setScreen('list');
            setActiveCustomer(null);
          }}
          onSave={confirmBill}
          busy={saving}
        />
      )}
    </div>
  );
}