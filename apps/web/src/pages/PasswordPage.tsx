import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Field, Input } from '@cafeflow/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

export function PasswordPage() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setNotice(null);

    if (newPassword !== confirmPassword) {
      setError('تکرار گذرواژه با گذرواژه جدید مطابقت ندارد.');
      return;
    }
    if (newPassword.length < 8) {
      setError('گذرواژه جدید باید حداقل ۸ نویسه باشد.');
      return;
    }

    setSaving(true);
    try {
      await api.post('/auth/password', { currentPassword, newPassword, confirmPassword });
      setNotice('گذرواژه با موفقیت تغییر کرد. سایر نشست‌های شما بسته شدند.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    await logout();
    navigate('/staff/login', { replace: true });
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <Card className="p-6">
          <div className="mb-5 space-y-1">
            <h1 className="text-base font-bold text-ink">تغییر گذرواژه</h1>
            <p className="text-xs leading-6 text-muted">
              {user?.mustChangePassword
                ? 'برای ادامه کار باید گذرواژه حساب خود را تغییر دهید.'
                : 'پس از تغییر گذرواژه، سایر نشست‌های فعال شما بسته می‌شوند.'}
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {notice ? <Alert tone="success">{notice}</Alert> : null}

            <Field label="گذرواژه فعلی" htmlFor="current-password" required>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                dir="ltr"
                className="text-start"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </Field>

            <Field label="گذرواژه جدید" htmlFor="new-password" hint="حداقل ۸ نویسه." required>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                dir="ltr"
                className="text-start"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </Field>

            <Field label="تکرار گذرواژه جدید" htmlFor="confirm-password" required>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                dir="ltr"
                className="text-start"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </Field>

            <Button type="submit" fullWidth loading={saving}>
              ذخیره گذرواژه
            </Button>
          </form>
        </Card>

        <div className="flex items-center justify-center gap-3 text-xs">
          {user && !user.mustChangePassword ? (
            <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
              بازگشت به داشبورد
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            خروج از حساب
          </Button>
        </div>
      </div>
    </main>
  );
}
