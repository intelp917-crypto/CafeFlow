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
  type Column,
} from '@cafeflow/ui';
import {
  PAYMENT_METHOD_LABELS_FA,
  type OrderPaymentsResponse,
  type PaymentMethod,
} from '@cafeflow/shared';
import type { StaffOrderSummary } from '../lib/types';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatCountFa, formatDateTimeFa, formatRial } from '../lib/format';
import { orderStatusFa, orderStatusTone } from '../lib/labels';

const METHODS: PaymentMethod[] = ['cash', 'card', 'online'];

/** Accepts Persian/Arabic digits and strips grouping characters. */
function parseAmount(value: string): number {
  const latin = value
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[^\d]/g, '');
  return latin.length === 0 ? 0 : Number(latin);
}

export function CashierPage() {
  const { hasPermission } = useAuth();
  const canRefund = hasPermission('payments.refund');
  const canPrint = hasPermission('orders.read');

  const [orders, setOrders] = useState<StaffOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selected, setSelected] = useState<StaffOrderSummary | null>(null);
  const [summary, setSummary] = useState<OrderPaymentsResponse | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [discountAmount, setDiscountAmount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discountSaving, setDiscountSaving] = useState(false);
  const [discountError, setDiscountError] = useState<string | null>(null);

  const [paidOrders, setPaidOrders] = useState<StaffOrderSummary[]>([]);
  const [refundTarget, setRefundTarget] = useState<StaffOrderSummary | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash');
  const [refundSaving, setRefundSaving] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await api.get<{ items: StaffOrderSummary[] }>(
        '/orders?scope=active&status=served,awaiting_payment&pageSize=50',
      );
      setOrders(data.items);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadPaid = useCallback(async () => {
    if (!canRefund) return;
    try {
      const data = await api.get<{ items: StaffOrderSummary[] }>('/orders?status=paid&pageSize=20');
      setPaidOrders(data.items);
    } catch {
      // The refund list is secondary; the settlement queue already reports errors.
    }
  }, [canRefund]);

  useEffect(() => {
    void load();
    void loadPaid();
  }, [load, loadPaid]);

  useEffect(() => {
    const interval = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const openSettlement = async (order: StaffOrderSummary) => {
    setSelected(order);
    setSummary(null);
    setModalError(null);
    setNotice(null);
    setMethod('cash');
    setReference('');
    setDiscountAmount('');
    setDiscountReason('');
    setDiscountError(null);
    setAmount(String(Math.max(order.total - order.paidTotal, 0)));
    setLoadingSummary(true);
    try {
      const data = await api.get<OrderPaymentsResponse>(`/orders/${order.id}/payments`);
      setSummary(data);
      setAmount(String(data.remaining));
    } catch (caught) {
      setModalError(errorMessage(caught));
    } finally {
      setLoadingSummary(false);
    }
  };

  const submit = async () => {
    if (!selected || saving) return;
    const value = parseAmount(amount);

    if (value <= 0) {
      setModalError('مبلغ پرداخت باید بیشتر از صفر باشد.');
      return;
    }

    setSaving(true);
    setModalError(null);
    try {
      const result = await api.post<OrderPaymentsResponse>(`/orders/${selected.id}/payments`, {
        method,
        amount: value,
        reference: reference.trim() || undefined,
      });
      setSummary(result);
      setAmount(String(result.remaining));
      setReference('');
      setNotice(
        result.status === 'paid'
          ? `سفارش ${result.code} کامل تسویه شد.`
          : `پرداخت ثبت شد؛ مانده سفارش ${result.code}: ${formatRial(result.remaining)}`,
      );
      await load(true);
    } catch (caught) {
      setModalError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const applyDiscount = async () => {
    if (!selected || discountSaving) return;
    const value = parseAmount(discountAmount);
    if (value <= 0) {
      setDiscountError('مبلغ تخفیف باید بیشتر از صفر باشد.');
      return;
    }
    if (discountReason.trim().length < 3) {
      setDiscountError('دلیل تخفیف را بنویسید (حداقل ۳ نویسه).');
      return;
    }

    setDiscountSaving(true);
    setDiscountError(null);
    try {
      const result = await api.post<OrderPaymentsResponse>(`/orders/${selected.id}/discount`, {
        amount: value,
        reason: discountReason.trim(),
      });
      setSummary(result);
      setAmount(String(result.remaining));
      setDiscountAmount('');
      setDiscountReason('');
      setNotice(`تخفیف سفارش ${result.code} ثبت شد؛ مبلغ کل ${formatRial(result.total)}`);
      await load(true);
      await loadPaid();
    } catch (caught) {
      setDiscountError(errorMessage(caught));
    } finally {
      setDiscountSaving(false);
    }
  };

  const openRefund = (order: StaffOrderSummary) => {
    setRefundTarget(order);
    setRefundAmount(String(Math.max(order.paidTotal, 0)));
    setRefundReason('');
    setRefundMethod('cash');
    setRefundError(null);
  };

  const submitRefund = async () => {
    if (!refundTarget || refundSaving) return;
    const value = parseAmount(refundAmount);
    if (value <= 0) {
      setRefundError('مبلغ بازپرداخت باید بیشتر از صفر باشد.');
      return;
    }
    if (refundReason.trim().length < 3) {
      setRefundError('دلیل بازپرداخت را بنویسید (حداقل ۳ نویسه).');
      return;
    }

    setRefundSaving(true);
    setRefundError(null);
    try {
      const result = await api.post<{ paidTotal: number; remaining: number }>(`/orders/${refundTarget.id}/refunds`, {
        amount: value,
        reason: refundReason.trim(),
        method: refundMethod,
      });
      setNotice(
        `بازپرداخت ${formatRial(value)} برای سفارش ${refundTarget.code} ثبت شد؛ مانده پرداخت ${formatRial(result.remaining)}`,
      );
      setRefundTarget(null);
      await load(true);
      await loadPaid();
    } catch (caught) {
      setRefundError(errorMessage(caught));
    } finally {
      setRefundSaving(false);
    }
  };

  const printReceipt = async (order: StaffOrderSummary) => {
    try {
      const result = await api.post<{ existed: boolean }>(`/orders/${order.id}/receipt`);
      setNotice(
        result.existed
          ? `رسید سفارش ${order.code} قبلاً در صف چاپ است.`
          : `رسید سفارش ${order.code} در صف چاپ قرار گرفت.`,
      );
    } catch (caught) {
      setError(errorMessage(caught));
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
    { key: 'total', header: 'مبلغ کل', align: 'end', render: (row) => <span className="num">{formatRial(row.total)}</span> },
    {
      key: 'paid',
      header: 'پرداخت‌شده',
      align: 'end',
      render: (row) => <span className="num text-muted">{formatRial(row.paidTotal)}</span>,
    },
    {
      key: 'remaining',
      header: 'مانده',
      align: 'end',
      render: (row) => (
        <span className="num font-semibold text-brand-700">{formatRial(Math.max(row.total - row.paidTotal, 0))}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (row) => (
        <Button size="sm" onClick={() => void openSettlement(row)}>
          ثبت پرداخت
        </Button>
      ),
    },
  ];

  const paidColumns: Column<StaffOrderSummary>[] = [
    { key: 'code', header: 'کد', render: (row) => <span className="num font-medium">{row.code}</span> },
    { key: 'table', header: 'میز', render: (row) => row.tableNameFa ?? '—' },
    { key: 'total', header: 'مبلغ کل', align: 'end', render: (row) => <span className="num">{formatRial(row.total)}</span> },
    {
      key: 'paid',
      header: 'پرداخت‌شده',
      align: 'end',
      render: (row) => <span className="num text-muted">{formatRial(row.paidTotal)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (row) => (
        <div className="flex justify-end gap-1.5">
          {canPrint ? (
            <Button size="sm" variant="ghost" onClick={() => void printReceipt(row)}>
              رسید
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => openRefund(row)}>
            بازپرداخت
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="صندوق"
        description="تسویه سفارش‌های سروشده. مبلغ نهایی از پایگاه داده خوانده می‌شود؛ پرداخت جزئی مجاز است و سفارش فقط با رسیدن مجموع پرداخت‌ها به مبلغ کل «پرداخت شده» می‌شود."
        breadcrumb="کافه‌فلو / صندوق"
        actions={
          <span className="text-xs text-muted">
            {loading ? <Spinner size="sm" /> : null} {formatCountFa(orders.length)} سفارش قابل تسویه
          </span>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        {loading && orders.length === 0 ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner size="lg" />
          </div>
        ) : error && orders.length === 0 ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <DataTable
            columns={columns}
            rows={orders}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="سفارش قابل تسویه‌ای نیست"
                description="سفارش پس از «سرو شد» به این صف می‌آید. سفارش‌های در حال آماده‌سازی قابل تسویه نیستند."
              />
            }
          />
        )}
      </Card>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `تسویه سفارش ${selected.code}` : 'تسویه'}
        description={selected ? `${selected.tableNameFa ?? 'بدون میز'} — مبلغ کل ${formatRial(selected.total)}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              بستن
            </Button>
            {canPrint && selected ? (
              <Button variant="outline" onClick={() => void printReceipt(selected)}>
                چاپ رسید
              </Button>
            ) : null}
            <Button loading={saving} disabled={summary?.remaining === 0} onClick={() => void submit()}>
              ثبت پرداخت
            </Button>
          </>
        }
      >
        {loadingSummary ? (
          <div className="flex justify-center py-8 text-brand-600">
            <Spinner size="lg" />
          </div>
        ) : summary ? (
          <div className="space-y-4">
            {modalError ? <Alert tone="danger">{modalError}</Alert> : null}

            <dl className="space-y-1 rounded-xl bg-canvas p-3 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted">مبلغ کل</dt>
                <dd className="num">{formatRial(summary.total)}</dd>
              </div>
              {summary.discountTotal > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted">تخفیف</dt>
                  <dd className="num text-brand-700">{formatRial(summary.discountTotal)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-muted">پرداخت‌شده</dt>
                <dd className="num">{formatRial(summary.paidTotal)}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-1 font-semibold">
                <dt>مانده</dt>
                <dd className="num">{formatRial(summary.remaining)}</dd>
              </div>
              {summary.bill ? (
                <div className="flex justify-between text-[10px] text-muted">
                  <dt>صورتحساب</dt>
                  <dd>{summary.bill.status === 'settled' ? 'تسویه شده' : 'باز'}</dd>
                </div>
              ) : null}
            </dl>

            <div className="space-y-2 rounded-xl border border-dashed border-line p-3">
              <p className="text-[11px] font-semibold text-ink">اعمال تخفیف</p>
              <p className="text-[10px] leading-5 text-muted">
                تخفیف فقط قبل از ثبت پرداخت امکان‌پذیر است. تخفیف بیش از ۲۰٪ جمع اقلام نیازمند تأیید مدیر است.
              </p>
              {discountError ? <Alert tone="danger">{discountError}</Alert> : null}
              <div className="flex flex-wrap items-end gap-2">
                <Field label="مبلغ تخفیف (ریال)">
                  <Input
                    value={discountAmount}
                    onChange={(event) => setDiscountAmount(event.target.value)}
                    inputMode="numeric"
                    dir="ltr"
                    placeholder="0"
                  />
                </Field>
                <Field label="دلیل تخفیف">
                  <Input
                    value={discountReason}
                    onChange={(event) => setDiscountReason(event.target.value)}
                    placeholder="مثلاً مشتری ثابت"
                  />
                </Field>
                <Button size="sm" variant="outline" loading={discountSaving} onClick={() => void applyDiscount()}>
                  ثبت تخفیف
                </Button>
              </div>
            </div>

            {summary.remaining > 0 ? (
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-[11px] text-muted">روش پرداخت</p>
                  <div className="flex flex-wrap gap-1.5">
                    {METHODS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setMethod(option)}
                        className={`rounded-xl border px-3 py-1.5 text-[11px] ${
                          method === option
                            ? 'border-brand-500 bg-brand-50 text-brand-700'
                            : 'border-line bg-surface text-muted'
                        }`}
                      >
                        {PAYMENT_METHOD_LABELS_FA[option]}
                      </button>
                    ))}
                  </div>
                </div>

                <Field label="مبلغ (ریال)" hint="پرداخت جزئی مجاز است؛ مقدار پیش‌فرض کل مانده است.">
                  <Input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="numeric"
                    dir="ltr"
                  />
                </Field>

                <Field label="شماره پیگیری (اختیاری)">
                  <Input
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    placeholder="TRX-…"
                    dir="ltr"
                  />
                </Field>
              </div>
            ) : (
              <Alert tone="success">این سفارش کامل تسویه شده است.</Alert>
            )}

            {summary.payments.length > 0 ? (
              <div>
                <p className="mb-2 text-[11px] font-semibold text-ink">پرداخت‌های ثبت‌شده</p>
                <ul className="space-y-1.5">
                  {summary.payments.map((payment) => (
                    <li key={payment.id} className="flex items-center justify-between gap-2 text-[10px] text-muted">
                      <span>
                        {payment.methodLabelFa}
                        {payment.receivedByName ? ` — ${payment.receivedByName}` : ''}
                        {payment.reference ? ` — ${payment.reference}` : ''}
                      </span>
                      <span className="num text-ink">{formatRial(payment.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <Alert tone="danger">{modalError ?? 'اطلاعات تسویه دریافت نشد.'}</Alert>
        )}
      </Modal>

      {canRefund ? (
        <Card>
          <CardHeader
            title="بازپرداخت سفارش‌های تسویه‌شده"
            description="آخرین سفارش‌های پرداخت‌شده. بازپرداخت، پرداخت اصلی را حذف نمی‌کند و سفارش را دوباره باز نمی‌کند."
          />
          <DataTable
            columns={paidColumns}
            rows={paidOrders}
            rowKey={(row) => row.id}
            empty={<EmptyState title="سفارش تسویه‌شده‌ای نیست" description="پس از تسویه، سفارش‌ها برای بازپرداخت اینجا دیده می‌شوند." />}
          />
        </Card>
      ) : null}

      <Modal
        open={refundTarget !== null}
        onClose={() => setRefundTarget(null)}
        title={refundTarget ? `بازپرداخت سفارش ${refundTarget.code}` : 'بازپرداخت'}
        description={refundTarget ? `مبلغ کل ${formatRial(refundTarget.total)} — پرداخت‌شده ${formatRial(refundTarget.paidTotal)}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRefundTarget(null)}>
              بستن
            </Button>
            <Button variant="outline" loading={refundSaving} onClick={() => void submitRefund()}>
              ثبت بازپرداخت
            </Button>
          </>
        }
      >
        {refundError ? <Alert tone="danger">{refundError}</Alert> : null}
        <div className="space-y-3">
          <Field label="مبلغ بازپرداخت (ریال)" hint="حداکثر تا مبلغ پرداخت‌شده.">
            <Input value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} inputMode="numeric" dir="ltr" />
          </Field>

          <div>
            <p className="mb-1 text-[11px] text-muted">روش بازپرداخت</p>
            <div className="flex flex-wrap gap-1.5">
              {METHODS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRefundMethod(option)}
                  className={`rounded-xl border px-3 py-1.5 text-[11px] ${
                    refundMethod === option
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-line bg-surface text-muted'
                  }`}
                >
                  {PAYMENT_METHOD_LABELS_FA[option]}
                </button>
              ))}
            </div>
          </div>

          <Field label="دلیل بازپرداخت" hint="دلیل در گزارش رویدادها و رسید ذخیره می‌شود.">
            <Input value={refundReason} onChange={(event) => setRefundReason(event.target.value)} placeholder="مثلاً سفارش اشتباه" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
