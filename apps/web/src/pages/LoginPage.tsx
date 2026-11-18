import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Alert, Button, Card, Field, Input } from '@cafeflow/ui';
import { errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { login, user, loading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user && !user.mustChangePassword) {
    return <Navigate to="/admin" replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-sm">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-7">
              <path d="M5 9h11a4 4 0 0 1 0 8h-1v2H8v-2H5z" strokeLinejoin="round" />
              <path d="M8 5c0 1.5 1 1.5 1 3M12 5c0 1.5 1 1.5 1 3" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <h1 className="text-lg font-bold text-ink">ورود به کافه‌فلو</h1>
            <p className="text-xs text-muted">سامانه مدیریت کافه و رستوران</p>
          </div>
        </div>

        <Card className="p-6">
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

            <Button type="submit" fullWidth loading={submitting}>
              ورود
            </Button>
          </form>
        </Card>

        <p className="text-center text-[10px] leading-5 text-muted">
          دسترسی‌ها بر اساس نقش شما تعیین می‌شود. در صورت فراموشی گذرواژه با مدیر سیستم تماس بگیرید.
        </p>
      </div>
    </div>
  );
}
