import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Alert, Button, Card, Field, Input } from '@cafeflow/ui';
import { ApiError, api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBranding } from '../lib/branding';
import { DeveloperCredit } from '../components/DeveloperCredit';

export function LoginPage() {
  const { login, refresh, user, loading } = useAuth();
  const { nameFa: brandName } = useBranding();
  const [mode, setMode] = useState<'checking' | 'login' | 'setup'>('checking');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [installKey, setInstallKey] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get<{ required: boolean }>('/auth/setup')
      .then((data) => {
        if (active) setMode(data.required ? 'setup' : 'login');
      })
      .catch(() => {
        if (active) setMode('login');
      });
    return () => {
      active = false;
    };
  }, []);

  if (!loading && user && !user.mustChangePassword) {
    return <Navigate to="/admin" replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password, needsCode ? code.trim() : undefined);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'MFA_REQUIRED') {
        setNeedsCode(true);
      }
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const submitSetup = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (password !== confirmPassword) {
      setError('تکرار گذرواژه با گذرواژه مطابقت ندارد.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/setup', {
        installKey: installKey.trim(),
        username: username.trim(),
        password,
        ...(fullName.trim() ? { fullName: fullName.trim() } : {}),
      });
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const setupMode = mode === 'setup';

  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[1fr_1.05fr]">
      <main className="flex min-h-dvh flex-col justify-center px-5 py-10 sm:px-10 lg:px-14">
        <div className="mx-auto w-full max-w-sm space-y-5">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-full border border-brand-300/50 bg-brand-500/10 text-brand-600">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-6">
              <path d="M5 9h11a4 4 0 0 1 0 8h-1v2H8v-2H5z" strokeLinejoin="round" />
              <path d="M8 5c0 1.5 1 1.5 1 3M12 5c0 1.5 1 1.5 1 3" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <h1 className="font-display text-xl font-bold text-ink">
              {setupMode ? `راه‌اندازی ${brandName}` : `ورود به ${brandName}`}
            </h1>
            <p className="text-[11px] text-muted">
              {setupMode ? 'ساخت نخستین مدیر اصلی' : 'سامانه مدیریت کافه و رستوران'}
            </p>
          </div>
        </div>

        <Card className="p-6 sm:p-7">
          {setupMode ? (
            <form className="space-y-4" onSubmit={submitSetup} noValidate>
              {error ? <Alert tone="danger" title="راه‌اندازی انجام نشد">{error}</Alert> : null}

              <p className="text-xs leading-6 text-muted">
                هنوز مدیری ساخته نشده است. کلید نصب را وارد کنید و حساب مدیر اصلی را بسازید.
              </p>

              <Field
                label="کلید نصب"
                htmlFor="install-key"
                hint="کلید یک‌بارمصرف راه‌اندازی را از مالک سیستم بگیرید."
                required
              >
                <Input
                  id="install-key"
                  name="install-key"
                  autoComplete="off"
                  dir="ltr"
                  className="text-start font-mono"
                  value={installKey}
                  onChange={(event) => setInstallKey(event.target.value)}
                  required
                />
              </Field>

              <Field label="نام مدیر" htmlFor="full-name">
                <Input
                  id="full-name"
                  name="full-name"
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="مدیر سیستم"
                />
              </Field>

              <Field label="نام کاربری" htmlFor="username" required>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  dir="ltr"
                  className="text-start"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="admin"
                  required
                />
              </Field>

              <Field label="گذرواژه" htmlFor="password" hint="حداقل ۸ نویسه." required>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  dir="ltr"
                  className="text-start"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </Field>

              <Field label="تکرار گذرواژه" htmlFor="confirm-password" required>
                <Input
                  id="confirm-password"
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  dir="ltr"
                  className="text-start"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </Field>

              <Button type="submit" fullWidth loading={submitting}>
                ساخت مدیر و ورود
              </Button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={submit} noValidate>
              {error ? <Alert tone="danger" title="ورود انجام نشد">{error}</Alert> : null}

              <Field label="نام کاربری" htmlFor="username" required>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  dir="ltr"
                  className="text-start"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="username"
                  required
                />
              </Field>

              <Field label="گذرواژه" htmlFor="password" required>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  dir="ltr"
                  className="text-start"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </Field>

              {needsCode ? (
                <Field
                  label="کد تأیید دو مرحله‌ای"
                  htmlFor="mfa-code"
                  hint="کد ۶ رقمی برنامه احراز هویت یا یکی از کدهای پشتیبان (مثل ABCD-EFGH)."
                  required
                >
                  <Input
                    id="mfa-code"
                    name="one-time-code"
                    inputMode="text"
                    autoComplete="one-time-code"
                    dir="ltr"
                    className="text-center tracking-[0.35em]"
                    maxLength={9}
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, '').slice(0, 9))
                    }
                  />
                </Field>
              ) : null}

              <Button type="submit" fullWidth loading={submitting}>
                ورود
              </Button>
            </form>
          )}
        </Card>

        <p className="text-[10px] leading-5 text-muted">
          {setupMode
            ? 'این صفحه فقط تا زمانی نمایش داده می‌شود که هیچ مدیر اصلی فعالی وجود نداشته باشد.'
            : 'دسترسی‌ها بر اساس نقش شما تعیین می‌شود. در صورت فراموشی گذرواژه با مدیر سیستم تماس بگیرید.'}
        </p>

        <div className="mt-10">
          <DeveloperCredit />
        </div>
        </div>
      </main>

      <aside className="relative hidden lg:block">
        <img
          src="/images/barista.jpg"
          alt="باریستا در حال ریختن شیر برای طرح لاته"
          className="absolute inset-0 size-full object-cover"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-espresso/60" />
        <div className="relative flex h-full flex-col justify-between p-10 text-cream">
          <span className="font-display text-xl font-bold">{brandName}</span>
          <div>
            <p className="font-display text-3xl font-bold leading-snug">
              هر فنجان،<br />یک تصمیم دقیق.
            </p>
            <p className="mt-3 max-w-xs text-[11px] leading-6 text-cream/65">
              سفارش‌ها، صف آماده‌سازی، صندوق و گزارش‌ها در یک پنل؛ با نقش‌های جدا و ثبت رویدادها.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
