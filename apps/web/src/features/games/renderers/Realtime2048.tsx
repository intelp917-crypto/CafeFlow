import { useEffect, useRef } from 'react';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';
import { formatCountFa } from '../../../lib/format';

const DIRECTIONS: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

function tileClass(value: number): string {
  if (value === 0) return 'bg-cream/40 text-muted';
  if (value <= 4) return 'bg-brand-100 text-brand-800';
  if (value <= 16) return 'bg-brand-200 text-brand-900';
  if (value <= 64) return 'bg-brand-300 text-espresso';
  if (value <= 256) return 'bg-brand-500 text-cream';
  if (value <= 1024) return 'bg-brand-700 text-cream';
  return 'bg-espresso text-cream';
}

/**
 * ۲۰۴۸ — a race, not a turn game: the rules never wait for other seats.
 *
 * Arrow keys for a laptop and a thumb swipe for a phone; the board arrives already
 * filtered to this seat, so nobody can see the leader's tiles.
 */
export function Realtime2048({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const board = (state.board ?? Array.from({ length: 4 }, () => Array(4).fill(0))) as number[][];
  const winner = state.winner as number | null;
  const alive = state.alive as boolean;
  const scores = (state.scores ?? []) as number[];
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const playing = phase === 'playing' && alive !== false;

  useEffect(() => {
    if (!playing) return;
    const onKey = (event: KeyboardEvent) => {
      const dir = DIRECTIONS[event.key];
      if (!dir) return;
      event.preventDefault();
      onMove({ dir });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, onMove]);

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={null}
        hint={alive === false ? 'صفحه‌تان قفل شد؛ منتظر بقیه باشید' : 'همه هم‌زمان بازی می‌کنند'}
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          {winner !== null && winner !== undefined && winner >= 0
            ? `${seatName(seats, winner)} زودتر به ۲۰۴۸ رسید.`
            : 'کسی به ۲۰۴۸ نرسید؛ نتیجه بر اساس امتیاز است.'}
        </p>
      </ResultOverlay>

      <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
        <div className="flex items-center justify-between text-xs">
          <p className="text-muted">
            امتیاز شما: <span className="num font-bold text-ink">{formatCountFa(state.score ?? 0)}</span>
          </p>
          <p className="text-muted">
            بیشترین: <span className="num font-bold text-ink">{formatCountFa(state.highScore ?? 0)}</span>
          </p>
        </div>

        <div
          className="grid grid-cols-4 gap-2 rounded-3xl bg-espresso p-3 touch-none select-none"
          onTouchStart={(event) => {
            const touch = event.touches[0];
            if (touch) startRef.current = { x: touch.clientX, y: touch.clientY };
          }}
          onTouchEnd={(event) => {
            const start = startRef.current;
            const touch = event.changedTouches[0];
            startRef.current = null;
            if (!start || !touch || !playing) return;
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
            onMove({ dir: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up' });
          }}
        >
          {board.map((row, rowIndex) =>
            row.map((value, colIndex) => (
              <div
                key={`${rowIndex}-${colIndex}`}
                className={`flex aspect-square items-center justify-center rounded-xl text-lg font-bold transition-colors duration-150 ${tileClass(
                  value,
                )}`}
                aria-label={value === 0 ? 'خانهٔ خالی' : `کاشی ${value}`}
              >
                {value === 0 ? '' : formatCountFa(value)}
              </div>
            )),
          )}
        </div>

        <div className="flex flex-wrap gap-2" aria-label="حرکت با دکمه">
          {(
            [
              ['up', 'بالا'],
              ['down', 'پایین'],
              ['left', 'چپ'],
              ['right', 'راست'],
            ] as const
          ).map(([dir, label]) => (
            <button
              key={dir}
              type="button"
              disabled={!playing}
              onClick={() => onMove({ dir })}
              className="min-h-11 flex-1 rounded-2xl border border-line/70 bg-surface text-[11px] font-semibold text-ink transition-colors enabled:hover:border-brand-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              {label}
            </button>
          ))}
        </div>

        <ul className="space-y-1 text-[11px] text-ink/80">
          {seats.map((seat) => (
            <li key={seat.index} className="flex items-center justify-between rounded-xl bg-surface px-3 py-1.5">
              <span className="max-w-[9rem] truncate">
                {seat.nameFa}
                {seat.isYou ? ' (شما)' : ''}
              </span>
              <span className="num">{formatCountFa(scores[seat.index] ?? 0)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
