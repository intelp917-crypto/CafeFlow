import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
  type Column,
} from '@cafeflow/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTimeFa } from '../lib/format';
import type { RoleSummary, StaffMember } from '../lib/types';

export function StaffPage() {
  const { hasPermission } = useAuth();
  const canReadRoles = hasPermission('roles.read');

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [permissionCount, setPermissionCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="کارکنان و نقش‌ها"
        description="فهرست حساب‌های کاربری، نقش‌های تخصیص‌یافته و مجوزهای دقیق هر نقش. دسترسی‌ها همیشه در سرور بررسی می‌شوند."
        breadcrumb="کافه‌فلو / کارکنان"
        actions={<span className="text-xs text-muted">{staff.length} حساب کاربری</span>}
      />

      {error ? (
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      ) : loading && staff.length === 0 ? (
        <Card className="flex items-center justify-center py-16 text-brand-600">
          <Spinner size="lg" />
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
    </div>
  );
}
