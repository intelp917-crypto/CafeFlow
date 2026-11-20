import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@cafeflow/ui';
import { customerApi } from '../lib/customer';
import { useBranding } from '../lib/branding';
import { formatCountFa } from '../lib/format';
import { HeroCarousel, type HeroItem } from '../components/customer/HeroCarousel';
import { CafeLocation } from '../components/customer/CafeLocation';
import { DeveloperCredit } from '../components/DeveloperCredit';

interface LandingCategory {
  id: string;
  nameFa: string;
  productCount: number;
}

/** Muted tints behind the carousel cards, one per category, recycled. */
const TINTS = ['#d9a26a', '#a9c1bd', '#cf9aa2', '#b9a7c9', '#cbb08a', '#c2a58d'];

function imageFor(name: string): string {
  if (/(سرد|آیس|iced|cold|فراپه|شیک|shake)/.test(name)) return '/images/iced.jpg';
  if (/(شیرینی|کیک|دسر|dessert|cake|pastry)/.test(name)) return '/images/cake.jpg';
  if (/(غذا|صبحانه|ساندویچ|سالاد|پاستا|food|sandwich|breakfast|salad|pasta)/.test(name)) return '/images/food.jpg';
  return '/images/cup-hero.jpg';
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function Wordmark({ className = '' }: { className?: string }) {
  const { nameFa } = useBranding();
  return (
    <span className={`font-display text-xl font-bold ${className}`} dir="rtl">
      {nameFa}
    </span>
  );
}

export function HomePage() {
  const { nameFa, addressFa, phone, latitude, longitude } = useBranding();
  const [categories, setCategories] = useState<LandingCategory[] | null>(null);
  const [productTotal, setProductTotal] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    let disposed = false;
    customerApi
      .menu()
      .then((menu) => {
        if (disposed) return;
        setProductTotal(menu.categories.reduce((sum, category) => sum + category.products.length, 0));
        setCategories(
          menu.categories.map((category) => ({
            id: category.id,
            nameFa: category.nameFa,
            productCount: category.products.length,
          })),
        );
      })
      .catch(() => {
        // The landing page still works without catalog numbers.
      });
    return () => {
      disposed = true;
    };
  }, []);

  const menu = categories ?? [];
  const heroItems: HeroItem[] = menu.map((category, index) => ({
    id: category.id,
    nameFa: category.nameFa,
    count: category.productCount,
    image: imageFor(category.nameFa),
    tint: TINTS[index % TINTS.length]!,
  }));

  return (
    <div className="flex min-h-dvh flex-col bg-espresso text-cream">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full border border-brand-300/40 bg-brand-500/15">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5">
                <path d="M5 9h11a4 4 0 0 1 0 8h-1v2H8v-2H5z" strokeLinejoin="round" />
                <path d="M8 5c0 1.5 1 1.5 1 3M12 5c0 1.5 1 1.5 1 3" strokeLinecap="round" />
              </svg>
            </span>
            <Wordmark />
          </div>
          <Link
            to="/menu"
            className="rounded-full border border-cream/25 px-4 py-2 text-[11px] text-cream hover:border-cream/60"
          >
            شروع سفارش
          </Link>
        </div>
      </header>

      <main className="relative flex flex-1 items-center overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-40 -top-40 size-[30rem] rounded-full bg-brand-500/20 blur-3xl"
        />
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-5 pb-12 pt-28 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
          <div>
            <p className="rise-in text-[11px] text-brand-200">کافه، منو، سفارش</p>
            <h1 className="font-display rise-in mt-4 text-[2.5rem] font-bold leading-[1.3] sm:text-6xl" style={{ animationDelay: '100ms' }}>
              سفارش آرام،
              <br />
              از روی میز.
            </h1>
            <p className="rise-in mt-5 max-w-md text-xs leading-7 text-cream/70 sm:text-sm" style={{ animationDelay: '180ms' }}>
              کد QR میز را اسکن کنید، منو را ببینید و سفارش را مستقیم به تیم کافه بفرستید. وضعیت هر آیتم را تا
              لحظه سرو دنبال کنید.
            </p>

            <div className="rise-in mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: '260ms' }}>
              <Link to="/menu">
                <Button size="lg">دیدن منو</Button>
              </Link>
              <Link
                to="/staff/login"
                className="rounded-full border border-cream/15 px-6 py-3 text-xs text-cream/70 hover:border-cream/40 hover:text-cream"
              >
                ورود کارکنان
              </Link>
            </div>

            <dl className="rise-in mt-10 flex gap-8 border-t border-cream/12 pt-6" style={{ animationDelay: '340ms' }}>
              <div>
                <dt className="text-[10px] text-cream/50">دسته‌بندی</dt>
                <dd className="num font-display mt-1 text-3xl font-bold">{formatCountFa(menu.length)}</dd>
              </div>
              <div className="border-s border-cream/12 ps-8">
                <dt className="text-[10px] text-cream/50">آیتم در منو</dt>
                <dd className="num font-display mt-1 text-3xl font-bold">{formatCountFa(productTotal)}</dd>
              </div>
            </dl>
          </div>

          <div className="rise-in" style={{ animationDelay: '200ms' }}>
            {heroItems.length > 0 ? (
              <HeroCarousel items={heroItems} reducedMotion={reduced} />
            ) : (
              <img
                src="/images/cup-hero.jpg"
                alt="فنجان قهوه کرم‌رنگ میان دانه‌های برشته با پاشش قهوه"
                width={1392}
                height={752}
                className="aspect-[5/4] w-full rounded-[2rem] object-cover object-[62%_center]"
              />
            )}
          </div>
        </div>
      </main>

      {latitude !== null && longitude !== null ? (
        <section aria-label="موقعیت کافه" className="border-t border-cream/10">
          <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-12">
            <CafeLocation
              tone="dark"
              nameFa={nameFa}
              addressFa={addressFa}
              phone={phone}
              latitude={latitude}
              longitude={longitude}
            />
          </div>
        </section>
      ) : null}

      <footer className="border-t border-cream/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-5 py-8 sm:flex-row sm:justify-between sm:px-8">
          <p className="text-[10px] text-cream/45">سامانه یکپارچه مدیریت کافه و رستوران</p>
          <nav className="flex gap-5 text-[11px] text-cream/60">
            <Link to="/menu" className="hover:text-cream">منو</Link>
            <Link to="/staff/login" className="hover:text-cream">کارکنان</Link>
          </nav>
        </div>
        <div className="border-t border-cream/10 px-5 py-6">
          <DeveloperCredit tone="dark" />
        </div>
      </footer>
    </div>
  );
}
