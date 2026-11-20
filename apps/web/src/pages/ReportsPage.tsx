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
  PageHeader,
  Spinner,
  StatCard,
  type Column,
} from '@cafeflow/ui';
import {
  formatJalali,
  toGregorian,
  toLatinDigits,
  type ReportSummary,
} from '@cafeflow/shared';
import { JalaliDatePicker } from '../components/reports/JalaliDatePicker';
import { api, errorMessage } from '../lib/api';
import { formatRial } from '../lib/format';

type Preset = 'today' | '7' | '30' | 'custom';

const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: 'today', label: 'امروز' },
  { key: '7', label: '۷ روز اخیر' },
  { key: '30', label: '۳۰ روز اخیر' },
  { key: 'custom', label: 'بازه دلخواه' },
];

/** Tehran's calendar day, independent of the browser timezone. */
function tehranIsoDay(offsetDays = 0): string {
  return new Date(Date.now() + 210 * 60_000 - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function jalaliTodayLatin(): string {
  return formatJalali(new Date(), { digits: 'latin' });
}

/** Converts «۱۴۰۵/۰۸/۲۷» (or with `-`) to a Gregorian `YYYY-MM-DD`, or null. */
function jalaliSkillToIso(value: string): string | null {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(toLatinDigits(value.trim()));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const gregorian = toGregorian(year, month, day);
  return `${gregorian.gy}-${String(gregorian.gm).padStart(2, '0')}-${String(gregorian.gd).padStart(2, '0')}`;
}

export function ReportsPage() {
  const [preset, setPreset] = useState<Preset>('today');
  const [fromInput, setFromInput] = useState(jalaliTodayLatin());
  const [toInput, setToInput] = useState(jalaliTodayLatin());
  const [range, setRange] = useState({ from: tehranIsoDay(), to: tehranIsoDay() });
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ReportSummary>(`/reports/summary?from=${range.from}&to=${range.to}`);
      setReport(data);
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

  const choosePreset = (next: Preset) => {
    setPreset(next);
    if (next === 'custom') return;
    if (next === 'today') {
      setRange({ from: tehranIsoDay(), to: tehranIsoDay() });
      setFromInput(jalaliTodayLatin());
      setToInput(jalaliTodayLatin());
      return;
    }
    const days = Number(next);
    setRange({ from: tehranIsoDay(days - 1), to: tehranIsoDay() });
    setFromInput(formatJalali(new Date(Date.now() - (days - 1) * 86_400_000), { digits: 'latin' }));
    setToInput(jalaliTodayLatin());
  };

  const applyCustom = () => {
    const from = jalaliSkillToIso(fromInput);
    const to = jalaliSkillToIso(toInput);
    if (!from || !to) {
      setError('تاریخ را به شکل ۱۴۰۵/۰۸/۲۷ وارد کنید.');
      return;
    }
    setPreset('custom');
    setRange({ from, to });
  };

  const downloadCsv = () => {
    window.open(`/api/v1/reports/payments.csv?from=${range.from}&to=${range.to}`, '_blank', 'noopener');
  };

  const downloadXlsx = () => {
    window.open(`/api/v1/reports/payments.xlsx?from=${range.from}&to=${range.to}`, '_blank', 'noopener');
  };

  const methodColumns: Column<ReportSummary['byMethod'][number]>[] = [
    { key: 'method', header: 'روش', render: (row) => row.methodLabelFa },
    { key: 'count', header: 'تعداد', align: 'center', render: (row) => row.count.toLocaleString('fa-IR') },
    { key: 'total', header: 'مبلغ', align: 'end', render: (row) => <span className="num">{formatRial(row.total)}</span> },
  ];

  const dailyColumns: Column<ReportSummary['daily'][number]>[] = [
    {
      key: 'date',
      header: 'روز',
      render: (row) => formatJalali(new Date(`${row.date}T12:00:00Z`), { monthName: true }),
    },
    { key: 'count', header: 'تعداد پرداخت', align: 'center', render: (row) => row.count.toLocaleString('fa-IR') },
    { key: 'sales', header: 'فروش', align: 'end', render: (row) => <span className="num">{formatRial(row.sales)}</span> },
  ];

  const productColumns: Column<ReportSummary['topProducts'][number]>[] = [
    { key: 'name', header: 'محصول', render: (row) => row.nameFa },
    { key: 'quantity', header: 'تعداد', align: 'center', render: (row) => row.quantity.toLocaleString('fa-IR') },
    { key: 'revenue', header: 'درآمد', align: 'end', render: (row) => <span className="num">{formatRial(row.revenue)}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="گزارش‌ها"
        description="فروش روزانه از پرداخت‌های تأییدشده محاسبه می‌شود و بازپرداخت‌ها از آن کسر می‌شوند. بازه بر اساس روز تقویم تهران است."
        breadcrumb={<Breadcrumb page="گزارش‌ها" />}
        actions={
          <div className="flex flex-wrap gap-1.5 print:hidden">
            <Button size="sm" variant="outline" onClick={downloadCsv}>
              دریافت CSV پرداخت‌ها
            </Button>
            <Button size="sm" variant="outline" onClick={downloadXlsx}>
              دریافت Excel
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.print()}>
              چاپ / PDF
            </Button>
          </div>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => choosePreset(item.key)}
                className={`rounded-xl border px-3 py-1.5 text-[11px] ${
                  preset === item.key
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-line bg-surface text-muted'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <Field label="از تاریخ">
              <JalaliDatePicker value={fromInput} onChange={setFromInput} ariaLabel="تاریخ شروع گزارش" />
            </Field>
            <Field label="تا تاریخ">
              <JalaliDatePicker value={toInput} onChange={setToInput} ariaLabel="تاریخ پایان گزارش" />
            </Field>
            <Button size="sm" onClick={applyCustom}>
              اعمال
            </Button>
          </div>
        </CardBody>
      </Card>

      {loading && !report ? (
        <div className="flex justify-center py-16 text-brand-600">
          <Spinner size="lg" />
        </div>
      ) : error && !report ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="فروش" value={formatRial(report.totals.sales)} />
            <StatCard label="بازپرداخت" value={formatRial(report.totals.refunds)} />
            <StatCard label="خالص" value={formatRial(report.totals.net)} />
            <StatCard label="سفارش تسویه‌شده" value={report.totals.orders.toLocaleString('fa-IR')} hint={`میانگین هر سفارش ${formatRial(report.totals.averageOrder)}`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="به تفکیک روش پرداخت" />
              <DataTable
                columns={methodColumns}
                rows={report.byMethod}
                rowKey={(row) => row.method}
                empty={<EmptyState title="پرداختی در این بازه ثبت نشده" description="بازه دیگری را انتخاب کنید." />}
              />
            </Card>

            <Card>
              <CardHeader title="پرفروش‌ترین اقلام" />
              <DataTable
                columns={productColumns}
                rows={report.topProducts}
                rowKey={(row) => row.nameFa}
                empty={<EmptyState title="قلمی فروش نداشته" description="در این بازه سفارش تسویه‌شده‌ای ثبت نشده است." />}
              />
            </Card>
          </div>

          <Card>
            <CardHeader title="فروش روزانه" description={`${formatJalali(new Date(`${report.from}T12:00:00Z`))} تا ${formatJalali(new Date(`${report.to}T12:00:00Z`))}`} />
            <DataTable
              columns={dailyColumns}
              rows={report.daily}
              rowKey={(row) => row.date}
              empty={<EmptyState title="فروشی در این بازه ثبت نشده" description="پرداخت تأییدشده‌ای برای این روزها وجود ندارد." />}
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}
