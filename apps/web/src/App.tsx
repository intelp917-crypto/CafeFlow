import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { Spinner } from '@cafeflow/ui';
import { useAuth } from './lib/auth';
import { AdminLayout } from './layouts/AdminLayout';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { AuditPage } from './pages/AuditPage';
import { CashierPage } from './pages/CashierPage';
import { CashPage } from './pages/CashPage';
import { CatalogPage } from './pages/CatalogPage';
import { CustomersPage } from './pages/CustomersPage';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { FinancePage } from './pages/FinancePage';
import { MessagesPage } from './pages/MessagesPage';
import { HomePage } from './pages/HomePage';
import { InventoryPage } from './pages/InventoryPage';
import { LayoutPage } from './pages/LayoutPage';
import { LoginPage } from './pages/LoginPage';
import { MenuPage } from './pages/MenuPage';
import { OrderStatusPage } from './pages/OrderStatusPage';
import { ModulesPage } from './pages/ModulesPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OrdersPage } from './pages/OrdersPage';
import { PrepPage } from './pages/PrepPage';
import { PrintPage } from './pages/PrintPage';
import { ReportsPage } from './pages/ReportsPage';
import { RequestsPage } from './pages/RequestsPage';
import { ReservationsPage } from './pages/ReservationsPage';
import { TablesPage } from './pages/TablesPage';
import { TableGamesPage } from './pages/TableGamesPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PasswordPage } from './pages/PasswordPage';
import { SecurityPage } from './pages/SecurityPage';
import { SettingsPage } from './pages/SettingsPage';
import { StaffPage } from './pages/StaffPage';

const INTRO_SEEN_KEY = 'cafeflow:intro-seen';

/** The cinematic entrance is its own chunk, downloaded on the first visit of a session. */
const IntroPage = lazy(() => import('./pages/IntroPage').then((module) => ({ default: module.IntroPage })));

function FullPageLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-brand-600">
      <Spinner size="lg" label="در حال بررسی نشست…" />
    </div>
  );
}

function readIntroSeen() {
  try {
    return sessionStorage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    // Storage can be blocked; the entrance is an extra, so never trap anyone on it.
    return true;
  }
}

/** Entering the site starts at the entrance scene; once per session after that, straight home. */
function RootRoute() {
  const [introSeen] = useState(readIntroSeen);
  return introSeen ? <HomePage /> : <Navigate to="/intro" replace />;
}

/**
 * Route changes start at the top of the new page.
 *
 * A client-side navigation keeps the document, so the browser keeps the old
 * scroll offset: on a phone the reader lands halfway down a page they have
 * never seen. Back/forward is left alone — there the browser's own restore is
 * exactly what people expect.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === 'POP') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname, navigationType]);

  return null;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/staff/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/staff/password" replace />;
  return <>{children}</>;
}

export function App() {
  const { user, loading } = useAuth();

  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<RootRoute />} />
      <Route
        path="/intro"
        element={
          <Suspense fallback={<FullPageLoader />}>
            <IntroPage />
          </Suspense>
        }
      />
      <Route path="/menu" element={<MenuPage />} />
      <Route path="/menu/:qrToken" element={<MenuPage />} />
      <Route path="/table/:qrToken/games" element={<TableGamesPage />} />
      <Route path="/order/:code" element={<OrderStatusPage />} />
      <Route path="/staff/login" element={loading ? <FullPageLoader /> : user ? <Navigate to="/admin" replace /> : <LoginPage />} />
      <Route
        path="/staff/password"
        element={loading ? <FullPageLoader /> : user ? <PasswordPage /> : <Navigate to="/staff/login" replace />}
      />

      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="catalog" element={<CatalogPage />} />
        <Route path="cashier" element={<CashierPage />} />
        <Route path="prep" element={<PrepPage />} />
        <Route path="tables" element={<TablesPage />} />
        <Route path="layout" element={<LayoutPage />} />
        <Route path="reservations" element={<ReservationsPage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="print" element={<PrintPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="cash" element={<CashPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="modules" element={<ModulesPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="security" element={<SecurityPage />} />
      </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
