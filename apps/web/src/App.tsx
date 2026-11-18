import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from '@cafeflow/ui';
import { useAuth } from './lib/auth';
import { AdminLayout } from './layouts/AdminLayout';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { AuditPage } from './pages/AuditPage';
import { CashierPage } from './pages/CashierPage';
import { DashboardPage } from './pages/DashboardPage';
import { HomePage } from './pages/HomePage';
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
import { TablesPage } from './pages/TablesPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PasswordPage } from './pages/PasswordPage';
import { SettingsPage } from './pages/SettingsPage';
import { StaffPage } from './pages/StaffPage';

function FullPageLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-brand-600">
      <Spinner size="lg" label="در حال بررسی نشست…" />
    </div>
  );
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
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/menu" element={<MenuPage />} />
      <Route path="/menu/:qrToken" element={<MenuPage />} />
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
        <Route path="cashier" element={<CashierPage />} />
        <Route path="prep" element={<PrepPage />} />
        <Route path="tables" element={<TablesPage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="print" element={<PrintPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="modules" element={<ModulesPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
