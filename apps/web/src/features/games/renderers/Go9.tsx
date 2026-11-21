import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';
import type { GameSeatView } from '@cafeflow/shared';

const SIZE = 9;
const STONE_NAMES = ['سیاه', 'سفید'];

/**
 * گو ۹×۹ — place stones, surround territory, and score after two passes.
 * The engine validates suicide, ko and captures; the board only has to show
 * what is public (including the scoring marks) and let a seat pass or accept.
 */
export function Go9({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);

  const board = (state.board as number[][]) ?? [];
  const gamePhase = (state.phase as string) ?? 'playing';
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const winner = (state.winner as number | null) ?? null;
  const captures = (state.captures as number[]) ?? [0, 0];
  const koPoint = (state.koPoint as { row: number; col: number } | null) ?? null;
  const passes = (state.consecutivePasses as number) ?? 0;
  const deadMarks = (state.deadMarks as Array<{ row: number; col: number }> | undefined) ?? [];
  const accepted = (state.accepted as boolean[]) ?? [false, false];
  const finalScores = (state.finalScores as { black: number; white: number } | null) ?? null;
  const history = (state.moveHistory as Array<{ row?: number; col?: number }> | undefined) ?? [];
  const lastMove = [...history].reverse().find((move) => Number.isInteger(move.row));

  const scoring = gamePhase === 'scoring';
  const myTurn = !scoring && phase === 'playing' && currentPlayer === mySeat && winner === null;
  const dead = new Set(deadMarks.map((point) => `${point.row},${point.col}`));

  const play = (row: number, col: number) => {
    if (scoring) {
      onMove({ type: 'mark', row, col });
      return;
    }
    if (!myTurn || board[row]?.[col] !== 0) return;
    setSelected({ row, col });
    onMove({ row, col });
  };

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null ? null : scoring ? null : currentPlayer}
        hint={
          winner !== null
            ? 'بازی تمام شد'
            : scoring
              ? 'سنگ‌های مرده را علامت بزنید، بعد نتیجه را تأیید کنید'
              : myTurn
                ? 'روی صفحه بزنید تا سنگ بگذارید'
                : 'منتظر حرکت حریف'
        }
      />

      <ResultOverlay
        seats={seats}
        winner={winner}
        phase={phase}
        canRestart={canRestart}
        onRestart={onRestart}
        headline={
          finalScores
            ? `سیاه ${formatCountFa(finalScores.black)} — سفید ${formatCountFa(finalScores.white)}`
            : undefined
        }
      >
        <p className="mt-1 text-[11px] text-muted">
          {seats.map((seat) => `${seat.nameFa}: ${formatCountFa(captures[seat.index] ?? 0)} گرفته`).join(' · ')}
        </p>
      </ResultOverlay>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-2.5 text-[11px]">
        <p className="text-muted">
          گرفتن‌ها: سیاه {formatCountFa(captures[0] ?? 0)} · سفید {formatCountFa(captures[1] ?? 0)}
        </p>
        <p className="text-muted">
          {passes > 0 ? `${formatCountFa(passes)} ردِ پی‌درپی` : 'هنوز کسی رد نکرده'}
          {koPoint ? ' · کو فعال' : ''}
        </p>
      </div>

      <div className="overflow-x-auto">
        <div
          className="mx-auto grid w-full min-w-[26rem] max-w-md grid-cols-9 gap-0.5 rounded-2xl border border-line/70 bg-[#e8d6b8] p-1.5"
          role="grid"
          aria-label="صفحهٔ گو"
        >
          {Array.from({ length: SIZE }).map((_, row) =>
            Array.from({ length: SIZE }).map((__, col) => {
              const stone = board[row]?.[col] ?? 0;
              const isDead = dead.has(`${row},${col}`);
              const isLast = lastMove?.row === row && lastMove?.col === col;
              const isKo = koPoint?.row === row && koPoint?.col === col;
              return (
                <button
                  key={`${row}-${col}`}
                  type="button"
                  role="gridcell"
                  aria-label={`${STONE_NAMES[stone - 1] ?? 'خانهٔ خالی'} — ردیف ${formatCountFa(row + 1)}، ستون ${formatCountFa(col + 1)}`}
                  onClick={() => play(row, col)}
                  className={cn(
                    'relative flex aspect-square items-center justify-center rounded-[3px] border border-[#c9b494]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                    isKo && 'bg-[#d9c3a0]',
                  )}
                >
                  {stone ? (
                    <span
                      className={cn(
                        'block size-[82%] rounded-full border',
                        stone === 1
                          ? 'border-[#1c1611] bg-[#2a211a]'
                          : 'border-[#b9ab97] bg-[#f6efe2]',
                        isDead && 'opacity-40',
                        isLast && 'ring-2 ring-brand-500',
                      )}
                    >
                      {isDead ? <X aria-hidden className="size-full p-0.5 text-brand-700" /> : null}
                    </span>
                  ) : null}
                </button>
              );
            }),
          )}
        </div>
      </div>

      {scoring ? (
        <div className="space-y-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="text-xs text-ink">
            هر دو نفر رد کردند. سنگ‌های مرده را با زدن روی‌شان علامت بزنید؛ با تأیید هر دو نفر شمارش انجام می‌شود.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onMove({ type: 'accept' })}
              disabled={accepted[mySeat]}
              className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              {accepted[mySeat] ? 'تأیید شد؛ منتظر حریف' : 'تأیید نتیجه'}
            </button>
            <button
              type="button"
              onClick={() => onMove({ type: 'resume' })}
              className="min-h-11 rounded-full border border-line bg-surface px-5 text-xs font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              ادامهٔ بازی
            </button>
            <p className="text-[10px] text-muted">
              {seats
                .map((seat) => `${seat.nameFa}: ${accepted[seat.index] ? 'تأیید' : 'در انتظار'}`)
                .join(' · ')}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onMove({ pass: true })}
            disabled={!myTurn}
            className="min-h-11 rounded-full border border-line bg-surface px-5 text-xs font-semibold text-ink transition-colors enabled:hover:border-brand-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            رد کردن نوبت
          </button>
          <p className="text-[10px] text-muted">
            {selected ? 'سنگ گذاشته شد و نوبت رد شد.' : 'با دو ردِ پی‌درپی، مرحلهٔ شمارش شروع می‌شود.'}
          </p>
        </div>
      )}

      {winner === null ? (
        <p className="text-[10px] text-muted">
          نوبت {seatName(seats as GameSeatView[], currentPlayer)} است.
        </p>
      ) : null}
    </div>
  );
}
