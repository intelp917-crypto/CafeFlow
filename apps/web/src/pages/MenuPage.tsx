import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  formatRial,
  percentOf,
  type PublicMenuProduct,
  type PublicMenuResponse,
} from '@cafeflow/shared';
import { Alert, Badge, Button, EmptyState, ErrorState, Spinner } from '@cafeflow/ui';
import { errorMessage } from '../lib/api';
import { customerApi } from '../lib/customer';
import { formatCountFa } from '../lib/format';
import { CartPanel, type CartLine, type CartTotals } from '../components/customer/CartPanel';
import { ProductDialog, type CartLineDraft } from '../components/customer/ProductDialog';
import { CategoryRail } from '../components/customer/CategoryRail';
import { DeveloperCredit } from '../components/DeveloperCredit';

function lineKey(draft: CartLineDraft): string {
  return [
    draft.productId,
    [...draft.optionIds].sort().join(','),
    [...draft.extraIds].sort().join(','),
    draft.note ?? '',
  ].join('|');
}

function readCart(storageKey: string): CartLine[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CartLine[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((line) => line && typeof line.productId === 'string' && line.quantity > 0);
  } catch {
    return [];
  }
}

function writeCart(storageKey: string, lines: CartLine[]): void {
  try {
    if (lines.length === 0) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify(lines));
  } catch {
    // Storage may be unavailable (private mode); the cart still works in memory.
  }
}

