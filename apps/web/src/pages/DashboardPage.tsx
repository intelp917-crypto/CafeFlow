import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
  StatCard,
  type Column,
} from '@cafeflow/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatCountFa, formatRial, relativeTimeFa } from '../lib/format';
import { auditActionFa, orderStatusFa, orderStatusTone } from '../lib/labels';
import type { DashboardOverview } from '../lib/types';

export function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<DashboardOverview>('/dashboard/overview'));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const orderColumns: Column<DashboardOverview['recentOrders'][number]>[] = [
    { key: 'code', header: 'کد سفارش', render: (row) => <span className="num font-medium">{row.code}</span> },
    { key: 'table', header: 'میز', render: (row) => (row.tableCode ? row.tableCode : '—') },
    {
      key: 'status',
      header: 'وضعیت',
      render: (row) => <Badge tone={orderStatusTone(row.status)}>{orderStatusFa(row.status)}</Badge>,
    },
    { key: 'total', header: 'مبلغ', align: 'end', render: (row) => <span className="num">{formatRial(row.total)}</span> },
    { key: 'time', header: 'زمان', render: (row) => <span className="text-muted">{relativeTimeFa(row.createdAt)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="داشبورد عملیات"
        description="نمای زنده فروش، سفارش‌ها، میزها و درخواست‌های مشتری. همه اعداد از پایگاه داده خوانده می‌شوند."
        breadcrumb="کافه‌فلو / داشبورد"
        actions={
          <div className="flex items-center gap-2 text-xs text-muted">
            {loading ? <Spinner size="sm" /> : null}
            <span>
              {data ? `${data.today.weekdayFa} — ${data.today.jalaliLabel}` : 'در حال دریافت تاریخ'}
            </span>
          </div>
        }
      />

      {error ? (
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      ) : loading && !data ? (
        <Card className="flex items-center justify-center py-16 text-brand-600">
          <Spinner size="lg" />
        </Card>
      ) : data ? (
        <>
          <section aria-label="شاخص‌های امروز" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="فروش امروز"
              value={formatRial(data.today.salesTotal)}
              hint={`${formatCountFa(data.today.paymentCount)} تراکنش ثبت شده`}
              tone="brand"
            />
            <StatCard
              label="سفارش‌های فعال"
              value={formatCountFa(data.orders.active)}
              hint={`${formatCountFa(data.orders.preparing)} در آماده‌سازی`}
            />
            <StatCard
              label="میزهای اشغال"
              value={`${formatCountFa(data.tables.occupied)} از ${formatCountFa(data.tables.total)}`}
              hint={`${formatCountFa(data.tables.available)} میز آزاد`}
            />
            <StatCard
              label="درخواست‌های مشتری"
              value={formatCountFa(data.requests.pending)}
              hint="در انتظار رسیدگی"
              tone={data.requests.pending > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="سفارش‌های تأخیری"
              value={formatCountFa(data.orders.delayed)}
              hint="از زمان هدف آماده‌سازی گذشته"
              tone={data.orders.delayed > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="در انتظار پرداخت"
              value={formatCountFa(data.orders.awaitingPayment)}
              hint="سرو شده و تسویه نشده"
            />
            <StatCard
              label="رزروهای پیش‌رو"
              value={formatCountFa(data.reservations.upcoming)}
              hint={`${formatCountFa(data.reservations.pendingApproval)} در انتظار تأیید`}
            />
            <StatCard
              label="منوی فعال"
              value={`${formatCountFa(data.catalog.products)} محصول`}
              hint={`${formatCountFa(data.catalog.categories)} دسته‌بندی`}
            />
          </section>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="آخرین سفارش‌ها" description="۸ سفارش اخیر ثبت‌شده در سیستم" />
              <DataTable
                columns={orderColumns}
                rows={data.recentOrders}
                rowKey={(row) => row.id}
                empty={
                  <EmptyState
                    title="هنوز سفارشی ثبت نشده است"
                    description="با فعال شدن منوی QR در فاز ۲، سفارش‌های مشتری اینجا نمایش داده می‌شوند."
                  />
                }
              />
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader title="روش‌های پرداخت امروز" />
                <CardBody className="space-y-2">
                  {data.paymentsByMethod.length === 0 ? (
                    <p className="text-xs text-muted">امروز پرداختی ثبت نشده است.</p>
                  ) : (
                    data.paymentsByMethod.map((row) => (
                      <div key={row.method} className="flex items-center justify-between text-xs">
                        <span className="text-muted">{row.method}</span>
                        <span className="num font-medium text-ink">{formatRial(row.total)}</span>
                      </div>
                    ))
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="آخرین رویدادهای حساس" />
                <CardBody className="space-y-3">
                  {data.recentActivity.length === 0 ? (
                    <p className="text-xs text-muted">رویدادی ثبت نشده است.</p>
                  ) : (
                    data.recentActivity.map((entry) => (
                      <div key={entry.id} className="space-y-0.5 border-b border-line/60 pb-2 last:border-0 last:pb-0">
                        <p className="text-xs font-medium text-ink">{auditActionFa(entry.action)}</p>
                        <p className="text-[10px] text-muted">
                          {entry.actorUsername ?? 'سیستم'} — {relativeTimeFa(entry.createdAt)}
                        </p>
                      </div>
                    ))
                  )}
                </CardBody>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader
              title="خلاصه وضعیت"
              description={`خوش آمدید ${user?.fullName ?? ''}؛ نقش شما: ${user?.roles?.join('، ') ?? '—'}`}
            />
            <CardBody className="grid gap-3 text-xs sm:grid-cols-3">
              <div className="rounded-xl bg-canvas p-3">
                <p className="text-muted">کارکنان فعال</p>
                <p className="num mt-1 text-base font-semibold text-ink">{formatCountFa(data.staff.activeUsers)}</p>
              </div>
              <div className="rounded-xl bg-canvas p-3">
                <p className="text-muted">میزهای رزرو شده</p>
                <p className="num mt-1 text-base font-semibold text-ink">{formatCountFa(data.tables.reserved)}</p>
              </div>
              <div className="rounded-xl bg-canvas p-3">
                <p className="text-muted">میزهای آزاد</p>
                <p className="num mt-1 text-base font-semibold text-ink">{formatCountFa(data.tables.available)}</p>
              </div>
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
}
