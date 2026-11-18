import { useMemo, useState } from 'react';
import { formatRial, type PublicMenuProduct } from '@cafeflow/shared';
import { Alert, Badge, Button, Field, Modal, Textarea } from '@cafeflow/ui';
import { formatCountFa } from '../../lib/format';

export interface CartLineDraft {
  productId: string;
  nameFa: string;
  unitPrice: number;
  quantity: number;
  optionIds: string[];
  extraIds: string[];
  note?: string;
}

interface ProductDialogProps {
  product: PublicMenuProduct | null;
  onClose: () => void;
  onAdd: (line: CartLineDraft) => void;
}

export function ProductDialog({ product, onClose, onAdd }: ProductDialogProps) {
  if (!product) return null;
  return <ProductDialogBody key={product.id} product={product} onClose={onClose} onAdd={onAdd} />;
}

function ProductDialogBody({ product, onClose, onAdd }: { product: PublicMenuProduct } & Omit<ProductDialogProps, 'product'>) {
  const [selectedOptions, setSelectedOptions] = useState<string[]>(() =>
    product.optionGroups
      .filter((group) => group.isRequired && group.maxSelect === 1 && group.options.length > 0)
      .map((group) => group.options[0]!.id),
  );
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const optionPriceDelta = useMemo(() => {
    let total = 0;
    for (const group of product.optionGroups) {
      for (const option of group.options) {
        if (selectedOptions.includes(option.id)) total += option.priceDelta;
      }
    }
    return total;
  }, [product.optionGroups, selectedOptions]);

  const extraPrice = useMemo(
    () => product.extras.filter((extra) => selectedExtras.includes(extra.id)).reduce((sum, extra) => sum + extra.price, 0),
    [product.extras, selectedExtras],
  );

  const unitPrice = product.price + optionPriceDelta + extraPrice;

  const toggleOption = (groupId: string, optionId: string, maxSelect: number) => {
    setError(null);
    setSelectedOptions((current) => {
      const group = product.optionGroups.find((item) => item.id === groupId);
      if (!group) return current;
      const groupOptionIds = group.options.map((option) => option.id);
      const inGroup = current.filter((id) => groupOptionIds.includes(id));

      if (inGroup.includes(optionId)) {
        return current.filter((id) => id !== optionId);
      }
      if (maxSelect === 1) {
        return [...current.filter((id) => !groupOptionIds.includes(id)), optionId];
      }
      if (inGroup.length >= maxSelect) return current;
      return [...current, optionId];
    });
  };

  const toggleExtra = (extraId: string) => {
    setSelectedExtras((current) =>
      current.includes(extraId) ? current.filter((id) => id !== extraId) : [...current, extraId],
    );
  };

  const submit = () => {
    for (const group of product.optionGroups) {
      const count = group.options.filter((option) => selectedOptions.includes(option.id)).length;
      const minimum = group.isRequired ? Math.max(group.minSelect, 1) : group.minSelect;
      if (count < minimum) {
        setError(`انتخاب «${group.nameFa}» الزامی است.`);
        return;
      }
      if (count > group.maxSelect) {
        setError(`حداکثر ${formatCountFa(group.maxSelect)} انتخاب برای «${group.nameFa}» مجاز است.`);
        return;
      }
    }

    onAdd({
      productId: product.id,
      nameFa: product.nameFa,
      unitPrice,
      quantity,
      optionIds: selectedOptions,
      extraIds: selectedExtras,
      note: note.trim() || undefined,
    });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={product.nameFa}
      description={product.descriptionFa ?? undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            بستن
          </Button>
          <Button onClick={submit} disabled={!product.isAvailable}>
            افزودن به سبد — {formatRial(unitPrice * quantity)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!product.isAvailable ? (
          <Alert tone="warning" title="ناموجود">
            {product.unavailableReasonFa ?? 'این محصول در حال حاضر قابل سفارش نیست.'}
          </Alert>
        ) : null}

        <div className="flex items-center justify-between rounded-xl bg-canvas px-3 py-2 text-xs">
          <span className="text-muted">زمان آماده‌سازی تقریبی</span>
          <Badge tone="neutral">{formatCountFa(product.prepMinutes)} دقیقه</Badge>
        </div>

        {product.optionGroups.map((group) => (
          <fieldset key={group.id} className="space-y-2">
            <legend className="flex items-center gap-2 text-xs font-semibold text-ink">
              {group.nameFa}
              {group.isRequired ? <Badge tone="brand">الزامی</Badge> : <Badge tone="neutral">اختیاری</Badge>}
              <span className="text-[10px] font-normal text-muted">
                تا {formatCountFa(group.maxSelect)} انتخاب
              </span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.options.map((option) => {
                const checked = selectedOptions.includes(option.id);
                return (
                  <label
                    key={option.id}
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs transition-colors ${
                      checked ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                        name={`group-${group.id}`}
                        checked={checked}
                        onChange={() => toggleOption(group.id, option.id, group.maxSelect)}
                        className="size-4 accent-[#aa472b]"
                      />
                      {option.nameFa}
                    </span>
                    {option.priceDelta !== 0 ? (
                      <span className="num text-[10px] text-muted">
                        {option.priceDelta > 0 ? '+' : ''}
                        {formatRial(option.priceDelta, { withUnit: false })}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}

        {product.extras.length > 0 ? (
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-ink">افزودنی‌ها</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {product.extras.map((extra) => {
                const checked = selectedExtras.includes(extra.id);
                return (
                  <label
                    key={extra.id}
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs transition-colors ${
                      checked ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleExtra(extra.id)}
                        className="size-4 accent-[#aa472b]"
                      />
                      {extra.nameFa}
                    </span>
                    <span className="num text-[10px] text-muted">+{formatRial(extra.price, { withUnit: false })}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تعداد" htmlFor="quantity">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                aria-label="کاهش تعداد"
              >
                −
              </Button>
              <span className="num w-10 text-center text-sm font-semibold">{formatCountFa(quantity)}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setQuantity((value) => Math.min(20, value + 1))}
                aria-label="افزایش تعداد"
              >
                +
              </Button>
            </div>
          </Field>

          <Field label="یادداشت برای باریستا" htmlFor="item-note" hint="مثال: بدون شکر، شیر گرم‌تر">
            <Textarea
              id="item-note"
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 200))}
              className="min-h-16"
              placeholder="توضیح اختیاری"
            />
          </Field>
        </div>

        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Modal>
  );
}
