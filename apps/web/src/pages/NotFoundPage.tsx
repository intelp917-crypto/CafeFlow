import { Link } from 'react-router-dom';
import { Card } from '@cafeflow/ui';

export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <Card className="w-full max-w-md p-8 text-center">
        <p className="num text-4xl font-bold text-brand-500">۴۰۴</p>
        <h1 className="mt-2 text-base font-bold text-ink">صفحه پیدا نشد</h1>
        <p className="mt-1 text-xs leading-6 text-muted">
          نشانی وارد شده وجود ندارد یا دسترسی به آن برای شما مجاز نیست.
        </p>
        <Link
          to="/"
          className="mt-5 inline-flex h-11 items-center justify-center rounded-xl bg-brand-500 px-5 text-sm font-medium text-white hover:bg-brand-600"
        >
          بازگشت به خانه
        </Link>
      </Card>
    </main>
  );
}
