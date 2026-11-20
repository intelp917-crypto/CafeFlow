import { useCallback, useEffect, useState } from 'react';
import { Breadcrumb } from '../lib/branding';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Spinner,
  Textarea,
  type Column,
} from '@cafeflow/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTimeFa } from '../lib/format';
import { approvalStatusFa } from '../lib/labels';
import type { ApprovalItem } from '../lib/types';

export function ApprovalsPage() {
  const { hasPermission } = useAuth();
  const canDecide = hasPermission('approvals.decide');

  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [target, setTarget] = useState<ApprovalItem | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ items: ApprovalItem[] }>('/approvals');
      setItems(data.items);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDecision = (item: ApprovalItem, next: 'approved' | 'rejected') => {
    setTarget(item);
    setDecision(next);
    setNote('');
    setFormError(null);
  };

  const submitDecision = async () => {
    if (!target || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      await api.post(`/approvals/${target.id}/decision`, { decision, note: note.trim() || undefined });
      setTarget(null);
      setNotice(decision === 'approved' ? 'درخواست تأیید شد.' : 'درخواست رد شد.');
      await load();
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<ApprovalItem>[] = [
    { key: 'title', header: 'موضوع', render: (row) => <span className="font-medium">{row.titleFa}</span> },
    { key: 'type', header: 'نوع', render: (row) => <Badge tone="neutral">{row.type}</Badge> },
    { key: 'requester', header: 'درخواست‌دهنده', render: (row) => row.requesterName ?? '—' },
    { key: 'status', header: 'وضعیت', render: (row) => (
      <Badge tone={row.status === 'pending' ? 'warning' : row.status === 'approved' ? 'success' : 'danger'}>
        {approvalStatusFa(row.status)}
      </Badge>
    ) },
    { key: 'created', header: 'زمان ثبت', render: (row) => <span className="text-muted">{formatDateTimeFa(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (row) =>
        canDecide && row.status === 'pending' ? (
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="outline" onClick={() => openDecision(row, 'approved')}>
              تأیید
            </Button>
            <Button size="sm" variant="ghost" onClick={() => openDecision(row, 'rejected')}>
              رد
            </Button>
          </div>
        ) : (
          <span className="text-[10px] text-muted">{row.deciderName ? `تصمیم: ${row.deciderName}` : '—'}</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="صف تأیید"
        description="عملیات حساس مانند تغییر قیمت، حذف محصول، تخفیف بزرگ و اصلاح مالی نیازمند تأیید مدیر است. هر تصمیم در گزارش رویدادها ثبت می‌شود."
        breadcrumb={<Breadcrumb page="صف تأیید" />}
        actions={<span className="text-xs text-muted">{items.filter((item) => item.status === 'pending').length} در انتظار</span>}
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-brand-600">
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
                title="درخواستی در صف نیست"
                description="درخواست‌های تأیید از بخش‌های مختلف سیستم (تغییر قیمت، لغو سفارش، تخفیف) در اینجا جمع می‌شوند."
              />
            }
          />
        )}
      </Card>

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={decision === 'approved' ? 'تأیید درخواست' : 'رد درخواست'}
        description={target?.titleFa}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>انصراف</Button>
            <Button variant={decision === 'approved' ? 'primary' : 'danger'} loading={saving} onClick={() => void submitDecision()}>
              {decision === 'approved' ? 'تأیید می‌کنم' : 'رد می‌کنم'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Field
            label={decision === 'rejected' ? 'دلیل رد (الزامی)' : 'توضیح (اختیاری)'}
            hint="این توضیح در گزارش رویدادها ذخیره می‌شود."
            required={decision === 'rejected'}
          >
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="توضیح تصمیم…" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
