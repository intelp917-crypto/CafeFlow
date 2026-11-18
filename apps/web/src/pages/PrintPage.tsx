import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Spinner,
  type Column,
} from '@cafeflow/ui';
import { PRINT_JOB_STATUS_LABELS_FA, type PrintJob } from '@cafeflow/shared';
import { api, errorMessage } from '../lib/api';
import { formatDateTimeFa } from '../lib/format';

type Filter = 'queued' | 'printed' | 'failed' | 'all';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'queued', label: 'در صف' },
  { key: 'printed', label: 'چاپ‌شده' },
  { key: 'failed', label: 'ناموفق' },
  { key: 'all', label: 'همه' },
];

function statusTone(status: string): 'neutral' | 'success' | 'danger' | 'warning' {
  if (status === 'printed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'queued' || status === 'sent') return 'warning';
  return 'neutral';
}

export function PrintPage() {
  const [filter, setFilter] = useState<Filter>('queued');
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PrintJob | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const query = filter === 'all' ? '' : `?status=${filter}`;
        const data = await api.get<{ items: PrintJob[] }>(`/print/jobs${query}`);
        setJobs(data.items);
        setError(null);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const complete = async (job: PrintJob) => {
    setBusyId(job.id);
    setNotice(null);
    try {
      await api.post(`/print/jobs/${job.id}/printed`);
      setNotice(`کار چاپ ${job.orderCode ?? ''} به‌عنوان چاپ‌شده ثبت شد.`);
      await load(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  };

  const fail = async (job: PrintJob) => {
    setBusyId(job.id);
    setNotice(null);
    try {
      await api.post(`/print/jobs/${job.id}/failed`, { error: 'چاپگر پاسخ نداد (ثبت دستی)' });
      setNotice('کار چاپ ناموفق ثبت شد و از صف خارج شد.');
      await load(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<PrintJob>[] = [
    { key: 'code', header: 'سفارش', render: (row) => <span className="num">{row.orderCode ?? '—'}</span> },
    {
      key: 'status',
      header: 'وضعیت',
      render: (row) => (
        <Badge tone={statusTone(row.status)}>{PRINT_JOB_STATUS_LABELS_FA[row.status] ?? row.status}</Badge>
      ),
    },
    { key: 'attempts', header: 'تلاش', align: 'center', render: (row) => row.attempts.toLocaleString('fa-IR') },
    { key: 'created', header: 'ثبت', render: (row) => <span className="text-[11px] text-muted">{formatDateTimeFa(row.createdAt)}</span> },
    {
      key: 'error',
      header: 'خطا',
      render: (row) => <span className="text-[11px] text-danger">{row.error ?? '—'}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (row) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setPreview(row)}>
            متن رسید
          </Button>
          {row.status === 'queued' || row.status === 'sent' ? (
            <>
              <Button size="sm" loading={busyId === row.id} onClick={() => void complete(row)}>
                چاپ شد
              </Button>
              <Button size="sm" variant="outline" disabled={busyId === row.id} onClick={() => void fail(row)}>
                ناموفق
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="صف چاپ"
        description="رسیدها ابتدا در صف چاپ ذخیره می‌شوند؛ پل چاپ (scripts/print-bridge.mjs) آن‌ها را برمی‌دارد یا از همین صفحه چاپ‌شدن را تأیید می‌کنید."
        breadcrumb="کافه‌فلو / صف چاپ"
        actions={
          <div className="flex gap-1.5">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key)}
                className={`rounded-xl border px-3 py-1.5 text-[11px] ${
                  filter === option.key
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-line bg-surface text-muted'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        {loading && jobs.length === 0 ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner size="lg" />
          </div>
        ) : error && jobs.length === 0 ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <DataTable
            columns={columns}
            rows={jobs}
            rowKey={(row) => row.id}
            empty={<EmptyState title="کاری در این صف نیست" description="از صفحه صندوق، رسید سفارش را در صف چاپ قرار دهید." />}
          />
        )}
      </Card>

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview ? `رسید سفارش ${preview.orderCode ?? ''}` : 'رسید'}
        footer={
          <Button variant="ghost" onClick={() => setPreview(null)}>
            بستن
          </Button>
        }
      >
        <pre dir="rtl" className="num max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-canvas p-3 text-[11px] leading-6 text-ink">
          {preview?.receipt.join('\n') ?? ''}
        </pre>
      </Modal>
    </div>
  );
}
