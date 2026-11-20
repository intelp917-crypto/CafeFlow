import { useCallback, useEffect, useState } from 'react';
import { Breadcrumb } from '../lib/branding';
import {
  Alert,
  Badge,
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
import type { CashSessionRow, CashSessionsResponse } from '@cafeflow/shared';
import { api, errorMessage } from '../lib/api';
import { formatDateTimeFa, formatCountFa, formatRial } from '../lib/format';

export function CashPage() {
  const [data, setData] = useState<CashSessionsResponse | null>(null);
  const [registerId, setRegisterId] = useState('');
  const [openingFloat, setOpeningFloat] = useState('0');
  const [closingAmount, setClosingAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (selected?: string) => {
    setLoading(true);
    try {
      const query = selected ? `?registerId=${encodeURIComponent(selected)}` : '';
      const response = await api.get<CashSessionsResponse>(`/cash-sessions${query}`);
      setData(response);
      setRegisterId((current) => selected ?? current ?? response.registers[0]?.id ?? '');
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

  const openSession = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const session = await api.post<CashSessionRow>('/cash-sessions/open', {
        registerId,
        openingFloat: Number(openingFloat || 0),
      });
      setNotice(`صندوق «${session.registerNameFa}» با موجودی اولیه ${formatRial(session.openingFloat)} باز شد.`);
      await load(registerId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const closeSession = async () => {
    if (!data?.current) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const closed = await api.post<CashSessionRow>(`/cash-sessions/${data.current.id}/close`, {
        closingAmount: Number(closingAmount || 0),
      });
      const diff = closed.difference ?? 0;
      setNotice(
        diff === 0
          ? 'صندوق بدون مغایرت بسته شد.'
          : `صندوق بسته شد؛ مغایرت ${formatRial(Math.abs(diff))} ریال (${diff > 0 ? 'اضافه' : 'کمبود'}).`,
      );
      setClosingAmount('');
      await load(registerId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const current = data?.current ?? null;

  const columns: Column<CashSessionRow>[] = [
    { key: 'register', header: 'صندوق', render: (row) => <span className="text-xs">{row.registerNameFa}</span> },
    {
      key: 'opened',
      header: 'باز شدن',
      render: (row) => (
        <div className="space-y-0.5">
          <p className="text-[11px]">{formatDateTimeFa(row.openedAt)}</p>
          <p className="text-[10px] text-muted">{row.openedByName ?? '—'}</p>
        </div>
      ),
    },
    { key: 'float', header: 'موجودی اولیه', render: (row) => <span className="num text-xs">{formatRial(row.openingFloat)}</span> },
    { key: 'cash', header: 'نقد', render: (row) => <span className="num text-xs">{formatRial(row.cashTotal)}</span> },
    { key: 'card', header: 'کارت', render: (row) => <span className="num text-xs">{formatRial(row.cardTotal)}</span> },
    { key: 'expected', header: 'انتظار', render: (row) => <span className="num text-xs">{formatRial(row.expectedAmount)}</span> },
    {
      key: 'difference',
      header: 'مغایرت',
      render: (row) =>
        row.difference === null ? (
          <span className="text-[10px] text-muted">—</span>
        ) : (
          <Badge tone={row.difference === 0 ? 'success' : row.difference > 0 ? 'warning' : 'danger'}>
            {formatRial(row.difference)}
          </Badge>
        ),
    },
    { key: 'closed', header: 'بسته شدن', render: (row) => <span className="text-[11px] text-muted">{formatDateTimeFa(row.closedAt)}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="صندوق و جلسات نقدی"
        description="باز کردن صندوق با موجودی اولیه، محاسبه خودکار مبلغ انتظار از پرداخت‌های نقدی تأییدشده و بستن با ثبت مغایرت."
        breadcrumb={<Breadcrumb page="مالی" />}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={registerId}
              onChange={(event) => {
                setRegisterId(event.target.value);
                void load(event.target.value);
              }}
              className="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink"
              aria-label="انتخاب صندوق"
            >
              {(data?.registers ?? []).map((register) => (
                <option key={register.id} value={register.id}>
                  {register.nameFa}
                  {register.isActive ? '' : ' (غیرفعال)'}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={() => void load(registerId)} loading={loading}>
              به‌روزرسانی
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
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="موجودی اولیه" value={current ? formatRial(current.openingFloat) : '—'} />
            <StatCard label="پرداخت نقدی" value={current ? formatRial(current.cashTotal) : '—'} tone="success" />
            <StatCard label="پرداخت کارتی" value={current ? formatRial(current.cardTotal) : '—'} tone="brand" />
            <StatCard label="مبلغ انتظار" value={current ? formatRial(current.expectedAmount) : '—'} tone="warning" />
          </div>

          <Card>
            <CardHeader
              title={current ? `جلسه باز — ${current.registerNameFa}` : 'جلسه‌ای باز نیست'}
              description={
                current
                  ? `باز شده در ${formatDateTimeFa(current.openedAt)} توسط ${current.openedByName ?? '—'}`
                  : 'برای ثبت پرداخت نقدی و شمارش پایان روز، یک جلسه صندوق باز کنید.'
              }
            />
            <CardBody>
              {current ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-line bg-canvas/60 p-3 text-[11px] leading-6 text-muted">
                    <p>
                      تعداد پرداخت‌های تأییدشده: <span className="num text-ink">{formatCountFa(current.paymentsCount)}</span>
                    </p>
                    <p>
                      بازپرداخت‌ها: <span className="num text-ink">{formatRial(current.refundsTotal)}</span>
                    </p>
                    <p>
                      مبلغ انتظار = موجودی اولیه + نقد خالص ={' '}
                      <span className="num text-ink">{formatRial(current.expectedAmount)}</span>
                    </p>
                  </div>
                  <div className="space-y-3">
                    <Field label="مبلغ شمارش‌شده در صندوق" hint="مبلغ واقعی شمارش‌شده؛ مغایرت سمت سرور محاسبه می‌شود.">
                      <Input
                        type="number"
                        min={0}
                        value={closingAmount}
                        onChange={(event) => setClosingAmount(event.target.value)}
                        placeholder={String(current.expectedAmount)}
                      />
                    </Field>
                    <Button onClick={() => void closeSession()} loading={busy} disabled={!closingAmount}>
                      بستن صندوق
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="موجودی اولیه صندوق (ریال)" hint="پول نقدی که در آغاز شیفت در صندوق است.">
                    <Input
                      type="number"
                      min={0}
                      value={openingFloat}
                      onChange={(event) => setOpeningFloat(event.target.value)}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button onClick={() => void openSession()} loading={busy} disabled={!registerId}>
                      باز کردن صندوق
                    </Button>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="جلسات بسته‌شده" description="۲۰ جلسه آخر با مبلغ انتظار، شمارش و مغایرت" />
            {data && data.history.length > 0 ? (
              <DataTable columns={columns} rows={data.history} rowKey={(row) => row.id} />
            ) : (
              <EmptyState title="جلسه بسته‌شده‌ای وجود ندارد" />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
