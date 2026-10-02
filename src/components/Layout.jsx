import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Bell as BellGlyph,
  Search as SearchGlyph,
  PanelLeftClose as PanelClose,
  PanelLeftOpen as PanelOpen,
  IndianRupee as RupeeIcon,
  Zap as BoltIcon,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useNotifications } from '../context/NotificationContext.jsx';
import NotificationPanel from './NotificationPanel.jsx';
import GlobalSearch from './GlobalSearch.jsx';
import PaymentDialog from './PaymentDialog.jsx';
import LightBillDialog from './LightBillDialog.jsx';
import { BottomSheet } from './ui.jsx';
import {
  HomeIcon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
  SettingsIcon,
  LogoutIcon,
  SunIcon,
  MoonIcon,
  BuildingIcon,
  ReceiptIcon,
  PlusIcon,
  MoreIcon,
  WrenchIcon,
  ClipboardListIcon,
  GaugeIcon,
  UtensilsCrossedIcon,
  FileTextIcon,
  BoxesIcon,
} from './icons.jsx';

const PRIMARY_NAV = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true },
  { to: '/customers', label: 'Customers', icon: UsersIcon, end: false },
  { to: '/rooms', label: 'Rooms', icon: BuildingIcon, end: false },
  { to: '/transactions', label: 'Money', icon: WalletIcon, end: false },
];

