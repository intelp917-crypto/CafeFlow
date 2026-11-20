import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Breadcrumb } from '../lib/branding';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  Spinner,
  type Column,
} from '@cafeflow/ui';
import { api, errorMessage } from '../lib/api';
import { formatDateTimeFa } from '../lib/format';
import { auditActionFa, entityLabelFa } from '../lib/labels';
import type { AuditEntry, PaginatedResponse } from '../lib/types';

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [appliedFilter, setAppliedFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (appliedFilter) query.set('action', appliedFilter);
      const data = await api.get<PaginatedResponse<AuditEntry>>(`/audit?${query.toString()}`);
      setEntries(data.items);
      setTotal(data.total);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [page, appliedFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitFilter = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilter(actionFilter.trim());
  };

  const columns: Column<AuditEntry>[] = [
    { key: 'time', header: 'زمان', render: (row) => <span className="text-muted">{formatDateTimeFa(row.createdAt)}</span> },
    { key: 'action', header: 'رویداد', render: (row) => <span className="font-medium">{auditActionFa(row.action)}</span> },
    { key: 'actor', header: 'کاربر', render: (row) => row.actorUsername ?? 'سیستم' },
    { key: 'entity', header: 'موجودیت', render: (row) => <Badge tone="neutral">{entityLabelFa(row.entityType)}</Badge> },
    { key: 'ip', header: 'IP', render: (row) => <span className="num text-muted" dir="ltr">{row.ip ?? '—'}</span> },
    {
      key: 'details',
      header: '',
      align: 'end',
      render: (row) => (
        <Button size="sm" variant="ghost" onClick={() => setSelected(row)}>
          جزئیات
        </Button>
      ),
    },
  ];

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="گزارش رویدادها"
        description="تمام عملیات حساس — ورود، تغییر تنظیمات، تغییر ماژول‌ها و تصمیم‌های تأیید — با زمان، کاربر و مقادیر قبل/بعد ثبت می‌شوند."
        breadcrumb={<Breadcrumb page="گزارش رویدادها" />}
        actions={<span className="text-xs text-muted">{total} رویداد</span>}
      />

      <Card className="p-4">
        <form onSubmit={submitFilter} className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <label htmlFor="audit-filter" className="mb-1 block text-[11px] font-medium text-ink">
              فیلتر نوع رویداد
            </label>
            <Input
              id="audit-filter"
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
              placeholder="مثال: module یا auth"
              dir="ltr"
              className="text-start"
            />
          </div>
          <Button type="submit" variant="outline">اعمال فیلتر</Button>
          {appliedFilter ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setActionFilter('');
                setAppliedFilter('');
                setPage(1);
              }}
            >
              حذف فیلتر
            </Button>
          ) : null}
        </form>
      </Card>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-brand-600">
            <Spinner size="lg" />
          </div>
        ) : error && entries.length === 0 ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={entries}
              rowKey={(row) => row.id}
              loading={loading}
              empty={<EmptyState title="رویدادی ثبت نشده است" description="عملیات حساس پس از انجام، در همین صفحه ثبت می‌شوند." />}
            />
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[11px] text-muted">
              <span>
                صفحه {page} از {totalPages}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                  قبلی
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                >
                  بعدی
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <Modal open={selected !== null} onClose={() => setSelected(null)} title="جزئیات رویداد" size="lg">
        {selected ? (
          <div className="space-y-3 text-xs">
            <dl className="grid grid-cols-2 gap-2">
              <div>
                <dt className="text-muted">رویداد</dt>
                <dd className="font-medium">{auditActionFa(selected.action)}</dd>
              </div>
              <div>
                <dt className="text-muted">کاربر</dt>
                <dd className="font-medium">{selected.actorUsername ?? 'سیستم'}</dd>
              </div>
              <div>
                <dt className="text-muted">زمان</dt>
                <dd className="font-medium">{formatDateTimeFa(selected.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted">شناسه موجودیت</dt>
                <dd className="num font-medium" dir="ltr">{selected.entityId ?? '—'}</dd>
              </div>
            </dl>

            <div>
              <p className="mb-1 font-semibold text-ink">مقدار قبل</p>
              <pre dir="ltr" className="max-h-40 overflow-auto rounded-xl bg-canvas p-3 text-[11px] leading-5">
                {selected.before ? JSON.stringify(selected.before, null, 2) : '—'}
              </pre>
            </div>
            <div>
              <p className="mb-1 font-semibold text-ink">مقدار بعد</p>
              <pre dir="ltr" className="max-h-40 overflow-auto rounded-xl bg-canvas p-3 text-[11px] leading-5">
                {selected.after ? JSON.stringify(selected.after, null, 2) : '—'}
              </pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
