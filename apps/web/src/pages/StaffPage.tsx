import { useCallback, useEffect, useState } from 'react';
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
  type Column,
} from '@cafeflow/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTimeFa } from '../lib/format';
import type { RoleSummary, StaffMember } from '../lib/types';

function RolePicker({
  roles,
  selected,
  onChange,
}: {
  roles: RoleSummary[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  if (roles.length === 0) return <p className="text-[11px] text-muted">نقشی برای انتخاب بارگذاری نشده است.</p>;

  return (
    <div className="flex flex-wrap gap-2">
      {roles.map((role) => {
        const active = selected.includes(role.key);
        return (
          <label
            key={role.key}
            className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] ${
              active ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line text-muted'
            }`}
          >
            <input
              type="checkbox"
              checked={active}
              onChange={() =>
                onChange(active ? selected.filter((key) => key !== role.key) : [...selected, role.key])
              }
              className="size-3.5 accent-brand-500"
            />
            {role.nameFa}
          </label>
        );
      })}
    </div>
  );
}

export function StaffPage() {
  const { hasPermission } = useAuth();
  const canReadRoles = hasPermission('roles.read');
  const canWrite = hasPermission('users.write');

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [permissionCount, setPermissionCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', fullName: '', password: '', roleKeys: [] as string[] });

  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: '',
    isActive: true,
    roleKeys: [] as string[],
    newPassword: '',
    resetMfa: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const staffResponse = await api.get<{ items: StaffMember[] }>('/users');
      setStaff(staffResponse.items);

      if (canReadRoles) {
        const [rolesResponse, permissionsResponse] = await Promise.all([
          api.get<{ items: RoleSummary[] }>('/roles'),
          api.get<{ items: unknown[] }>('/permissions'),
        ]);
        setRoles(rolesResponse.items);
        setPermissionCount(permissionsResponse.items.length);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [canReadRoles]);

  useEffect(() => {
    void load();
  }, [load]);

  const createStaff = async () => {
    setBusy(true);
    try {
      const created = await api.post<StaffMember>('/users', {
        username: createForm.username,
        fullName: createForm.fullName,
        password: createForm.password,
        roleKeys: createForm.roleKeys,
      });
      setCreateOpen(false);
      setCreateForm({ username: '', fullName: '', password: '', roleKeys: [] });
      setNotice(`حساب «${created.fullName}» ساخته شد؛ اولین ورود باید گذرواژه را تغییر دهد.`);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (row: StaffMember) => {
    setEditing(row);
    setEditForm({
      fullName: row.fullName,
      isActive: row.isActive,
      roleKeys: row.roles,
      newPassword: '',
      resetMfa: false,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await api.patch<StaffMember>(`/users/${editing.id}`, {
        fullName: editForm.fullName,
        isActive: editForm.isActive,
        roleKeys: editForm.roleKeys,
        newPassword: editForm.newPassword || undefined,
        resetMfa: editForm.resetMfa || undefined,
      });
      setEditing(null);
      setNotice('تغییرات حساب کاربری ذخیره شد.');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<StaffMember>[] = [
    { key: 'name', header: 'نام', render: (row) => <span className="font-medium">{row.fullName}</span> },
    { key: 'username', header: 'نام کاربری', render: (row) => <span className="num text-muted" dir="ltr">{row.username}</span> },
    {
      key: 'roles',
      header: 'نقش‌ها',
      render: (row) =>
        row.roleNamesFa.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {row.roleNamesFa.map((role) => (
              <Badge key={role} tone="brand">{role}</Badge>
            ))}
          </span>
        ) : (
          <span className="text-muted">بدون نقش</span>
        ),
    },
    {
      key: 'status',
      header: 'وضعیت',
      render: (row) => (row.isActive ? <Badge tone="success" dot>فعال</Badge> : <Badge tone="danger" dot>غیرفعال</Badge>),
    },
    { key: 'lastLogin', header: 'آخرین ورود', render: (row) => <span className="text-muted">{formatDateTimeFa(row.lastLoginAt)}</span> },
    ...(canWrite
      ? [
          {
            key: 'actions',
            header: 'عملیات',
            render: (row: StaffMember) => (
              <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                ویرایش
              </Button>
            ),
          } satisfies Column<StaffMember>,
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="کارکنان و نقش‌ها"
        description="ساخت و ویرایش حساب کارکنان، تخصیص نقش و بازنشانی گذرواژه. دسترسی‌ها همیشه در سرور بررسی می‌شوند."
        breadcrumb="کافه‌فلو / کارکنان"
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{staff.length} حساب کاربری</span>
            {canWrite ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                کارمند جدید
              </Button>
            ) : null}
          </div>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading && staff.length === 0 ? (
        <Card className="flex items-center justify-center py-16 text-brand-600">
          <Spinner size="lg" />
        </Card>
      ) : error && staff.length === 0 ? (
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="کارکنان" description="حساب‌های فعال و غیرفعال به همراه نقش‌هایشان" />
            <DataTable
              columns={columns}
              rows={staff}
              rowKey={(row) => row.id}
              empty={<EmptyState title="کاربری ثبت نشده است" />}
            />
          </Card>

          {canReadRoles ? (
            <Card>
              <CardHeader
                title="نقش‌ها"
                description={permissionCount === null ? 'مجوزها در حال شمارش' : `${permissionCount} مجوز دقیق در سیستم تعریف شده است`}
              />
              <CardBody className="space-y-2">
                {roles.length === 0 ? (
                  <p className="text-xs text-muted">نقشی تعریف نشده است.</p>
                ) : (
                  roles.map((role) => (
                    <div
                      key={role.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5"
                    >
                      <div className="space-y-0.5">
                        <p className="text-xs font-semibold text-ink">
                          {role.nameFa}
                          {role.isSystem ? <span className="ms-2 text-[10px] font-normal text-muted">پیش‌فرض سیستم</span> : null}
                        </p>
                        <p className="text-[10px] text-muted">{role.descriptionFa ?? '—'}</p>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted">
                        <Badge tone="neutral">{role.permissionCount} مجوز</Badge>
                        <Badge tone="neutral">{role.userCount} کاربر</Badge>
                      </div>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>
          ) : null}
        </>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="کارمند جدید"
        description="حساب تازه باید در اولین ورود گذرواژه را تغییر دهد."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              انصراف
            </Button>
            <Button
              onClick={() => void createStaff()}
              loading={busy}
              disabled={
                createForm.username.trim().length < 3 ||
                createForm.fullName.trim().length < 2 ||
                createForm.password.length < 8 ||
                createForm.roleKeys.length === 0
              }
            >
              ساخت حساب
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="نام کاربری" required hint="فقط حروف انگلیسی، رقم، نقطه، خط تیره">
            <Input
              value={createForm.username}
              onChange={(event) => setCreateForm({ ...createForm, username: event.target.value })}
              dir="ltr"
            />
          </Field>
          <Field label="نام و نام خانوادگی" required>
            <Input
              value={createForm.fullName}
              onChange={(event) => setCreateForm({ ...createForm, fullName: event.target.value })}
            />
          </Field>
          <Field label="گذرواژه" required hint="حداقل ۸ نویسه">
            <Input
              type="password"
              value={createForm.password}
              onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })}
              dir="ltr"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="نقش‌ها" required>
              <RolePicker
                roles={roles}
                selected={createForm.roleKeys}
                onChange={(roleKeys) => setCreateForm({ ...createForm, roleKeys })}
              />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `ویرایش ${editing.fullName}` : 'ویرایش کارمند'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              انصراف
            </Button>
            <Button onClick={() => void saveEdit()} loading={busy} disabled={editForm.roleKeys.length === 0}>
              ذخیره
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="نام و نام خانوادگی" required>
            <Input value={editForm.fullName} onChange={(event) => setEditForm({ ...editForm, fullName: event.target.value })} />
          </Field>
          <Field label="گذرواژه جدید" hint="خالی بگذارید تا تغییر نکند؛ نشست‌ها بسته می‌شوند.">
            <Input
              type="password"
              value={editForm.newPassword}
              onChange={(event) => setEditForm({ ...editForm, newPassword: event.target.value })}
              dir="ltr"
            />
          </Field>
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={editForm.isActive}
                onChange={(event) => setEditForm({ ...editForm, isActive: event.target.checked })}
                className="size-4 accent-brand-500"
              />
              حساب فعال باشد
            </label>
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={editForm.resetMfa}
                onChange={(event) => setEditForm({ ...editForm, resetMfa: event.target.checked })}
                className="size-4 accent-brand-500"
              />
              بازنشانی تأیید دو مرحله‌ای (برای دستگاه گمشده)
            </label>
            <p className="text-[10px] leading-5 text-muted">
              کلید TOTP و همه کدهای پشتیبان کاربر پاک می‌شوند؛ کاربر با گذرواژه وارد می‌شود و باید دوباره ثبت‌نام کند.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Field label="نقش‌ها" required>
              <RolePicker
                roles={roles}
                selected={editForm.roleKeys}
                onChange={(roleKeys) => setEditForm({ ...editForm, roleKeys })}
              />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}
