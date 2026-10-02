import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Toaster from './components/Toaster.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { DataProvider } from './context/DataContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import { AppErrorBoundary, RouteBoundary } from './components/ErrorBoundary.jsx';
import { LoadingBlock } from './components/States.jsx';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AccessDenied from './pages/AccessDenied.jsx';

// Route-level code splitting keeps the first paint small on a phone.
const Admission = lazy(() => import('./pages/Admission.jsx'));
const CustomerDetails = lazy(() => import('./pages/CustomerDetails.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Customers = lazy(() => import('./pages/Customers.jsx'));
const Transactions = lazy(() => import('./pages/Transactions.jsx'));
const Rooms = lazy(() => import('./pages/Rooms.jsx'));
const Expenses = lazy(() => import('./pages/Expenses.jsx'));
const Operations = lazy(() => import('./pages/Operations.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Meters = lazy(() => import('./pages/Meters.jsx'));
const Mess = lazy(() => import('./pages/Mess.jsx'));
const Assets = lazy(() => import('./pages/Assets.jsx'));

function RequireAuth({ children }) {
  const { isAuthenticated, checking, accessChecking, accessDenied, deniedEmail } = useAuth();
  const location = useLocation();

  // The session is restored asynchronously. Redirecting before that check
  // finishes would bounce a signed-in user to /login and then lose the route
  // they were actually on, so hold the gate until we know who they are.
  if (checking) return <LoadingBlock label="Checking your session…" />;
  // Checked before the redirect below: a rejected account has already been
  // signed out, so `isAuthenticated` is false and the naive order would bounce
  // it to /login and lose the explanation.
  if (accessDenied) return <AccessDenied email={deniedEmail} />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  // Signed in, but we still have to confirm the address is on the owner's
  // allowlist. Rendering the app before that answers would flash the ledger at
  // someone who is about to be signed out.
  if (accessChecking) return <LoadingBlock label="Checking access…" />;
  return children;
}

function GuestOnly({ children }) {
  const { isAuthenticated, checking } = useAuth();
  if (checking) return <LoadingBlock label="Checking your session…" />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

/**
 * Wraps every protected route so a render-time throw in one page replaces only
 * that page. `key` includes the pathname so moving between two broken pages
 * clears the previous error instead of stranding the user on the old screen.
 */
function Protected({ children }) {
  const location = useLocation();
  return (
    <RouteBoundary routeKey={location.pathname} label={LABELS[location.pathname] ?? 'This page'}>
      {children}
    </RouteBoundary>
  );
}

const LABELS = {
  '/': 'The dashboard',
  '/admission': 'The admission form',
  '/customers': 'The tenant list',
  '/transactions': 'The payments page',
  '/rooms': 'The rooms page',
  '/expenses': 'The expenses page',
  '/operations': 'The operations page',
  '/reports': 'The reports page',
  '/meters': 'The electricity meters page',
  '/mess': 'The mess menu page',
  '/assets': 'The assets page',
  '/settings': 'Settings',
};

function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-5xl font-bold text-slate-300 dark:text-slate-700">404</p>
      <h1 className="text-lg font-semibold text-ink">Page not found</h1>
      <p className="text-sm text-ink-subtle">The page you were looking for does not exist.</p>
      <a href="/" className="btn-gradient mt-2">
        Go to dashboard
      </a>
    </div>
  );
}

function page(element, label = 'Loading…') {
  return (
    <Suspense fallback={<LoadingBlock label={label} />}>
      {element}
    </Suspense>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <DataProvider>
              <NotificationProvider>
                <Routes>
                  <Route
                    path="/login"
                    element={
                      <GuestOnly>
                        <Login />
                      </GuestOnly>
                    }
                  />

                  <Route
                    element={
                      <RequireAuth>
                        <Layout />
                      </RequireAuth>
                    }
                  >
                    <Route
                      path="/"
                      element={
                        <Protected>
                          <Dashboard />
                        </Protected>
                      }
                    />
                    <Route path="/admission" element={<Protected>{page(<Admission />, 'Loading form…')}</Protected>} />
                    <Route path="/customers" element={<Protected>{page(<Customers />)}</Protected>} />
                    <Route
                      path="/customer/:id"
                      element={<Protected>{page(<CustomerDetails />, 'Loading tenant…')}</Protected>}
                    />
                    <Route path="/transactions" element={<Protected>{page(<Transactions />, 'Loading transactions…')}</Protected>} />
                    <Route path="/rooms" element={<Protected>{page(<Rooms />, 'Loading rooms…')}</Protected>} />
                    <Route path="/expenses" element={<Protected>{page(<Expenses />)}</Protected>} />
                    <Route path="/operations" element={<Protected>{page(<Operations />)}</Protected>} />
                    <Route path="/reports" element={<Protected>{page(<Reports />)}</Protected>} />
                    <Route path="/meters" element={<Protected>{page(<Meters />)}</Protected>} />
                    <Route path="/mess" element={<Protected>{page(<Mess />)}</Protected>} />
                    <Route path="/assets" element={<Protected>{page(<Assets />)}</Protected>} />
                    <Route path="/settings" element={<Protected>{page(<Settings />, 'Loading settings…')}</Protected>} />
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Routes>
                <Toaster />
              </NotificationProvider>
            </DataProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
    </AppErrorBoundary>
  );
}
