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
} from '@cafeflow/ui';
import type { PrepStatus } from '@cafeflow/shared';
import type { PrepQueueItem } from '../lib/types';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatCountFa } from '../lib/format';
import { prepStatusFa, prepStatusTone } from '../lib/labels';

const TABS: Array<{ key: string; label: string }> = [
  { key: '', label: 'همه دپارتمان‌ها' },
  { key: 'barista', label: 'باریستا' },
  { key: 'kitchen', label: 'آشپزخانه' },
];

function nextActions(status: string): Array<{ to: PrepStatus; label: string }> {
  switch (status) {
    case 'queued':
      return [
        { to: 'in_progress', label: 'شروع آماده‌سازی' },
        { to: 'ready', label: 'آماده شد' },
      ];
    case 'in_progress':
      return [
        { to: 'ready', label: 'آماده شد' },
        { to: 'delayed', label: 'تأخیر' },
      ];
    case 'delayed':
      return [
        { to: 'in_progress', label: 'ادامه' },
        { to: 'ready', label: 'آماده شد' },
      ];
    default:
      return [];
  }
}

export function PrepPage() {
  const { hasPermission } = useAuth();
  const canUpdate = hasPermission('prep.update');

  const [kind, setKind] = useState('');
  const [items, setItems] = useState<PrepQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (kind) params.set('kind', kind);
        const query = params.toString();
        const data = await api.get<{ items: PrepQueueItem[] }>(`/prep/queue${query ? `?${query}` : ''}`);
        setItems(data.items);
        setError(null);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [kind],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => void load(true), 8_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const advance = async (id: string, to: PrepStatus) => {
    setPendingId(id);
    try {
      await api.post(`/prep/${id}/transition`, { to });
      await load(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="صف آماده‌سازی"
        description="هر آیتم سفارش یک وظیفه در دپارتمان خودش است. با شروع و آماده‌شدن آیتم‌ها، وضعیت سفارش به‌صورت خودکار و از مسیر مجاز ماشین وضعیت به‌روزرسانی می‌شود."
        breadcrumb="کافه‌فلو / صف آماده‌سازی"
        actions={
          <span className="text-xs text-muted">
            {loading ? <Spinner size="sm" /> : null} {formatCountFa(items.length)} آیتم در صف
          </span>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setKind(tab.key)}
            className={`rounded-xl border px-3 py-1.5 text-[11px] ${
              kind === tab.key ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line bg-surface text-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <Button size="sm" variant="outline" onClick={() => void load()}>
          به‌روزرسانی
        </Button>
      </div>

      {loading && items.length === 0 ? (
        <Card className="flex justify-center py-16 text-brand-600">
          <Spinner size="lg" />
        </Card>
      ) : error && items.length === 0 ? (
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="صف خالی است"
            description="وقتی سفارش جدیدی ثبت شود، آیتم‌های آن به‌تفکیک دپارتمان اینجا ظاهر می‌شوند. این صفحه هر ۸ ثانیه خودکار به‌روزرسانی می‌شود."
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id} className={item.isDelayed ? 'border-danger-200' : undefined}>
              <CardBody className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-ink">
                      {item.productNameFa} <span className="num text-muted">× {formatCountFa(item.quantity)}</span>
                    </p>
                    <p className="text-[10px] text-muted">
                      {item.tableNameFa ?? 'بدون میز'} — سفارش <span className="num">{item.orderCode}</span>
                    </p>
                  </div>
                  <Badge tone={prepStatusTone(item.status)}>{prepStatusFa(item.status)}</Badge>
                </div>

                {item.note ? <p className="text-[10px] text-muted">«{item.note}»</p> : null}

                <div className="flex items-center justify-between text-[10px] text-muted">
                  <span>
                    سپری‌شده: <span className="num">{formatCountFa(item.elapsedMinutes)}</span> دقیقه / هدف{' '}
                    <span className="num">{formatCountFa(item.targetMinutes)}</span>
                  </span>
                  {item.isDelayed ? <Badge tone="danger">تأخیر</Badge> : null}
                </div>

                {item.departmentNameFa ? (
                  <p className="text-[10px] text-muted">دپارتمان: {item.departmentNameFa}</p>
                ) : null}

                {canUpdate ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {nextActions(item.status).map((action) => (
                      <Button
                        key={action.to}
                        size="sm"
                        variant={action.to === 'ready' ? 'primary' : 'outline'}
                        loading={pendingId === item.id}
                        disabled={pendingId !== null}
                        onClick={() => void advance(item.id, action.to)}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted">برای تغییر وضعیت، مجوز «prep.update» لازم است.</p>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
