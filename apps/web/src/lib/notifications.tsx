import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { NotificationItem, NotificationsResponse } from '@cafeflow/shared';
import { api } from './api';
import { useAuth } from './auth';

/**
 * One notification layer for the whole app:
 *
 *  - in-app toasts in the top-left corner (and above the thumb on phones),
 *  - device notifications (the browser/OS notification centre) for staff and
 *    guests, so a phone that is in a pocket still gets the event,
 *  - a shared unread feed that feeds the staff bell.
 *
 * Device notifications are on-device only: no VAPID keys, no external push
 * service and nothing to configure in env. They use the service worker when it
 * is available (Chrome/Android) and fall back to the plain Notification API.
 * Staff events themselves are produced server-side; this layer only delivers
 * them.
 */

export type NotificationTone = 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface AppNotification {
  /** Stable key: the same id replaces the previous toast instead of stacking. */
  id: string;
  title: string;
  body?: string | null;
  tone?: NotificationTone;
  /** In-app route the toast/bell entry opens. */
  href?: string;
}

interface ToastItem extends AppNotification {
  key: string;
}

interface NotificationsContextValue {
  toasts: ToastItem[];
  staffItems: NotificationItem[];
  unreadCount: number;
  deviceEnabled: boolean;
  deviceSupported: boolean;
  notify: (notification: AppNotification) => void;
  dismiss: (key: string) => void;
  enableDevice: () => Promise<boolean>;
  disableDevice: () => void;
  markRead: (item: NotificationItem) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

const DEVICE_KEY = 'cafeflow:device-notifications';
const SEEN_PREFIX = 'cafeflow:notif-seen:';
const POLL_MS = 12_000;
const TOAST_MS = 7_000;
const SEEN_LIMIT = 300;

/** Server notification types get a matching colour and destination. */
const TYPE_TONES: Record<string, NotificationTone> = {
  'order.submitted': 'brand',
  'order.confirmed': 'brand',
  'order.items_added': 'brand',
  'order.partially_ready': 'success',
  'order.ready': 'success',
  'prep.delayed': 'warning',
  'order.awaiting_payment': 'warning',
  'order.cancelled': 'danger',
  'service.request': 'warning',
  'terminal.request': 'info',
  'payment.refunded': 'info',
};

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function readSeen(userId: string): string[] | null {
  try {
    const raw = localStorage.getItem(`${SEEN_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : null;
  } catch {
    return null;
  }
}

function writeSeen(userId: string, ids: string[]): void {
  try {
    localStorage.setItem(`${SEEN_PREFIX}${userId}`, JSON.stringify(ids.slice(-SEEN_LIMIT)));
  } catch {
    // Storage can be blocked; notifications still work for this page view.
  }
}

/** The service worker is registered after load in production, so wait briefly. */
async function activeServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    return await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
  } catch {
    return null;
  }
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [staffItems, setStaffItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [deviceEnabled, setDeviceEnabled] = useState(() => readFlag(DEVICE_KEY));

  const deviceEnabledRef = useRef(deviceEnabled);
  deviceEnabledRef.current = deviceEnabled;
  const timers = useRef(new Map<string, number>());
  const seenRef = useRef<Set<string>>(new Set());
  const seenUserRef = useRef<string | null>(null);

  const dismiss = useCallback((key: string) => {
    const timer = timers.current.get(key);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(key);
    }
    setToasts((current) => current.filter((toast) => toast.key !== key));
  }, []);

  const showDeviceNotification = useCallback(async (item: AppNotification) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (!deviceEnabledRef.current || Notification.permission !== 'granted') return;
    const options: NotificationOptions = {
      body: item.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: item.id,
      dir: 'rtl',
      lang: 'fa',
      data: { href: item.href ?? '/' },
    };
    try {
      const registration = await activeServiceWorker();
      if (registration?.showNotification) {
        await registration.showNotification(item.title, options);
        return;
      }
      // Desktop browsers without a worker can still raise an OS notification.
      new Notification(item.title, options);
    } catch {
      // Device notifications are an enhancement; a refusal must never break the flow.
    }
  }, []);

  const notify = useCallback(
    (item: AppNotification) => {
      const key = `${item.id}:${Date.now()}`;
      setToasts((current) => [...current.filter((toast) => toast.id !== item.id), { ...item, key }].slice(-4));
      const timer = window.setTimeout(() => dismiss(key), TOAST_MS);
      timers.current.set(key, timer);
      void showDeviceNotification(item);
    },
    [dismiss, showDeviceNotification],
  );

  /* Staff feed: poll the existing notifications API and announce what is new. */
  useEffect(() => {
    if (!user) {
      seenRef.current = new Set();
      seenUserRef.current = null;
      setStaffItems([]);
      setUnreadCount(0);
      return;
    }

    if (seenUserRef.current !== user.id) {
      seenUserRef.current = user.id;
      seenRef.current = new Set(readSeen(user.id) ?? []);
    }

    let active = true;

    const poll = async () => {
      try {
        const data = await api.get<NotificationsResponse>('/notifications');
        if (!active) return;
        setStaffItems(data.items);
        setUnreadCount(data.unreadCount);

        // A device that has never seen the feed starts quiet: only events that
        // arrive from now on are announced, never the old backlog.
        const firstVisit = readSeen(user.id) === null;
        const known = seenRef.current;
        const fresh = data.items.filter((item) => !item.isRead && !known.has(item.id));
        for (const item of data.items) known.add(item.id);
        writeSeen(user.id, [...known]);

        if (!firstVisit) {
          for (const item of fresh.slice(0, 3).reverse()) {
            notify({
              id: `staff:${item.id}`,
              title: item.titleFa,
              body: item.bodyFa,
              tone: TYPE_TONES[item.type] ?? 'brand',
              href: '/admin/notifications',
            });
          }
        }
      } catch {
        // Keep the last snapshot; a failed poll is not worth a toast.
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, notify]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const enableDevice = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;
    try {
      localStorage.setItem(DEVICE_KEY, '1');
    } catch {
      // Not fatal: the setting holds for this tab.
    }
    deviceEnabledRef.current = true;
    setDeviceEnabled(true);
    await activeServiceWorker();
    await showDeviceNotification({
      id: 'welcome',
      title: 'اعلان‌ها فعال شد',
      body: 'از این پس رویدادهای مهم روی همین دستگاه نمایش داده می‌شود.',
    });
    return true;
  }, [showDeviceNotification]);

  const disableDevice = useCallback(() => {
    try {
      localStorage.setItem(DEVICE_KEY, '0');
    } catch {
      // Ignore storage failures.
    }
    deviceEnabledRef.current = false;
    setDeviceEnabled(false);
  }, []);

  const markRead = useCallback(async (item: NotificationItem) => {
    if (item.isRead) return;
    setStaffItems((current) => current.map((row) => (row.id === item.id ? { ...row, isRead: true } : row)));
    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      const result = await api.post<{ unreadCount: number }>(`/notifications/${item.id}/read`);
      setUnreadCount(result.unreadCount);
    } catch {
      // The next poll reconciles the server truth.
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setStaffItems((current) => current.map((row) => ({ ...row, isRead: true })));
    setUnreadCount(0);
    try {
      await api.post('/notifications/read-all');
    } catch {
      // The next poll reconciles the server truth.
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.get<NotificationsResponse>('/notifications');
      setStaffItems(data.items);
      setUnreadCount(data.unreadCount);
    } catch {
      // Keep the last snapshot.
    }
  }, [user]);

  const deviceSupported = typeof window !== 'undefined' && 'Notification' in window;

  const value = useMemo<NotificationsContextValue>(
    () => ({
      toasts,
      staffItems,
      unreadCount,
      deviceEnabled,
      deviceSupported,
      notify,
      dismiss,
      enableDevice,
      disableDevice,
      markRead,
      markAllRead,
      refresh,
    }),
    [
      toasts,
      staffItems,
      unreadCount,
      deviceEnabled,
      deviceSupported,
      notify,
      dismiss,
      enableDevice,
      disableDevice,
      markRead,
      markAllRead,
      refresh,
    ],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <ToastStack
        toasts={toasts}
        onDismiss={dismiss}
        onOpen={(toast) => {
          dismiss(toast.key);
          if (toast.href) navigate(toast.href);
        }}
      />
    </NotificationsContext.Provider>
  );
}

const TONE_CLASS: Record<NotificationTone, string> = {
  brand: 'border-brand-300/60 bg-brand-500/10 text-brand-700',
  success: 'border-success-200 bg-success-50 text-success-700',
  warning: 'border-warning-200 bg-warning-50 text-warning-700',
  danger: 'border-danger-200 bg-danger-50 text-danger-700',
  info: 'border-info-200 bg-info-50 text-info-700',
};

function ToastStack({
  toasts,
  onDismiss,
  onOpen,
}: {
  toasts: ToastItem[];
  onDismiss: (key: string) => void;
  onOpen: (toast: ToastItem) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="اعلان‌های زنده"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-4 z-[70] flex flex-col gap-2 sm:inset-x-auto sm:bottom-auto sm:left-4 sm:top-20 sm:w-[22rem] print:hidden"
    >
      {toasts.map((toast) => (
        <div
          key={toast.key}
          className="toast-in pointer-events-auto overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_20px_45px_-26px_rgba(41,27,19,0.6)]"
        >
          <div className="flex items-start gap-3 p-3.5">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border ${TONE_CLASS[toast.tone ?? 'brand']}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4">
                <path d="M6 9a6 6 0 1 1 12 0v3l2 4H4l2-4zM10 20a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <button type="button" onClick={() => onOpen(toast)} className="min-w-0 flex-1 text-start">
              <span className="block text-xs font-semibold text-ink">{toast.title}</span>
              {toast.body ? (
                <span className="mt-0.5 line-clamp-3 block text-[11px] leading-5 text-muted">{toast.body}</span>
              ) : null}
              {toast.href ? (
                <span className="mt-1 block text-[10px] font-medium text-brand-600">مشاهده</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => onDismiss(toast.key)}
              aria-label="بستن اعلان"
              className="rounded-full p-1 text-muted transition-colors hover:bg-canvas hover:text-ink"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3.5">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications must be used inside NotificationProvider');
  return context;
}
