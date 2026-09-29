import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { customerService } from '../services/index.js';
import { HomeIcon, UserPlusIcon, UsersIcon, SettingsIcon, LogoutIcon } from './icons.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true },
  { to: '/admission', label: 'Admission', icon: UserPlusIcon, end: false },
  { to: '/customers', label: 'Tenants', icon: UsersIcon, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
];

function NavItem({ item, variant }) {
  const Icon = item.icon;
  const base =
    variant === 'bottom'
      ? 'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium transition'
      : 'flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition';

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        variant === 'bottom'
          ? `${base} ${
              isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            }`
          : `${base} ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={`size-5 shrink-0 ${isActive ? 'text-brand-600' : ''}`} />
          <span className="truncate">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

function OverdueCount() {
  const { customers, today, status } = useData();
  if (status !== 'ready') return null;
  const overdue = customerService.summarise(customers, today).overdue;
  if (!overdue) return null;
  return (
    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
      {overdue}
    </span>
  );
}

export default function Layout() {
  const { logout } = useAuth();
  const { settings } = useData();
  const location = useLocation();

  // Route changes should always start at the top of the page.
  useEffect(() => {
    document.getElementById('main-scroll')?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="flex min-h-dvh bg-slate-100">
      {/* ------------------------------------------------------ sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-brand-600 text-white">
            <HomeIcon className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{settings.pgName || 'PG Manager'}</p>
            <p className="truncate text-xs text-slate-500">{settings.ownerName || 'Administrator'}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => (
            <div key={item.to} className="flex items-center">
              <div className="flex-1">
                <NavItem item={item} variant="side" />
              </div>
              {item.to === '/' && <OverdueCount />}
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <button type="button" onClick={logout} className="btn-ghost w-full justify-start">
            <LogoutIcon className="size-4" />
            Lock app
          </button>
        </div>
      </aside>

      {/* -------------------------------------------------------- main */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex size-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <HomeIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{settings.pgName || 'PG Manager'}</p>
            <p className="truncate text-xs text-slate-500">{settings.ownerName || 'Administrator'}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex size-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
            aria-label="Lock app"
          >
            <LogoutIcon className="size-5" />
          </button>
        </header>

        <main id="main-scroll" className="flex-1 px-4 pt-4 pb-28 lg:px-8 lg:pt-8 lg:pb-12">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>

      {/* ------------------------------------------------ bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)]
                   backdrop-blur lg:hidden"
        aria-label="Primary"
      >
        <div className="mx-auto flex max-w-lg items-stretch gap-1 px-2">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} item={item} variant="bottom" />
          ))}
        </div>
      </nav>
    </div>
  );
}
