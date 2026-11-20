import { useCallback, useEffect, useMemo, useState } from 'react';
import { Breadcrumb } from '../lib/branding';
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
  StatCard,
  Textarea,
  type Column,
} from '@cafeflow/ui';
import {
  RESERVATION_STATUS_LABELS_FA,
  type ReservationRow,
  type ReservationStatus,
  type ReservationsResponse,
  type StaffTablesResponse,
} from '@cafeflow/shared';
import { api, errorMessage } from '../lib/api';
import { formatDateTimeFa, formatCountFa } from '../lib/format';

const TONES: Record<ReservationStatus, 'neutral' | 'brand' | 'success' | 'danger' | 'warning'> = {
  pending: 'warning',
  confirmed: 'brand',
  seated: 'success',
  cancelled: 'danger',
  no_show: 'neutral',
};

function tehranToday(): string {
  return new Date(Date.now() + 210 * 60_000).toISOString().slice(0, 10);
}

interface FormState {
  customerName: string;
  customerPhone: string;
  guestCount: string;
  reservedFor: string;
  durationMinutes: string;
  tableId: string;
  note: string;
}

const EMPTY_FORM: FormState = {
  customerName: '',
  customerPhone: '',
  guestCount: '2',
  reservedFor: `${tehranToday()}T19:00`,
  durationMinutes: '90',
  tableId: '',
  note: '',
};

