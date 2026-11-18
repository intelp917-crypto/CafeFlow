import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Textarea,
  type Column,
} from '@cafeflow/ui';
import type { OrderStatus } from '@cafeflow/shared';
import type { StaffOrderDetail, StaffOrderSummary } from '../lib/types';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatCountFa, formatDateTimeFa, formatRial, relativeTimeFa } from '../lib/format';
import { orderStatusFa, orderStatusTone, prepStatusFa, prepStatusTone } from '../lib/labels';

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'همه وضعیت‌ها' },
  { value: 'submitted', label: 'ثبت شده' },
  { value: 'confirmed', label: 'تأیید شده' },
  { value: 'preparing', label: 'در حال آماده‌سازی' },
  { value: 'partially_ready', label: 'بخشی آماده' },
  { value: 'ready', label: 'آماده تحویل' },
  { value: 'served', label: 'سرو شده' },
  { value: 'awaiting_payment', label: 'در انتظار پرداخت' },
  { value: 'cancelled', label: 'لغو شده' },
];

export function OrdersPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('orders.write');
  const canCancel = hasPermission('orders.cancel');

  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [status, setStatus] = useState('');
  const [code, setCode] = useState('');
  const [items, setItems] = useState<StaffOrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [detail, setDetail] = useState<StaffOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saving, setSaving] = useState<OrderStatus | null>(null);
  const [cancelMode, setCancelMode] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({ scope, pageSize: '50' });
        if (status) params.set('status', status);
        if (code.trim()) params.set('q', code.trim());
        const data = await api.get<{ items: StaffOrderSummary[]; total: number }>(`/orders?${params.toString()}`);
        setItems(data.items);
        setTotal(data.total);
        setError(null);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [scope, status, code],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setCancelMode(false);
    setCancelReason('');
    try {
      setDetail(await api.get<StaffOrderDetail>(`/orders/${id}`));
    } catch (caught) {
      setDetailError(errorMessage(caught));
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (id: string) => {
    setDetail(await api.get<StaffOrderDetail>(`/orders/${id}`));
    await load(true);
  };

  const applyTransition = async (to: OrderStatus) => {
    if (!detail) return;
    if (to === 'cancelled' && !canCancel) return;
    if (to === 'cancelled' && cancelReason.trim().length === 0) {
      setCancelMode(true);
      return;
    }

    setSaving(to);
    setNotice(null);
    try {
      const updated = await api.post<StaffOrderDetail>(`/orders/${detail.id}/transition`, {
        to,
        reason: to === 'cancelled' ? cancelReason.trim() : undefined,
      });
      setDetail(updated);
      setCancelMode(false);
      setCancelReason('');
      setNotice(`وضعیت سفارش به «${updated.statusLabelFa}» تغییر کرد.`);
      await load(true);
    } catch (caught) {
      setDetailError(errorMessage(caught));
    } finally {
      setSaving(null);
    }
  };

  const columns: Column<StaffOrderSummary>[] = [
    { key: 'code', header: 'کد', render: (row) => <span className="num font-medium">{row.code}</span> },
    { key: 'table', header: 'میز', render: (row) => row.tableNameFa ?? '—' },
    {
      key: 'status',
      header: 'وضعیت',
      render: (row) => <Badge tone={orderStatusTone(row.status)}>{orderStatusFa(row.status)}</Badge>,
    },
    {
      key: 'prep',
      header: 'آماده‌سازی',
      render: (row) => (
        <span className="num text-[11px] text-muted">
          {formatCountFa(row.prep.ready)}/{formatCountFa(row.prep.total)}
          {row.isDelayed ? <span className="ms-1 text-danger-700">تأخیر</span> : null}
        </span>
      ),
    },
    { key: 'items', header: 'اقلام', render: (row) => <span className="num">{formatCountFa(row.itemCount)}</span> },
    { key: 'total', header: 'مبلغ', align: 'end', render: (row) => <span className="num">{formatRial(row.total)}</span> },
    { key: 'time', header: 'زمان', render: (row) => <span className="text-muted">{relativeTimeFa(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (row) => (
        <Button size="sm" variant="outline" onClick={() => void openDetail(row.id)}>
          جزئیات
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="سفارش‌ها"
        description="صف سفارش‌های فعال، آماده‌سازی هر آیتم و تغییر وضعیت با همان ماشین وضعیت سمت سرور."
        breadcrumb="کافه‌فلو / سفارش‌ها"
        actions={
          <span className="text-xs text-muted">
            {loading ? <Spinner size="sm" /> : null} {formatCountFa(total)} سفارش
          </span>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-1 rounded-xl border border-line p-1">
            <button
              type="button"
              onClick={() => setScope('active')}
              className={`rounded-lg px-3 py-1.5 text-[11px] ${scope === 'active' ? 'bg-brand-500 text-white' : 'text-muted'}`}
            >
              فعال
            </button>
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`rounded-lg px-3 py-1.5 text-[11px] ${scope === 'all' ? 'bg-brand-500 text-white' : 'text-muted'}`}
            >
              همه
            </button>
          </div>

          <label className="text-[11px] text-muted">
            وضعیت
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="mt-1 block rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink"
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="min-w-40 flex-1">
            <Field label="جست‌وجوی کد سفارش">
              <Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="CF-…" dir="ltr" />
            </Field>
          </div>

          <Button size="sm" variant="outline" onClick={() => void load()}>
            به‌روزرسانی
          </Button>
        </CardBody>
      </Card>

      <Card>
        {loading && items.length === 0 ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner size="lg" />
          </div>
        ) : error && items.length === 0 ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="سفارشی در این صف نیست"
                description="سفارش‌هایی که مشتری از روی QR ثبت می‌کند اینجا ظاهر می‌شوند. این صفحه هر ۱۰ ثانیه خودکار به‌روزرسانی می‌شود."
              />
            }
          />
        )}
      </Card>

      <Modal
        open={detailLoading || detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `سفارش ${detail.code}` : 'در حال دریافت سفارش'}
        description={detail ? `${detail.tableNameFa ?? 'بدون میز'} — ${formatDateTimeFa(detail.createdAt)}` : undefined}
        footer={
          detail && canWrite ? (
            <div className="flex flex-wrap justify-end gap-1.5">
              {detail.allowedTransitions
                .filter((entry) => entry.status !== 'cancelled' || canCancel)
                .map((entry) => (
                  <Button
                    key={entry.status}
                    size="sm"
                    variant={entry.status === 'cancelled' ? 'ghost' : 'primary'}
                    loading={saving === entry.status}
                    disabled={saving !== null}
                    onClick={() => void applyTransition(entry.status)}
                  >
                    {entry.labelFa}
                  </Button>
                ))}
            </div>
          ) : (
            <span className="text-[11px] text-muted">برای تغییر وضعیت، مجوز «orders.write» لازم است.</span>
          )
        }
      >
        {detailLoading ? (
          <div className="flex justify-center py-10 text-brand-600">
            <Spinner size="lg" />
          </div>
        ) : detail ? (
          <div className="space-y-4">
            {detailError ? <Alert tone="danger">{detailError}</Alert> : null}

            <div className="flex items-center gap-2">
              <Badge tone={orderStatusTone(detail.status)}>{detail.statusLabelFa}</Badge>
              {detail.isDelayed ? <Badge tone="danger">تأخیر در آماده‌سازی</Badge> : null}
              {detail.note ? <span className="text-[11px] text-muted">«{detail.note}»</span> : null}
            </div>

            <div className="space-y-2">
              {detail.items.map((item) => (
                <div key={item.id} className="rounded-xl border border-line/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-ink">
                        {item.productNameFa} <span className="num text-muted">× {formatCountFa(item.quantity)}</span>
                      </p>
                      {item.options.length > 0 ? (
                        <p className="text-[10px] text-muted">گزینه‌ها: {item.options.join('، ')}</p>
                      ) : null}
                      {item.extras.length > 0 ? (
                        <p className="text-[10px] text-muted">افزودنی‌ها: {item.extras.join('، ')}</p>
                      ) : null}
                      {item.note ? <p className="text-[10px] text-muted">«{item.note}»</p> : null}
                      <p className="mt-1 text-[10px] text-muted">
                        دپارتمان: {item.departmentNameFa ?? '—'} {item.targetMinutes ? `— هدف ${formatCountFa(item.targetMinutes)} دقیقه` : ''}
                      </p>
                    </div>
                    <div className="text-end">
                      <p className="num text-xs">{formatRial(item.total)}</p>
                      <Badge tone={prepStatusTone(item.prepStatus ?? 'queued')}>
                        {item.prepStatus ? prepStatusFa(item.prepStatus) : 'بدون صف'}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <dl className="space-y-1 border-t border-line pt-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted">جمع اقلام</dt>
                <dd className="num">{formatRial(detail.subtotal)}</dd>
              </div>
              {detail.serviceCharge > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted">حق سرویس</dt>
                  <dd className="num">{formatRial(detail.serviceCharge)}</dd>
                </div>
              ) : null}
              {detail.taxTotal > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted">مالیات</dt>
                  <dd className="num">{formatRial(detail.taxTotal)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between text-sm font-semibold">
                <dt>مبلغ کل</dt>
                <dd className="num">{formatRial(detail.total)}</dd>
              </div>
            </dl>

            {detail.cancelReason ? (
              <Alert tone="danger" title="دلیل لغو">
                {detail.cancelReason}
              </Alert>
            ) : null}

            {cancelMode ? (
              <Field label="دلیل لغو (الزامی)" hint="در تاریخچه سفارش و گزارش حسابرسی ثبت می‌شود.">
                <Textarea
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  placeholder="مثال: مشتری منصرف شد"
                />
              </Field>
            ) : null}

            <div>
              <p className="mb-2 text-[11px] font-semibold text-ink">تاریخچه وضعیت</p>
              <ol className="space-y-1.5">
                {detail.events.slice(-8).map((event) => (
                  <li key={event.id} className="flex items-center justify-between gap-2 text-[10px] text-muted">
                    <span>
                      {event.fromStatus ? `${orderStatusFa(event.fromStatus)} → ` : ''}
                      {event.toStatus ? orderStatusFa(event.toStatus) : event.type}
                      {event.actorName ? ` (${event.actorName})` : ''}
                    </span>
                    <span>{relativeTimeFa(event.createdAt)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : null}
      </Modal>

      {detail && !detailLoading ? (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => void refreshDetail(detail.id)}>
            تازه‌سازی جزئیات
          </Button>
        </div>
      ) : null}
    </div>
  );
}