export function MenuPage() {
  const { qrToken } = useParams<{ qrToken?: string }>();
  const navigate = useNavigate();
  const storageKey = `cafeflow:cart:${qrToken ?? 'browse'}`;

  const [menu, setMenu] = useState<PublicMenuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>(() => readCart(storageKey));
  const [dialogProduct, setDialogProduct] = useState<PublicMenuProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderNote, setOrderNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  // The idempotency key stays stable until the server confirms an order, so a
  // retry after a network failure returns the original order instead of
  // creating a duplicate.
  const pendingRequestId = useRef<string>(crypto.randomUUID());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await customerApi.menu(qrToken);
      setMenu(data);
      setActiveCategory((current) => current ?? data.categories[0]?.id ?? null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [qrToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    writeCart(storageKey, cart);
  }, [cart, storageKey]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Keep the rail highlight in step with the section in view. Intersection
  // observer only tracks position; nothing is animated.
  useEffect(() => {
    if (!menu || menu.categories.length === 0) return;
    const sections = menu.categories
      .map((category) => document.getElementById(`category-${category.id}`))
      .filter((element): element is HTMLElement => Boolean(element));
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveCategory(visible.target.id.replace('category-', ''));
      },
      { rootMargin: '-25% 0px -60% 0px' },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [menu]);

  const canOrder = Boolean(qrToken) && menu?.qr !== null;

  const totals: CartTotals = useMemo(() => {
    const subtotal = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    const serviceCharge = menu ? percentOf(subtotal, menu.restaurant.serviceChargePercent) : 0;
    const taxTotal = menu ? percentOf(subtotal + serviceCharge, menu.restaurant.taxPercent) : 0;
    return { subtotal, serviceCharge, taxTotal, total: subtotal + serviceCharge + taxTotal };
  }, [cart, menu]);

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const productCount = menu ? menu.categories.reduce((sum, category) => sum + category.products.length, 0) : 0;

  const addLine = (draft: CartLineDraft) => {
    const key = lineKey(draft);
    setCart((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) =>
          line.key === key ? { ...line, quantity: Math.min(20, line.quantity + draft.quantity) } : line,
        );
      }
      return [...current, { ...draft, key }];
    });
  };

  const increment = (key: string) =>
    setCart((current) =>
      current.map((line) => (line.key === key ? { ...line, quantity: Math.min(20, line.quantity + 1) } : line)),
    );

  const decrement = (key: string) =>
    setCart((current) =>
      current
        .map((line) => (line.key === key ? { ...line, quantity: line.quantity - 1 } : line))
        .filter((line) => line.quantity > 0),
    );

  const remove = (key: string) => setCart((current) => current.filter((line) => line.key !== key));

  const submitOrder = async () => {
    if (!qrToken || !menu || cart.length === 0 || submitting) return;
    if (!online) {
      setSubmitError('اتصال اینترنت برقرار نیست. پس از وصل شدن دوباره تلاش کنید.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await customerApi.createOrder({
        qrToken,
        clientRequestId: pendingRequestId.current,
        note: orderNote.trim() || undefined,
        items: cart.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          optionIds: line.optionIds,
          extraIds: line.extraIds,
          note: line.note,
        })),
      });

      // Server confirmed: the cart can be cleared and the key rotated.
      setCart([]);
      setOrderNote('');
      pendingRequestId.current = crypto.randomUUID();
      setCartOpen(false);
      navigate(`/order/${response.code}?qr=${encodeURIComponent(qrToken)}`);
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const scrollToCategory = (categoryId: string) => {
    setActiveCategory(categoryId);
    document.getElementById(`category-${categoryId}`)?.scrollIntoView({ block: 'start' });
  };

  if (loading && !menu) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas text-brand-600">
        <Spinner size="lg" label="در حال دریافت منو…" />
      </div>
    );
  }

  if (error || !menu) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6">
          <ErrorState message={error ?? 'منو دریافت نشد.'} onRetry={() => void load()} />
          <div className="mt-2 text-center">
            <Link to="/" className="text-xs text-brand-600 hover:underline">
              بازگشت به صفحه اصلی
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-canvas pb-24 pl-[6rem] sm:pl-[6.75rem] lg:pb-0">
      <CategoryRail
        categories={menu.categories}
        activeCategory={activeCategory}
        onSelect={scrollToCategory}
      />

      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <Link to="/" className="flex items-center gap-2 leading-tight">
            {menu.restaurant.logoUrl ? (
              <img
                src={menu.restaurant.logoUrl}
                alt=""
                className="h-9 w-9 shrink-0 rounded-xl object-cover"
              />
            ) : null}
            <div>
            <p className="font-display text-base font-bold text-ink">{menu.restaurant.nameFa}</p>
            <p className="text-[10px] text-muted">
              {menu.table
                ? `${menu.table.nameFa}${menu.table.floorNameFa ? ` — ${menu.table.floorNameFa}` : ''}`
                : 'منوی کافه'}
            </p>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            {menu.table ? <Badge tone="brand">{menu.table.nameFa}</Badge> : null}
            <Button size="sm" onClick={() => setCartOpen(true)} disabled={cart.length === 0}>
              سبد ({formatCountFa(itemCount)})
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-8">
        <section className="mt-5 overflow-hidden rounded-[1.75rem] bg-espresso text-cream sm:mt-6">
          <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
            <div className="p-7 sm:p-10 lg:p-11">
              <p className="text-[11px] text-brand-200">منوی دیجیتال</p>
              <h1 className="font-display mt-3 text-3xl font-bold leading-[1.3] sm:text-4xl lg:text-5xl">
                {menu.table ? `سفارش از ${menu.table.nameFa}` : 'منوی امروز کافه'}
              </h1>
              {menu.restaurant.addressFa || menu.restaurant.phone ? (
                <p className="mt-3 text-xs leading-6 text-cream/70">
                  {menu.restaurant.addressFa}
                  {menu.restaurant.addressFa && menu.restaurant.phone ? ' — ' : ''}
                  {menu.restaurant.phone ? (
                    <span dir="ltr" className="num">{menu.restaurant.phone}</span>
                  ) : null}
                </p>
              ) : null}
              <p className="mt-4 max-w-md text-xs leading-7 text-cream/70 sm:text-sm">
                {canOrder
                  ? 'دسته‌ها را از ریل سمت چپ انتخاب کنید، آیتم‌ها را به سبد بریزید و سفارش را مستقیم برای باریستا بفرستید.'
                  : 'همه دسته‌ها و قیمت‌های به‌روز را ببینید. برای ثبت سفارش، کد QR روی میز خود را اسکن کنید.'}
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                {menu.categories[0] ? (
                  <Button size="lg" onClick={() => scrollToCategory(menu.categories[0]!.id)}>
                    رفتن به منو
                  </Button>
                ) : null}
                <Link
                  to="/"
                  className="rounded-full border border-cream/25 px-5 py-2.5 text-xs text-cream hover:border-cream/60"
                >
                  صفحه اصلی کافه
                </Link>
              </div>

              <dl className="mt-8 flex gap-8 border-t border-cream/12 pt-5">
                <div>
                  <dt className="text-[10px] text-cream/50">دسته فعال</dt>
                  <dd className="num font-display mt-1 text-2xl font-bold">
                    {formatCountFa(menu.categories.length)}
                  </dd>
                </div>
                <div className="border-s border-cream/12 ps-8">
                  <dt className="text-[10px] text-cream/50">آیتم در منو</dt>
                  <dd className="num font-display mt-1 text-2xl font-bold">{formatCountFa(productCount)}</dd>
                </div>
              </dl>
            </div>

            <div className="relative min-h-56 lg:min-h-full">
              <img
                src="/images/cup-hero.jpg"
                alt="فنجان قهوه کرم‌رنگ میان دانه‌های برشته با پاشش قهوه"
                className="absolute inset-0 size-full object-cover object-[60%_center]"
                width={1392}
                height={752}
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-l from-espresso/10 via-espresso/20 to-espresso"
              />
            </div>
          </div>
        </section>

        <div className="py-5">
          {!online ? (
            <div className="mb-3">
              <Alert tone="warning" title="اتصال قطع است">
                سفارش تا برقراری اتصال ثبت نمی‌شود. سبد شما روی همین دستگاه حفظ می‌شود.
              </Alert>
            </div>
          ) : null}

          {!canOrder ? (
            <div className="mb-3">
              <Alert tone="info" title="حالت مشاهده منو">
                برای ثبت سفارش، کد QR روی میز خود را اسکن کنید. در این حالت امکان افزودن به سبد فعال نیست.
              </Alert>
            </div>
          ) : null}

          {menu.categories.length === 0 ? (
            <EmptyState title="منو در حال آماده‌سازی است" description="هنوز محصول فعالی ثبت نشده است." />
          ) : (
            <div className="space-y-12 pb-10 pt-3">
              {menu.categories.map((category) => (
                <section key={category.id} id={`category-${category.id}`} className="scroll-mt-24">
                  <div className="mb-5 flex items-end justify-between border-b border-ink/10 pb-3">
                    <h2 className="font-display text-2xl font-bold text-ink sm:text-3xl">{category.nameFa}</h2>
                    <span className="num text-[11px] text-muted">
                      {formatCountFa(category.products.length)} محصول
                    </span>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {category.products.map((product) => (
                      <article
                        key={product.id}
                        className="flex flex-col justify-between rounded-[1.35rem] border border-line bg-surface p-5 shadow-[0_26px_60px_-54px_rgba(41,27,19,0.6)]"
                      >
                        <div>
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              {product.imageUrl ? (
                                <img
                                  src={product.imageUrl}
                                  alt={product.nameFa}
                                  className="size-12 shrink-0 border border-line object-cover"
                                  loading="lazy"
                                />
                              ) : null}
                              <div className="min-w-0">
                                <h3 className="text-sm font-bold text-ink">{product.nameFa}</h3>
                                {product.descriptionFa ? (
                                  <p className="mt-1 text-[11px] leading-6 text-muted">{product.descriptionFa}</p>
                                ) : null}
                              </div>
                            </div>
                            {product.isAvailable ? (
                              <Badge tone="success" dot>موجود</Badge>
                            ) : (
                              <Badge tone="danger" dot>ناموجود</Badge>
                            )}
                          </div>
                          {!product.isAvailable && product.unavailableReasonFa ? (
                            <p className="mt-1 text-[10px] text-danger-700">{product.unavailableReasonFa}</p>
                          ) : null}
                        </div>

                        <div className="mt-4 flex items-end justify-between gap-2 border-t border-line pt-3">
                          <div>
                            <p className="num text-sm font-bold text-brand-700">{formatRial(product.price)}</p>
                            <p className="text-[10px] text-muted">
                              آماده‌سازی ~{formatCountFa(product.prepMinutes)} دقیقه
                            </p>
                          </div>
                          <Button
                            size="sm"
                            disabled={!product.isAvailable || !canOrder}
                            onClick={() => {
                              if (!canOrder) return;
                              if (product.optionGroups.length > 0 || product.extras.length > 0) {
                                setDialogProduct(product);
                                return;
                              }
                              addLine({
                                productId: product.id,
                                nameFa: product.nameFa,
                                unitPrice: product.price,
                                quantity: 1,
                                optionIds: [],
                                extraIds: [],
                              });
                            }}
                          >
                            افزودن
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>

      <div className="px-5 pb-28 pt-4">
        <DeveloperCredit />
      </div>

      {cart.length > 0 && canOrder ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface p-3 pl-[6rem] sm:pl-[6.75rem]">
          <Button fullWidth size="lg" onClick={() => setCartOpen(true)}>
            مشاهده سبد — {formatRial(totals.total)}
          </Button>
        </div>
      ) : null}

      <CartPanel
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        lines={cart}
        totals={totals}
        serviceChargePercent={menu.restaurant.serviceChargePercent}
        taxPercent={menu.restaurant.taxPercent}
        onIncrement={increment}
        onDecrement={decrement}
        onRemove={remove}
        orderNote={orderNote}
        onOrderNoteChange={setOrderNote}
        onSubmit={() => void submitOrder()}
        submitting={submitting}
        error={submitError}
        canOrder={canOrder}
      />

      <ProductDialog product={dialogProduct} onClose={() => setDialogProduct(null)} onAdd={addLine} />
    </div>
  );
}