const SECONDARY_NAV = [
  { to: '/admission', label: 'New admission', icon: UserPlusIcon },
  { to: '/expenses', label: 'Expenses', icon: ReceiptIcon },
  { to: '/operations', label: 'Operations', icon: ClipboardListIcon },
  { to: '/reports', label: 'Reports', icon: FileTextIcon },
  { to: '/meters', label: 'Meter readings', icon: GaugeIcon },
  { to: '/mess', label: 'Mess menu', icon: UtensilsCrossedIcon },
  { to: '/assets', label: 'Assets', icon: BoxesIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

const MORE_SHEET_NAV = [
  ...SECONDARY_NAV,
  { to: '/operations?tab=complaints&add=1', label: 'Log complaint', icon: WrenchIcon },
];

const QUICK_ACTIONS = [
  { key: 'payment', label: 'Record payment', icon: RupeeIcon, tone: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'bill', label: 'Add light bill', icon: BoltIcon, tone: 'text-amber-600 dark:text-amber-400' },
  { to: '/admission', label: 'Add customer', icon: UserPlusIcon, tone: 'text-brand-600 dark:text-brand-300' },
  { to: '/expenses?add=1', label: 'Add expense', icon: ReceiptIcon, tone: 'text-rose-600 dark:text-rose-400' },
  { to: '/operations?tab=complaints&add=1', label: 'Log complaint', icon: WrenchIcon, tone: 'text-sky-600 dark:text-sky-400' },
];

function ThemeToggleButton({ className = '' }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // One tap flips light <-> dark. The full Light / Dark / System set stays in
  // Settings, and the icon shown is the *resolved* appearance.
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`relative flex size-10 items-center justify-center overflow-hidden rounded-xl text-ink-subtle transition hover:bg-sunken hover:text-ink ${className}`}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={isDark ? 'moon' : 'sun'}
          initial={{ y: 14, opacity: 0, rotate: -40 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: -14, opacity: 0, rotate: 40 }}
          transition={{ duration: 0.16 }}
          className="flex"
        >
          {isDark ? <MoonIcon className="size-5" /> : <SunIcon className="size-5" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function BellButton() {
  const { unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex size-10 items-center justify-center rounded-xl text-ink-subtle transition hover:bg-sunken hover:text-ink"
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
      >
        <BellGlyph className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex min-w-4 justify-center">
            <span className="rounded-full bg-red-500 px-1 text-[10px] leading-4 font-bold text-white">{unreadCount > 9 ? '9+' : unreadCount}</span>
          </span>
        )}
      </button>
      <NotificationPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function OverdueCount() {
  const { pendingList, status } = useData();
  if (status !== 'ready') return null;
  const overdue = pendingList.filter((r) => r.daysOverdue > 0 && r.rentRemaining > 0).length;
  if (!overdue) return null;
  return (
    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
      {overdue}
    </span>
  );
}

function OfflineBanner() {
  const { online, status, refresh } = useData();
  if (online && status !== 'error') return null;

  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-3 px-4 py-2 text-xs font-medium text-white ${
        status === 'error' ? 'bg-red-600' : 'bg-amber-500'
      }`}
    >
      <span className="min-w-0 truncate">
        {status === 'error'
          ? 'Could not load your data from the cloud.'
          : 'You are offline. Showing the last loaded data; saving changes needs a connection.'}
      </span>
      {status === 'error' && (
        <button type="button" onClick={refresh} className="shrink-0 rounded-lg bg-white/20 px-2.5 py-1 font-semibold hover:bg-white/30">
          Retry
        </button>
      )}
    </div>
  );
}

function NavItem({ item, variant, iconOnly = false }) {
  const Icon = item.icon;
  const base =
    variant === 'bottom'
      ? 'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium transition'
      : `flex min-h-11 items-center rounded-xl px-3 py-2.5 text-sm font-medium transition ${
          iconOnly ? 'justify-center px-0' : 'gap-3'
        }`;

  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={iconOnly ? item.label : undefined}
      aria-label={iconOnly ? item.label : undefined}
      className={({ isActive }) =>
        `${base} ${
          isActive
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/70 dark:text-brand-200'
            : 'text-ink-subtle hover:bg-sunken hover:text-ink'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span className="relative">
            <Icon className={`size-5 shrink-0 ${isActive ? 'text-brand-600 dark:text-brand-300' : ''}`} />
            {isActive && variant === 'bottom' && (
              <motion.span
                layoutId="navdot"
                className="absolute -bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-brand-500"
              />
            )}
          </span>
          {!iconOnly && <span className="truncate">{item.label}</span>}
        </>
      )}
    </NavLink>
  );
}

/**
 * Centered floating "+" in the bottom bar -> quick action sheet.
 * "Record payment" / "Add light bill" pick a tenant first, then run through the
 * exact same service calls the customer list uses, so the ledger rules and the
 * toasts stay identical no matter where the action started.
 */
function QuickActionFab() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [picking, setPicking] = useState(null); // 'payment' | 'bill' | null
  const [target, setTarget] = useState(null);
  const [paymentCycle, setPaymentCycle] = useState(null);
  const [busy, setBusy] = useState(false);
  const { customers, openCycleByCustomer, lightBills, today, recordRentPayment, saveLightBill } = useData();
  const navigate = useNavigate();

  const withBalance = useMemo(() => {
    const rows = [];
    for (const customer of customers) {
      if (customer.status === 'vacated') continue;
      const cycle = openCycleByCustomer.get(customer.id) ?? null;
      const remaining = cycle ? cycle.remainingAmount : null;
      rows.push({ customer, cycle, remaining });
    }
    return rows.sort((a, b) => (b.remaining ?? -1) - (a.remaining ?? -1));
  }, [customers, openCycleByCustomer]);

  function pick(action) {
    if (action.to) {
      navigate(action.to);
      setSheetOpen(false);
      return;
    }
    setPicking(action.key);
    setSheetOpen(false);
  }

  return (
    <>
      <motion.button
        type="button"
        whileTap={{ scale: 0.92 }}
        onClick={() => setSheetOpen(true)}
        className="relative -mt-6 flex size-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg"
        style={{ backgroundImage: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
        aria-label="Quick actions"
        aria-expanded={sheetOpen}
      >
        <motion.span animate={{ rotate: sheetOpen ? 45 : 0 }} transition={{ duration: 0.18 }}>
          <PlusIcon className="size-6" />
        </motion.span>
      </motion.button>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Quick actions">
        <ul className="grid grid-cols-1 gap-1">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            const body = (
              <>
                <span className={`flex size-10 items-center justify-center rounded-xl bg-sunken ${action.tone}`}>
                  <Icon className="size-5" />
                </span>
                <span className="text-sm font-semibold text-ink">{action.label}</span>
              </>
            );
            return (
              <li key={action.label}>
                {action.to ? (
                  <NavLink to={action.to} className="flex min-h-14 items-center gap-3 rounded-xl px-2 hover:bg-sunken">
                    {body}
                  </NavLink>
                ) : (
                  <button
                    type="button"
                    onClick={() => pick(action)}
                    className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-sunken"
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </BottomSheet>

      {/* Tenant picker for payment / bill flows */}
      <BottomSheet open={Boolean(picking)} onClose={() => setPicking(null)} title={picking === 'bill' ? 'Add light bill for…' : 'Record payment for…'}>

        <ul className="divide-y divide-line">
          {withBalance.map(({ customer, cycle, remaining }) => (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => {
                  setTarget(customer);
                  setPaymentCycle(cycle);
                  setPicking(null);
                }}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-1 py-2 text-left hover:bg-sunken"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{customer.name}</span>
                  <span className="block truncate text-xs text-ink-subtle">
                    {customer.roomNo ? `Room ${customer.roomNo} · ` : ''}
                    {customer.mobile}
                  </span>
                </span>
                {remaining !== null && remaining > 0 && (
                  <span className="shrink-0 text-xs font-bold text-red-600 dark:text-red-400">₹{Number(remaining).toLocaleString('en-IN')}</span>
                )}
              </button>
            </li>
          ))}
          {withBalance.length === 0 && <li className="px-1 py-6 text-center text-sm text-ink-subtle">No tenants yet.</li>}
        </ul>
      </BottomSheet>

      {picking === 'payment' && target && (
        <PaymentDialog
          open
          target={{ kind: 'rent', customer: target, cycle: paymentCycle }}
          onClose={() => {
            setTarget(null);
            setPaymentCycle(null);
          }}
          onConfirm={async (payment) => {
            setBusy(true);
            try {
              const result = await recordRentPayment({
                customerId: target.id,
                amount: payment.amount,
                date: payment.date,
                mode: payment.mode,
                note: payment.note,
              });
              setTarget(null);
              setPaymentCycle(null);
              return result;
            } finally {
              setBusy(false);
            }
          }}
          busy={busy}
        />
      )}

      {picking === 'bill' && target && (
        <LightBillDialog
          open
          customer={target}
          existingBill={lightBills.find((b) => b.customerId === target.id && b.month === monthKeyOf(today)) ?? null}
          onClose={() => setTarget(null)}
          onSave={async (bill) => {
            setBusy(true);
            try {
              const saved = await saveLightBill(bill);
              setTarget(null);
              return saved;
            } finally {
              setBusy(false);
            }
          }}
          busy={busy}
        />
      )}
    </>
  );
}

function monthKeyOf(today) {
  const d = today?.format ? today.format('YYYY-MM') : String(today ?? '').slice(0, 7);
  return d;
}

function MoreSheet({ open, onClose }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="More">
      <ul className="grid grid-cols-2 gap-1">
        {MORE_SHEET_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex min-h-14 items-center gap-2.5 rounded-xl px-3 text-sm font-medium ${
                    isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/70 dark:text-brand-200' : 'text-ink-muted hover:bg-sunken'
                  }`
                }
              >
                <Icon className="size-5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}

export default function Layout() {
  const { logout, user } = useAuth();
  const { settings } = useData();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  // Route changes should always start at the top of the page.
  useEffect(() => {
    document.getElementById('main-scroll')?.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Ctrl/Cmd+K opens global search (desktop shortcut, mobile has the icon).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pageKey = useMemo(() => location.pathname + location.search, [location.pathname, location.search]);

  return (
    <div className="flex min-h-dvh flex-col bg-sunken">
      <OfflineBanner />
      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------------ sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-raised transition-[width] duration-200 lg:flex ${
            collapsed ? 'w-[76px]' : 'w-64'
          }`}
        >
          <div className={`flex items-center gap-3 border-b border-line py-5 ${collapsed ? 'justify-center px-2' : 'px-4'}`}>
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white"
              style={{ backgroundImage: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
            >
              <HomeIcon className="size-5" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{settings.pgName || 'PG Manager'}</p>
                <p className="truncate text-xs text-ink-subtle">{settings.ownerName || 'Administrator'}</p>
              </div>
            )}
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto p-3">
            {PRIMARY_NAV.map((item) => (
              <div key={item.to} className="flex items-center">
                <div className="flex-1">
                  <NavItem item={item} variant="side" iconOnly={collapsed} />
                </div>
                {!collapsed && item.to === '/' && <OverdueCount />}
              </div>
            ))}

            {!collapsed && <p className="px-3 pt-4 pb-1 text-[10px] font-bold tracking-widest text-ink-subtle uppercase">Manage</p>}
            <div className="space-y-1">
              {(collapsed ? SECONDARY_NAV.slice(0, 4) : SECONDARY_NAV).map((item) => (
                <NavItem key={item.to} item={item} variant="side" iconOnly={collapsed} />
              ))}
            </div>
          </nav>

          <div className="space-y-1 border-t border-line p-3">
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="btn-ghost w-full justify-start"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelOpen className="size-4" /> : <PanelClose className="size-4" />}
              {!collapsed && 'Collapse'}
            </button>
            <button type="button" onClick={logout} className="btn-ghost w-full justify-start">
              <LogoutIcon className="size-4" />
              {!collapsed && 'Sign out'}
            </button>
          </div>
        </aside>

        {/* -------------------------------------------------------- main */}
        <div className={`flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ${collapsed ? 'lg:pl-[76px]' : 'lg:pl-64'}`}>
          {/* Mobile glass header */}
          <header className="glass-header sticky top-0 z-20 flex items-center gap-1.5 px-3 py-2.5 lg:hidden">
            <div
              className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white"
              style={{ backgroundImage: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
            >
              <HomeIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{settings.pgName || 'PG Manager'}</p>
              <p className="truncate text-[11px] text-ink-subtle">{settings.ownerName || 'Administrator'}</p>
            </div>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex size-10 items-center justify-center rounded-xl text-ink-subtle hover:bg-sunken hover:text-ink"
              aria-label="Search"
            >
              <SearchGlyph className="size-5" />
            </button>
            <ThemeToggleButton />
            <BellButton />
          </header>

          {/* Desktop top strip */}
          <div className="hidden items-center justify-end gap-2 px-8 pt-4 lg:flex">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex min-h-10 w-72 items-center gap-2 rounded-xl border border-line bg-raised px-3 text-sm text-ink-subtle shadow-xs hover:border-line-strong"
            >
              <SearchGlyph className="size-4" />
              <span className="flex-1 text-left">Search tenants, rooms…</span>
              <kbd className="rounded border border-line bg-sunken px-1.5 py-0.5 text-[10px] font-semibold">Ctrl K</kbd>
            </button>
            <ThemeToggleButton />
            <BellButton />
            <AccountMenu open={accountOpen} onClose={() => setAccountOpen(false)} user={user} onSignOut={logout} />
          </div>

          <main id="main-scroll" className="flex-1 px-4 pt-3 pb-32 lg:px-8 lg:pt-4 lg:pb-12">
            <div className="mx-auto w-full max-w-6xl">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={pageKey}
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      </div>

      {/* ------------------------------------------------ bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Primary"
      >
        <div className="mx-auto flex max-w-lg items-stretch gap-1 px-2">
          {PRIMARY_NAV.slice(0, 2).map((item) => (
            <NavItem key={item.to} item={item} variant="bottom" />
          ))}
          <div className="flex w-14 shrink-0 items-start justify-center">
            <QuickActionFab />
          </div>
          {PRIMARY_NAV.slice(2).map((item) => (
            <NavItem key={item.to} item={item} variant="bottom" />
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex min-h-14 w-16 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium text-ink-subtle transition hover:bg-sunken hover:text-ink"
            aria-label="More pages"
          >
            <MoreIcon className="size-5" />
            <span className="truncate">More</span>
          </button>
        </div>
      </nav>

      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

/**
 * Header account menu: the Google profile photo and name when Google supplied
 * them, falling back to the initial-based avatar for a password account.
 */
function AccountMenu({ open, onClose, user, onSignOut }) {
  const name = user?.name || user?.email || 'Account';
  const email = user?.email ?? '';
  const avatar = user?.avatarUrl ?? '';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onClose(open ? null : true)}
        aria-label="Account menu"
        aria-expanded={Boolean(open)}
        className="flex min-h-10 items-center gap-2 rounded-xl px-1.5 hover:bg-sunken"
      >
        {avatar ? (
          <img
            src={avatar}
            alt=""
            referrerPolicy="no-referrer"
            className="size-8 shrink-0 rounded-full border border-line object-cover"
          />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-200">
            {(user?.email || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="hidden max-w-32 truncate text-sm font-semibold text-ink xl:block">{name}</span>
      </button>

      {open && (
        <>
          {/* Click-away layer. */}
          <button
            type="button"
            aria-label="Close account menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={onClose}
          />
          <div className="card absolute right-0 z-50 mt-1 w-64 overflow-hidden p-0 shadow-lg">
            <div className="flex items-center gap-3 border-b border-line p-3">
              {avatar ? (
                <img
                  src={avatar}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="size-10 shrink-0 rounded-full border border-line object-cover"
                />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-200">
                  {(email || '?').slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{name}</p>
                {email && <p className="truncate text-xs text-ink-subtle">{email}</p>}
              </div>
            </div>
            <div className="p-1.5">
              <NavLink to="/settings" onClick={onClose} className="btn-ghost w-full justify-start">
                <SettingsIcon className="size-4" />
                Settings
              </NavLink>
              <button type="button" onClick={onSignOut} className="btn-ghost w-full justify-start text-red-600">
                <LogoutIcon className="size-4" />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
