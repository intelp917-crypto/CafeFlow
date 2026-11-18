import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@cafeflow/ui';
import { CoffeeIntro } from '../features/coffee/CoffeeIntro';

const INTRO_SESSION_KEY = 'cafeflow:intro-seen';

function introAlreadySeen(): boolean {
  try {
    return sessionStorage.getItem(INTRO_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Customer entry point. The 3D intro plays at most once per browser session:
 * navigating back to the home page shows the static hero instead of replaying
 * five seconds of animation.
 */
export function HomePage() {
  const [introSeen, setIntroSeen] = useState(introAlreadySeen);
  const [introDone, setIntroDone] = useState(introAlreadySeen);

  const finishIntro = useCallback(() => {
    try {
      sessionStorage.setItem(INTRO_SESSION_KEY, '1');
    } catch {
      // Private mode may refuse storage; the animation simply plays again.
    }
    setIntroSeen(true);
    setIntroDone(true);
  }, []);

  return (
    <div className="min-h-dvh bg-[#150c08] text-brand-50">
      <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6 sm:px-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-brand-500 text-white">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-5">
                <path d="M5 9h11a4 4 0 0 1 0 8h-1v2H8v-2H5z" strokeLinejoin="round" />
                <path d="M8 5c0 1.5 1 1.5 1 3M12 5c0 1.5 1 1.5 1 3" strokeLinecap="round" />
              </svg>
            </span>
            <div className="leading-tight">
              <p className="text-sm font-bold">کافه‌فلو</p>
              <p className="text-[10px] text-brand-100/70">منوی دیجیتال کافه</p>
            </div>
          </div>
          <Link to="/staff/login" className="text-[11px] text-brand-100/70 hover:text-brand-50">
            ورود کارکنان
          </Link>
        </header>

        <main className="flex flex-1 flex-col justify-center gap-6 py-6">
          {!introSeen ? (
            <CoffeeIntro onDone={finishIntro} />
          ) : (
            <div className="relative overflow-hidden rounded-3xl border border-brand-100/15 bg-gradient-to-b from-[#2a1610] via-[#3a1f15] to-[#1a0f0a]">
              <div className="flex h-52 items-end justify-center gap-2 pb-6 sm:h-64">
                <div className="relative flex h-32 w-32 items-end justify-center">
                  <div className="absolute bottom-0 h-5 w-24 rounded-full bg-black/40 blur-md" />
                  <div className="relative h-20 w-24 rounded-b-[2.5rem] rounded-t-lg border-4 border-brand-100/80 bg-gradient-to-b from-[#f7efe4] to-[#e4d3bf]" />
                  <div className="absolute bottom-12 h-10 w-20 rounded-[50%] bg-[#3a2113]" />
                  <div className="absolute bottom-[3.35rem] h-8 w-14 rounded-[50%] bg-[#f0dfc8]/90" />
                </div>
              </div>
            </div>
          )}

          <div
            className={`space-y-4 text-center transition-opacity duration-500 ${
              introDone ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <p className="text-[11px] tracking-wide text-brand-200/80">دانه تازه، استخراج دقیق، لاته‌آرت دست‌ساز</p>
            <h1 className="text-2xl font-bold leading-snug sm:text-3xl">
              قهوه‌ات را از روی میز سفارش بده
            </h1>
            <p className="mx-auto max-w-md text-xs leading-6 text-brand-100/75">
              کد QR روی میز را اسکن کنید تا منو باز شود؛ سفارش مستقیم به باریستا یا آشپزخانه می‌رود و
              می‌توانید وضعیت آماده‌سازی را دنبال کنید.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Link to="/menu">
                <Button size="lg">مشاهده منو</Button>
              </Link>
              <Link to="/staff/login">
                <Button size="lg" variant="outline" className="border-brand-100/30 bg-transparent text-brand-50 hover:border-brand-100/60 hover:text-white">
                  ورود کارکنان
                </Button>
              </Link>
            </div>

            <p className="text-[10px] text-brand-100/50">
              برای ثبت سفارش، کد QR روی میز را اسکن کنید.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { title: 'اسکن QR میز', body: 'بدون نصب اپلیکیشن، منوی همان میز باز می‌شود.' },
              { title: 'سفارش مستقیم', body: 'آیتم‌ها به باریستا یا آشپزخانه مسیر می‌گیرند.' },
              { title: 'پیگیری وضعیت', body: 'از ثبت تا آماده‌شدن، وضعیت را می‌بینید.' },
            ].map((card) => (
              <div key={card.title} className="rounded-2xl border border-brand-100/12 bg-white/5 p-4">
                <p className="text-xs font-semibold">{card.title}</p>
                <p className="mt-1 text-[11px] leading-6 text-brand-100/70">{card.body}</p>
              </div>
            ))}
          </div>
        </main>

        <footer className="border-t border-brand-100/10 pt-4 text-center text-[10px] text-brand-100/40">
          کافه‌فلو — سامانه یکپارچه مدیریت کافه و رستوران
        </footer>
      </div>
    </div>
  );
}
