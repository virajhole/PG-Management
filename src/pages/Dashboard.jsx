import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import CustomerList from '../components/CustomerList.jsx';
import SwipeCustomerCard from '../components/SwipeCustomerCard.jsx';
import PaymentDialog from '../components/PaymentDialog.jsx';
import LateFeeDialog from '../components/LateFeeDialog.jsx';
import { ErrorState } from '../components/States.jsx';
import { Card, StatCard, AnimatedNumber, Badge, BottomSheet, EmptyState as UiEmptyState, ProgressBar, SkeletonList } from '../components/ui.jsx';
import { CircularProgress, BarChart, LineChart, DonutChart } from '../components/charts.jsx';
import {
  UsersIcon,
  AlertIcon,
  WalletIcon,
  UserPlusIcon,
  BoltIcon,
  BuildingIcon,
  HomeIcon,
  LogoutIcon,
  WrenchIcon,
  UserCheckIcon,
  SettingsIcon,
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  ClockIcon,
} from '../components/icons.jsx';
import { customerService, roomService, occupancyTotals } from '../services/index.js';
import { listComplaints, listEnquiries } from '../services/operationsService.js';
import { useData } from '../context/DataContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatRupees } from '../utils/format.js';
import { dayjs, formatDate } from '../utils/dateLogic.js';
import { getRemaining } from '../utils/ledger.js';
import { suggestLateFees } from '../utils/lateFee.js';
import { loadWidgetOrder, saveWidgetOrder, loadWidgetHidden, saveWidgetHidden, WIDGETS } from '../utils/widgets.js';

