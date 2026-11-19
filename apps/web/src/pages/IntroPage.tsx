import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { preload } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@cafeflow/ui';

const POSTER = '/scenes/hero-cup.webp';
const FILM = '/scenes/hero-cup.mp4';
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Shared framing for the plate, so the poster and the film never disagree. */
const MEDIA = 'size-full object-cover object-[76%_50%] lg:object-[8%_50%]';

// The poster is the first paint and the largest element; start it before React mounts.
preload(POSTER, { as: 'image', fetchPriority: 'high' });

type Connection = {
  saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
};

function connection() {
  return (navigator as Navigator & { connection?: Connection }).connection;
}

/** Visitors on a metered connection or with reduced motion get the still frame only. */
function stillSnapshot() {
  return window.matchMedia(MOTION_QUERY).matches || connection()?.saveData === true;
}

function subscribeStill(onChange: () => void) {
  const motion = window.matchMedia(MOTION_QUERY);
  const network = connection();

  motion.addEventListener('change', onChange);
  network?.addEventListener?.('change', onChange);

  return () => {
    motion.removeEventListener('change', onChange);
    network?.removeEventListener?.('change', onChange);
  };
}

/** Follows the setting while the page is open, not only at mount. */
function useStillPreference() {
  return useSyncExternalStore(subscribeStill, stillSnapshot, () => true);
}

/**
 * Cinematic entrance: a film plate of the café, graded with a warm vignette and
 * 35 mm grain, over which the title is set. The poster paints immediately and the
 * film fades in on top of it, so an unreachable or refused video never flashes black.
 */
