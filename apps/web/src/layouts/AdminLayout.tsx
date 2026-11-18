import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button, cn } from '@cafeflow/ui';
import { useAuth } from '../lib/auth';

interface NavItem {
  to: string;
  label: string;
  permission: string;
  end?: boolean;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/admin', label: 'داشبورد', permission: 'dashboard.read', end: true, icon: 'M4 13h6V4H4zm10 7h6v-9h-6zM4 20h6v-3H4zm10-13h6V4h-6z' },
  { to: '/admin/orders', label: 'سفارش‌ها', permission: 'orders.read', icon: 'M6 4h12v16H6zM9 8h6M9 12h6M9 16h4' },
  { to: '/admin/prep', label: 'صف آماده‌سازی', permission: 'prep.read', icon: 'M4 7h16M6 7v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7M9 3v4m6-4v4' },
  { to: '/admin/cashier', label: 'صندوق', permission: 'payments.read', icon: 'M4 7h16v10H4zM4 11h16M8 15h3' },
  { to: '/admin/tables', label: 'میزها', permission: 'layout.read', icon: 'M4 10h16M6 10V6h12v4M8 10v6m8-6v6M5 20h14' },
  { to: '/admin/requests', label: 'درخواست‌ها', permission: 'orders.read', icon: 'M12 4a5 5 0 0 1 5 5v3l2 3H5l2-3V9a5 5 0 0 1 5-5zM10 19a2 2 0 0 0 4 0' },
  { to: '/admin/notifications', label: 'اعلان‌ها', permission: '', icon: 'M6 9a6 6 0 1 1 12 0v3l2 4H4l2-4zM10 20a2 2 0 0 0 4 0' },
  { to: '/admin/print', label: 'صف چاپ', permission: 'orders.read', icon: 'M7 8V4h10v4M7 16h10v4H7zM5 8h14a2 2 0 0 1 2 2v6H3v-6a2 2 0 0 1 2-2z' },
  { to: '/admin/reports', label: 'گزارش‌ها', permission: 'reports.read', icon: 'M5 19V9m5 10V5m5 14v-7m5 7V8' },
  { to: '/admin/modules', label: 'ماژول‌ها', permission: 'modules.read', icon: 'M4 7h16M4 12h16M4 17h10' },
  { to: '/admin/staff', label: 'کارکنان و نقش‌ها', permission: 'users.read', icon: 'M16 19v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  { to: '/admin/approvals', label: 'صف تأیید', permission: 'approvals.read', icon: 'M9 12l2 2 4-4M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z' },
  { to: '/admin/audit', label: 'گزارش رویدادها', permission: 'audit.read', icon: 'M5 5h14v14H5zM9 9h6M9 13h6M9 17h3' },
  { to: '/admin/settings', label: 'تنظیمات', permission: 'settings.read', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12h1.5M3.5 12H5m7-8.5V5m0 14v1.5M17 7l1-1M6 18l1-1m10 0l1 1M6 6l1 1' },
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
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const items = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));

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
    <nav aria-label="ناوبری اصلی" className="flex h-full flex-col gap-1 p-3">
      <div className="mb-4 flex items-center gap-2 px-2 py-1">
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand-500 text-white">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-5">
            <path d="M5 9h11a4 4 0 0 1 0 8h-1v2H8v-2H5z" strokeLinejoin="round" />
            <path d="M8 5c0 1.5 1 1.5 1 3M12 5c0 1.5 1 1.5 1 3" strokeLinecap="round" />
          </svg>
        </span>
        <div className="leading-tight">
          <p className="text-sm font-bold text-ink">کافه‌فلو</p>
          <p className="text-[10px] text-muted">مدیریت کافه و رستوران</p>
        </div>
      </div>

      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-colors',
              isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-muted hover:bg-canvas hover:text-ink',
            )
          }
        >
          <Icon path={item.icon} />
          {item.label}
        </NavLink>
      ))}

      <div className="mt-auto rounded-xl border border-line bg-canvas/70 p-3 text-[10px] leading-5 text-muted">
        <p className="font-semibold text-ink">نسخه ۰.۵ — فاز ۵</p>
        <p>رسید و صف چاپ، تخفیف، بازپرداخت، اعلان‌ها و گزارش‌ها.</p>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto flex max-w-[1600px]">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-e border-line bg-surface lg:block">
          {sidebar}
        </aside>

        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-ink/40" onClick={() => setMobileOpen(false)} aria-hidden />
            <aside className="absolute inset-y-0 start-0 w-64 border-e border-line bg-surface">{sidebar}</aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
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
                <Button size="sm" variant="ghost" onClick={() => navigate('/staff/password')}>
                  تغییر گذرواژه
                </Button>
                <Button size="sm" variant="outline" onClick={onLogout} loading={loggingOut}>
                  خروج
                </Button>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </main>

          <footer className="border-t border-line px-4 py-4 text-center text-[10px] text-muted sm:px-6">
            کافه‌فلو — سامانه یکپارچه مدیریت کافه و رستوران
          </footer>
        </div>
      </div>
    </div>
  );
}
