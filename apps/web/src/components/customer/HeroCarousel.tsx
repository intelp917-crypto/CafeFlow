import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { formatCountFa } from '../../lib/format';

export interface HeroItem {
  id: string;
  nameFa: string;
  count: number;
  image: string;
  /** Muted flavour colour used for the light behind the cards. */
  tint: string;
}

interface HeroCarouselProps {
  items: HeroItem[];
  reducedMotion: boolean;
}

const EASE = 'cubic-bezier(.22,.8,.24,1)';

/**
 * A small, real 3D-feeling carousel for the landing hero.
 *
 * It is driven by the live menu categories: drag it, flick it, click a card,
 * use the arrows or let it advance on its own while the hero is on screen. The
 * colour behind the cards grows out on every change, and the selected category
 * name is shown under the deck. Reduced motion turns every animation off.
 */
export function HeroCarousel({ items, reducedMotion }: HeroCarouselProps) {
  const [pos, setPos] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [auto, setAuto] = useState(!reducedMotion);
  const [inView, setInView] = useState(true);
  const [slot, setSlot] = useState(210);
  const [glow, setGlow] = useState<{ color: string; key: number } | null>(null);
  const dragRef = useRef<{ startX: number; startPos: number; moved: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const count = items.length;
  const active = count > 0 ? ((Math.round(pos) % count) + count) % count : 0;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => setSlot(Math.max(112, Math.min(228, element.clientWidth * 0.17)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), {
      threshold: 0.4,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const previousActive = useRef(active);
  useEffect(() => {
    if (previousActive.current === active) return;
    previousActive.current = active;
    if (reducedMotion) return;
    const item = items[active];
    if (!item) return;
    setGlow({ color: item.tint, key: Date.now() });
    const timer = window.setTimeout(() => setGlow(null), 1100);
    return () => window.clearTimeout(timer);
  }, [active, items, reducedMotion]);

  useEffect(() => {
    if (!auto || reducedMotion || dragging || !inView || count < 2) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const timer = window.setInterval(() => setPos((current) => Math.round(current) + 1), 4600);
    return () => window.clearInterval(timer);
  }, [auto, reducedMotion, dragging, inView, count]);

  const goTo = useCallback(
    (next: number) => {
      setPos(Math.round(next));
    },
    [],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { startX: event.clientX, startPos: pos, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    if (Math.abs(dx) > 4) drag.moved = true;
    setPos(drag.startPos - dx / slot);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag || !drag.moved) return;
    setPos(Math.round(pos));
  };

  if (count === 0) return null;

  const current = items[active]!;

  return (
    <div ref={containerRef} className="relative select-none">
      {glow ? (
        <span
          key={glow.key}
          aria-hidden="true"
          className="hero-glow pointer-events-none absolute left-1/2 top-[42%] size-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: `radial-gradient(circle, ${glow.color} 0%, transparent 66%)` }}
        />
      ) : null}

      <div
        className={`relative h-[22rem] touch-pan-y sm:h-[27rem] ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ perspective: '1300px' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {items.map((item, index) => {
          let offset = index - pos;
          offset = ((offset + count / 2) % count + count) % count - count / 2;
          const distance = Math.abs(offset);
          const isActive = index === active;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => goTo(index)}
              aria-label={`${item.nameFa}، ${item.count} آیتم`}
              aria-current={isActive ? 'true' : undefined}
              className="absolute left-1/2 top-1/2 w-[10rem] overflow-hidden rounded-[1.4rem] bg-surface text-start shadow-[0_40px_80px_-40px_rgba(0,0,0,0.85)] outline-offset-4 sm:w-[12.5rem]"
              style={{
                height: '20.5rem',
                transform: `translate(-50%, -50%) translateX(${offset * slot}px) translateY(${distance * 10}px) translateZ(${-distance * 70}px) rotateY(${offset * -22}deg) scale(${1 - distance * 0.05})`,
                opacity: Math.max(0, 1 - distance * 0.24),
                zIndex: 30 - Math.round(distance * 6),
                transition: dragging ? 'none' : `transform 720ms ${EASE}, opacity 480ms ease`,
              }}
            >
              <img
                src={item.image}
                alt=""
                className="h-[13rem] w-full object-cover sm:h-[14.5rem]"
                width={1024}
                height={1024}
                draggable={false}
              />
              <div className="space-y-1 p-3.5">
                <p className="text-[9px] text-muted">دسته‌بندی</p>
                <p className="font-display text-sm font-bold leading-tight text-ink">{item.nameFa}</p>
                <p className="num text-[10px] text-muted">{item.count} آیتم</p>
              </div>
              <span
                aria-hidden="true"
                className={`absolute inset-0 rounded-[1.4rem] ring-1 ${
                  isActive ? 'ring-brand-500/70' : 'ring-ink/5'
                }`}
              />
            </button>
          );
        })}
      </div>

      <div className="relative mt-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goTo(Math.round(pos) - 1)}
            aria-label="دسته قبلی"
            className="flex size-10 items-center justify-center rounded-full border border-cream/25 text-cream hover:border-cream/60"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
              <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => goTo(Math.round(pos) + 1)}
            aria-label="دسته بعدی"
            className="flex size-10 items-center justify-center rounded-full border border-cream/25 text-cream hover:border-cream/60"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setAuto((value) => !value)}
            aria-pressed={auto}
            className="ms-1 flex items-center gap-2 text-[10px] text-cream/60 hover:text-cream"
          >
            <span className="flex size-6 items-center justify-center rounded-full border border-cream/30">
              {auto ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="size-2.5">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="size-2.5">
                  <path d="M7 4l13 8-13 8z" />
                </svg>
              )}
            </span>
            پخش خودکار
          </button>
        </div>

        <p className="num text-[10px] text-cream/50" aria-live="polite">
          {formatCountFa(active + 1).padStart(2, '۰')} / {formatCountFa(count).padStart(2, '۰')}
        </p>
      </div>

      <div className="relative mt-4 border-t border-cream/12 pt-4" aria-live="polite">
        <p key={current.id} className="hero-swap font-display text-xl font-bold text-cream">
          {current.nameFa}
        </p>
        <p className="num mt-1 text-[11px] text-cream/55">{current.count} آیتم در این دسته</p>
      </div>
    </div>
  );
}
