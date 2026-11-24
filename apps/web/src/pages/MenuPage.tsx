import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  formatRial,
  percentOf,
  type PublicMenuProduct,
  type PublicMenuResponse,
} from '@cafeflow/shared';
import { Alert, Badge, Button, EmptyState, ErrorState, Spinner } from '@cafeflow/ui';
import { errorMessage } from '../lib/api';
import { customerApi, orderTokenFor, rememberOrderToken } from '../lib/customer';
import { formatCountFa } from '../lib/format';
import { randomId } from '../lib/id';
import { CartPanel, type CartLine, type CartTotals } from '../components/customer/CartPanel';
import { ProductDialog, type CartLineDraft } from '../components/customer/ProductDialog';
import { CategoryRail } from '../components/customer/CategoryRail';
import { CafeLocation } from '../components/customer/CafeLocation';
import { DeveloperCredit } from '../components/DeveloperCredit';
import { useNotifications } from '../lib/notifications';
import { DeviceNotificationButton } from '../components/NotificationBell';

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

/** Editorial section index: ۰۱، ۰۲ … */
function sectionNumber(index: number): string {
  return formatCountFa(index + 1).padStart(2, '۰');
}

function CupMark({ className = 'size-10' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 9h11a4 4 0 0 1 0 8h-1v2H8v-2H5z" />
      <path d="M8 5c0 1.5 1 1.5 1 3M12 5c0 1.5 1 1.5 1 3" />
    </svg>
  );
}

/** A product photo fills a wide frame; without one the card keeps its rhythm. */
function ProductImage({
  product,
  className,
  sizes,
  priority = false,
}: {
  product: PublicMenuProduct;
  className: string;
  sizes?: string;
  priority?: boolean;
}) {
  if (!product.imageUrl) {
    return (
      <div
        aria-hidden="true"
        className={`flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,#f7ddc9_0%,#eec0a1_45%,#e19e76_100%)] text-brand-800/50 ${className}`}
      >
        <CupMark className="size-12" />
      </div>
    );
  }

  return (
    <img
      src={product.imageUrl}
      alt={product.nameFa}
      width={1248}
      height={832}
      sizes={sizes}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      className={`object-cover ${className}`}
    />
  );
}

function AvailabilityBadge({ product }: { product: PublicMenuProduct }) {
  return product.isAvailable ? (
    <Badge tone="success" dot>
      موجود
    </Badge>
  ) : (
    <Badge tone="danger" dot>
      ناموجود
    </Badge>
  );
}

