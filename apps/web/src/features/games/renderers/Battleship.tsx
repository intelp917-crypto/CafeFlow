import { useState } from 'react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar } from '../shared/GamePieces';

const SIZE = 10;

const SHIP_NAMES: Record<string, string> = {
  carrier: 'ناو هواپیمابر',
  battleship: 'رزمناو سنگین',
  cruiser: 'رزمناو',
  submarine: 'زیردریایی',
  destroyer: 'ناوشکن',
};

interface Cell {
  hasShip?: boolean;
  shipType?: string | null;
  shot?: string | null;
  shipId?: number;
}

interface Ship {
  type: string;
  cells: Array<{ r: number; c: number; hit?: boolean }>;
}

/**
 * نبرد ناوگان — both fleets are placed at the same time, then seats trade
 * shots until one fleet is gone. The engine masks the enemy ships, so the
 * target grid only ever shows the results of my own shots.
 */
export function Battleship({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [orientation, setOrientation] = useState<'h' | 'v'>('h');

  const gamePhase = (state.phase as string) ?? 'placing';
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const winner = (state.winner as number | null) ?? null;
  const myBoard = (state.myBoard as Cell[][]) ?? [];
  const enemyBoard = (state.enemyBoard as Cell[][]) ?? [];
  const shipSizes = (state.shipSizes as number[]) ?? [];
  const placedCount = (state.placedCount as number[]) ?? [0, 0];
  const myShips = (state.myShips as Ship[] | undefined) ?? [];
  const lastShot = (state.lastShotResult as { result: string; r: number; c: number; shipType?: string | null } | null) ?? null;

  const placing = gamePhase === 'placing';
  const nextSize = shipSizes[placedCount[mySeat]] ?? null;
  const myTurn = phase === 'playing' && gamePhase === 'shooting' && currentPlayer === mySeat && winner === null;
  const myPlaced = placedCount[mySeat] ?? 0;
  const enemyPlaced = placedCount[mySeat === 0 ? 1 : 0] ?? 0;

  const place = (r: number, c: number) => {
    if (!placing || nextSize === null) return;
    onMove({ r, c, orientation, size: nextSize });
  };

  const fire = (r: number, c: number) => {
    if (!myTurn) return;
    if (enemyBoard[r]?.[c]?.shot) return;
    onMove({ r, c });
  };

  const boardClass = 'grid grid-cols-10 gap-0.5 rounded-2xl border border-line/70 bg-[#cfe0e8] p-1';

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null || placing ? null : currentPlayer}
        hint={
          winner !== null
            ? 'بازی تمام شد'
            : placing
              ? nextSize === null
                ? 'ناوگان شما آماده است؛ منتظر چیدن حریف'
                : `کشتی ${formatCountFa(nextSize)}خانه‌ای را بچینید`
              : myTurn
                ? 'یک خانه از ناوگان حریف را هدف بگیرید'
                : 'منتظر شلیک حریف'
        }
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          {lastShot
            ? `آخرین شلیک: ردیف ${formatCountFa(lastShot.r + 1)}، ستون ${formatCountFa(lastShot.c + 1)} — ${
                lastShot.result === 'sunk'
                  ? `${SHIP_NAMES[lastShot.shipType ?? ''] ?? 'کشتی'} غرق شد`
                  : lastShot.result === 'hit'
                    ? 'برخورد'
                    : 'آب'
              }`
            : 'هنوز شلیکی انجام نشده است.'}
        </p>
      </ResultOverlay>

      {placing ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="text-[11px] text-ink">
            ناوگان شما: {formatCountFa(myPlaced)} از {formatCountFa(shipSizes.length)} کشتی · حریف:{' '}
            {formatCountFa(enemyPlaced)} از {formatCountFa(shipSizes.length)}
            {nextSize !== null ? ` · بعدی ${formatCountFa(nextSize)}خانه‌ای` : ''}
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setOrientation('h')}
              aria-pressed={orientation === 'h'}
              className={cn(
                'min-h-11 rounded-full px-4 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                orientation === 'h' ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-ink',
              )}
            >
              افقی
            </button>
            <button
              type="button"
              onClick={() => setOrientation('v')}
              aria-pressed={orientation === 'v'}
              className={cn(
                'min-h-11 rounded-full px-4 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                orientation === 'v' ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-ink',
              )}
            >
              عمودی
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-label="ناوگان من" className="space-y-1.5">
          <p className="text-[10px] text-muted">دریای من</p>
          <div className={boardClass} role="grid" aria-label="ناوگان من">
            {Array.from({ length: SIZE }).map((_, r) =>
              Array.from({ length: SIZE }).map((__, c) => {
                const cell = myBoard[r]?.[c] ?? {};
                const sunk = cell.shot === 'sunk';
                return (
                  <button
                    key={`mine-${r}-${c}`}
                    type="button"
                    role="gridcell"
                    onClick={() => place(r, c)}
                    disabled={!placing || nextSize === null}
                    aria-label={`دریای من، ردیف ${formatCountFa(r + 1)}، ستون ${formatCountFa(c + 1)}${
                      cell.hasShip ? '، کشتی' : ''
                    }${cell.shot ? `، ${cell.shot === 'miss' ? 'آب' : 'برخورد'}` : ''}`}
                    className={cn(
                      'relative flex aspect-square items-center justify-center rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                      cell.hasShip ? 'bg-[#b9a583]' : 'bg-[#e6eef2]',
                      sunk ? 'bg-[#8f3a2b]' : cell.shot && 'bg-[#d8b8a6]',
                    )}
                  >
                    {cell.shot === 'hit' || cell.shot === 'sunk' ? (
                      <span aria-hidden className="size-2.5 rounded-full bg-[#7a2f21]" />
                    ) : cell.shot === 'miss' ? (
                      <span aria-hidden className="size-1.5 rounded-full bg-[#8fa7b3]" />
                    ) : null}
                  </button>
                );
              }),
            )}
          </div>
          <ul className="flex flex-wrap gap-1.5 text-[10px] text-muted">
            {myShips.map((ship, index) => {
              const down = ship.cells.every((cell) => cell.hit);
              return (
                <li
                  key={index}
                  className={cn(
                    'rounded-full border px-2 py-0.5',
                    down ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-line/70',
                  )}
                >
                  {SHIP_NAMES[ship.type] ?? ship.type} ({formatCountFa(ship.cells.length)})
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="ناوگان حریف" className="space-y-1.5">
          <p className="text-[10px] text-muted">دریای حریف</p>
          <div className={boardClass} role="grid" aria-label="ناوگان حریف">
            {Array.from({ length: SIZE }).map((_, r) =>
              Array.from({ length: SIZE }).map((__, c) => {
                const cell = enemyBoard[r]?.[c] ?? {};
                return (
                  <button
                    key={`enemy-${r}-${c}`}
                    type="button"
                    role="gridcell"
                    onClick={() => fire(r, c)}
                    disabled={!myTurn || Boolean(cell.shot)}
                    aria-label={`دریای حریف، ردیف ${formatCountFa(r + 1)}، ستون ${formatCountFa(c + 1)}${
                      cell.shot === 'miss' ? '، آب' : cell.shot ? '، برخورد' : ''
                    }`}
                    className={cn(
                      'relative flex aspect-square items-center justify-center rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                      cell.shot === 'sunk'
                        ? 'bg-[#8f3a2b]'
                        : cell.shot === 'hit'
                          ? 'bg-[#d8b8a6]'
                          : 'bg-[#e6eef2]',
                      !cell.shot && myTurn && 'hover:bg-[#d7e7ee]',
                    )}
                  >
                    {cell.shot === 'hit' || cell.shot === 'sunk' ? (
                      <span aria-hidden className="size-2.5 rounded-full bg-[#7a2f21]" />
                    ) : cell.shot === 'miss' ? (
                      <span aria-hidden className="size-1.5 rounded-full bg-[#8fa7b3]" />
                    ) : null}
                  </button>
                );
              }),
            )}
          </div>
          <p className="text-[10px] text-muted">خانه‌های روشن‌تر هنوز هدف گرفته نشده‌اند.</p>
        </section>
      </div>
    </div>
  );
}