export function ReservationsPage() {
  const [date, setDate] = useState(tehranToday());
  const [allDates, setAllDates] = useState(false);
  const [items, setItems] = useState<ReservationRow[]>([]);
  const [summary, setSummary] = useState({ pending: 0, confirmed: 0, seated: 0 });
  const [tables, setTables] = useState<StaffTablesResponse['items']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = allDates ? `?scope=all` : `?date=${date}&scope=all`;
      const [reservations, tableResponse] = await Promise.all([
        api.get<ReservationsResponse>(`/reservations${query}`),
        api.get<StaffTablesResponse>('/tables'),
      ]);
      setItems(reservations.items);
      setSummary(reservations.summary);
      setTables(tableResponse.items);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [allDates, date]);

  useEffect(() => {
    void load();
  }, [load]);

  const tableOptions = useMemo(
    () => tables.filter((table) => table.status !== 'unavailable'),
    [tables],
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.post<ReservationRow>('/reservations', {
        customerName: form.customerName,
        customerPhone: form.customerPhone,
        guestCount: Number(form.guestCount),
        reservedFor: new Date(form.reservedFor).toISOString(),
        durationMinutes: Number(form.durationMinutes),
        tableId: form.tableId || undefined,
        note: form.note || undefined,
      });
      setModalOpen(false);
      setForm(EMPTY_FORM);
      setNotice(`رزرو «${response.customerName}» برای ${formatDateTimeFa(response.reservedFor)} ثبت شد.`);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (row: ReservationRow, status: ReservationStatus) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post(`/reservations/${row.id}/status`, { status });
      setNotice(`وضعیت رزرو «${row.customerName}» به «${RESERVATION_STATUS_LABELS_FA[status]}» تغییر کرد.`);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<ReservationRow>[] = [
    {
      key: 'customer',
      header: 'مشتری',
      render: (row) => (
        <div className="space-y-0.5">
          <p className="font-medium text-ink">{row.customerName}</p>
          <p className="num text-[10px] text-muted" dir="ltr">
            {row.customerPhone}
          </p>
        </div>
      ),
    },
    {
      key: 'time',
      header: 'زمان رزرو',
      render: (row) => (
        <div className="space-y-0.5">
          <p className="text-xs">{formatDateTimeFa(row.reservedFor)}</p>
          <p className="text-[10px] text-muted">{formatCountFa(row.durationMinutes)} دقیقه</p>
        </div>
      ),
    },
    {
      key: 'table',
      header: 'میز',
      render: (row) =>
        row.tableNameFa ? (
          <span className="text-xs">
            {row.tableNameFa}
            {row.tableCapacity ? <span className="text-[10px] text-muted"> / ظرفیت {formatCountFa(row.tableCapacity)}</span> : null}
          </span>
        ) : (
          <span className="text-[10px] text-muted">بدون میز</span>
        ),
    },
    { key: 'guests', header: 'مهمان', render: (row) => <span className="num">{formatCountFa(row.guestCount)}</span> },
    {
      key: 'status',
      header: 'وضعیت',
      render: (row) => <Badge tone={TONES[row.status]}>{row.statusLabelFa}</Badge>,
    },
    {
      key: 'actions',
      header: 'عملیات',
      render: (row) =>
        row.allowedStatuses.length === 0 ? (
          <span className="text-[10px] text-muted">پایان‌یافته</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.allowedStatuses.map((option) => (
              <Button
                key={option.status}
                size="sm"
                variant={option.status === 'cancelled' || option.status === 'no_show' ? 'ghost' : 'outline'}
                disabled={busy}
                onClick={() => void changeStatus(row, option.status)}
              >
                {option.labelFa}
              </Button>
            ))}
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="رزرو میز"
        description="ثبت رزرو تلفنی و حضوری با بررسی ظرفیت میز و جلوگیری از تداخل زمانی. هر تغییر وضعیت در سرور بررسی و ثبت می‌شود."
        breadcrumb={<Breadcrumb page="رزروها" />}
        actions={
          <Button size="sm" onClick={() => setModalOpen(true)}>
            رزرو جدید
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="در انتظار تأیید" value={formatCountFa(summary.pending)} tone="warning" />
        <StatCard label="تأییدشده" value={formatCountFa(summary.confirmed)} tone="brand" />
        <StatCard label="حاضر شده" value={formatCountFa(summary.seated)} tone="success" />
      </div>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardHeader
          title="فهرست رزروها"
          description={allDates ? 'همه رزروها' : `رزروهای ${date}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={allDates}
                  onChange={(event) => setAllDates(event.target.checked)}
                  className="size-3.5 accent-brand-500"
                />
                همه تاریخ‌ها
              </label>
              <Input
                type="date"
                value={date}
                disabled={allDates}
                onChange={(event) => setDate(event.target.value)}
                className="h-9 w-36 text-xs"
                aria-label="تاریخ رزرو"
              />
              <Button size="sm" variant="outline" onClick={() => void load()} loading={loading}>
                به‌روزرسانی
              </Button>
            </div>
          }
        />
        {loading && items.length === 0 ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner size="lg" />
          </div>
        ) : error && items.length === 0 ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(row) => row.id}
            empty={<EmptyState title="رزروی ثبت نشده است" description="با دکمه «رزرو جدید» اولین رزرو را ثبت کنید." />}
          />
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="رزرو جدید"
        description="میز و بازه زمانی در سرور بررسی می‌شود؛ رزرو هم‌زمان روی یک میز پذیرفته نمی‌شود."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              انصراف
            </Button>
            <Button onClick={() => void submit()} loading={busy}>
              ثبت رزرو
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="نام مشتری" required>
            <Input
              value={form.customerName}
              onChange={(event) => setForm({ ...form, customerName: event.target.value })}
              placeholder="مثلاً سارا محمدی"
            />
          </Field>
          <Field label="شماره تماس" required>
            <Input
              value={form.customerPhone}
              onChange={(event) => setForm({ ...form, customerPhone: event.target.value })}
              placeholder="09120000000"
              dir="ltr"
              inputMode="tel"
            />
          </Field>
          <Field label="تعداد مهمان" required>
            <Input
              type="number"
              min={1}
              max={60}
              value={form.guestCount}
              onChange={(event) => setForm({ ...form, guestCount: event.target.value })}
            />
          </Field>
          <Field label="میز" hint="برای رزرو بدون میز خالی بگذارید.">
            <select
              value={form.tableId}
              onChange={(event) => setForm({ ...form, tableId: event.target.value })}
              className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink focus:border-brand-400 focus:outline-none"
            >
              <option value="">بدون میز مشخص</option>
              {tableOptions.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.nameFa} — ظرفیت {table.capacity}
                </option>
              ))}
            </select>
          </Field>
          <Field label="زمان رزرو" required>
            <Input
              type="datetime-local"
              value={form.reservedFor}
              onChange={(event) => setForm({ ...form, reservedFor: event.target.value })}
            />
          </Field>
          <Field label="مدت (دقیقه)" required>
            <Input
              type="number"
              min={15}
              max={480}
              step={15}
              value={form.durationMinutes}
              onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="یادداشت">
              <Textarea
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
                placeholder="مثلاً کنار پنجره، جشن تولد"
              />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}
