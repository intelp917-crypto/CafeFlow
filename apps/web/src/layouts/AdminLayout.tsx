import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button, cn } from '@cafeflow/ui';
import type { ModuleKey } from '@cafeflow/shared';
import { useAuth } from '../lib/auth';
import { useBranding } from '../lib/branding';
import { DeveloperCredit } from '../components/DeveloperCredit';
import { NotificationBell } from '../components/NotificationBell';

interface NavItem {
  to: string;
  label: string;
  permission: string;
  /** Optional modules hide their entry while disabled. */
  module?: ModuleKey;
  end?: boolean;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/admin', label: 'داشبورد', permission: 'dashboard.read', end: true, icon: 'M4 13h6V4H4zm10 7h6v-9h-6zM4 20h6v-3H4zm10-13h6V4h-6z' },
  { to: '/admin/orders', label: 'سفارش‌ها', permission: 'orders.read', icon: 'M6 4h12v16H6zM9 8h6M9 12h6M9 16h4' },
  { to: '/admin/catalog', label: 'منو و محصولات', permission: 'catalog.read', icon: 'M6 4h12v16H6zM9 8h6M9 12h6M9 16h4' },
  { to: '/admin/prep', label: 'صف آماده‌سازی', permission: 'prep.read', icon: 'M4 7h16M6 7v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7M9 3v4m6-4v4' },
  { to: '/admin/cashier', label: 'صندوق', permission: 'payments.read', icon: 'M4 7h16v10H4zM4 11h16M8 15h3' },
  { to: '/admin/tables', label: 'میزها', permission: 'layout.read', icon: 'M4 10h16M6 10V6h12v4M8 10v6m8-6v6M5 20h14' },
  { to: '/admin/layout', label: 'طراحی سالن', permission: 'layout.read', icon: 'M4 4h16v16H4zM4 10h16M10 10v10M15 6h2' },
  { to: '/admin/reservations', label: 'رزروها', permission: 'reservations.read', module: 'reservations', icon: 'M8 4v3m8-3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z' },
  { to: '/admin/requests', label: 'درخواست‌ها', permission: 'orders.read', icon: 'M12 4a5 5 0 0 1 5 5v3l2 3H5l2-3V9a5 5 0 0 1 5-5zM10 19a2 2 0 0 0 4 0' },
  { to: '/admin/notifications', label: 'اعلان‌ها', permission: '', icon: 'M6 9a6 6 0 1 1 12 0v3l2 4H4l2-4zM10 20a2 2 0 0 0 4 0' },
  { to: '/admin/print', label: 'صف چاپ', permission: 'orders.read', icon: 'M7 8V4h10v4M7 16h10v4H7zM5 8h14a2 2 0 0 1 2 2v6H3v-6a2 2 0 0 1 2-2z' },
  { to: '/admin/reports', label: 'گزارش‌ها', permission: 'reports.read', icon: 'M5 19V9m5 10V5m5 14v-7m5 7V8' },
  { to: '/admin/inventory', label: 'انبار', permission: 'inventory.read', module: 'inventory', icon: 'M4 8l8-4 8 4v9l-8 4-8-4zM4 8l8 4 8-4M12 12v9' },
  { to: '/admin/cash', label: 'جلسات صندوق', permission: 'finance.read', module: 'finance', icon: 'M4 7h16v10H4zM8 11h3M8 14h6' },
  { to: '/admin/finance', label: 'مالی و سود و زیان', permission: 'finance.read', module: 'finance', icon: 'M5 19V9m5 10V5m5 14v-7m5 7V8M3 19h18' },
  { to: '/admin/employees', label: 'شیفت و عملکرد', permission: 'shifts.read', module: 'employees', icon: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z' },
  { to: '/admin/messages', label: 'مرکز پیام', permission: 'messages.read', module: 'notifications', icon: 'M4 6h16v10H8l-4 4V6zM8 10h8M8 13h5' },
  { to: '/admin/customers', label: 'مشتریان', permission: 'crm.read', module: 'crm', icon: 'M17 19v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 8v6M17 11h6' },
  { to: '/admin/modules', label: 'ماژول‌ها', permission: 'modules.read', icon: 'M4 7h16M4 12h16M4 17h10' },
  { to: '/admin/staff', label: 'کارکنان و نقش‌ها', permission: 'users.read', icon: 'M16 19v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  { to: '/admin/approvals', label: 'صف تأیید', permission: 'approvals.read', icon: 'M9 12l2 2 4-4M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z' },
  { to: '/admin/audit', label: 'گزارش رویدادها', permission: 'audit.read', icon: 'M5 5h14v14H5zM9 9h6M9 13h6M9 17h3' },
  { to: '/admin/settings', label: 'تنظیمات و برند', permission: 'settings.read', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12h1.5M3.5 12H5m7-8.5V5m0 14v1.5M17 7l1-1M6 18l1-1m10 0l1 1M6 6l1 1' },
];

function Icon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0"
    >
      <path d={path} />
    </svg>
  );
}

export function AdminLayout() {
  const { user, logout, hasPermission, isModuleEnabled } = useAuth();
  const navigate = useNavigate();
  const { nameFa: brandName } = useBranding();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const items = NAV_ITEMS.filter(
    (item) =>
      (!item.permission || hasPermission(item.permission)) && (!item.module || isModuleEnabled(item.module)),
  );

  const onLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/staff/login', { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  const sidebar = (
    <nav aria-label="ناوبری اصلی" className="flex h-full flex-col gap-1 p-3.5">
      <div className="mb-4 flex shrink-0 items-center gap-2.5 px-2 py-1">
        <span className="flex size-10 items-center justify-center rounded-full border border-brand-300/30 bg-brand-500/15 text-cream">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-5">
            <path d="M5 9h11a4 4 0 0 1 0 8h-1v2H8v-2H5z" strokeLinejoin="round" />
            <path d="M8 5c0 1.5 1 1.5 1 3M12 5c0 1.5 1 1.5 1 3" strokeLinecap="round" />
          </svg>
        </span>
        <div className="leading-tight">
          <p className="font-display text-lg font-bold text-cream">{brandName}</p>
          <p className="text-[10px] text-cream/50">مدیریت کافه و رستوران</p>
        </div>
      </div>

      {/* The menu is longer than a laptop screen, so the list scrolls on its
          own: the last entries (تنظیمات, where the café name/logo live) stay
          reachable while the brand header and the footer stay in place. */}
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-1 pb-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex shrink-0 items-center gap-2.5 rounded-full px-3.5 py-2.5 text-xs font-medium',
                isActive
                  ? 'bg-brand-500 text-cream shadow-[0_10px_24px_-16px_rgba(0,0,0,0.9)]'
                  : 'text-cream/65 hover:bg-white/5 hover:text-cream',
              )
            }
          >
            <Icon path={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </div>

      <div className="mt-3 shrink-0 rounded-2xl border border-white/10 bg-white/5 p-3.5 text-[10px] leading-5 text-cream/55">
        <p className="font-semibold text-cream/85">نسخه ۰.۲.۴</p>
        <p>وضعیت میز، سفارش‌های قبلی و اعلان مرحله‌ای تیم.</p>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto flex max-w-[1600px]">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-e border-white/10 bg-espresso lg:block print:hidden">
          {sidebar}
        </aside>

        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-ink/40" onClick={() => setMobileOpen(false)} aria-hidden />
            <aside className="absolute inset-y-0 start-0 w-64 border-e border-white/10 bg-espresso">{sidebar}</aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur print:hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileOpen((value) => !value)}
                  className="rounded-lg border border-line p-2 text-muted lg:hidden"
                  aria-label="نمایش منو"
                  aria-expanded={mobileOpen}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
                  </svg>
                </button>
                <div className="leading-tight">
                  <p className="text-xs font-semibold text-ink">{user?.fullName ?? 'کاربر'}</p>
                  <p className="text-[10px] text-muted">{user?.roles?.join('، ') ?? ''}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <NotificationBell />
                <Button size="sm" variant="ghost" onClick={() => navigate('/admin/security')}>
                  امنیت
                </Button>
                <Button size="sm" variant="ghost" onClick={() => navigate('/staff/password')}>
                  تغییر گذرواژه
                </Button>
                <Button size="sm" variant="outline" onClick={onLogout} loading={loggingOut}>
                  خروج
                </Button>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 print:p-0">
            <Outlet />
          </main>

          <footer className="space-y-4 border-t border-line px-4 py-5 text-center text-[10px] text-muted sm:px-6 print:hidden">
            <p>{brandName} — سامانه یکپارچه مدیریت کافه و رستوران</p>
            <DeveloperCredit />
          </footer>
        </div>
      </div>
    </div>
  );
}
