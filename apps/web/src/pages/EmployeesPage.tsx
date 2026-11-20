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
  cn,
  type Column,
} from '@cafeflow/ui';
import type {
  CreateEmployeeInput,
  EmployeeRow,
  EmployeesResponse,
  ShiftRow,
  ShiftsResponse,
  StaffPerformanceResponse,
} from '@cafeflow/shared';
import { api, errorMessage } from '../lib/api';
import { formatCountFa, formatDateTimeFa, formatRial } from '../lib/format';

type Tab = 'employees' | 'shifts' | 'performance';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'employees', label: 'کارکنان' },
  { key: 'shifts', label: 'برنامه شیفت و حضور' },
  { key: 'performance', label: 'عملکرد' },
];

const STATUS_TONES: Record<string, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  on_leave: 'warning',
  inactive: 'neutral',
};

const SHIFT_TONES: Record<string, 'brand' | 'success' | 'neutral'> = {
  scheduled: 'brand',
  completed: 'success',
  cancelled: 'neutral',
};

function tehranIsoDay(offsetDays = 0): string {
  return new Date(Date.now() + 210 * 60_000 - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** `datetime-local` value (browser local) → ISO instant for the API. */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function EmployeesPage() {
  const [tab, setTab] = useState<Tab>('employees');
  const [directory, setDirectory] = useState<EmployeesResponse | null>(null);
  const [shifts, setShifts] = useState<ShiftsResponse | null>(null);
  const [performance, setPerformance] = useState<StaffPerformanceResponse | null>(null);
  const [shiftRange, setShiftRange] = useState({ from: tehranIsoDay(), to: tehranIsoDay(-14) });
  const [performanceRange, setPerformanceRange] = useState({ from: tehranIsoDay(29), to: tehranIsoDay() });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [employeeModal, setEmployeeModal] = useState(false);
  const [employeeForm, setEmployeeForm] = useState({
    userId: '',
    employeeCode: '',
    departmentId: '',
    floorId: '',
    positionFa: '',
    status: 'active' as CreateEmployeeInput['status'],
  });

  const [shiftModal, setShiftModal] = useState(false);
  const [shiftForm, setShiftForm] = useState({ employeeId: '', startsAt: '', endsAt: '', note: '' });

  const loadDirectory = useCallback(async () => {
    const response = await api.get<EmployeesResponse>('/employees');
    setDirectory(response);
  }, []);

  const loadShifts = useCallback(async () => {
    const response = await api.get<ShiftsResponse>(`/shifts?from=${shiftRange.from}&to=${shiftRange.to}`);
    setShifts(response);
  }, [shiftRange]);

  const loadPerformance = useCallback(async () => {
    const response = await api.get<StaffPerformanceResponse>(
      `/employees/performance?from=${performanceRange.from}&to=${performanceRange.to}`,
    );
    setPerformance(response);
  }, [performanceRange]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadDirectory(), loadShifts(), loadPerformance()]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [loadDirectory, loadShifts, loadPerformance]);

  useEffect(() => {
    void load();
  }, [load]);

  const employees = directory?.items ?? [];
  const activeEmployees = useMemo(() => employees.filter((item) => item.status !== 'inactive'), [employees]);

  const createEmployee = async () => {
    if (!employeeForm.userId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<EmployeeRow>('/employees', {
        userId: employeeForm.userId,
        employeeCode: employeeForm.employeeCode || undefined,
        departmentId: employeeForm.departmentId || undefined,
        floorId: employeeForm.floorId || undefined,
        positionFa: employeeForm.positionFa || undefined,
        status: employeeForm.status,
      });
      setEmployeeModal(false);
      setEmployeeForm({ userId: '', employeeCode: '', departmentId: '', floorId: '', positionFa: '', status: 'active' });
      setNotice('پروفایل کارمند ساخته شد.');
      await loadDirectory();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (employee: EmployeeRow, status: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/employees/${employee.id}`, { status });
      setNotice(`وضعیت «${employee.fullName}» به‌روزرسانی شد.`);
      await loadDirectory();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const createShift = async () => {
    const startsAt = localInputToIso(shiftForm.startsAt);
    const endsAt = localInputToIso(shiftForm.endsAt);
    if (!shiftForm.employeeId || !startsAt || !endsAt) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<ShiftRow>('/shifts', {
        employeeId: shiftForm.employeeId,
        startsAt,
        endsAt,
        note: shiftForm.note || undefined,
      });
      setShiftModal(false);
      setShiftForm({ employeeId: '', startsAt: '', endsAt: '', note: '' });
      setNotice(`شیفت ${created.employeeName} ثبت شد.`);
      await Promise.all([loadShifts(), loadDirectory()]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const shiftAction = async (shift: ShiftRow, action: 'check-in' | 'check-out' | 'cancel') => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.post<ShiftRow>(`/shifts/${shift.id}/${action}`);
      const messages: Record<typeof action, string> = {
        'check-in': `حضور ${updated.employeeName} ثبت شد.`,
        'check-out': `خروج ${updated.employeeName} ثبت شد.`,
        cancel: 'شیفت لغو شد.',
      };
      setNotice(messages[action]);
      await loadShifts();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const employeeColumns: Column<EmployeeRow>[] = [
    {
      key: 'name',
      header: 'کارمند',
      render: (row) => (
        <div className="space-y-0.5">
          <p className="font-medium text-ink">{row.fullName}</p>
          <p className="text-[10px] text-muted" dir="ltr">
            {row.username}
            {row.employeeCode ? ` · ${row.employeeCode}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'position', header: 'عنوان شغلی', render: (row) => <span className="text-xs">{row.positionFa ?? '—'}</span> },
    { key: 'department', header: 'دپارتمان', render: (row) => <span className="text-xs">{row.departmentNameFa ?? '—'}</span> },
    { key: 'floor', header: 'طبقه', render: (row) => <span className="text-xs">{row.floorNameFa ?? '—'}</span> },
    {
      key: 'week',
      header: 'شیفت هفته آینده',
      render: (row) => <span className="num text-xs">{formatCountFa(row.shiftsThisWeek)}</span>,
    },
    {
      key: 'status',
      header: 'وضعیت',
      render: (row) => (
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONES[row.status] ?? 'neutral'}>{row.statusLabelFa}</Badge>
          {!row.isUserActive ? <Badge tone="danger">حساب غیرفعال</Badge> : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'تغییر وضعیت',
      render: (row) => (
        <select
          value={row.status}
          onChange={(event) => void updateStatus(row, event.target.value)}
          className="h-8 rounded-lg border border-line bg-surface px-2 text-[11px] text-ink"
          aria-label={`وضعیت ${row.fullName}`}
        >
          <option value="active">فعال</option>
          <option value="on_leave">مرخصی</option>
          <option value="inactive">غیرفعال</option>
        </select>
      ),
    },
  ];

  const shiftColumns: Column<ShiftRow>[] = [
    { key: 'employee', header: 'کارمند', render: (row) => <span className="text-xs font-medium text-ink">{row.employeeName}</span> },
    { key: 'department', header: 'دپارتمان', render: (row) => <span className="text-[11px] text-muted">{row.departmentNameFa ?? '—'}</span> },
    { key: 'start', header: 'شروع', render: (row) => <span className="text-[11px]">{formatDateTimeFa(row.startsAt)}</span> },
    { key: 'end', header: 'پایان', render: (row) => <span className="text-[11px]">{formatDateTimeFa(row.endsAt)}</span> },
    {
      key: 'hours',
      header: 'ساعت',
      render: (row) => <span className="num text-xs">{row.durationHours.toLocaleString('fa-IR')}</span>,
    },
    {
      key: 'attendance',
      header: 'حضور',
      render: (row) => (
        <div className="space-y-0.5 text-[10px] text-muted">
          <p>ورود: {row.checkedInAt ? formatDateTimeFa(row.checkedInAt) : '—'}</p>
          <p>خروج: {row.checkedOutAt ? formatDateTimeFa(row.checkedOutAt) : '—'}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'وضعیت',
      render: (row) => <Badge tone={SHIFT_TONES[row.status] ?? 'neutral'}>{row.statusLabelFa}</Badge>,
    },
    {
      key: 'actions',
      header: 'عملیات',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.status === 'scheduled' && !row.checkedInAt ? (
            <Button size="sm" variant="outline" onClick={() => void shiftAction(row, 'check-in')} disabled={busy}>
              ثبت حضور
            </Button>
          ) : null}
          {row.status === 'scheduled' && row.checkedInAt ? (
            <Button size="sm" variant="outline" onClick={() => void shiftAction(row, 'check-out')} disabled={busy}>
              ثبت خروج
            </Button>
          ) : null}
          {row.status === 'scheduled' ? (
            <Button size="sm" variant="ghost" onClick={() => void shiftAction(row, 'cancel')} disabled={busy}>
              لغو
            </Button>
          ) : (
            <span className="text-[10px] text-muted">—</span>
          )}
        </div>
      ),
    },
  ];

  const performanceColumns: Column<StaffPerformanceResponse['items'][number]>[] = [
    { key: 'name', header: 'کارمند', render: (row) => <span className="text-xs font-medium text-ink">{row.fullName}</span> },
    { key: 'department', header: 'دپارتمان', render: (row) => <span className="text-[11px] text-muted">{row.departmentNameFa ?? '—'}</span> },
    { key: 'shifts', header: 'شیفت', render: (row) => <span className="num text-xs">{formatCountFa(row.shifts)}</span> },
    {
      key: 'hours',
      header: 'ساعت کارکرد',
      render: (row) => <span className="num text-xs">{row.workedHours.toLocaleString('fa-IR')}</span>,
    },
    { key: 'orders', header: 'سفارش تسویه‌شده', render: (row) => <span className="num text-xs">{formatCountFa(row.ordersServed)}</span> },
    { key: 'revenue', header: 'درآمد وصولی', render: (row) => <span className="num text-xs">{formatRial(row.revenue)}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="کارکنان، شیفت و عملکرد"
        description="پروفایل پرسنلی، برنامه شیفت با جلوگیری از تداخل، ثبت حضور و خروج، و عملکرد هر کارمند از دفتر واقعی سفارش و پرداخت."
        breadcrumb={<Breadcrumb page="کارکنان" />}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEmployeeModal(true)} disabled={!directory?.candidates.length}>
              پروفایل کارمند
            </Button>
            <Button size="sm" onClick={() => setShiftModal(true)} disabled={activeEmployees.length === 0}>
              شیفت جدید
            </Button>
          </div>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              'rounded-full px-4 py-2 text-xs font-medium transition',
              tab === item.key ? 'bg-brand-500 text-cream' : 'border border-line bg-surface text-muted hover:text-ink',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading && !directory ? (
        <Card className="flex justify-center py-16 text-brand-600">
          <Spinner size="lg" />
        </Card>
      ) : error && !directory ? (
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      ) : tab === 'employees' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="کارکنان" value={formatCountFa(directory?.summary.total ?? 0)} />
            <StatCard label="فعال" value={formatCountFa(directory?.summary.active ?? 0)} tone="success" />
            <StatCard label="مرخصی" value={formatCountFa(directory?.summary.onLeave ?? 0)} tone="warning" />
          </div>

          <Card>
            <CardHeader
              title="پروفایل پرسنلی"
              description="دسترسی و گذرواژه در صفحه «کارکنان و نقش‌ها» مدیریت می‌شود؛ اینجا وضعیت پرسنلی ثبت می‌شود."
            />
            <DataTable
              columns={employeeColumns}
              rows={employees}
              rowKey={(row) => row.id}
              empty={<EmptyState title="پروفایل کارمندی ثبت نشده است" description="از دکمه «پروفایل کارمند» شروع کنید." />}
            />
          </Card>
        </>
      ) : tab === 'shifts' ? (
        <>
          <Card>
            <CardHeader
              title="بازه شیفت‌ها"
              description="بازه پیش‌فرض از امروز تا دو هفته آینده است؛ شیفت هم‌پوشان برای یک کارمند پذیرفته نمی‌شود."
              action={
                <div className="flex flex-wrap items-end gap-2">
                  <Input
                    type="date"
                    value={shiftRange.from}
                    onChange={(event) => setShiftRange({ ...shiftRange, from: event.target.value })}
                    className="h-9 w-36 text-xs"
                    aria-label="از تاریخ"
                  />
                  <Input
                    type="date"
                    value={shiftRange.to}
                    onChange={(event) => setShiftRange({ ...shiftRange, to: event.target.value })}
                    className="h-9 w-36 text-xs"
                    aria-label="تا تاریخ"
                  />
                  <Button size="sm" variant="outline" onClick={() => void loadShifts()} loading={loading}>
                    اعمال
                  </Button>
                </div>
              }
            />
            <CardBody className="pb-0">
              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard label="شیفت برنامه‌ریزی‌شده" value={formatCountFa(shifts?.summary.scheduled ?? 0)} />
                <StatCard label="شیفت انجام‌شده" value={formatCountFa(shifts?.summary.completed ?? 0)} tone="success" />
                <StatCard label="جمع ساعت" value={(shifts?.summary.hours ?? 0).toLocaleString('fa-IR')} />
              </div>
            </CardBody>
            <DataTable
              columns={shiftColumns}
              rows={shifts?.items ?? []}
              rowKey={(row) => row.id}
              empty={<EmptyState title="شیفتی در این بازه ثبت نشده است" />}
            />
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader
            title="عملکرد کارکنان"
            description="ساعت کارکرد از ثبت حضور و خروج، سفارش تسویه‌شده از سفارش‌ها و درآمد وصولی از پرداخت‌ها محاسبه می‌شود."
            action={
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  type="date"
                  value={performanceRange.from}
                  onChange={(event) => setPerformanceRange({ ...performanceRange, from: event.target.value })}
                  className="h-9 w-36 text-xs"
                  aria-label="از تاریخ"
                />
                <Input
                  type="date"
                  value={performanceRange.to}
                  onChange={(event) => setPerformanceRange({ ...performanceRange, to: event.target.value })}
                  className="h-9 w-36 text-xs"
                  aria-label="تا تاریخ"
                />
                <Button size="sm" variant="outline" onClick={() => void loadPerformance()} loading={loading}>
                  اعمال
                </Button>
              </div>
            }
          />
          <CardBody className="pb-0">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="ساعت کارکرد" value={(performance?.totals.workedHours ?? 0).toLocaleString('fa-IR')} />
              <StatCard label="سفارش تسویه‌شده" value={formatCountFa(performance?.totals.ordersServed ?? 0)} tone="brand" />
              <StatCard label="درآمد وصولی" value={formatRial(performance?.totals.revenue ?? 0)} tone="success" />
            </div>
          </CardBody>
          <DataTable
            columns={performanceColumns}
            rows={performance?.items ?? []}
            rowKey={(row) => row.employeeId}
            empty={<EmptyState title="داده‌ای برای این بازه وجود ندارد" />}
          />
        </Card>
      )}

      <Modal
        open={employeeModal}
        onClose={() => setEmployeeModal(false)}
        title="پروفایل کارمند جدید"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEmployeeModal(false)}>
              انصراف
            </Button>
            <Button onClick={() => void createEmployee()} loading={busy} disabled={!employeeForm.userId}>
              ثبت
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="حساب کاربری" required hint="فقط کاربرانی که پروفایل پرسنلی ندارند فهرست می‌شوند.">
              <select
                value={employeeForm.userId}
                onChange={(event) => setEmployeeForm({ ...employeeForm, userId: event.target.value })}
                className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
              >
                <option value="">انتخاب کاربر</option>
                {(directory?.candidates ?? []).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.fullName} ({candidate.username})
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="عنوان شغلی">
            <Input
              value={employeeForm.positionFa}
              onChange={(event) => setEmployeeForm({ ...employeeForm, positionFa: event.target.value })}
              placeholder="مثلاً باریستا"
            />
          </Field>
          <Field label="کد پرسنلی">
            <Input
              value={employeeForm.employeeCode}
              onChange={(event) => setEmployeeForm({ ...employeeForm, employeeCode: event.target.value })}
              dir="ltr"
            />
          </Field>
          <Field label="دپارتمان">
            <select
              value={employeeForm.departmentId}
              onChange={(event) => setEmployeeForm({ ...employeeForm, departmentId: event.target.value })}
              className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
            >
              <option value="">—</option>
              {(directory?.departments ?? []).map((department) => (
                <option key={department.id} value={department.id}>
                  {department.nameFa}
                </option>
              ))}
            </select>
          </Field>
          <Field label="طبقه">
            <select
              value={employeeForm.floorId}
              onChange={(event) => setEmployeeForm({ ...employeeForm, floorId: event.target.value })}
              className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
            >
              <option value="">—</option>
              {(directory?.floors ?? []).map((floor) => (
                <option key={floor.id} value={floor.id}>
                  {floor.nameFa}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={shiftModal}
        onClose={() => setShiftModal(false)}
        title="شیفت جدید"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShiftModal(false)}>
              انصراف
            </Button>
            <Button
              onClick={() => void createShift()}
              loading={busy}
              disabled={!shiftForm.employeeId || !shiftForm.startsAt || !shiftForm.endsAt}
            >
              ثبت شیفت
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="کارمند" required>
              <select
                value={shiftForm.employeeId}
                onChange={(event) => setShiftForm({ ...shiftForm, employeeId: event.target.value })}
                className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
              >
                <option value="">انتخاب کارمند</option>
                {activeEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.fullName}
                    {employee.positionFa ? ` — ${employee.positionFa}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="شروع" required>
            <Input
              type="datetime-local"
              value={shiftForm.startsAt}
              onChange={(event) => setShiftForm({ ...shiftForm, startsAt: event.target.value })}
            />
          </Field>
          <Field label="پایان" required>
            <Input
              type="datetime-local"
              value={shiftForm.endsAt}
              onChange={(event) => setShiftForm({ ...shiftForm, endsAt: event.target.value })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="یادداشت">
              <Input value={shiftForm.note} onChange={(event) => setShiftForm({ ...shiftForm, note: event.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}
