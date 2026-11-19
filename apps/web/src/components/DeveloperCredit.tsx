import { useEffect, useRef } from 'react';
import { Camera, PhoneCall } from 'lucide-react';
import { animate, stagger } from 'animejs';

const INSTAGRAM_URL = 'https://www.instagram.com/siyaablack/';
const PHONE_DISPLAY = '09023363676';
const PHONE_HREF = 'tel:+989023363676';

/**
 * A small, self-contained signature credit. The business app never depends on
 * it; it is only a quiet credit with a direct Instagram link and a tap-to-call
 * number. The entrance is animated with anime.js and is skipped when the
 * visitor asks for reduced motion.
 */
export function DeveloperCredit({
  className = '',
  tone = 'light',
}: {
  className?: string;
  /** `dark` is for dark backgrounds such as the home footer. */
  tone?: 'light' | 'dark';
}) {
  const dark = tone === 'dark';
  const muted = dark ? 'text-cream/50' : 'text-muted';
  const strong = dark ? 'text-cream hover:text-brand-200' : 'text-ink hover:text-brand-700';
  const rule = dark ? 'bg-brand-300' : 'bg-brand-500';
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const items: HTMLElement[] = Array.from(
      root.querySelectorAll<HTMLElement>('[data-credit-reveal]'),
    );
    const rule = root.querySelector<HTMLElement>('[data-credit-rule]');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      for (const item of items) {
        item.style.opacity = '1';
        item.style.transform = 'none';
        item.style.filter = 'none';
      }
      if (rule) rule.style.opacity = '0.55';
      return;
    }

    const entrance = animate(items, {
      opacity: [0, 1],
      translateY: [10, 0],
      filter: ['blur(5px)', 'blur(0px)'],
      delay: stagger(95),
      duration: 680,
      easing: 'easeOutCubic',
    });

    const ruleAnimation = rule
      ? animate(rule, {
          opacity: [0, 0.8, 0.5],
          scaleX: [0, 1],
          duration: 950,
          easing: 'easeOutQuart',
        })
      : null;

    return () => {
      entrance.revert();
      ruleAnimation?.revert();
    };
  }, []);

  const lift = (event: React.MouseEvent<HTMLAnchorElement>) => {
    animate(event.currentTarget, {
      translateY: -2,
      scale: 1.035,
      duration: 220,
      easing: 'easeOutQuad',
    });
  };

  const settle = (event: React.MouseEvent<HTMLAnchorElement>) => {
    animate(event.currentTarget, {
      translateY: 0,
      scale: 1,
      duration: 280,
      easing: 'easeOutQuad',
    });
  };

  return (
    <div ref={rootRef} className={`flex flex-col items-center gap-2 text-center ${className}`.trim()}>
      <span data-credit-reveal style={{ opacity: 0 }} className={`text-[9px] font-semibold ${muted}`}>
        اطلاعات برنامه‌نویس
      </span>

      <span
        data-credit-rule
        aria-hidden="true"
        style={{ opacity: 0 }}
        className={`h-px w-14 origin-center ${rule}`}
      />

      <p
        data-credit-reveal
        style={{ opacity: 0 }}
        className={`flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] ${muted}`}
      >
        <span>طراحی و توسعه</span>
        <a
          href={INSTAGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          onMouseEnter={lift}
          onMouseLeave={settle}
          aria-label="صفحهٔ اینستاگرام @siyaablack"
          title="صفحهٔ اینستاگرام"
          className={`inline-flex items-center gap-1 font-semibold ${strong}`}
          dir="ltr"
        >
          <Camera className="h-3.5 w-3.5" aria-hidden="true" />
          @siyaablack
        </a>
        <span className={dark ? 'text-cream/30' : 'text-line'} aria-hidden="true">·</span>
        <a
          href={PHONE_HREF}
          onMouseEnter={lift}
          onMouseLeave={settle}
          aria-label="تماس مستقیم با ۰۹۰۲۳۳۶۳۶۷۶"
          title="تماس مستقیم"
          className={`num inline-flex items-center gap-1 font-semibold ${strong}`}
          dir="ltr"
        >
          <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />
          {PHONE_DISPLAY}
        </a>
      </p>
    </div>
  );
}
