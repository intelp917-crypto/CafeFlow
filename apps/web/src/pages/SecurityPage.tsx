import { useCallback, useEffect, useState } from 'react';
import { Breadcrumb } from '../lib/branding';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Spinner,
} from '@cafeflow/ui';
import type { MfaActivation, MfaEnrollment, MfaStatus } from '@cafeflow/shared';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTimeFa } from '../lib/format';

export function SecurityPage() {
  const { refresh } = useAuth();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<MfaStatus>('/auth/mfa');
      setStatus(response);
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

  const startEnrollment = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.post<MfaEnrollment>('/auth/mfa/enroll');
      setEnrollment(response);
      setCode('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const activated = await api.post<MfaActivation>('/auth/mfa/activate', { code: code.trim() });
      setEnrollment(null);
      setCode('');
      setRecoveryCodes(activated.recoveryCodes);
      setNotice('تأیید دو مرحله‌ای فعال شد؛ از این پس هنگام ورود کد برنامه احراز هویت لازم است.');
      await load();
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const regenerateRecovery = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', {
        password: recoveryPassword,
        code: recoveryCode.trim(),
      });
      setRecoveryCodes(response.recoveryCodes);
      setRecoveryPassword('');
      setRecoveryCode('');
      setNotice('کدهای پشتیبان جدید ساخته شد؛ کدهای قبلی دیگر کار نمی‌کنند.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post('/auth/mfa/disable', {
        password,
        code: disableCode.trim() || undefined,
      });
      setPassword('');
      setDisableCode('');
      setNotice('تأیید دو مرحله‌ای غیرفعال شد.');
      await load();
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="امنیت حساب"
        description="تأیید دو مرحله‌ای با کد شش‌رقمی مبتنی بر زمان (TOTP). کلید فقط یک‌بار نمایش داده می‌شود و در سرور نگه‌داری می‌شود."
        breadcrumb={<Breadcrumb page="امنیت" />}
        actions={
          status ? (
            status.enabled ? (
              <Badge tone="success" dot>فعال</Badge>
            ) : (
              <Badge tone="warning" dot>غیرفعال</Badge>
            )
          ) : null
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {recoveryCodes.length > 0 ? (
        <Card>
          <CardHeader
            title="کدهای پشتیبان — فقط همین یک‌بار"
            description="هر کد یک‌بار قابل استفاده است. آن‌ها را در جای امن نگه دارید؛ در سرور فقط هش ذخیره می‌شود."
          />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {recoveryCodes.map((item) => (
                <code
                  key={item}
                  dir="ltr"
                  className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-center text-xs text-ink"
                >
                  {item}
                </code>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => setRecoveryCodes([])}>
              ذخیره کردم
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {loading && !status ? (
        <Card className="flex justify-center py-16 text-brand-600">
          <Spinner size="lg" />
        </Card>
      ) : status?.enabled ? (
        <Card>
          <CardHeader
            title="تأیید دو مرحله‌ای فعال است"
            description={status.confirmedAt ? `فعال‌شده در ${formatDateTimeFa(status.confirmedAt)}` : undefined}
          />
          <CardBody className="space-y-4">
            <p className="text-[11px] leading-6 text-muted">
              برای خاموش‌کردن، گذرواژه و یک کد تازه از برنامه احراز هویت لازم است. اگر دستگاه خود را گم کرده‌اید،
              مدیر سیستم باید کلید را از پایگاه داده بازنشانی کند.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="گذرواژه" required>
                <Input
                  type="password"
                  dir="ltr"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Field label="کد تأیید" required>
                <Input
                  inputMode="numeric"
                  dir="ltr"
                  className="text-center tracking-[0.4em]"
                  maxLength={6}
                  value={disableCode}
                  onChange={(event) => setDisableCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </Field>
            </div>
            <Button variant="outline" onClick={() => void disable()} loading={busy} disabled={!password || disableCode.length !== 6}>
              غیرفعال‌سازی تأیید دو مرحله‌ای
            </Button>

            <div className="space-y-3 border-t border-line pt-4">
              <p className="text-xs font-semibold text-ink">کدهای پشتیبان جدید</p>
              <p className="text-[10px] leading-5 text-muted">
                با ساخت مجموعه جدید، همه کدهای قبلی باطل می‌شوند. برای انجام این کار گذرواژه و یک کد فعلی لازم است.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="گذرواژه" required>
                  <Input
                    type="password"
                    dir="ltr"
                    autoComplete="current-password"
                    value={recoveryPassword}
                    onChange={(event) => setRecoveryPassword(event.target.value)}
                  />
                </Field>
                <Field label="کد فعلی برنامه" required>
                  <Input
                    inputMode="numeric"
                    dir="ltr"
                    className="text-center tracking-[0.4em]"
                    maxLength={6}
                    value={recoveryCode}
                    onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </Field>
              </div>
              <Button
                variant="ghost"
                onClick={() => void regenerateRecovery()}
                loading={busy}
                disabled={!recoveryPassword || recoveryCode.length !== 6}
              >
                ساخت کدهای پشتیبان جدید
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="فعال‌سازی تأیید دو مرحله‌ای"
            description="با Google Authenticator، Aegis، 1Password یا هر برنامه TOTP سازگار است."
          />
          <CardBody className="space-y-4">
            {enrollment ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-line bg-canvas/60 p-4">
                  <p className="text-[11px] text-muted">کلید را در برنامه احراز هویت وارد کنید (یا لینک زیر را باز کنید):</p>
                  <p className="num mt-2 select-all break-all text-sm font-bold text-ink" dir="ltr">
                    {enrollment.secret}
                  </p>
                  <a
                    href={enrollment.otpauthUrl}
                    className="mt-2 inline-block break-all text-[10px] text-brand-600 underline"
                    dir="ltr"
                  >
                    {enrollment.otpauthUrl}
                  </a>
                </div>
                <Field label="کد ۶ رقمی برنامه" required hint="پس از افزودن کلید، کد نمایش‌داده‌شده را وارد کنید.">
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    dir="ltr"
                    className="text-center tracking-[0.5em]"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button onClick={() => void activate()} loading={busy} disabled={code.length !== 6}>
                    فعال‌سازی
                  </Button>
                  <Button variant="ghost" onClick={() => setEnrollment(null)}>
                    انصراف
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-[11px] leading-6 text-muted">
                  پس از فعال‌سازی، ورود بدون کد شش‌رقمی ممکن نیست. اگر برنامه احراز هویت را گم کنید، دسترسی به
                  حساب نیازمند بازنشانی توسط مدیر است.
                </p>
                <Button onClick={() => void startEnrollment()} loading={busy}>
                  شروع فعال‌سازی
                </Button>
              </>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
