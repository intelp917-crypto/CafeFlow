import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
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
import type { CustomerDetail, CustomerRow, CustomersResponse, LoyaltyTier } from '@cafeflow/shared';
import { api, errorMessage } from '../lib/api';
import { formatDateTimeFa, formatRial } from '../lib/format';

const TIER_TONES: Record<LoyaltyTier, 'neutral' | 'brand' | 'success' | 'warning'> = {
  regular: 'neutral',
  silver: 'brand',
  gold: 'warning',
  vip: 'success',
};

export function CustomersPage() {
  const [items, setItems] = useState<CustomerRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', birthDate: '', notes: '', consentMarketing: false });

  const [selected, setSelected] = useState<CustomerDetail | null>(null);
  const [adjustForm, setAdjustForm] = useState({ points: '', wallet: '', reason: '' });

  const load = useCallback(async (term = '') => {
    setLoading(true);
    try {
      const suffix = term.trim() ? `?q=${encodeURIComponent(term.trim())}` : '';
      const response = await api.get<CustomersResponse>(`/customers${suffix}`);
      setItems(response.items);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createCustomer = async () => {
    setBusy(true);
    try {
      const created = await api.post<CustomerRow>('/customers', {
        name: form.name || undefined,
        phone: form.phone,
        birthDate: form.birthDate || undefined,
        notes: form.notes || undefined,
        consentMarketing: form.consentMarketing,
      });
      setCreateOpen(false);
      setForm({ name: '', phone: '', birthDate: '', notes: '', consentMarketing: false });
      setNotice(`مشتری «${created.name ?? created.phone}» ثبت شد.`);
      await load(query);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (row: CustomerRow) => {
    setError(null);
    setAdjustForm({ points: '', wallet: '', reason: '' });
    try {
      const detail = await api.get<CustomerDetail>(`/customers/${row.id}`);
      setSelected(detail);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const adjust = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const detail = await api.post<CustomerDetail>(`/customers/${selected.id}/loyalty`, {
        points: adjustForm.points ? Number(adjustForm.points) : undefined,
        wallet: adjustForm.wallet ? Number(adjustForm.wallet) : undefined,
        reason: adjustForm.reason,
      });
      setSelected(detail);
      setAdjustForm({ points: '', wallet: '', reason: '' });
      setNotice('امتیاز/کیف پول مشتری به‌روزرسانی شد.');
      await load(query);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<CustomerRow>[] = [
    {
      key: 'name',
      header: 'مشتری',
      render: (row) => (
        <div className="space-y-0.5">
          <p className="font-medium text-ink">{row.name ?? 'بدون نام'}</p>
          <p className="num text-[10px] text-muted" dir="ltr">
            {row.phone}
          </p>
        </div>
      ),
    },
    {
      key: 'tier',
      header: 'سطح',
      render: (row) => <Badge tone={TIER_TONES[row.tier]}>{row.tierLabelFa}</Badge>,
    },
    { key: 'points', header: 'امتیاز', render: (row) => <span className="num text-xs">{row.points.toLocaleString('fa-IR')}</span> },
    {
      key: 'wallet',
      header: 'کیف پول',
      render: (row) => <span className="num text-xs">{formatRial(row.walletBalance)}</span>,
    },
    {
      key: 'consent',
      header: 'رضایت پیامک',
      render: (row) => (row.consentMarketing ? <Badge tone="success">دارد</Badge> : <span className="text-[10px] text-muted">ندارد</span>),
    },
    { key: 'created', header: 'عضویت', render: (row) => <span className="text-[11px] text-muted">{formatDateTimeFa(row.createdAt)}</span> },
    {
      key: 'actions',
      header: 'عملیات',
      render: (row) => (
        <Button size="sm" variant="outline" onClick={() => void openDetail(row)}>
          جزئیات و امتیاز
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="باشگاه مشتریان"
        description="پروفایل مشتری با شماره تماس یکتا، امتیاز وفاداری و کیف پول. هر تغییر امتیاز یا کیف پول در دفتر جداگانه ثبت می‌شود."
        breadcrumb="کافه‌فلو / مشتریان"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            مشتری جدید
          </Button>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardHeader
          title="مشتریان"
          description="جست‌وجو بر اساس نام یا شماره تماس"
          action={
            <div className="flex items-center gap-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="نام یا شماره…"
                className="h-9 w-44 text-xs"
              />
              <Button size="sm" variant="outline" onClick={() => void load(query)} loading={loading}>
                جست‌وجو
              </Button>
            </div>
          }
        />
        {loading && items.length === 0 ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner size="lg" />
          </div>
        ) : error && items.length === 0 ? (
          <ErrorState message={error} onRetry={() => void load(query)} />
        ) : (
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(row) => row.id}
            empty={<EmptyState title="مشتری‌ای ثبت نشده است" description="با دکمه «مشتری جدید» اولین پروفایل را بسازید." />}
          />
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="مشتری جدید"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              انصراف
            </Button>
            <Button onClick={() => void createCustomer()} loading={busy} disabled={form.phone.trim().length < 7}>
              ثبت
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="نام">
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="شماره تماس" required>
            <Input
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              dir="ltr"
              inputMode="tel"
              placeholder="09120000000"
            />
          </Field>
          <Field label="تاریخ تولد" hint="میلادی: YYYY-MM-DD">
            <Input
              type="date"
              value={form.birthDate}
              onChange={(event) => setForm({ ...form, birthDate: event.target.value })}
            />
          </Field>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={form.consentMarketing}
                onChange={(event) => setForm({ ...form, consentMarketing: event.target.checked })}
                className="size-4 accent-brand-500"
              />
              رضایت دریافت پیامک تبلیغاتی
            </label>
          </div>
          <div className="sm:col-span-2">
            <Field label="یادداشت">
              <Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `مشتری: ${selected.name ?? selected.phone}` : 'مشتری'}
        description={selected ? `امتیاز ${selected.points} — سطح ${selected.tierLabelFa} — کیف پول ${formatRial(selected.walletBalance)}` : undefined}
        size="lg"
        footer={
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setSelected(null)}>
              بستن
            </Button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="تغییر امتیاز" hint="مثبت یا منفی">
                <Input
                  type="number"
                  value={adjustForm.points}
                  onChange={(event) => setAdjustForm({ ...adjustForm, points: event.target.value })}
                />
              </Field>
              <Field label="تغییر کیف پول (ریال)" hint="مثبت شارژ، منفی برداشت">
                <Input
                  type="number"
                  value={adjustForm.wallet}
                  onChange={(event) => setAdjustForm({ ...adjustForm, wallet: event.target.value })}
                />
              </Field>
              <Field label="دلیل" required>
                <Input
                  value={adjustForm.reason}
                  onChange={(event) => setAdjustForm({ ...adjustForm, reason: event.target.value })}
                  placeholder="خرید، هدیه، اصلاح"
                />
              </Field>
            </div>
            <Button
              size="sm"
              onClick={() => void adjust()}
              loading={busy}
              disabled={(!adjustForm.points && !adjustForm.wallet) || adjustForm.reason.trim().length < 2}
            >
              ثبت تغییر
            </Button>

            <div>
              <p className="mb-2 text-xs font-semibold text-ink">دفتر امتیاز و کیف پول</p>
              {selected.ledger.length === 0 ? (
                <p className="text-[11px] text-muted">هنوز تغییری ثبت نشده است.</p>
              ) : (
                <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                  {selected.ledger.map((entry) => (
                    <li key={`${entry.kind}-${entry.id}`} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div>
                        <p className="text-[11px] text-ink">{entry.reason}</p>
                        <p className="text-[10px] text-muted">{formatDateTimeFa(entry.createdAt)}</p>
                      </div>
                      <span className={`num text-xs ${entry.delta < 0 ? 'text-danger-600' : 'text-success-700'}`}>
                        {entry.kind === 'points'
                          ? `${entry.delta > 0 ? '+' : ''}${entry.delta} امتیاز`
                          : `${entry.delta > 0 ? '+' : ''}${formatRial(entry.delta)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
