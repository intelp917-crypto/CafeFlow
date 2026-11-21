import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, SeatList } from '../shared/GamePieces';

const COLORS = ['#aa472b', '#96a09f', '#7c5c3e', '#3f6b52', '#b07d3f', '#6d5b8f'];

interface Snake {
  player: number;
  body: Array<{ x: number; y: number }>;
  alive: boolean;
  score: number;
}

/**
 * نبرد مارها — همه هم‌زمان روی یک زمین بازی می‌کنند و سرور هر ۱۲۰ میلی‌ثانیه
 * یک قدم جلو می‌برد. صفحه فقط زمین، خوراک و مارها را می‌کشد و چهار دکمهٔ
 * جهت می‌فرستد؛ برخورد، خوراک و برنده در قواعد است.
 */
export function SnakeBattle({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const width = (state.width as number) ?? 28;
  const height = (state.height as number) ?? 20;
  const snakes = (state.snakes as Snake[] | undefined) ?? [];
  const food = (state.food as { x: number; y: number } | null) ?? null;
  const winner = (state.winner as number | null) ?? null;
  const tick = (state.tick as number) ?? 0;
  const me = snakes[mySeat];
  const alive = me?.alive !== false && winner === null;

  const turn = (direction: string) => {
    if (!alive || phase !== 'playing') return;
    onMove({ direction });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SeatList seats={seats} />
        <p className="num text-[10px] text-muted">تیک {formatCountFa(tick)}</p>
      </div>

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          {seats.map((seat) => `${seat.nameFa}: ${formatCountFa(snakes[seat.index]?.score ?? 0)}`).join(' · ')}
        </p>
      </ResultOverlay>

      <div className="overflow-hidden rounded-[1.75rem] border border-line/70 bg-[#17251f] p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="block w-full"
          role="img"
          aria-label="زمین بازی نبرد مارها"
          shapeRendering="crispEdges"
        >
          <rect x="0" y="0" width={width} height={height} fill="#17251f" />
          {food ? <rect x={food.x + 0.15} y={food.y + 0.15} width="0.7" height="0.7" rx="0.3" fill="#e2b04a" /> : null}
          {snakes.map((snake) =>
            snake.body.map((cell, index) => (
              <rect
                key={`${snake.player}-${index}`}
                x={cell.x + 0.08}
                y={cell.y + 0.08}
                width="0.84"
                height="0.84"
                rx={index === 0 ? 0.3 : 0.15}
                fill={COLORS[snake.player % COLORS.length]}
                opacity={snake.alive ? 1 : 0.28}
              />
            )),
          )}
        </svg>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-line/70 bg-surface p-3">
          <button
            type="button"
            onClick={() => turn('up')}
            disabled={!alive}
            aria-label="بالا"
            className="flex size-12 items-center justify-center rounded-2xl border border-line bg-cream text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <ArrowUp aria-hidden className="size-5" />
          </button>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => turn('left')}
              disabled={!alive}
              aria-label="چپ"
              className="flex size-12 items-center justify-center rounded-2xl border border-line bg-cream text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <ArrowLeft aria-hidden className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => turn('down')}
              disabled={!alive}
              aria-label="پایین"
              className="flex size-12 items-center justify-center rounded-2xl border border-line bg-cream text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <ArrowDown aria-hidden className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => turn('right')}
              disabled={!alive}
              aria-label="راست"
              className="flex size-12 items-center justify-center rounded-2xl border border-line bg-cream text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <ArrowRight aria-hidden className="size-5" />
            </button>
          </div>
          <p className="text-[10px] text-muted">
            {alive ? 'با دکمه‌های جهت بچرخید؛ خوراک زرد یک قدم رشد می‌دهد.' : 'مار شما از بازی خارج شده است.'}
          </p>
        </div>

        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="mb-1.5 text-[10px] text-muted">امتیاز</p>
          <ul className="space-y-1">
            {seats.map((seat) => {
              const snake = snakes[seat.index];
              return (
                <li key={seat.index} className="flex items-center justify-between text-[11px]">
                  <span className={cn('flex items-center gap-1.5', snake?.alive ? 'text-ink/80' : 'text-muted line-through')}>
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: COLORS[seat.index % COLORS.length] }}
                    />
                    {seat.nameFa}
                    {snake && !snake.alive ? <span className="text-[9px] no-underline">بیرون</span> : null}
                  </span>
                  <span className="num text-muted">
                    {formatCountFa(snake?.body.length ?? 0)} خانه
                    <span className="mr-2 font-semibold text-ink">{formatCountFa(snake?.score ?? 0)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[10px] text-muted">برخورد با دیوار، خودتان یا مار دیگری بازی را برایتان تمام می‌کند.</p>
        </div>
      </div>
    </div>
  );
}
