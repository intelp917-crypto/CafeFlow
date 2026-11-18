import { useEffect, useRef, useState } from 'react';
import { Button } from '@cafeflow/ui';
import type { CoffeeSceneHandle, CoffeeStage } from './CoffeeScene';

const STAGE_LABELS_FA: Record<CoffeeStage, string> = {
  beans: 'دانه‌های قهوه',
  grinding: 'آسیاب',
  brewing: 'استخراج اسپرسو',
  milk: 'ریختن شیر',
  art: 'طرح گل رزتا',
  done: 'آماده است',
};

export interface CoffeeIntroProps {
  /** Called once the animation (or a fallback) is finished. */
  onDone: () => void;
  /** Called when the customer explicitly skips. */
  onSkip?: () => void;
  disabled?: boolean;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Wraps the 3D scene so the heavy Three.js chunk is only downloaded when the
 * animation will actually play, and always offers a way to skip.
 */
export function CoffeeIntro({ onDone, onSkip, disabled = false }: CoffeeIntroProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<CoffeeSceneHandle | null>(null);
  const [stage, setStage] = useState<CoffeeStage>('beans');
  const [mode, setMode] = useState<'loading' | 'animated' | 'poster'>('loading');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (disabled) return;
    let disposed = false;

    const finish = () => {
      if (!disposed) onDone();
    };

    const reduced = prefersReducedMotion();

    const run = async () => {
      if (reduced) {
        setMode('poster');
        onDone();
        return;
      }

      try {
        const { createCoffeeScene, supportsWebGl } = await import('./CoffeeScene');
        if (disposed) return;

        if (!supportsWebGl() || !containerRef.current) {
          setMode('poster');
          onDone();
          return;
        }

        const handle = createCoffeeScene(containerRef.current, {
          onComplete: () => {
            setReady(true);
            finish();
          },
          onStage: setStage,
        });
        handleRef.current = handle;
        setMode('animated');
        handle.play();
      } catch {
        // A failed WebGL initialisation must never block the menu.
        setMode('poster');
        onDone();
      }
    };

    void run();

    return () => {
      disposed = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [disabled, onDone]);

  const skip = () => {
    handleRef.current?.skip();
    handleRef.current?.dispose();
    handleRef.current = null;
    setReady(true);
    onSkip?.();
    onDone();
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-brand-100 bg-gradient-to-b from-[#2a1610] via-[#3a1f15] to-[#1a0f0a]">
      <div className="relative h-[68vh] min-h-96 w-full sm:h-[62vh]">
        {mode === 'poster' ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
            <div className="relative flex h-40 w-40 items-end justify-center">
              <div className="absolute bottom-0 h-6 w-32 rounded-full bg-black/40 blur-md" />
              <div className="relative h-24 w-28 rounded-b-[3rem] rounded-t-lg border-4 border-brand-100/80 bg-gradient-to-b from-[#f7efe4] to-[#e4d3bf]" />
              <div className="absolute bottom-14 h-14 w-24 rounded-[50%] bg-[#3a2113]" />
              <div className="absolute bottom-16 h-10 w-16 rounded-[50%] bg-[#f0dfc8]/90" />
              <span className="absolute -top-2 h-10 w-2 rounded-full bg-white/25 blur-[2px]" />
              <span className="absolute top-4 start-8 h-8 w-1.5 rounded-full bg-white/20 blur-[2px]" />
            </div>
            <p className="text-sm text-brand-100">دانه‌های تازه، استخراج دقیق، لاته‌آرت دست‌ساز</p>
          </div>
        ) : (
          <div ref={containerRef} className="h-full w-full" aria-hidden="true" />
        )}

        {mode === 'animated' ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-2 px-6">
            <p className="rounded-full bg-black/30 px-3 py-1 text-[11px] text-brand-100 backdrop-blur-sm">
              {STAGE_LABELS_FA[stage]}
            </p>
          </div>
        ) : null}

        {mode !== 'poster' ? (
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
            <span className="rounded-full bg-black/35 px-3 py-1 text-[11px] text-brand-100 backdrop-blur-sm">
              کافه‌فلو
            </span>
            <Button size="sm" variant="secondary" onClick={skip} disabled={ready}>
              رد کردن انیمیشن
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
