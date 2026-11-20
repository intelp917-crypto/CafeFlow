import { useCallback, useEffect, useState } from 'react';
import { Breadcrumb } from '../lib/branding';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
} from '@cafeflow/ui';
import type { NotificationItem, NotificationsResponse } from '@cafeflow/shared';
import { api, errorMessage } from '../lib/api';
import { relativeTimeFa } from '../lib/format';

const TYPE_LABELS_FA: Record<string, string> = {
  'order.awaiting_payment': 'در انتظار پرداخت',
  'order.ready': 'آماده سرو',
  'order.submitted': 'سفارش جدید',
  'order.cancelled': 'لغو سفارش',
  'service.request': 'درخواست مشتری',
  'terminal.request': 'درخواست کارت‌خوان',
  'payment.refunded': 'بازپرداخت',
};

function typeLabel(type: string): string {
  return TYPE_LABELS_FA[type] ?? type;
}

export function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await api.get<NotificationsResponse>('/notifications');
      setItems(data.items);
      setUnreadCount(data.unreadCount);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => void load(true), 15_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const markRead = async (item: NotificationItem) => {
    if (item.isRead) return;
    setBusy(true);
    try {
      const result = await api.post<{ unreadCount: number }>(`/notifications/${item.id}/read`);
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, isRead: true } : row)));
      setUnreadCount(result.unreadCount);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const markAll = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await api.post('/notifications/read-all');
      setItems((current) => current.map((row) => ({ ...row, isRead: true })));
      setUnreadCount(0);
      setNotice('همه اعلان‌ها خوانده‌شده علامت خوردند.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="اعلان‌ها"
        description="اعلان‌های شخصی و نقش‌محور شما. هر اعلان فقط برای کاربر هدف یا دارندگان نقش مربوط نمایش داده می‌شود."
        breadcrumb={<Breadcrumb page="اعلان‌ها" />}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{unreadCount.toLocaleString('fa-IR')} خوانده‌نشده</span>
            <Button size="sm" variant="outline" loading={busy} disabled={unreadCount === 0} onClick={() => void markAll()}>
              همه خوانده شد
            </Button>
          </div>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        {loading && items.length === 0 ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner size="lg" />
          </div>
        ) : error && items.length === 0 ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <EmptyState title="اعلانی ندارید" description="هنگام رسیدن سفارش به مرحله پرداخت یا آماده سرو، اعلان اینجا ظاهر می‌شود." />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void markRead(item)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-canvas ${
                    item.isRead ? 'opacity-70' : ''
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${item.isRead ? 'bg-line' : 'bg-brand-500'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-ink">{item.titleFa}</span>
                      <Badge tone={item.isRead ? 'neutral' : 'brand'}>{typeLabel(item.type)}</Badge>
                    </span>
                    {item.bodyFa ? <span className="mt-1 block text-[11px] leading-5 text-muted">{item.bodyFa}</span> : null}
                    <span className="mt-1 block text-[10px] text-muted">{relativeTimeFa(item.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
