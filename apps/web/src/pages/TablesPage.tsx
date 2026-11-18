import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
  StatCard,
} from '@cafeflow/ui';
import type { StaffTablesResponse } from '../lib/types';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatCountFa, formatRial, relativeTimeFa } from '../lib/format';
import { tableStatusFa, tableStatusTone } from '../lib/labels';

export function TablesPage() {
  const { hasPermission } = useAuth();
  const canClose = hasPermission('layout.write') || hasPermission('payments.create');

  const [data, setData] = useState<StaffTablesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setData(await api.get<StaffTablesResponse>('/tables'));
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
    const interval = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const closeTable = async (id: string) => {
    setClosingId(id);
    setNotice(null);
    try {
      const result = await api.post<{ code: string; closedOrders: number }>(`/tables/${id}/close`);
      setNotice(`میز ${result.code} بسته شد (${result.closedOrders} سفارش).`);
      setError(null);
      await load(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setClosingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="میزها"
        description="وضعیت زنده هر میز، نشست باز، تعداد سفارش فعال و مبلغ باز. این اعداد از سفارش‌های واقعی خوانده می‌شوند."
        breadcrumb="کافه‌فلو / میزها"
        actions={
          <div className="flex items-center gap-2 text-xs text-muted">
            {loading ? <Spinner size="sm" /> : null}
            <Button size="sm" variant="outline" onClick={() => void load()}>
              به‌روزرسانی
            </Button>
          </div>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {data ? (
        <section aria-label="خلاصه میزها" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="کل میزها" value={formatCountFa(data.summary.total)} hint="میزهای فعال سالن" />
          <StatCard label="اشغال" value={formatCountFa(data.summary.occupied)} hint="نشست باز دارد" tone="brand" />
          <StatCard label="آزاد" value={formatCountFa(data.summary.available)} hint="آماده پذیرش" />
          <StatCard label="رزرو" value={formatCountFa(data.summary.reserved)} hint="رزرو شده" />
        </section>
      ) : null}

      {loading && !data ? (
        <Card className="flex justify-center py-16 text-brand-600">
          <Spinner size="lg" />
        </Card>
      ) : error && !data ? (
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      ) : data && data.items.length === 0 ? (
        <Card>
          <EmptyState title="میز فعالی ثبت نشده است" description="میزها از بخش مدیریت سالن (فاز بعد) اضافه می‌شوند." />
        </Card>
      ) : data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((table) => (
            <Card key={table.id}>
              <CardBody className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">{table.nameFa}</p>
                    <p className="text-[10px] text-muted">
                      <span className="num">{table.code}</span>
                      {table.floorNameFa ? ` — ${table.floorNameFa}` : ''}
                      {table.areaNameFa ? ` / ${table.areaNameFa}` : ''}
                    </p>
                  </div>
                  <Badge tone={tableStatusTone(table.status)}>{tableStatusFa(table.status)}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-xl bg-canvas p-2 text-[10px] text-muted">
                  <span>
                    ظرفیت: <span className="num">{formatCountFa(table.capacity)}</span> نفر
                  </span>
                  <span>
                    سفارش فعال: <span className="num">{formatCountFa(table.activeOrders)}</span>
                  </span>
                  <span>
                    مبلغ باز: <span className="num text-ink">{formatRial(table.openTotal)}</span>
                  </span>
                  <span>
                    درخواست: <span className="num">{formatCountFa(table.pendingRequests)}</span>
                  </span>
                </div>

                <div className="flex items-center justify-between text-[10px] text-muted">
                  <span>{table.waiterName ? `گارسون: ${table.waiterName}` : 'گارسون تعیین نشده'}</span>
                  <span>{table.openedAt ? `نشست: ${relativeTimeFa(table.openedAt)}` : 'نشست باز ندارد'}</span>
                </div>

                {table.pendingRequests > 0 ? <Alert tone="warning">این میز درخواست رسیدگی‌نشده دارد.</Alert> : null}

                {canClose && table.sessionId ? (
                  <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
                    {table.activeOrders === 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={closingId === table.id}
                        disabled={closingId !== null}
                        onClick={() => void closeTable(table.id)}
                      >
                        بستن میز
                      </Button>
                    ) : (
                      <span className="text-[10px] text-muted">برای بستن میز، ابتدا سفارش‌های باز را تسویه کنید.</span>
                    )}
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