export function MenuPage() {
  const { qrToken } = useParams<{ qrToken?: string }>();
  const [searchParams] = useSearchParams();
  const roundCode = searchParams.get('order');
  const navigate = useNavigate();
  const { notify } = useNotifications();
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
  const pendingRequestId = useRef<string>(randomId());

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

  /** Products with options open the configurator; simple ones go straight in. */
  const chooseProduct = (product: PublicMenuProduct) => {
    if (!canOrder || !product.isAvailable) return;
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
      const items = cart.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        optionIds: line.optionIds,
        extraIds: line.extraIds,
        note: line.note,
      }));
      const clientRequestId = pendingRequestId.current;

      // Coming from the status page (`?order=CODE`), the cart extends that
      // order instead of opening a second one on the same table.
      if (roundCode) {
        const response = await customerApi.addOrderItems(roundCode, orderTokenFor(roundCode), {
          clientRequestId,
          items,
        });
        rememberOrderToken(response.code, orderTokenFor(roundCode));
        setCart([]);
        setOrderNote('');
        pendingRequestId.current = randomId();
        setCartOpen(false);
        notify({
          id: `order-items:${response.code}`,
          title: 'اقلام به سفارش اضافه شد',
          body: 'کارکنان سفارش به‌روزشده را می‌بینند.',
          tone: 'success',
        });
        navigate(`/order/${response.code}?qr=${encodeURIComponent(qrToken)}`);
        return;
      }

      const response = await customerApi.createOrder({
        qrToken,
        clientRequestId,
        note: orderNote.trim() || undefined,
        items,
      });

      // The token is only issued once, so it is kept for this tab before the
      // status page takes over.
      rememberOrderToken(response.code, response.statusToken);

      // Server confirmed: the cart can be cleared and the key rotated.
      setCart([]);
      setOrderNote('');
      pendingRequestId.current = randomId();
      setCartOpen(false);
      notify({
        id: `order:${response.code}`,
        title: 'سفارش شما ثبت شد',
        body: 'وضعیت سفارش را در همین صفحه دنبال کنید.',
        tone: 'success',
      });
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
    <div className="min-h-dvh bg-canvas pb-28 lg:pb-10">
      <CategoryRail
        categories={menu.categories}
        activeCategory={activeCategory}
        onSelect={scrollToCategory}
      />

      <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-3 sm:px-8">
          <Link to="/" className="flex min-w-0 items-center gap-2.5 leading-tight">
            {menu.restaurant.logoUrl ? (
              <img
                src={menu.restaurant.logoUrl}
                alt=""
                width={36}
                height={36}
                className="size-9 shrink-0 rounded-full border border-line object-cover"
              />
            ) : (
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-espresso text-cream">
                <CupMark className="size-5" />
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate font-display text-base font-bold text-ink">
                {menu.restaurant.nameFa}
              </span>
              <span className="block truncate text-[10px] text-muted">
                {menu.table
                  ? `${menu.table.nameFa}${menu.table.floorNameFa ? ` — ${menu.table.floorNameFa}` : ''}`
                  : 'منوی کافه'}
              </span>
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-2">
            {menu.table ? (
              <span className="hidden rounded-full border border-line bg-surface px-3 py-1.5 text-[10px] text-muted sm:inline">
                {menu.table.nameFa}
              </span>
            ) : null}
            <DeviceNotificationButton className="hidden sm:inline-flex" />
            <Button size="sm" onClick={() => setCartOpen(true)} disabled={cart.length === 0}>
              سبد ({formatCountFa(itemCount)})
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-8">
        <section className="relative mt-4 overflow-hidden rounded-[2rem] bg-espresso text-cream sm:mt-6">
          <img
            src="/images/menu-hero.jpg"
            alt="میز چوبی تیره با لاته، چیزکیک و دانه‌های قهوه در نور گرم"
            width={1568}
            height={672}
            fetchPriority="high"
            className="absolute inset-0 size-full object-cover object-[35%_center]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-r from-espresso/30 via-espresso/80 to-espresso/95"
          />

          <div className="relative grid gap-8 p-6 sm:p-9 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:p-12">
            <div>
              <p className="flex items-center gap-2 text-[11px] tracking-wide text-brand-200">
                <span aria-hidden="true" className="h-px w-6 bg-brand-300/70" />
                منوی دیجیتال کافه
              </p>
              <h1 className="mt-3 max-w-lg text-balance font-display text-3xl font-bold leading-[1.35] sm:text-4xl lg:text-5xl">
                {menu.table ? `سفارش از ${menu.table.nameFa}` : 'منوی امروز کافه'}
              </h1>
              <p className="mt-4 max-w-md text-pretty text-xs leading-7 text-cream/75 sm:text-sm">
                {canOrder
                  ? 'دسته‌ها را انتخاب کنید، آیتم‌ها را به سبد بریزید و سفارش را مستقیم برای باریستا بفرستید.'
                  : 'همهٔ دسته‌ها و قیمت‌های به‌روز را ببینید. برای ثبت سفارش، کد QR روی میز خود را اسکن کنید.'}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                {menu.categories[0] ? (
                  <Button size="lg" onClick={() => scrollToCategory(menu.categories[0]!.id)}>
                    دیدن منو
                  </Button>
                ) : null}
                {qrToken && menu.gamesEnabled ? (
                  <Link
                    to={`/table/${qrToken}/games`}
                    className="rounded-full border border-cream/25 px-5 py-2.5 text-xs text-cream transition-colors duration-200 hover:border-cream/60 focus-visible:ring-2 focus-visible:ring-cream/60"
                  >
                    بازی میزی
                  </Link>
                ) : null}
                <Link
                  to="/"
                  className="rounded-full border border-cream/25 px-5 py-2.5 text-xs text-cream transition-colors duration-200 hover:border-cream/60 focus-visible:ring-2 focus-visible:ring-cream/60"
                >
                  صفحه اصلی کافه
                </Link>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end lg:flex-col lg:items-stretch">
              <div className="flex flex-1 gap-2.5">
                <div className="flex-1 rounded-2xl border border-cream/15 bg-espresso/45 px-4 py-3 backdrop-blur-sm">
                  <p className="text-[10px] text-cream/55">دسته‌بندی</p>
                  <p className="num mt-0.5 font-display text-2xl font-bold">
                    {formatCountFa(menu.categories.length)}
                  </p>
                </div>
                <div className="flex-1 rounded-2xl border border-cream/15 bg-espresso/45 px-4 py-3 backdrop-blur-sm">
                  <p className="text-[10px] text-cream/55">آیتم در منو</p>
                  <p className="num mt-0.5 font-display text-2xl font-bold">{formatCountFa(productCount)}</p>
                </div>
              </div>

              {menu.restaurant.addressFa || menu.restaurant.phone ? (
                <p className="text-[11px] leading-6 text-cream/60">
                  {menu.restaurant.addressFa}
                  {menu.restaurant.addressFa && menu.restaurant.phone ? ' — ' : ''}
                  {menu.restaurant.phone ? (
                    <span dir="ltr" className="num">
                      {menu.restaurant.phone}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <CafeLocation
          className="mt-5"
          nameFa={menu.restaurant.nameFa}
          addressFa={menu.restaurant.addressFa}
          phone={menu.restaurant.phone}
          latitude={menu.restaurant.latitude}
          longitude={menu.restaurant.longitude}
        />

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
            <div className="space-y-14 pb-10 pt-2">
              {menu.categories.map((category, categoryIndex) => {
                const featured = category.products.length >= 3 ? category.products[0]! : null;
                const rest = featured ? category.products.slice(1) : category.products;

                return (
                  <section
                    key={category.id}
                    id={`category-${category.id}`}
                    className="scroll-mt-40 lg:scroll-mt-24"
                  >
                    <div className="mb-5 flex items-start gap-3 sm:items-end sm:gap-5">
                      <span
                        aria-hidden="true"
                        className="num font-display text-4xl font-bold leading-none text-brand-200 sm:text-5xl"
                      >
                        {sectionNumber(categoryIndex)}
                      </span>
                      <div className="flex min-w-0 flex-1 items-end justify-between gap-3 border-b border-ink/10 pb-2.5">
                        <div className="min-w-0">
                          <h2 className="truncate font-display text-2xl font-bold text-ink sm:text-3xl">
                            {category.nameFa}
                          </h2>
                          <p className="mt-0.5 text-[10px] text-muted">
                            {formatCountFa(category.products.length)} آیتم در این دسته
                          </p>
                        </div>
                        <span aria-hidden="true" className="mb-1 hidden h-1.5 w-1.5 rounded-full bg-brand-400 sm:block" />
                      </div>
                    </div>

                    {featured ? (
                      <article className="group mb-4 overflow-hidden rounded-[1.75rem] border border-line/70 bg-surface shadow-[0_30px_70px_-58px_rgba(41,27,19,0.65)] sm:mb-5">
                        <div className="grid md:grid-cols-[0.95fr_1.05fr]">
                          <div className="order-2 flex flex-col p-5 sm:p-7 md:order-1 md:justify-center">
                            <p className="flex items-center gap-2 text-[10px] text-brand-600">
                              <span aria-hidden="true" className="h-px w-5 bg-brand-300" />
                              پیشنهاد منو
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <h3 className="font-display text-xl font-bold text-ink sm:text-2xl">
                                {featured.nameFa}
                              </h3>
                              <AvailabilityBadge product={featured} />
                            </div>
                            {featured.descriptionFa ? (
                              <p className="mt-2 line-clamp-2 text-[11px] leading-6 text-muted sm:text-xs">
                                {featured.descriptionFa}
                              </p>
                            ) : null}
                            {!featured.isAvailable && featured.unavailableReasonFa ? (
                              <p className="mt-1 text-[10px] text-danger-700">{featured.unavailableReasonFa}</p>
                            ) : null}

                            <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line/80 pt-4">
                              <div>
                                <p className="num text-lg font-bold text-brand-700">{formatRial(featured.price)}</p>
                                <p className="text-[10px] text-muted">
                                  آماده‌سازی ~{formatCountFa(featured.prepMinutes)} دقیقه
                                </p>
                              </div>
                              <Button
                                disabled={!featured.isAvailable || !canOrder}
                                onClick={() => chooseProduct(featured)}
                              >
                                {featured.optionGroups.length > 0 || featured.extras.length > 0
                                  ? 'انتخاب و افزودن'
                                  : 'افزودن به سبد'}
                              </Button>
                            </div>
                          </div>

                          <div className="relative order-1 min-h-52 overflow-hidden md:order-2 md:min-h-full">
                            <ProductImage
                              product={featured}
                              priority
                              sizes="(min-width: 768px) 45vw, 100vw"
                              className="absolute inset-0 size-full transition-transform duration-700 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                            />
                            <div
                              aria-hidden="true"
                              className="absolute inset-0 bg-gradient-to-t from-espresso/45 via-transparent to-transparent md:bg-gradient-to-l md:from-espresso/35 md:via-espresso/5 md:to-transparent"
                            />
                            <span className="absolute bottom-3 start-3 rounded-full bg-cream/90 px-3 py-1 text-[10px] font-medium text-espresso backdrop-blur-sm">
                              تازه‌دم
                            </span>
                          </div>
                        </div>
                      </article>
                    ) : null}

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {rest.map((product) => (
                        <article
                          key={product.id}
                          className="group flex flex-col overflow-hidden rounded-[1.4rem] border border-line/80 bg-surface shadow-[0_24px_55px_-52px_rgba(41,27,19,0.7)] transition-shadow duration-300 hover:shadow-[0_30px_60px_-46px_rgba(41,27,19,0.55)]"
                        >
                          <div className="relative aspect-[4/3] overflow-hidden bg-cream">
                            <ProductImage
                              product={product}
                              sizes="(min-width: 1280px) 30vw, (min-width: 640px) 46vw, 100vw"
                              className="size-full transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                            />
                            <div
                              aria-hidden="true"
                              className="absolute inset-0 bg-gradient-to-t from-espresso/35 via-transparent to-transparent"
                            />

                            <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
                              <span className="rounded-full bg-cream/90 px-2.5 py-1 backdrop-blur-sm">
                                <AvailabilityBadge product={product} />
                              </span>
                              <span className="num rounded-full bg-espresso/85 px-3 py-1 text-[11px] font-semibold text-cream backdrop-blur-sm">
                                {formatRial(product.price, { withUnit: false })}
                                <span className="ms-1 text-[9px] font-normal text-cream/60">ریال</span>
                              </span>
                            </div>

                            <span className="absolute bottom-3 start-3 rounded-full bg-espresso/55 px-2.5 py-1 text-[9px] text-cream backdrop-blur-sm">
                              ~{formatCountFa(product.prepMinutes)} دقیقه
                            </span>
                          </div>

                          <div className="flex flex-1 flex-col p-4">
                            <h3 className="truncate text-sm font-bold text-ink" title={product.nameFa}>
                              {product.nameFa}
                            </h3>
                            <p className="mt-1 line-clamp-2 text-[11px] leading-6 text-muted">
                              {product.descriptionFa ?? 'بدون توضیح'}
                            </p>
                            {!product.isAvailable && product.unavailableReasonFa ? (
                              <p className="mt-1 line-clamp-1 text-[10px] text-danger-700">
                                {product.unavailableReasonFa}
                              </p>
                            ) : null}

                            <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                              <span className="text-[10px] text-muted">
                                {product.optionGroups.length > 0 || product.extras.length > 0
                                  ? 'قابل شخصی‌سازی'
                                  : 'آماده برای سفارش'}
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!product.isAvailable || !canOrder}
                                onClick={() => chooseProduct(product)}
                              >
                                افزودن
                              </Button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <div className="mx-auto max-w-6xl px-4 pb-28 pt-4 sm:px-8 lg:pb-10">
        <CafeLocation
          variant="bar"
          nameFa={menu.restaurant.nameFa}
          addressFa={menu.restaurant.addressFa}
          phone={menu.restaurant.phone}
          latitude={menu.restaurant.latitude}
          longitude={menu.restaurant.longitude}
        />
        <div className="px-1 pt-4">
          <DeveloperCredit />
        </div>
      </div>

      {cart.length > 0 && canOrder ? (
        <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 sm:inset-x-6 lg:inset-x-auto lg:end-8 lg:w-[24rem]">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="flex w-full items-center justify-between gap-3 rounded-full bg-espresso px-5 py-3.5 text-cream shadow-[0_24px_50px_-22px_rgba(36,22,17,0.7)] transition-colors duration-200 hover:bg-choco focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <span className="flex items-center gap-2 text-xs">
              <span className="num flex size-6 items-center justify-center rounded-full bg-cream/15 text-[10px]">
                {formatCountFa(itemCount)}
              </span>
              مشاهده سبد
            </span>
            <span className="num text-sm font-bold">{formatRial(totals.total)}</span>
          </button>
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
