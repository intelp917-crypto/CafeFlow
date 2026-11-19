import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Alert, Button, Card, CardBody, CardHeader, ErrorState, Field, Input, PageHeader, Spinner } from '@cafeflow/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { SettingsResponse } from '../lib/types';

const SELECT_CLASS =
  'h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-500/10';

export function SettingsPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('settings.write');

  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [form, setForm] = useState({
    restaurantNameFa: '',
    digitMode: 'fa' as 'fa' | 'latin',
    serviceChargePercent: 0,
    taxPercent: 0,
    logoUrl: '',
    addressFa: '',
    phone: '',
    email: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<SettingsResponse>('/settings');
      setSettings(data);
      setForm({
        restaurantNameFa: data.restaurantNameFa,
        digitMode: data.digitMode,
        serviceChargePercent: data.serviceChargePercent,
        taxPercent: data.taxPercent,
        logoUrl: data.logoUrl,
        addressFa: data.addressFa,
        phone: data.phone,
        email: data.email,
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.patch<SettingsResponse>('/settings', {
        restaurantNameFa: form.restaurantNameFa.trim(),
        digitMode: form.digitMode,
        serviceChargePercent: Number(form.serviceChargePercent),
        taxPercent: Number(form.taxPercent),
        logoUrl: form.logoUrl,
        addressFa: form.addressFa.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
      });
      setSettings(updated);
      setNotice('تنظیمات ذخیره شد.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const pickLogo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('فرمت لوگو باید PNG، JPEG یا WebP باشد.');
      return;
    }
    if (file.size > 220 * 1024) {
      setError('حجم لوگو بیش از ۲۲۰ کیلوبایت است.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      setForm((current) => ({ ...current, logoUrl: String(reader.result) }));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="تنظیمات سیستم"
        description="نام مجموعه، نحوه نمایش اعداد و درصدهای مالی. تغییرات در گزارش رویدادها با مقدار قبل و بعد ثبت می‌شود."
        breadcrumb="کافه‌فلو / تنظیمات"
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger" title="ذخیره نشد">{error}</Alert> : null}

      {loading && !settings ? (
        <Card className="flex items-center justify-center py-16 text-brand-600">
          <Spinner size="lg" />
        </Card>
      ) : !settings ? (
        <Card>
          <ErrorState message="تنظیمات دریافت نشد." onRetry={() => void load()} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="تنظیمات عمومی" description={canWrite ? 'فیلدها را تغییر دهید و ذخیره کنید.' : 'شما فقط اجازه مشاهده تنظیمات را دارید.'} />
            <CardBody>
              <form onSubmit={submit} className="space-y-4">
                <Field label="نام رستوران (فارسی)" htmlFor="restaurant-name" required>
                  <Input
                    id="restaurant-name"
                    value={form.restaurantNameFa}
                    onChange={(event) => setForm((current) => ({ ...current, restaurantNameFa: event.target.value }))}
                    disabled={!canWrite}
                    required
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="نحوه نمایش اعداد" htmlFor="digit-mode" hint="برای همه رابط‌های کاربری اعمال می‌شود.">
                    <select
                      id="digit-mode"
                      className={SELECT_CLASS}
                      value={form.digitMode}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, digitMode: event.target.value as 'fa' | 'latin' }))
                      }
                      disabled={!canWrite}
                    >
                      <option value="fa">اعداد فارسی</option>
                      <option value="latin">اعداد لاتین</option>
                    </select>
                  </Field>

                  <Field label="واحد پول" htmlFor="currency" hint="فقط ریال ایران پشتیبانی می‌شود.">
                    <Input id="currency" value="ریال ایران (IRR)" disabled readOnly />
                  </Field>

                  <Field label="درصد حق سرویس" htmlFor="service-charge" hint="بین ۰ تا ۳۰ درصد.">
                    <Input
                      id="service-charge"
                      type="number"
                      min={0}
                      max={30}
                      className="num"
                      value={form.serviceChargePercent}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, serviceChargePercent: Number(event.target.value) }))
                      }
                      disabled={!canWrite}
                    />
                  </Field>

                  <Field label="درصد مالیات بر ارزش افزوده" htmlFor="tax" hint="بین ۰ تا ۳۰ درصد.">
                    <Input
                      id="tax"
                      type="number"
                      min={0}
                      max={30}
                      className="num"
                      value={form.taxPercent}
                      onChange={(event) => setForm((current) => ({ ...current, taxPercent: Number(event.target.value) }))}
                      disabled={!canWrite}
                    />
                  </Field>
                </div>

                {canWrite ? (
                  <div className="flex justify-end">
                    <Button type="submit" loading={saving}>ذخیره تنظیمات</Button>
                  </div>
                ) : null}
              </form>
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader
              title="هویت کافه"
              description="نام، لوگو و مشخصات تماس که در منوی مشتری و برنامه نمایش داده می‌شود."
            />
            <CardBody>
              <form onSubmit={submit} className="space-y-4">
                <Field label="نام کافه (فارسی)" htmlFor="cafe-name" required>
                  <Input
                    id="cafe-name"
                    value={form.restaurantNameFa}
                    onChange={(event) => setForm((current) => ({ ...current, restaurantNameFa: event.target.value }))}
                    disabled={!canWrite}
                    required
                  />
                </Field>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface">
                    {form.logoUrl ? (
                      <img src={form.logoUrl} alt="پیش‌نمایش لوگو" className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-xs text-muted">بدون لوگو</span>
                    )}
                  </div>
                  {canWrite ? (
                    <div className="flex flex-wrap gap-2">
                      <label className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-brand-400">
                        انتخاب لوگو
                        <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pickLogo} />
                      </label>
                      {form.logoUrl ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setForm((current) => ({ ...current, logoUrl: '' }))}
                        >
                          حذف لوگو
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="text-xs text-muted">PNG، JPEG یا WebP تا ۲۲۰ کیلوبایت.</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="شماره تماس" htmlFor="cafe-phone">
                    <Input
                      id="cafe-phone"
                      className="num"
                      dir="ltr"
                      value={form.phone}
                      onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                      disabled={!canWrite}
                    />
                  </Field>
                  <Field label="ایمیل" htmlFor="cafe-email">
                    <Input
                      id="cafe-email"
                      type="email"
                      dir="ltr"
                      value={form.email}
                      onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                      disabled={!canWrite}
                    />
                  </Field>
                </div>

                <Field label="نشانی" htmlFor="cafe-address">
                  <Input
                    id="cafe-address"
                    value={form.addressFa}
                    onChange={(event) => setForm((current) => ({ ...current, addressFa: event.target.value }))}
                    disabled={!canWrite}
                  />
                </Field>

                {canWrite ? (
                  <div className="flex justify-end">
                    <Button type="submit" loading={saving}>ذخیره هویت کافه</Button>
                  </div>
                ) : null}
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="اطلاعات سیستم" />
            <CardBody className="space-y-3 text-xs">
              <div>
                <p className="text-muted">منطقه زمانی</p>
                <p className="font-medium">{settings.timezone}</p>
              </div>
              <div>
                <p className="text-muted">زبان و تقویم</p>
                <p className="font-medium">فارسی — تقویم جلالی ({settings.locale})</p>
              </div>
              <div>
                <p className="text-muted">پایگاه داده</p>
                <p className="font-medium">SQLite (WAL) — سازگار با مسیر مهاجرت PostgreSQL</p>
              </div>
              <div>
                <p className="text-muted">نسخه</p>
                <p className="font-medium">۰.۹.۰</p>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