function greetingFor(hour) {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Move `key` one position earlier/later in the widget order. */
function moveWidget(order, key, dir) {
  const index = order.indexOf(key);
  const target = index + dir;
  if (index === -1 || target < 0 || target >= order.length) return order;
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

const WIDGET_TITLES = Object.fromEntries(WIDGETS.map((w) => [w.key, w.label]));

export default function Dashboard() {
  const {
    customers,
    status,
    error,
    today,
    refresh,
    settings,
    openCycleByCustomer,
    monthTotal,
    outstandingTotals,
    pendingList,
    lightBills,
    transactions,
    recordRentPayment,
  } = useData();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [leaving, setLeaving] = useState([]);
  const [widgetsOpen, setWidgetsOpen] = useState(false);
  const [widgetOrder, setWidgetOrder] = useState(() => loadWidgetOrder(user?.id));
  const [widgetHidden, setWidgetHidden] = useState(() => loadWidgetHidden(user?.id));

  useEffect(() => {
    setWidgetOrder(loadWidgetOrder(user?.id));
    setWidgetHidden(loadWidgetHidden(user?.id));
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    // Occupancy and upcoming vacates are room/lifecycle reads. A failure here
    // must not take the tenant dashboard down with it, so both degrade to empty.
    Promise.all([roomService.listRooms(), roomService.getUpcomingVacates(30)])
      .then(([roomList, vacates]) => {
        if (cancelled) return;
        setRooms(roomList);
        setLeaving(vacates);
      })
      .catch(() => {
        if (!cancelled) {
          setRooms([]);
          setLeaving([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentTenants = useMemo(
    () => customers.filter((c) => c.status === 'active' || c.status === 'notice' || !c.status),
    [customers],
  );

  const sorted = useMemo(() => customerService.sortByDueDate(currentTenants, today), [currentTenants, today]);

  const summary = useMemo(() => {
    let overdue = 0;
    let dueSoon = 0;
    let onSchedule = 0;
    for (const c of currentTenants) {
      const cycle = openCycleByCustomer.get(c.id) ?? null;
      const hasBalance = getRemaining(cycle) > 0;
      const bucket = customerService.getCustomerStatus(c, today);
      if (hasBalance && bucket === 'overdue') overdue += 1;
      else if (hasBalance && bucket === 'soon') dueSoon += 1;
      else onSchedule += 1;
    }
    return { total: currentTenants.length, overdue, dueSoon, onSchedule };
  }, [currentTenants, openCycleByCustomer, today]);

  const beds = useMemo(() => occupancyTotals(rooms), [rooms]);

  // Expected = sum of open cycles still carrying a balance + settled tenants' rent.
  const expectedThisMonth = useMemo(
    () => currentTenants.reduce((sum, c) => sum + (Number(c.rentAmount) || 0), 0),
    [currentTenants],
  );

  const collectedPercent = expectedThisMonth > 0 ? Math.min(100, Math.round((monthTotal.rent / expectedThisMonth) * 100)) : 0;

  // ------------------------------------------------------------- charts
  const monthlyTrend = useMemo(() => {
    const out = [];
    for (let i = 5; i >= 0; i -= 1) {
      const m = today.subtract(i, 'month');
      const key = m.format('YYYY-MM');
      const total = transactions
        .filter((t) => t.type !== 'REFUND' && String(t.date).startsWith(key))
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);
      out.push({ label: m.format('MMM'), value: total });
    }
    return out;
  }, [transactions, today]);

  const occupancyTrend = useMemo(() => {
    // Occupancy history is not tracked, so approximate the trend from joining /
    // leaving dates: tenants active during each of the last 6 months.
    const out = [];
    for (let i = 5; i >= 0; i -= 1) {
      const m = today.subtract(i, 'month');
      const monthEnd = m.endOf('month');
      const active = customers.filter((c) => {
        const joined = c.joiningDate ? dayjs(c.joiningDate) : null;
        const left = c.vacatedAt ? dayjs(c.vacatedAt) : null;
        return joined && joined.isBefore(monthEnd) && (!left || left.isAfter(m));
      }).length;
      out.push({ label: m.format('MMM'), value: active });
    }
    return out;
  }, [customers, today]);

  const rentVsBill = useMemo(() => {
    const rent = monthTotal.rent;
    const bill = monthTotal.lightBill;
    return [
      { label: 'Rent', value: rent, color: 'var(--color-brand-500)' },
      { label: 'Light bill', value: bill, color: '#14b8a6' },
    ];
  }, [monthTotal]);

  // Open complaints / enquiries come from the operations service; the tables
  // may not exist yet (migration 003), so failures degrade to zero. The import
  // is static because three other modules already pull this file in eagerly -
  // a dynamic import here would not move it into its own chunk anyway, it would
  // only hide the intent.
  const [opsCounts, setOpsCounts] = useState({ complaints: 0, enquiries: 0 });
  useEffect(() => {
    let cancelled = false;
    Promise.all([listComplaints(), listEnquiries()])
      .then(([complaints, enquiries]) => {
        if (cancelled) return;
        setOpsCounts({
          complaints: (complaints ?? []).filter((c) => c.status !== 'resolved').length,
          enquiries: (enquiries ?? []).filter((e) => ['new', 'contacted'].includes(e.status)).length,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const billsByCustomer = useMemo(() => {
    const map = new Map();
    for (const bill of lightBills) {
      const remaining = getRemaining(bill);
      if (remaining <= 0) continue;
      map.set(bill.customerId, (map.get(bill.customerId) ?? 0) + remaining);
    }
    return map;
  }, [lightBills]);

  const attention = useMemo(
    () => ({
      overdue: pendingList.filter((r) => r.daysOverdue > 0 && r.rentRemaining > 0),
      leaving: leaving.slice(0, 4),
      complaints: opsCounts.complaints,
      enquiries: opsCounts.enquiries,
      dueSoon: sorted.filter((c) => {
        const cycle = openCycleByCustomer.get(c.id) ?? null;
        return getRemaining(cycle) > 0 && customerService.getCustomerStatus(c, today) === 'soon';
      }),
    }),
    [pendingList, leaving, opsCounts, sorted, openCycleByCustomer, today],
  );

  // Late-fee suggestions straight from the saved Settings rule; empty when
  // late fees are off (the mode check lives inside suggestLateFees).
  const lateFeeSuggestions = useMemo(
    () => suggestLateFees(pendingList, settings, today),
    [pendingList, settings, today],
  );
  const [lateFeeCustomer, setLateFeeCustomer] = useState(null);

  // Payment dialog for swipe -> record. Same dialog, same rules as the list.
  // Declared before the error return below: hooks after a conditional return
  // are skipped on the failure path and reappear on the retry, which React
  // reports as "Rendered more hooks than during the previous render" - a crash
  // on exactly the path where the owner most needs the app to recover.
  const [payTarget, setPayTarget] = useState(null);
  const [paymentCycle, setPaymentCycle] = useState(null);

  function openPay(customer) {
    setPayTarget(customer);
    setPaymentCycle(openCycleByCustomer.get(customer.id) ?? null);
  }

  if (status === 'error') {
    return (
      <ErrorState
        title="Could not load your tenants"
        message={error?.message || 'There was a problem reading your data from the cloud.'}
        onRetry={refresh}
      />
    );
  }

  const widgets = {
    hero: (
      <motion.section key="hero" aria-label="This month's collection" className="gradient-brand relative overflow-hidden rounded-3xl p-5 text-white shadow-lift sm:p-6">
        <div className="absolute -top-16 -right-10 size-56 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-white/80 uppercase">Collected this month</p>
            <p className="mt-1 text-3xl font-extrabold sm:text-4xl">
              <AnimatedNumber value={Math.round(monthTotal.total)} format={(n) => formatRupees(n)} />
            </p>
            <p className="mt-1 text-sm text-white/85">
              {formatRupees(monthTotal.rent)} rent · {formatRupees(monthTotal.lightBill)} electricity
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">Expected {formatRupees(expectedThisMonth)}</span>
              <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">Outstanding {formatRupees(outstandingTotals.rent + outstandingTotals.lightBill)}</span>
            </div>
            <button type="button" onClick={() => navigate('/reports')} className="mt-4 inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white/15 px-4 text-sm font-semibold hover:bg-white/25">
              View reports <ArrowRightIcon className="size-4" />
            </button>
          </div>
          <div className="flex shrink-0 items-center justify-center">
            <CircularProgress percent={collectedPercent} label={`${collectedPercent}%`} sub="of expected" />
          </div>
        </div>
      </motion.section>
    ),

    stats: (
      <motion.section key="stats" aria-label="Summary" className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 xl:grid-cols-4">
        <StatCard label="Total customers" value={summary.total} sub={`${summary.onSchedule} on schedule`} icon={UsersIcon} tone="brand" animated />
        <StatCard label="Overdue" value={summary.overdue} sub={summary.overdue ? 'Balance pending' : 'All clear'} icon={AlertIcon} tone={summary.overdue ? 'danger' : 'neutral'} animated />
        <StatCard label="Due in 5 days" value={summary.dueSoon} sub={summary.dueSoon ? 'Send reminders' : 'Nothing due'} icon={WalletIcon} tone={summary.dueSoon ? 'warning' : 'neutral'} animated />
        <StatCard label="Remaining rent" value={formatRupees(outstandingTotals.rent)} icon={BoltIcon} tone={outstandingTotals.rent > 0 ? 'danger' : 'neutral'} />
        <StatCard label="Remaining light bill" value={formatRupees(outstandingTotals.lightBill)} icon={BoltIcon} tone={outstandingTotals.lightBill > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Occupancy" value={`${beds.occupancyPercent}%`} sub={`${beds.occupiedBeds} of ${beds.totalBeds} beds`} icon={BuildingIcon} tone="accent" />
        <StatCard label="Vacant beds" value={beds.vacantBeds} sub={`${beds.fullyVacantRooms} empty rooms`} icon={HomeIcon} tone={beds.vacantBeds ? 'brand' : 'neutral'} animated />
        <StatCard label="Leaving soon" value={leaving.length} sub={leaving.length ? 'within 30 days' : 'nobody on notice'} icon={LogoutIcon} tone={leaving.length ? 'warning' : 'neutral'} animated />
      </motion.section>
    ),

    attention: (
      <motion.section key="attention" aria-label="Needs attention today">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="section-title">Needs attention today</h2>
            <Badge tone={attention.overdue.length ? 'danger' : 'accent'}>{attention.overdue.length ? `${attention.overdue.length} overdue` : 'All good'}</Badge>
          </div>

          {lateFeeSuggestions.length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
                <ClockIcon className="size-3.5" />
                {lateFeeSuggestions.length} late fee{lateFeeSuggestions.length === 1 ? '' : 's'} ready to apply
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-300/90">
                {lateFeeSuggestions.slice(0, 3).map((s) => s.name).join(', ')}
                {lateFeeSuggestions.length > 3 ? ` and ${lateFeeSuggestions.length - 3} more` : ''} ·{' '}
                {formatRupees(lateFeeSuggestions.reduce((sum, s) => sum + s.amount, 0))} total
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {lateFeeSuggestions.slice(0, 3).map((s) => (
                  <button
                    key={s.customerId}
                    type="button"
                    onClick={() => {
                      const customer = customers.find((c) => c.id === s.customerId);
                      const cycle = openCycleByCustomer.get(s.customerId);
                      if (customer && cycle) setLateFeeCustomer({ customer, cycle });
                    }}
                    className="min-h-9 rounded-lg border border-amber-300 bg-white/60 px-2.5 text-xs font-semibold text-amber-900 hover:bg-white dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60"
                  >
                    {s.name.split(' ')[0]} · {formatRupees(s.amount)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            <AttentionTile icon={AlertIcon} label="Overdue tenants" count={attention.overdue.length} tone="danger" onClick={() => navigate('/customers?filter=overdue')} />
            <AttentionTile icon={WalletIcon} label="Due within 5 days" count={attention.dueSoon.length} tone="warning" onClick={() => navigate('/customers?filter=soon')} />
            <AttentionTile icon={LogoutIcon} label="Leaving soon" count={leaving.length} tone="warning" onClick={() => navigate('/customers')} />
            <AttentionTile icon={WrenchIcon} label="Open complaints" count={attention.complaints} tone="danger" onClick={() => navigate('/operations?tab=complaints')} />
            <AttentionTile icon={UserCheckIcon} label="Pending enquiries" count={attention.enquiries} tone="brand" onClick={() => navigate('/operations?tab=enquiries')} />
          </ul>

          {attention.overdue.length > 0 && (
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {attention.overdue.slice(0, 3).map((row) => (
                <li key={row.customerId}>
                  <button type="button" onClick={() => navigate(`/customer/${row.customerId}`)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{row.name}</span>
                      <span className="block truncate text-[11px] text-ink-subtle">
                        {row.roomNo ? `Room ${row.roomNo} · ` : ''}due {formatDate(row.dueDate)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-bold text-red-600 dark:text-red-400">{formatRupees(row.totalRemaining)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </motion.section>
    ),

    charts: (
      <motion.section key="charts" aria-label="Trends" className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 sm:p-5">
          <h2 className="section-title">6-month collection</h2>
          <div className="mt-3">
            <BarChart data={monthlyTrend} ariaLabel="Collection trend, last 6 months" format={formatRupees} />
          </div>
        </Card>
        <Card className="p-4 sm:p-5">
          <h2 className="section-title">Occupancy trend</h2>
          <div className="mt-3">
            <LineChart data={occupancyTrend} ariaLabel="Occupied tenants, last 6 months" />
          </div>
        </Card>
        <Card className="p-4 sm:p-5">
          <h2 className="section-title">Rent vs light bill</h2>
          <div className="mt-2 flex items-center justify-center gap-4">
            <DonutChart
              data={rentVsBill}
              centerLabel={formatRupees(monthTotal.total).replace('Rs ', '')}
              centerSub="this month"
            />
            <ul className="space-y-2 text-xs">
              {rentVsBill.map((d) => (
                <li key={d.label} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="font-medium text-ink">{d.label}</span>
                  <span className="text-ink-subtle">{formatRupees(d.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </motion.section>
    ),

    occupancy: (
      <motion.section key="occupancy" aria-label="Occupancy">
        {rooms.length > 0 && (
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="section-title">Occupancy</h2>
              <button type="button" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => navigate('/rooms')}>
                Manage rooms
              </button>
            </div>
            <ProgressBar className="mt-3" percent={beds.occupancyPercent} tone="brand" label="Occupancy" />
            <p className="mt-2 text-xs text-ink-subtle">
              {beds.occupiedBeds} of {beds.totalBeds} beds filled · {beds.vacantBeds} vacant · {beds.fullyVacantRooms} empty rooms
            </p>
            {leaving.length > 0 && (
              <ul className="mt-4 divide-y divide-line border-t border-line">
                {leaving.map((tenant) => (
                  <li key={tenant.id}>
                    <button type="button" className="flex w-full items-center justify-between gap-3 py-2.5 text-left" onClick={() => navigate(`/customers/${tenant.id}`)}>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{tenant.name}</span>
                        <span className="block truncate text-[11px] text-ink-subtle">
                          Room {tenant.roomNo || '—'}
                          {tenant.bedNo ? ` · Bed ${tenant.bedNo}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400">{formatDate(tenant.expectedLeavingDate)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </motion.section>
    ),

    customers: (
      <motion.section key="customers" aria-label="Tenants">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="section-title">
            Rent status
            {status === 'ready' && sorted.length > 0 && <span className="ml-1.5 font-normal text-ink-subtle">({sorted.length})</span>}
          </h2>
        </div>

        {status === 'loading' ? (
          <SkeletonList count={5} />
        ) : sorted.length === 0 ? (
          <UiEmptyState
            icon={UsersIcon}
            tone="brand"
            title="No tenants yet"
            message="Add your first paying guest to start tracking rent. Three sample tenants are available from Settings if you want to try the colour coding first."
            action={
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" className="btn-gradient" onClick={() => navigate('/admission')}>
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
          <>
            {/* Mobile: swipeable cards. Desktop: the shared list (cards + table). */}
            <ul className="space-y-3 lg:hidden" data-testid="dashboard-cards">
              {sorted.map((customer) => (
                <SwipeCustomerCard
                  key={customer.id}
                  customer={customer}
                  cycle={openCycleByCustomer.get(customer.id) ?? null}
                  billTotal={billsByCustomer.get(customer.id) ?? 0}
                  today={today}
                  onPay={openPay}
                />
              ))}
            </ul>
            <div className="hidden lg:block">
              <CustomerList customers={sorted} />
            </div>
          </>
        )}
      </motion.section>
    ),
  };

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------- greeting */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="sr-only">Dashboard</h2>
          <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
            {greetingFor(today.hour())}
            {settings.ownerName ? `, ${settings.ownerName.split(' ')[0]}` : ''}
          </h1>
          <p className="mt-0.5 text-sm text-ink-subtle">
            {today.format('dddd, DD MMMM YYYY')} · {settings.pgName}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setWidgetsOpen(true)}
          className="btn-secondary min-h-10 px-3"
          aria-label="Customize dashboard widgets"
        >
          <SettingsIcon className="size-4" />
          <span className="hidden sm:inline">Widgets</span>
        </button>
      </header>

      {widgetOrder.map((key) => {
        if (widgetHidden.includes(key)) return null;
        const widget = widgets[key];
        return widget ?? null;
      })}

      <p className="pt-2 text-center text-xs text-ink-subtle">{settings.pgName} · stored in your own Supabase account</p>

      <BottomSheet open={widgetsOpen} onClose={() => setWidgetsOpen(false)} title="Dashboard widgets">
        <p className="mb-3 text-xs text-ink-subtle">Hide, show or reorder sections. Saved on this device.</p>
        <ul className="space-y-2">
          {widgetOrder.map((key, index) => {
            const hidden = widgetHidden.includes(key);
            return (
              <li key={key}>
                <Card className="flex items-center gap-2 p-3">
                  <span className="flex-1 truncate text-sm font-semibold text-ink">{WIDGET_TITLES[key] ?? key}</span>
                  <button
                    type="button"
                    className="btn-ghost size-9 min-h-9 p-0"
                    disabled={index === 0}
                    onClick={() => {
                      const next = moveWidget(widgetOrder, key, -1);
                      setWidgetOrder(next);
                      saveWidgetOrder(user?.id, next);
                    }}
                    aria-label={`Move ${WIDGET_TITLES[key]} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn-ghost size-9 min-h-9 p-0"
                    disabled={index === widgetOrder.length - 1}
                    onClick={() => {
                      const next = moveWidget(widgetOrder, key, 1);
                      setWidgetOrder(next);
                      saveWidgetOrder(user?.id, next);
                    }}
                    aria-label={`Move ${WIDGET_TITLES[key]} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={`btn-ghost size-9 min-h-9 p-0 ${hidden ? 'text-ink-subtle' : 'text-brand-600 dark:text-brand-300'}`}
                    onClick={() => {
                      const next = hidden ? widgetHidden.filter((k) => k !== key) : [...widgetHidden, key];
                      setWidgetHidden(next);
                      saveWidgetHidden(user?.id, next);
                    }}
                    aria-label={hidden ? `Show ${WIDGET_TITLES[key]}` : `Hide ${WIDGET_TITLES[key]}`}
                  >
                    {hidden ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                  </button>
                </Card>
              </li>
            );
          })}
        </ul>
      </BottomSheet>

      {/* Payment sheet reused by the swipe action. */}
      {payTarget && (
        <PaymentDialog
          open
          target={{ kind: 'rent', customer: payTarget, cycle: paymentCycle }}
          onClose={() => {
            setPayTarget(null);
            setPaymentCycle(null);
          }}
          onConfirm={async (payment) => {
            await recordRentPayment({ customerId: payTarget.id, amount: payment.amount, date: payment.date, mode: payment.mode, note: payment.note });
            setPayTarget(null);
            setPaymentCycle(null);
          }}
        />
      )}

      {lateFeeCustomer && (
        <LateFeeDialog
          open
          customer={lateFeeCustomer.customer}
          cycle={lateFeeCustomer.cycle}
          onClose={() => setLateFeeCustomer(null)}
        />
      )}
    </div>
  );
}

function AttentionTile({ icon: Icon, label, count, tone, onClick }) {
  const tones = {
    danger: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
    warning: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
    brand: 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-300',
    accent: 'border-accent-200 bg-accent-50 text-accent-700 dark:border-accent-900 dark:bg-accent-950/40 dark:text-accent-300',
  };
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition hover:brightness-[0.98] ${tones[tone] ?? tones.brand}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <span className="tabular-nums">{count}</span>
      </button>
    </li>
  );
}