export function IntroPage() {
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frame = useRef(0);
  const leaveTimer = useRef<number | undefined>(undefined);
  const still = useStillPreference();
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [entering, setEntering] = useState(false);
  const film = !still && !failed;

  // Autoplay can be refused even when muted (battery saver); the poster is a full still.
  useEffect(() => {
    if (!film) return;
    videoRef.current?.play().catch(() => setFailed(true));
  }, [film]);

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  // Remembered for the session, so returning to "/" goes straight to the café.
  useEffect(() => {
    try {
      sessionStorage.setItem('cafeflow:intro-seen', '1');
    } catch {
      // Private or sandboxed storage: nothing to remember, the page still works.
    }
  }, []);

  // Hidden tabs must not decode video; the poster stays underneath while paused.
  useEffect(() => {
    if (!film) return;
    const video = videoRef.current;
    if (!video) return;

    const onVisibilityChange = () => {
      if (document.hidden) {
        video.pause();
        return;
      }
      video.play().catch(() => undefined);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [film]);

  // Slow parallax: a few pixels, the way a locked-off camera breathes.
  useEffect(() => {
    if (!film) return;
    const stage = stageRef.current;
    if (!stage) return;

    const pointer = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };

    const onMove = (event: PointerEvent) => {
      target.x = (event.clientX / window.innerWidth - 0.5) * 2;
      target.y = (event.clientY / window.innerHeight - 0.5) * 2;
    };

    const tick = () => {
      pointer.x += (target.x - pointer.x) * 0.045;
      pointer.y += (target.y - pointer.y) * 0.045;
      stage.style.transform = `translate3d(${(-pointer.x * 9).toFixed(2)}px, ${(-pointer.y * 6).toFixed(2)}px, 0)`;
      frame.current = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    frame.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame.current);
    };
  }, [film]);

  const enter = useCallback(() => {
    if (entering) return;
    setEntering(true);
    leaveTimer.current = window.setTimeout(() => navigate('/'), still ? 220 : 560);
  }, [entering, navigate, still]);

  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-[#0b0705] text-cream">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div ref={stageRef} className="absolute -inset-6">
          <div className="cinematic-push relative size-full">
            <img
              src={POSTER}
              alt=""
              fetchPriority="high"
              decoding="async"
              className={`${MEDIA} [filter:contrast(1.06)_saturate(0.92)_brightness(0.94)]`}
            />
            {film ? (
              <video
                ref={videoRef}
                src={FILM}
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                disablePictureInPicture
                onPlaying={() => setPlaying(true)}
                onError={() => setFailed(true)}
                className={`${MEDIA} absolute inset-0 transition-opacity duration-700 [filter:contrast(1.06)_saturate(0.92)_brightness(0.94)] ${
                  playing ? 'opacity-100' : 'opacity-0'
                }`}
              />
            ) : null}
          </div>
        </div>

        {/* Light: a warm key from the upper right, then the grade and the falloff. */}
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_82%_8%,rgba(185,95,51,0.2),transparent_55%)] mix-blend-screen" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(9,5,4,0.78)_0%,rgba(9,5,4,0.12)_24%,rgba(9,5,4,0.1)_40%,rgba(9,5,4,0.86)_78%,rgba(9,5,4,0.97)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(115%_95%_at_50%_42%,transparent_38%,rgba(8,5,4,0.6)_100%)]" />
      </div>

      <div aria-hidden className="film-grain pointer-events-none absolute inset-0 z-0" />

      <header className="relative z-10 flex items-center justify-between gap-4 px-5 py-5 sm:px-10 sm:py-7">
        <Link to="/" className="font-display text-lg font-bold tracking-tight text-cream">
          کافه‌فلو
        </Link>
        <Link
          to="/"
          className="text-[10.5px] tracking-wide text-cream/50 transition hover:text-cream"
        >
          رد کردن و ورود به سایت
        </Link>
      </header>

      <div className="relative z-10 mt-auto w-full px-5 pb-10 sm:px-10 sm:pb-14">
        <div className="mx-auto w-full max-w-6xl">
          <div className="max-w-2xl">
            <div
              className="intro-reveal flex items-center gap-3 text-[10px] tracking-[0.22em] text-cream/55"
              style={{ animationDelay: '120ms' }}
            >
              <span aria-hidden className="h-px w-8 bg-cream/35" />
              تجربهٔ کافه‌فلو
            </div>

            <h1
              className="intro-reveal font-display mt-5 text-[clamp(2.4rem,6.4vw,4.4rem)] font-bold leading-[1.14] tracking-tight drop-shadow-[0_6px_40px_rgba(0,0,0,0.55)]"
              style={{ animationDelay: '240ms' }}
            >
              یک فنجان تا کافه
            </h1>

            <p
              className="intro-reveal mt-5 max-w-md text-[13px] leading-7 text-cream/70 sm:text-sm sm:leading-8"
              style={{ animationDelay: '360ms' }}
            >
              عطر قهوهٔ تازه‌دم، میزهای آماده و منویی که با یک اسکن باز می‌شود. وارد شوید و روز را از
              کافه‌فلو شروع کنید.
            </p>

            <div
              className="intro-reveal mt-8 flex flex-wrap items-center gap-x-6 gap-y-4"
              style={{ animationDelay: '480ms' }}
            >
              <Button size="lg" onClick={enter} loading={entering}>
                ورود به کافه
              </Button>
              <Link
                to="/menu"
                className="text-[11.5px] text-cream/75 underline decoration-cream/25 underline-offset-4 transition hover:text-cream"
              >
                دیدن منو
              </Link>
              <Link
                to="/staff/login"
                className="text-[11.5px] text-cream/55 underline decoration-cream/20 underline-offset-4 transition hover:text-cream"
              >
                ورود کارکنان
              </Link>
            </div>

            <div
              className="intro-reveal mt-9 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-cream/12 pt-4 text-[10px] text-cream/40"
              style={{ animationDelay: '600ms' }}
            >
              <span>قهوهٔ تازه‌دم</span>
              <span aria-hidden className="size-0.5 rounded-full bg-cream/30" />
              <span>منوی دیجیتال</span>
              <span aria-hidden className="size-0.5 rounded-full bg-cream/30" />
              <span>سفارش از روی میز</span>
            </div>
          </div>
        </div>
      </div>

      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-20 bg-[#0b0705] transition-opacity duration-500 ${
          entering ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </main>
  );
}
