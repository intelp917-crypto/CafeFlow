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

  const canOrder = Boolean(qrToken) && menu?.qr !== null;

  const totals: CartTotals = useMemo(() => {
    const subtotal = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    const serviceCharge = menu ? percentOf(subtotal, menu.restaurant.serviceChargePercent) : 0;
    const taxTotal = menu ? percentOf(subtotal + serviceCharge, menu.restaurant.taxPercent) : 0;
    return { subtotal, serviceCharge, taxTotal, total: subtotal + serviceCharge + taxTotal };
  }, [cart, menu]);

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

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
    document.getElementById(`category-${categoryId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    <div className="min-h-dvh bg-canvas pb-24 lg:pb-0">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Link to="/" className="flex size-9 items-center justify-center rounded-xl bg-brand-500 text-white" aria-label="کافه‌فلو">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-5">
                <path d="M5 9h11a4 4 0 0 1 0 8h-1v2H8v-2H5z" strokeLinejoin="round" />
                <path d="M8 5c0 1.5 1 1.5 1 3M12 5c0 1.5 1 1.5 1 3" strokeLinecap="round" />
              </svg>
            </Link>
            <div className="leading-tight">
              <p className="text-sm font-bold text-ink">{menu.restaurant.nameFa}</p>
              <p className="text-[10px] text-muted">
                {menu.table ? `${menu.table.nameFa}${menu.table.floorNameFa ? ` — ${menu.table.floorNameFa}` : ''}` : 'منوی کافه'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {menu.table ? <Badge tone="brand">{menu.table.nameFa}</Badge> : null}
            <Button size="sm" onClick={() => setCartOpen(true)} disabled={cart.length === 0}>
              سبد ({formatCountFa(itemCount)})
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
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
          <div className="lg:grid lg:grid-cols-[210px_1fr] lg:gap-6">
            <aside className="lg:sticky lg:top-20 lg:h-[calc(100dvh-6rem)]">
              <nav
                aria-label="دسته‌بندی‌ها"
                className="scroll-thin -mx-4 flex gap-2 overflow-x-auto px-4 pb-3 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-y-auto lg:px-0 lg:pb-0"
              >
                {menu.categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => scrollToCategory(category.id)}
                    className={`shrink-0 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                      activeCategory === category.id
                        ? 'bg-brand-50 text-brand-700'
                        : 'bg-surface text-muted hover:bg-canvas hover:text-ink lg:bg-transparent'
                    }`}
                  >
                    {category.nameFa}
                  </button>
                ))}
              </nav>
            </aside>

            <div className="space-y-8">
              {menu.categories.map((category) => (
                <section key={category.id} id={`category-${category.id}`} className="scroll-mt-20">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-base font-bold text-ink">{category.nameFa}</h2>
                    <span className="text-[11px] text-muted">{formatCountFa(category.products.length)} محصول</span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {category.products.map((product) => (
                      <article
                        key={product.id}
                        className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-4"
                      >
                        <div>
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <h3 className="text-sm font-semibold text-ink">{product.nameFa}</h3>
                            {product.isAvailable ? (
                              <Badge tone="success" dot>موجود</Badge>
                            ) : (
                              <Badge tone="danger" dot>ناموجود</Badge>
                            )}
                          </div>
                          {product.descriptionFa ? (
                            <p className="text-[11px] leading-6 text-muted">{product.descriptionFa}</p>
                          ) : null}
                          {!product.isAvailable && product.unavailableReasonFa ? (
                            <p className="mt-1 text-[10px] text-danger-700">{product.unavailableReasonFa}</p>
                          ) : null}
                        </div>

                        <div className="mt-3 flex items-end justify-between gap-2">
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
          </div>
        )}
      </main>

      {cart.length > 0 && canOrder ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-3 backdrop-blur lg:hidden">
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
