import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { formatRial, type CustomerRequestType, type PublicOrderStatusResponse } from '@cafeflow/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Spinner } from '@cafeflow/ui';
import { errorMessage } from '../lib/api';
import { customerApi, orderTokenFor } from '../lib/customer';
import { formatCountFa, formatDateTimeFa } from '../lib/format';
import { useBranding } from '../lib/branding';
import { CafeLocation } from '../components/customer/CafeLocation';

const CUSTOMER_PATH = [
  'submitted',
  'awaiting_confirmation',
  'confirmed',
  'preparing',
  'partially_ready',
  'ready',
  'served',
  'awaiting_payment',
  'paid',
] as const;

const CUSTOMER_STEP_LABELS: Record<string, string> = {
  submitted: 'ثبت شد',
  awaiting_confirmation: 'در انتظار تأیید',
  confirmed: 'تأیید شد',
  preparing: 'در حال آماده‌سازی',
  partially_ready: 'بخشی آماده',
  ready: 'آماده تحویل',
  served: 'سرو شد',
  awaiting_payment: 'در انتظار پرداخت',
  paid: 'پرداخت شد',
};

const ITEM_STATUS_LABELS: Record<string, string> = {
  pending: 'در انتظار',
  preparing: 'در حال آماده‌سازی',
  ready: 'آماده',
  served: 'سرو شده',
  cancelled: 'لغو شده',
};

const QUICK_REQUESTS: Array<{ type: CustomerRequestType; label: string }> = [
  { type: 'waiter', label: 'گارسون' },
  { type: 'water', label: 'آب' },
  { type: 'tissues', label: 'دستمال' },
  { type: 'bill', label: 'صورتحساب' },
  { type: 'terminal', label: 'کارت‌خوان' },
];

