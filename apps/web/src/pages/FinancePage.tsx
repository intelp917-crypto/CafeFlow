import { useCallback, useEffect, useState } from 'react';
import { Breadcrumb } from '../lib/branding';
import {
  Alert,
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
  type Column,
} from '@cafeflow/ui';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS_FA,
  type ExpenseCategory,
  type ExpenseRow,
  type FinanceSummaryResponse,
} from '@cafeflow/shared';
import { api, errorMessage } from '../lib/api';
import { formatCountFa, formatDateTimeFa, formatRial } from '../lib/format';

function tehranIsoDay(offsetDays = 0): string {
  return new Date(Date.now() + 210 * 60_000 - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function FinancePage() {
  const [range, setRange] = useState({ from: tehranIsoDay(29), to: tehranIsoDay() });
  const [data, setData] = useState<FinanceSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expenseModal, setExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    category: 'other' as ExpenseCategory,
    amount: '',
    description: '',
    spentAt: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<FinanceSummaryResponse>(`/finance/summary?from=${range.from}&to=${range.to}`);
      setData(response);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const createExpense = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post<ExpenseRow>('/finance/expenses', {
        category: expenseForm.category,
        amount: Number(expenseForm.amount),
        description: expenseForm.description || undefined,
        spentAt: localInputToIso(expenseForm.spentAt) ?? undefined,
      });
      setExpenseModal(false);
      setExpenseForm({ category: 'other', amount: '', description: '', spentAt: '' });
      setNotice('هزینه ثبت شد.');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const categoryColumns: Column<FinanceSummaryResponse['expensesByCategory'][number]>[] = [
    { key: 'label', header: 'دسته', render: (row) => <span className="text-xs">{row.labelFa}</span> },
    { key: 'total', header: 'جمع', render: (row) => <span className="num text-xs">{formatRial(row.total)}</span> },
  ];

  const dailyColumns: Column<FinanceSummaryResponse['daily'][number]>[] = [
    { key: 'date', header: 'روز', render: (row) => <span className="num text-[11px]" dir="ltr">{row.date}</span> },
    { key: 'revenue', header: 'درآمد', render: (row) => <span className="num text-xs">{formatRial(row.revenue)}</span> },
    { key: 'expenses', header: 'هزینه', render: (row) => <span className="num text-xs">{formatRial(row.expenses)}</span> },
    {
      key: 'profit',
      header: 'سود',
      render: (row) => (
        <span className={`num text-xs ${row.profit < 0 ? 'text-danger-600' : 'text-success-700'}`}>
          {formatRial(row.profit)}
        </span>
      ),
    },
  ];

  const expenseColumns: Column<ExpenseRow>[] = [
    { key: 'spent', header: 'زمان', render: (row) => <span className="text-[11px]">{formatDateTimeFa(row.spentAt)}</span> },
    { key: 'category', header: 'دسته', render: (row) => <span className="text-xs">{row.categoryLabelFa}</span> },
    { key: 'amount', header: 'مبلغ', render: (row) => <span className="num text-xs">{formatRial(row.amount)}</span> },
    { key: 'description', header: 'شرح', render: (row) => <span className="text-[11px] text-muted">{row.description ?? '—'}</span> },
    { key: 'by', header: 'ثبت‌کننده', render: (row) => <span className="text-[11px] text-muted">{row.createdByName ?? '—'}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="مالی و سود و زیان"
        description="درآمد از دفتر پرداخت‌های تأییدشده و هزینه‌ها از دفتر هزینه‌ها محاسبه می‌شود؛ سود و حاشیه سود همان‌جا ساخته می‌شوند."
        breadcrumb={<Breadcrumb page="مالی" />}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Input
              type="date"
              value={range.from}
              onChange={(event) => setRange({ ...range, from: event.target.value })}
              className="h-9 w-36 text-xs"
              aria-label="از تاریخ"
            />
            <Input
              type="date"
              value={range.to}
              onChange={(event) => setRange({ ...range, to: event.target.value })}
              className="h-9 w-36 text-xs"
              aria-label="تا تاریخ"
            />
            <Button size="sm" variant="outline" onClick={() => void load()} loading={loading}>
              اعمال
            </Button>
            <Button size="sm" onClick={() => setExpenseModal(true)}>
              ثبت هزینه
            </Button>
          </div>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading && !data ? (
        <Card className="flex justify-center py-16 text-brand-600">
          <Spinner size="lg" />
        </Card>
      ) : !data ? (
        <Card>
          <ErrorState message={error ?? 'داده‌ای دریافت نشد.'} onRetry={() => void load()} />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="درآمد خالص" value={formatRial(data.netRevenue)} tone="brand" />
            <StatCard label="هزینه‌ها" value={formatRial(data.expenses)} tone="warning" />
            <StatCard label="سود" value={formatRial(data.profit)} tone={data.profit < 0 ? 'danger' : 'success'} />
            <StatCard label="حاشیه سود" value={`${data.marginPercent.toLocaleString('fa-IR')}٪`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="هزینه به تفکیک دسته" description={`بازه ${data.from} تا ${data.to}`} />
              {data.expensesByCategory.length > 0 ? (
                <DataTable
                  columns={categoryColumns}
                  rows={data.expensesByCategory}
                  rowKey={(row) => row.category}
                />
              ) : (
                <EmptyState title="در این بازه هزینه‌ای ثبت نشده است" />
              )}
            </Card>

            <Card>
              <CardHeader
                title="خلاصه درآمد"
                description="درآمد ناخالص، بازپرداخت و تعداد روزهای دارای گردش"
                action={<span className="text-[10px] text-muted">{formatCountFa(data.daily.length)} روز</span>}
              />
              <CardBody className="space-y-2 text-[11px] leading-6 text-muted">
                <p>
                  درآمد ناخالص: <span className="num text-ink">{formatRial(data.revenue)}</span>
                </p>
                <p>
                  بازپرداخت: <span className="num text-ink">{formatRial(data.refunds)}</span>
                </p>
                <p>
                  درآمد خالص: <span className="num text-ink">{formatRial(data.netRevenue)}</span>
                </p>
                <p>
                  هزینه: <span className="num text-ink">{formatRial(data.expenses)}</span>
                </p>
                <p>
                  سود: <span className="num text-ink">{formatRial(data.profit)}</span>
                </p>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="گردش روزانه" description="درآمد، هزینه و سود هر روز در بازه انتخابی" />
            {data.daily.length > 0 ? (
              <DataTable columns={dailyColumns} rows={data.daily} rowKey={(row) => row.date} />
            ) : (
              <EmptyState title="گردشی در این بازه ثبت نشده است" />
            )}
          </Card>

          <Card>
            <CardHeader title="هزینه‌های ثبت‌شده" description="۶۰ ردیف آخر بازه انتخابی" />
            {data.expensesList.length > 0 ? (
              <DataTable columns={expenseColumns} rows={data.expensesList} rowKey={(row) => row.id} />
            ) : (
              <EmptyState title="هزینه‌ای ثبت نشده است" description="از دکمه «ثبت هزینه» شروع کنید." />
            )}
          </Card>
        </>
      )}

      <Modal
        open={expenseModal}
        onClose={() => setExpenseModal(false)}
        title="ثبت هزینه"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setExpenseModal(false)}>
              انصراف
            </Button>
            <Button onClick={() => void createExpense()} loading={busy} disabled={Number(expenseForm.amount) <= 0}>
              ثبت
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="دسته" required>
            <select
              value={expenseForm.category}
              onChange={(event) =>
                setExpenseForm({ ...expenseForm, category: event.target.value as ExpenseCategory })
              }
              className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
            >
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {EXPENSE_CATEGORY_LABELS_FA[category]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="مبلغ (ریال)" required>
            <Input
              type="number"
              min={1}
              value={expenseForm.amount}
              onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })}
            />
          </Field>
          <Field label="زمان هزینه" hint="خالی بماند، همین حالا ثبت می‌شود.">
            <Input
              type="datetime-local"
              value={expenseForm.spentAt}
              onChange={(event) => setExpenseForm({ ...expenseForm, spentAt: event.target.value })}
            />
          </Field>
          <Field label="شرح">
            <Input
              value={expenseForm.description}
              onChange={(event) => setExpenseForm({ ...expenseForm, description: event.target.value })}
              placeholder="مثلاً قبض برق مهر"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
