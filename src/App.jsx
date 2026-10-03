import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Toaster from './components/Toaster.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { DataProvider } from './context/DataContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AppErrorBoundary, RouteBoundary } from './components/ErrorBoundary.jsx';
import { LoadingBlock } from './components/States.jsx';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';

// Route-level code splitting keeps the first paint small on a phone.
const Admission = lazy(() => import('./pages/Admission.jsx'));
const CustomerDetails = lazy(() => import('./pages/CustomerDetails.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Transactions = lazy(() => import('./pages/Transactions.jsx'));
const Rooms = lazy(() => import('./pages/Rooms.jsx'));

function RequireAuth({ children }) {
  const { isAuthenticated, checking } = useAuth();
  const location = useLocation();

  if (checking) return <LoadingBlock label="Checking your session…" />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

function GuestOnly({ children }) {
  const { isAuthenticated, checking } = useAuth();
  if (checking) return <LoadingBlock label="Checking your session…" />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

/** One page crashing must not take the app down. */
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
  '/transactions': 'The payments page',
  '/rooms': 'The rooms page',
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
                    <Route path="/" element={<Protected><Dashboard /></Protected>} />
                    <Route path="/admission" element={<Protected>{page(<Admission />, 'Loading form…')}</Protected>} />
                    <Route path="/customer/:id" element={<Protected>{page(<CustomerDetails />, 'Loading tenant…')}</Protected>} />
                    <Route path="/transactions" element={<Protected>{page(<Transactions />, 'Loading payments…')}</Protected>} />
                    <Route path="/rooms" element={<Protected>{page(<Rooms />, 'Loading rooms…')}</Protected>} />
                    <Route path="/settings" element={<Protected>{page(<Settings />, 'Loading settings…')}</Protected>} />
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Routes>
                <Toaster />
              </DataProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
