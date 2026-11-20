import { useEffect, useState } from 'react';
import { ExternalLink, UtensilsCrossed } from 'lucide-react';
import type { PublicMenuResponse } from '@cafeflow/shared';
import { Spinner } from '@cafeflow/ui';
import { customerApi } from '../../lib/customer';
import { errorMessage } from '../../lib/api';
import { formatCountFa, formatRial } from '../../lib/format';

/**
 * What the phone does after the sticker is scanned, shown inside a phone frame.
 *
 * It reads the same public menu endpoint the customer page uses, so a price or
 * availability change appears here too — there is no second copy of the data.
 */
export function CustomerMenuPreview({ qrToken, menuUrl }: { qrToken: string | null; menuUrl: string }) {
  const [menu, setMenu] = useState<PublicMenuResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!qrToken) return;
    let cancelled = false;
    setError(null);
    customerApi
      .menu(qrToken)
      .then((response) => {
        if (!cancelled) setMenu(response);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [qrToken]);

  const products = menu?.categories.flatMap((category) => category.products).slice(0, 5) ?? [];

  return (
    <div className="mx-auto w-64 shrink-0">
      <p className="mb-1.5 text-center text-[10px] text-muted">پیش‌نمایش گوشی مشتری</p>

      <div className="rounded-[2rem] border border-ink/20 bg-ink/90 p-1.5 shadow-[0_24px_60px_-30px_rgba(36,22,17,0.7)]">
        <div className="relative h-[21rem] overflow-hidden rounded-[1.6rem] bg-canvas">
          <div className="flex justify-center pt-1.5">
            <span aria-hidden className="h-1 w-12 rounded-full bg-ink/20" />
          </div>

          {!menu && !error ? (
            <div className="flex h-[18rem] items-center justify-center text-brand-600">
              <Spinner size="lg" label="در حال خواندن منو…" />
            </div>
          ) : error ? (
            <p className="px-4 pt-8 text-center text-[11px] leading-6 text-danger-700">{error}</p>
          ) : menu ? (
            <div className="h-[19.5rem] overflow-y-auto px-3 pb-12 pt-2">
              <div className="rounded-2xl bg-espresso px-3 py-3 text-cream">
                <p className="text-[9px] text-cream/70">{menu.restaurant.nameFa}</p>
                <p className="mt-0.5 font-display text-sm font-bold">
                  {menu.table ? `میز ${menu.table.nameFa}` : 'منوی کافه'}
                </p>
                {menu.table?.floorNameFa ? (
                  <p className="mt-0.5 text-[9px] text-cream/60">{menu.table.floorNameFa}</p>
                ) : null}
              </div>

              <div className="mt-2.5 flex gap-1.5">
                {(menu.categories.slice(0, 3) ?? []).map((category, index) => (
                  <span
                    key={category.id}
                    className={`rounded-full px-2 py-1 text-[9px] ${
                      index === 0 ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-ink/70'
                    }`}
                  >
                    {category.nameFa}
                  </span>
                ))}
              </div>

              <ul className="mt-2.5 space-y-1.5">
                {products.map((product) => (
                  <li
                    key={product.id}
                    className="flex items-center gap-2 rounded-xl border border-line/70 bg-surface p-1.5"
                  >
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt=""
                        className="size-9 shrink-0 rounded-lg object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-cream text-brand-700">
                        <UtensilsCrossed aria-hidden className="size-4" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10px] font-medium text-ink">{product.nameFa}</p>
                      <p className="num text-[9px] text-muted">{formatRial(product.price)}</p>
                    </div>
                    {!product.isAvailable ? (
                      <span className="rounded-full bg-danger-50 px-1.5 py-0.5 text-[8px] text-danger-700">ناموجود</span>
                    ) : null}
                  </li>
                ))}
                {products.length === 0 ? (
                  <li className="rounded-xl border border-dashed border-line px-2 py-4 text-center text-[10px] text-muted">
                    هنوز محصولی در منو نیست.
                  </li>
                ) : null}
              </ul>

              <p className="mt-2 text-center text-[9px] text-muted">
                {formatCountFa(menu.categories.length)} دسته · {formatCountFa(products.length)} محصول در این نمایش
              </p>
            </div>
          ) : null}

          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 border-t border-line bg-surface/95 px-3 py-2">
            <span className="rounded-full border border-line px-2 py-1 text-[9px] text-ink/70">منو</span>
            <span className="rounded-full bg-brand-600 px-2.5 py-1 text-[9px] font-semibold text-white">
              سبد خرید
            </span>
          </div>
        </div>
      </div>

      {menuUrl ? (
        <a
          href={menuUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-line text-[11px] text-brand-700 transition-colors hover:border-brand-300"
        >
          باز کردن منوی واقعی
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      ) : null}
    </div>
  );
}
