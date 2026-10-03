import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { PanelLeftClose as PanelClose, PanelLeftOpen as PanelOpen } from 'lucide-react';

import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import {
  HomeIcon,
  UserPlusIcon,
  WalletIcon,
  SettingsIcon,
  LogoutIcon,
  SunIcon,
  MoonIcon,
  BuildingIcon,
} from './icons.jsx';

const NAV = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true },
  { to: '/rooms', label: 'Rooms', icon: BuildingIcon, end: false },
  { to: '/transactions', label: 'Money', icon: WalletIcon, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
];

function ThemeToggleButton({ className = '' }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // One tap flips light <-> dark. The choice is saved in localStorage and
  // applied before first paint, so there is no flash on load.
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

function OverdueCount() {
  const { customers, openCycleByCustomer, status, today } = useData();
  if (status !== 'ready') return null;
  const overdue = customers.filter((c) => {
    if (c.status === 'vacated') return false;
    const cycle = openCycleByCustomer.get(c.id);
    return (cycle ? cycle.remainingAmount : 0) > 0 && c.nextDueDate < today.format('YYYY-MM-DD');
  }).length;
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

export default function Layout() {
  const { logout, user } = useAuth();
  const { settings } = useData();
  const location = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);

  // Route changes should always start at the top of the page.
  useEffect(() => {
    document.getElementById('main-scroll')?.scrollTo({ top: 0 });
  }, [location.pathname]);

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
                <p className="truncate text-xs text-ink-subtle">{user?.email || 'Administrator'}</p>
              </div>
            )}
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto p-3">
            {NAV.map((item) => (
              <div key={item.to} className="flex items-center">
                <div className="flex-1">
                  <NavItem item={item} variant="side" iconOnly={collapsed} />
                </div>
                {!collapsed && item.to === '/' && <OverdueCount />}
              </div>
            ))}
            {!collapsed && (
              <button type="button" onClick={() => navigate('/admission')} className="btn-primary mt-4 w-full justify-center">
                <UserPlusIcon className="size-4" />
                New admission
              </button>
            )}
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
            </div>
            <ThemeToggleButton />
            <button
              type="button"
              onClick={logout}
              className="flex size-10 items-center justify-center rounded-xl text-ink-subtle hover:bg-sunken hover:text-ink"
              aria-label="Sign out"
            >
              <LogoutIcon className="size-5" />
            </button>
          </header>

          {/* Desktop top strip: dark/light toggle + sign out */}
          <div className="hidden items-center justify-end gap-2 px-8 pt-4 lg:flex">
            <ThemeToggleButton />
            <button type="button" onClick={logout} className="btn-ghost min-h-10 gap-2 px-3">
              <LogoutIcon className="size-4" />
              Sign out
            </button>
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
          {NAV.slice(0, 2).map((item) => (
            <NavItem key={item.to} item={item} variant="bottom" />
          ))}
          <div className="flex w-14 shrink-0 items-start justify-center">
            <button
              type="button"
              onClick={() => navigate('/admission')}
              className="relative -mt-6 flex size-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg"
              style={{ backgroundImage: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
              aria-label="New admission"
            >
              <UserPlusIcon className="size-6" />
            </button>
          </div>
          {NAV.slice(2).map((item) => (
            <NavItem key={item.to} item={item} variant="bottom" />
          ))}
        </div>
      </nav>
    </div>
  );
}
