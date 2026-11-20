import { useEffect, useMemo, useState } from 'react';
import {
  formatRial,
  type PublicMenuResponse,
  type StaffTablesResponse,
} from '@cafeflow/shared';
import { Alert, Button, EmptyState, Field, Input, Modal, Spinner, Textarea } from '@cafeflow/ui';
import { api, errorMessage } from '../../lib/api';
import { formatCountFa } from '../../lib/format';

interface DraftLine {
  productId: string;
  nameFa: string;
  unitPrice: number;
  quantity: number;
}

interface ManualOrderModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (code: string) => void;
}

/**
 * A waiter takes the order at the table. The customer side of the menu is read
 * only for names and prices to display; the saved order is priced again by the
 * server, so this preview can never become the bill.
 *
 * Lines that need an option choice are shown but not addable here: the server
 * rejects a required group that is missing, and a silent default would put the
 * wrong drink on the bill.
 */
export function ManualOrderModal({ open, onClose, onCreated }: ManualOrderModalProps) {
  const [menu, setMenu] = useState<PublicMenuResponse | null>(null);
  const [tables, setTables] = useState<StaffTablesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tableId, setTableId] = useState('');
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      api.get<PublicMenuResponse>('/public/menu'),
      api.get<StaffTablesResponse>('/tables'),
    ])
      .then(([menuData, tableData]) => {
        if (cancelled) return;
        setMenu(menuData);
        setTables(tableData);
      })
      .catch((caught) => {
        if (!cancelled) setLoadError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const products = useMemo(() => {
    if (!menu) return [];
    const needle = query.trim();
    return menu.categories
      .flatMap((category) => category.products)
      .filter((product) => product.isAvailable)
      .filter((product) => needle === '' || product.nameFa.includes(needle));
  }, [menu, query]);

  const previewTotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  const addLine = (product: { id: string; nameFa: string; price: number }) => {
    setError(null);
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id ? { ...line, quantity: Math.min(30, line.quantity + 1) } : line,
        );
      }
      return [
        ...current,
        { productId: product.id, nameFa: product.nameFa, unitPrice: product.price, quantity: 1 },
      ];
    });
  };

  const changeQuantity = (productId: string, delta: number) => {
    setLines((current) =>
      current
        .map((line) =>
          line.productId === productId ? { ...line, quantity: line.quantity + delta } : line,
        )
        .filter((line) => line.quantity > 0),
    );
  };

  const submit = async () => {
    if (lines.length === 0) {
      setError('حداقل یک قلم برای سفارش اضافه کنید.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ code: string }>('/orders', {
        tableId: tableId || null,
        note: note.trim() || undefined,
        items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      });
      setLines([]);
      setNote('');
      setQuery('');
      setTableId('');
      onCreated(created.code);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ثبت سفارش دستی"
      description="برای سفارش حضوری یا تلفنی؛ مبلغ نهایی و موجودی هر قلم دوباره در سرور بررسی می‌شود."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            انصراف
          </Button>
          <Button loading={busy} disabled={lines.length === 0} onClick={() => void submit()}>
            ثبت سفارش
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex justify-center py-10 text-brand-600">
          <Spinner size="lg" label="در حال دریافت منو و میزها…" />
        </div>
      ) : loadError ? (
        <Alert tone="danger" title="دریافت اطلاعات انجام نشد">
          {loadError}
        </Alert>
      ) : (
        <div className="space-y-5">
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="میز">
              <select
                className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
                value={tableId}
                onChange={(event) => setTableId(event.target.value)}
              >
                <option value="">بدون میز (بیرون‌بر)</option>
                {tables?.items.map((table) => (
                  <option key={table.id} value={table.id}>
                    {table.nameFa}
                    {table.status === 'available' ? '' : ' — اشغال/رزرو'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="جست‌وجوی محصول">
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="نام محصول…"
              />
            </Field>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-medium text-ink">منوی قابل سفارش</p>
            {products.length === 0 ? (
              <EmptyState
                title="محصولی پیدا نشد"
                description="فقط محصولات فعال و موجود در این ساعت نمایش داده می‌شوند."
              />
            ) : (
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-2xl border border-line/80 p-2">
                {products.map((product) => {
                  const needsOptions = product.optionGroups.length > 0 || product.extras.length > 0;
                  return (
                    <div
                      key={product.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-ink">{product.nameFa}</p>
                        <p className="num text-[10.5px] text-muted">{formatRial(product.price)}</p>
                      </div>
                      {needsOptions ? (
                        <span className="shrink-0 text-[10px] text-muted">نیازمند انتخاب گزینه</span>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => addLine(product)}>
                          افزودن
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-1.5 text-[10.5px] text-muted">
              محصولات دارای گزینه یا افزودنی از این فرم ثبت نمی‌شوند؛ برای آن‌ها از منوی QR استفاده کنید.
            </p>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-medium text-ink">
              اقلام سفارش ({formatCountFa(itemCount)})
            </p>
            {lines.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[11px] text-muted">
                هنوز قلمی اضافه نشده است.
              </p>
            ) : (
              <div className="space-y-1.5">
                {lines.map((line) => (
                  <div
                    key={line.productId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line/80 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink">{line.nameFa}</p>
                      <p className="num text-[10.5px] text-muted">
                        {formatRial(line.unitPrice)} × {formatCountFa(line.quantity)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => changeQuantity(line.productId, -1)}>
                        −
                      </Button>
                      <span className="num w-6 text-center text-xs">{formatCountFa(line.quantity)}</span>
                      <Button size="sm" variant="ghost" onClick={() => changeQuantity(line.productId, 1)}>
                        +
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-line pt-2 text-xs">
                  <span className="text-muted">جمع اقلام (بدون حق سرویس و مالیات)</span>
                  <span className="num font-semibold text-ink">{formatRial(previewTotal)}</span>
                </div>
              </div>
            )}
          </div>

          <Field label="یادداشت سفارش" hint="اختیاری؛ در صف آماده‌سازی دیده می‌شود.">
            <Textarea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="مثلاً: سفارش تلفنی، تحویل ساعت ۱۷"
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}
