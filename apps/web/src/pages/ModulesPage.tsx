import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Card, CardBody, CardHeader, ErrorState, PageHeader, Spinner, Switch } from '@cafeflow/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { ModuleStatus } from '../lib/types';

export function ModulesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('modules.manage');

  const [modules, setModules] = useState<ModuleStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ items: ModuleStatus[] }>('/modules');
      setModules(data.items);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (module: ModuleStatus, enabled: boolean) => {
    setSavingKey(module.key);
    setError(null);
    setNotice(null);
    try {
      await api.patch(`/modules/${module.key}`, { enabled });
      setModules((current) => current.map((item) => (item.key === module.key ? { ...item, enabled } : item)));
      setNotice(`وضعیت ماژول «${module.nameFa}» ${enabled ? 'فعال' : 'غیرفعال'} شد.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingKey(null);
    }
  };

  const core = modules.filter((module) => !module.configurable);
  const optional = modules.filter((module) => module.configurable);

  const renderList = (items: ModuleStatus[]) => (
    <ul className="divide-y divide-line">
      {items.map((module) => (
        <li key={module.key} className="flex flex-wrap items-start justify-between gap-3 py-3.5">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-ink">{module.nameFa}</p>
              {module.enabled ? (
                <Badge tone="success" dot>فعال</Badge>
              ) : (
                <Badge tone="neutral" dot>غیرفعال</Badge>
              )}
              {!module.configurable ? <Badge tone="brand">هسته</Badge> : null}
            </div>
            <p className="max-w-2xl text-[11px] leading-6 text-muted">{module.descriptionFa}</p>
          </div>

          <div className="flex items-center gap-2">
            {savingKey === module.key ? <Spinner size="sm" className="text-brand-600" /> : null}
            <Switch
              checked={module.enabled}
              onChange={(next) => void toggle(module, next)}
              disabled={!module.configurable || !canManage || savingKey === module.key}
              label={`تغییر وضعیت ${module.nameFa}`}
            />
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="ماژول‌ها و ویژگی‌ها"
        description="ماژول‌های هسته همیشه فعال‌اند. ماژول‌های کسب‌وکار اختیاری‌اند، به‌صورت پیش‌فرض خاموش هستند و داده‌هایشان با غیرفعال شدن حذف نمی‌شود."
        breadcrumb="کافه‌فلو / ماژول‌ها"
        actions={<span className="text-xs text-muted">{modules.length} ماژول ثبت‌شده</span>}
      />

      {error ? <Alert tone="danger" title="تغییر وضعیت انجام نشد">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {loading && modules.length === 0 ? (
        <Card className="flex items-center justify-center py-16 text-brand-600">
          <Spinner size="lg" />
        </Card>
      ) : modules.length === 0 ? (
        <Card>
          <ErrorState message="فهرست ماژول‌ها دریافت نشد." onRetry={() => void load()} />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title="ماژول‌های کسب‌وکار اختیاری"
              description="فعال‌سازی هر ماژول نیازمند مجوز «مدیریت ماژول‌ها» است و در گزارش رویدادها ثبت می‌شود."
            />
            <CardBody>{optional.length > 0 ? renderList(optional) : <p className="text-xs text-muted">ماژول اختیاری تعریف نشده است.</p>}</CardBody>
          </Card>

          <Card>
            <CardHeader title="ماژول‌های هسته" description="این ماژول‌ها بخشی از جریان اصلی سفارش هستند و قابل غیرفعال‌سازی نیستند." />
            <CardBody>{renderList(core)}</CardBody>
          </Card>

          <Alert tone="info" title="نکته پیاده‌سازی">
            غیرفعال بودن یک ماژول فقط دسترسی به API و رابط کاربری آن را می‌بندد؛ داده‌های موجود حفظ می‌شوند و پس از فعال‌سازی دوباره در دسترس قرار می‌گیرند.
          </Alert>
        </>
      )}
    </div>
  );
}
