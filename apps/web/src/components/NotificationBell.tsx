import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NotificationItem } from '@cafeflow/shared';
import { Button, cn } from '@cafeflow/ui';
import { relativeTimeFa } from '../lib/format';
import { useNotifications } from '../lib/notifications';

/**
 * Header bell for the staff panel: the newest unread events, the "read all"
 * action and the per-device notification switch. Notifications arrive from the
 * shared provider, so every page in the panel feeds the same badge.
 */
export function NotificationBell() {
  const {
    staffItems,
    unreadCount,
    deviceEnabled,
    deviceSupported,
    enableDevice,
    disableDevice,
    markRead,
    markAllRead,
    notify,
  } = useNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const unreadItems = staffItems.filter((item) => !item.isRead).slice(0, 6);

  const openItem = async (item: NotificationItem) => {
    setOpen(false);
    await markRead(item);
    navigate('/admin/notifications');
  };

  const toggleDevice = async () => {
    if (busy) return;
    if (deviceEnabled) {
      disableDevice();
      notify({ id: 'device-off', title: 'اعلان موبایلی خاموش شد', tone: 'info' });
      return;
    }
    setBusy(true);
    try {
      const enabled = await enableDevice();
      if (!enabled) {
        notify({
          id: 'device-denied',
          title: 'اعلان موبایلی فعال نشد',
          body: 'مرورگر اجازه نداد. از تنظیمات مرورگر، اعلان این سایت را مجاز کنید.',
          tone: 'warning',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unreadCount > 0 ? `اعلان‌ها، ${unreadCount} خوانده‌نشده` : 'اعلان‌ها'}
        aria-expanded={open}
        className="relative rounded-lg border border-line p-2 text-muted transition-colors hover:bg-canvas hover:text-ink"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-4">
          <path d="M6 9a6 6 0 1 1 12 0v3l2 4H4l2-4zM10 20a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unreadCount > 0 ? (
          <span className="absolute -top-1 -end-1 flex min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[9px] font-bold text-white">
            {unreadCount > 99 ? '۹۹+' : unreadCount.toLocaleString('fa-IR')}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute end-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-surface p-2 shadow-[0_24px_60px_-30px_rgba(41,27,19,0.65)]">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <p className="text-xs font-semibold text-ink">اعلان‌ها</p>
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
              className="text-[10px] text-brand-600 hover:underline disabled:opacity-40"
            >
              همه خوانده شد
            </button>
          </div>

          <div className="scroll-thin max-h-80 overflow-y-auto overscroll-contain">
            {unreadItems.length === 0 ? (
              <p className="px-2 py-6 text-center text-[11px] text-muted">اعلان خوانده‌نشده‌ای ندارید.</p>
            ) : (
              <ul className="divide-y divide-line/70">
                {unreadItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void openItem(item)}
                      className="flex w-full items-start gap-2.5 rounded-xl px-2 py-2.5 text-start transition-colors hover:bg-canvas"
                    >
                      <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-semibold text-ink">{item.titleFa}</span>
                        {item.bodyFa ? (
                          <span className="mt-0.5 block text-[10px] leading-5 text-muted">{item.bodyFa}</span>
                        ) : null}
                        <span className="mt-0.5 block text-[9px] text-muted">{relativeTimeFa(item.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-1 space-y-1 border-t border-line/70 px-2 pt-2">
            <button
              type="button"
              onClick={() => void toggleDevice()}
              disabled={!deviceSupported || busy}
              className="flex w-full items-center justify-between gap-2 rounded-xl px-1.5 py-1.5 text-start text-[10px] leading-5 text-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              <span>
                <span className="block font-semibold text-ink">اعلان موبایلی این دستگاه</span>
                <span>
                  {deviceSupported
                    ? deviceEnabled
                      ? 'روشن — روی همین گوشی یا رایانه نمایش داده می‌شود.'
                      : 'خاموش — با یک لمس فعال کنید.'
                    : 'این مرورگر از اعلان پشتیبانی نمی‌کند.'}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                  deviceEnabled ? 'bg-brand-500' : 'bg-line',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 size-4 rounded-full bg-white transition-all',
                    deviceEnabled ? 'start-0.5' : 'start-4',
                  )}
                />
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/admin/notifications');
              }}
              className="w-full rounded-xl px-1.5 py-1.5 text-center text-[10px] font-medium text-brand-600 hover:bg-canvas"
            >
              مشاهده همه اعلان‌ها
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact opt-in for guest pages: the order status page and the QR menu. It
 * asks for permission on tap (a real user gesture, as browsers require).
 */
export function DeviceNotificationButton({ className }: { className?: string }) {
  const { deviceEnabled, deviceSupported, enableDevice, disableDevice, notify } = useNotifications();
  if (!deviceSupported) return null;

  const onToggle = async () => {
    if (deviceEnabled) {
      disableDevice();
      notify({ id: 'device-off', title: 'اعلان موبایلی خاموش شد', tone: 'info' });
      return;
    }
    const enabled = await enableDevice();
    if (!enabled) {
      notify({
        id: 'device-denied',
        title: 'اعلان موبایلی فعال نشد',
        body: 'برای دریافت اعلان وضعیت سفارش، اجازه اعلان را در مرورگر بدهید.',
        tone: 'warning',
      });
    }
  };

  return (
    <Button
      size="sm"
      variant={deviceEnabled ? 'ghost' : 'outline'}
      className={className}
      onClick={() => void onToggle()}
    >
      {deviceEnabled ? 'اعلان روشن' : 'فعال‌سازی اعلان'}
    </Button>
  );
}
