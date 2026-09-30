import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Toaster from './components/Toaster.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { DataProvider } from './context/DataContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { LoadingBlock } from './components/States.jsx';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';

// Route-level code splitting keeps the first paint small on a phone.
const Admission = lazy(() => import('./pages/Admission.jsx'));
const CustomerDetails = lazy(() => import('./pages/CustomerDetails.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Customers = lazy(() => import('./pages/Customers.jsx'));
const Transactions = lazy(() => import('./pages/Transactions.jsx'));

function RequireAuth({ children }) {
  const { isAuthenticated, checking } = useAuth();
  const location = useLocation();

  // The session is restored asynchronously. Redirecting before that check
  // finishes would bounce a signed-in user to /login and then lose the route
  // they were actually on, so hold the gate until we know who they are.
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

function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-5xl font-bold text-slate-200">404</p>
      <h1 className="text-lg font-semibold text-slate-800">Page not found</h1>
      <p className="text-sm text-slate-500">The page you were looking for does not exist.</p>
      <a href="/" className="btn-primary mt-2">
        Go to dashboard
      </a>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
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
                <Route path="/" element={<Dashboard />} />
                <Route
                  path="/admission"
                  element={
                    <Suspense fallback={<LoadingBlock label="Loading form…" />}>
                      <Admission />
                    </Suspense>
                  }
                />
                <Route
                  path="/customers"
                  element={
                    <Suspense fallback={<LoadingBlock />}>
                      <Customers />
                    </Suspense>
                  }
                />
                <Route
                  path="/customer/:id"
                  element={
                    <Suspense fallback={<LoadingBlock label="Loading tenant…" />}>
                      <CustomerDetails />
                    </Suspense>
                  }
                />
                <Route
                  path="/transactions"
                  element={
                    <Suspense fallback={<LoadingBlock label="Loading transactions…" />}>
                      <Transactions />
                    </Suspense>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <Suspense fallback={<LoadingBlock label="Loading settings…" />}>
                      <Settings />
                    </Suspense>
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
            <Toaster />
          </DataProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
