import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CardBody,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
  type Column,
} from '@cafeflow/ui';
import type { TerminalCompletionResult } from '@cafeflow/shared';
import type { ServiceRequestRow, TerminalRequestRow } from '../lib/types';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTimeFa, formatRial, relativeTimeFa } from '../lib/format';
import { requestStatusFa, requestStatusTone } from '../lib/labels';

export function RequestsPage() {
  const { hasPermission } = useAuth();
  const canHandle = hasPermission('orders.write');
  const canTerminal = hasPermission('payments.read');
  const canComplete = hasPermission('payments.create');

  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const [requests, setRequests] = useState<ServiceRequestRow[]>([]);
  const [terminals, setTerminals] = useState<TerminalRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await api.get<{ items: ServiceRequestRow[] }>(`/service-requests?status=${status}`);
        setRequests(data.items);
        if (canTerminal) {
          const terminalData = await api.get<{ items: TerminalRequestRow[] }>('/terminal-requests?status=all');
          setTerminals(terminalData.items);
        }
        setError(null);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [status, canTerminal],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const updateRequest = async (id: string, next: 'accepted' | 'done' | 'cancelled') => {
    setPendingId(id);
    setNotice(null);
    try {
      await api.post(`/service-requests/${id}/status`, { status: next });
      setNotice(next === 'done' ? 'درخواست انجام شد.' : 'درخواست به‌روزرسانی شد.');
      await load(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPendingId(null);
    }
  };

  const completeTerminal = async (id: string) => {
    setPendingId(id);
    try {
      const result = await api.post<TerminalCompletionResult>(`/terminal-requests/${id}/complete`, {});
      setNotice(
        result.payment
          ? `درخواست تکمیل شد و پرداخت ${formatRial(result.payment.amount)} ثبت شد.`
          : 'درخواست تکمیل شد؛ سفارش تسویه‌نشده‌ای برای این میز وجود نداشت.',
      );
      await load(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPendingId(null);
    }
  };

  const columns: Column<ServiceRequestRow>[] = [
    { key: 'type', header: 'نوع', render: (row) => <span className="font-medium">{row.typeLabelFa}</span> },
    { key: 'table', header: 'میز', render: (row) => row.tableNameFa ?? '—' },
    { key: 'note', header: 'توضیح', render: (row) => (row.note ? <span className="text-muted">«{row.note}»</span> : '—') },
    {
      key: 'status',
      header: 'وضعیت',
      render: (row) => <Badge tone={requestStatusTone(row.status)}>{requestStatusFa(row.status)}</Badge>,
    },
    { key: 'time', header: 'زمان', render: (row) => <span className="text-muted">{relativeTimeFa(row.createdAt)}</span> },
    {
      key: 'handled',
      header: 'رسیدگی',
      render: (row) =>
        row.handledByName ? (
          <span className="text-[10px] text-muted">{row.handledByName}</span>
        ) : (
          <span className="text-[10px] text-muted">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (row) =>
        canHandle && (row.status === 'pending' || row.status === 'accepted') ? (
          <div className="flex justify-end gap-1.5">
            {row.status === 'pending' ? (
              <Button
                size="sm"
                variant="outline"
                loading={pendingId === row.id}
                disabled={pendingId !== null}
                onClick={() => void updateRequest(row.id, 'accepted')}
              >
                پذیرش
              </Button>
            ) : null}
            <Button
              size="sm"
              loading={pendingId === row.id}
              disabled={pendingId !== null}
              onClick={() => void updateRequest(row.id, 'done')}
            >
              انجام شد
            </Button>
          </div>
        ) : (
          <span className="text-[10px] text-muted">{row.resolvedAt ? formatDateTimeFa(row.resolvedAt) : '—'}</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="درخواست‌های مشتری"
        description="درخواست‌هایی که مشتری از روی QR میز می‌فرستد: گارسون، آب، دستمال، صورتحساب و کارت‌خوان. هر درخواست یک بار بسته می‌شود."
        breadcrumb="کافه‌فلو / درخواست‌ها"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStatus('pending')}
              className={`rounded-xl border px-3 py-1.5 text-[11px] ${
                status === 'pending' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line bg-surface text-muted'
              }`}
            >
              در انتظار
            </button>
            <button
              type="button"
              onClick={() => setStatus('all')}
              className={`rounded-xl border px-3 py-1.5 text-[11px] ${
                status === 'all' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line bg-surface text-muted'
              }`}
            >
              همه
            </button>
          </div>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        {loading && requests.length === 0 ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner size="lg" />
          </div>
        ) : error && requests.length === 0 ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <DataTable
            columns={columns}
            rows={requests}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="درخواستی در انتظار نیست"
                description="وقتی مشتری از روی QR میز درخواستی بفرستد، اینجا ظاهر می‌شود. این صفحه هر ۱۰ ثانیه خودکار به‌روزرسانی می‌شود."
              />
            }
          />
        )}
      </Card>

      {canTerminal ? (
        <Card>
          <CardHeader
            title="درخواست‌های کارت‌خوان"
            description="درخواست‌هایی که مشتری برای پرداخت با کارت‌خوان می‌فرستد."
          />
          <CardBody className="space-y-2">
            {terminals.length === 0 ? (
              <p className="text-xs text-muted">درخواست کارت‌خوانی ثبت نشده است.</p>
            ) : (
              terminals.slice(0, 12).map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2 last:border-0 last:pb-0"
                >
                  <div>
                    <p className="text-xs text-ink">
                      {row.tableNameFa ?? 'بدون میز'}
                      {row.orderCode ? (
                        <span className="num text-muted">
                          {' '}
                          — سفارش {row.orderCode}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[10px] text-muted">
                      {relativeTimeFa(row.createdAt)}
                      {row.note ? ` — «${row.note}»` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={row.status === 'completed' ? 'success' : 'warning'}>
                      {row.status === 'completed' ? 'تکمیل شده' : 'در انتظار'}
                    </Badge>
                    {canComplete && row.status !== 'completed' ? (
                      <Button
                        size="sm"
                        loading={pendingId === row.id}
                        disabled={pendingId !== null}
                        onClick={() => void completeTerminal(row.id)}
                      >
                        تحویل داده شد
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
