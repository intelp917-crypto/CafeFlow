import { formatRial } from '@cafeflow/shared';
import { Alert, Button, Field, Textarea } from '@cafeflow/ui';
import { formatCountFa } from '../../lib/format';

export interface CartLine {
  key: string;
  productId: string;
  nameFa: string;
  unitPrice: number;
  quantity: number;
  optionIds: string[];
  extraIds: string[];
  note?: string;
}

export interface CartTotals {
  subtotal: number;
  serviceCharge: number;
  taxTotal: number;
  total: number;
}

interface CartPanelProps {
  open: boolean;
  onClose: () => void;
  lines: CartLine[];
  totals: CartTotals;
  serviceChargePercent: number;
  taxPercent: number;
  onIncrement: (key: string) => void;
  onDecrement: (key: string) => void;
  onRemove: (key: string) => void;
  orderNote: string;
  onOrderNoteChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  canOrder: boolean;
}

export function CartPanel({
  open,
  onClose,
  lines,
  totals,
  serviceChargePercent,
  taxPercent,
  onIncrement,
  onDecrement,
  onRemove,
  orderNote,
  onOrderNoteChange,
  onSubmit,
  submitting,
  error,
  canOrder,
}: CartPanelProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="سبد سفارش"
        className="relative ms-auto flex h-full w-full max-w-md flex-col border-s border-line bg-surface shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">سبد سفارش</h2>
            <p className="text-[11px] text-muted">{formatCountFa(lines.length)} قلم</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            بستن
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {lines.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted">سبد شما خالی است.</p>
          ) : (
            <ul className="space-y-3">
              {lines.map((line) => (
                <li key={line.key} className="rounded-xl border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink">{line.nameFa}</p>
                      <p className="num mt-0.5 text-[11px] text-muted">
                        {formatRial(line.unitPrice)} × {formatCountFa(line.quantity)}
                      </p>
                      {line.note ? <p className="mt-1 text-[10px] text-muted">«{line.note}»</p> : null}
                    </div>
                    <span className="num shrink-0 text-xs font-semibold text-brand-700">
                      {formatRial(line.unitPrice * line.quantity)}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onDecrement(line.key)}
                        aria-label={`کاهش ${line.nameFa}`}
                      >
                        −
                      </Button>
                      <span className="num w-8 text-center text-xs">{formatCountFa(line.quantity)}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onIncrement(line.key)}
                        aria-label={`افزایش ${line.nameFa}`}
                      >
                        +
                      </Button>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemove(line.key)}
                      className="text-[11px] text-danger-600 hover:underline"
                    >
                      حذف
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {lines.length > 0 ? (
            <div className="mt-4">
              <Field label="یادداشت سفارش" htmlFor="order-note" hint="مثال: همه با هم سرو شود">
                <Textarea
                  id="order-note"
                  value={orderNote}
                  onChange={(event) => onOrderNoteChange(event.target.value.slice(0, 300))}
                  className="min-h-16"
                  placeholder="توضیح اختیاری برای سفارش"
                />
              </Field>
            </div>
          ) : null}
        </div>

        <footer className="border-t border-line px-5 py-4">
          {error ? (
            <div className="mb-3">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}

          <dl className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <dt className="text-muted">جمع اقلام</dt>
              <dd className="num">{formatRial(totals.subtotal)}</dd>
            </div>
            {serviceChargePercent > 0 ? (
              <div className="flex items-center justify-between">
                <dt className="text-muted">حق سرویس ({formatCountFa(serviceChargePercent)}٪)</dt>
                <dd className="num">{formatRial(totals.serviceCharge)}</dd>
              </div>
            ) : null}
            {taxPercent > 0 ? (
              <div className="flex items-center justify-between">
                <dt className="text-muted">مالیات ({formatCountFa(taxPercent)}٪)</dt>
                <dd className="num">{formatRial(totals.taxTotal)}</dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between border-t border-line pt-2 text-sm font-semibold text-ink">
              <dt>مبلغ قابل پرداخت</dt>
              <dd className="num">{formatRial(totals.total)}</dd>
            </div>
          </dl>

          <p className="mt-2 text-[10px] leading-5 text-muted">
            مبلغ نهایی توسط سیستم محاسبه و در سفارش ثبت می‌شود؛ این ارقام پیش‌نمایش هستند.
          </p>

          <Button
            className="mt-3"
            fullWidth
            size="lg"
            loading={submitting}
            disabled={lines.length === 0 || !canOrder}
            onClick={onSubmit}
          >
            ثبت سفارش
          </Button>
          {!canOrder ? (
            <p className="mt-2 text-center text-[10px] text-warning-700">
              برای ثبت سفارش، کد QR روی میز را اسکن کنید.
            </p>
          ) : null}
        </footer>
      </aside>
    </div>
  );
}