export function OrderStatusPage() {
  const { code } = useParams<{ code: string }>();
  const { nameFa, addressFa, phone, latitude, longitude } = useBranding();
  const [searchParams] = useSearchParams();
  const qrToken = searchParams.get('qr') ?? undefined;

  const [order, setOrder] = useState<PublicOrderStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<CustomerRequestType | null>(null);
  const noticeTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!code) return;
    try {
      const data = await customerApi.orderStatus(code, orderTokenFor(code));
      setOrder(data);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Until realtime lands in phase 3, the customer page polls a lightweight
    // status endpoint; there is no WebSocket pretence here.
    const terminal = order && (order.status === 'paid' || order.status === 'cancelled');
    if (terminal) return;
    const interval = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(interval);
  }, [load, order?.status]);

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
  };

  const sendRequest = async (type: CustomerRequestType) => {
    if (!qrToken || requesting) return;
    setRequesting(type);
    try {
      await customerApi.createRequest({ qrToken, type, orderCode: code });
      showNotice('درخواست شما ثبت شد و به کارکنان اطلاع داده شد.');
    } catch (caught) {
      showNotice(errorMessage(caught));
    } finally {
      setRequesting(null);
    }
  };

  if (loading && !order) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas text-brand-600">
        <Spinner size="lg" label="در حال دریافت وضعیت سفارش…" />
      </main>
    );
  }

  if (!order) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <Card className="w-full max-w-md p-6 text-center">
          <p className="text-sm font-semibold text-danger-700">سفارش پیدا نشد</p>
          <p className="mt-2 text-xs text-muted">{error ?? 'کد سفارش نامعتبر است.'}</p>
          <Link to="/menu" className="mt-4 inline-block text-xs text-brand-600 hover:underline">
            بازگشت به منو
          </Link>
        </Card>
      </main>
    );
  }

  const currentIndex = CUSTOMER_PATH.indexOf(order.status as (typeof CUSTOMER_PATH)[number]);
  const cancelled = order.status === 'cancelled';

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <p className="text-[10px] text-muted">کد سفارش</p>
            <p className="num text-sm font-bold text-ink" dir="ltr">
              {order.code}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {order.tableNameFa ? <Badge tone="brand">{order.tableNameFa}</Badge> : null}
            {qrToken && ['submitted', 'confirmed', 'preparing'].includes(order.status) ? (
              <Link
                to={`/menu/${qrToken}?order=${order.code}`}
                className="text-[11px] font-medium text-brand-700 hover:underline"
              >
                افزودن سفارش
              </Link>
            ) : null}
            <Link to={qrToken ? `/menu/${qrToken}` : '/menu'} className="text-[11px] text-brand-600 hover:underline">
              منو
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5 sm:px-6">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {!qrToken ? (
          <Alert tone="info">
            برای ارسال درخواست به گارسون، صفحه را از روی QR میز باز کنید.
          </Alert>
        ) : null}

        <Card>
          <CardHeader
            title="وضعیت سفارش"
            description={`ثبت شده در ${formatDateTimeFa(order.createdAt)}`}
            action={<Badge tone={cancelled ? 'danger' : order.status === 'paid' ? 'success' : 'brand'}>{CUSTOMER_STEP_LABELS[order.status] ?? order.status}</Badge>}
          />
          <CardBody>
            {cancelled ? (
              <Alert tone="danger" title="این سفارش لغو شده است">
                {order.cancelReason ?? 'برای اطلاعات بیشتر با کارکنان صحبت کنید.'}
              </Alert>
            ) : (
              <ol className="space-y-2">
                {CUSTOMER_PATH.filter((step) => step !== 'awaiting_confirmation' || order.status === step).map(
                  (step, index) => {
                    const reached = currentIndex >= CUSTOMER_PATH.indexOf(step);
                    return (
                      <li key={step} className="flex items-center gap-3">
                        <span
                          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            reached ? 'bg-brand-500 text-white' : 'bg-canvas text-muted'
                          }`}
                        >
                          {reached ? '✓' : formatCountFa(index + 1)}
                        </span>
                        <span className={`text-xs ${reached ? 'font-medium text-ink' : 'text-muted'}`}>
                          {CUSTOMER_STEP_LABELS[step]}
                        </span>
                      </li>
                    );
                  },
                )}
              </ol>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="اقلام سفارش" description={`${formatCountFa(order.items.length)} نوع آیتم`} />
          <CardBody className="space-y-2">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-2 border-b border-line/60 pb-2 last:border-0 last:pb-0">
                <div>
                  <p className="text-xs font-medium text-ink">
                    {item.nameFa} <span className="num text-muted">× {formatCountFa(item.quantity)}</span>
                  </p>
                  {item.note ? <p className="text-[10px] text-muted">«{item.note}»</p> : null}
                </div>
                <div className="text-end">
                  <p className="num text-xs">{formatRial(item.total)}</p>
                  <p className="text-[10px] text-muted">{ITEM_STATUS_LABELS[item.status] ?? item.status}</p>
                </div>
              </div>
            ))}

            <dl className="space-y-1 border-t border-line pt-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted">جمع اقلام</dt>
                <dd className="num">{formatRial(order.subtotal)}</dd>
              </div>
              {order.serviceCharge > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted">حق سرویس</dt>
                  <dd className="num">{formatRial(order.serviceCharge)}</dd>
                </div>
              ) : null}
              {order.taxTotal > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted">مالیات</dt>
                  <dd className="num">{formatRial(order.taxTotal)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-line pt-2 text-sm font-semibold">
                <dt>مبلغ کل</dt>
                <dd className="num">{formatRial(order.total)}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        {qrToken && !cancelled ? (
          <Card>
            <CardHeader title="درخواست از کارکنان" description="با یک لمس، درخواست شما به میزتان ارسال می‌شود." />
            <CardBody className="flex flex-wrap gap-2">
              {QUICK_REQUESTS.map((request) => (
                <Button
                  key={request.type}
                  size="sm"
                  variant="outline"
                  loading={requesting === request.type}
                  disabled={requesting !== null}
                  onClick={() => void sendRequest(request.type)}
                >
                  {request.label}
                </Button>
              ))}
            </CardBody>
          </Card>
        ) : null}

        <CafeLocation
          variant="bar"
          nameFa={nameFa}
          addressFa={addressFa}
          phone={phone}
          latitude={latitude}
          longitude={longitude}
        />

        <p className="pb-6 text-center text-[10px] text-muted">
          وضعیت این صفحه هر ۱۵ ثانیه به‌روزرسانی می‌شود.
        </p>
      </main>
    </div>
  );
}
