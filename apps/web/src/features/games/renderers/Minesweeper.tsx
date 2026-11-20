import { useState } from 'react';
import { Bomb, Flag } from 'lucide-react';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay } from '../shared/GamePieces';
import { formatCountFa } from '../../../lib/format';

interface Cell {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacent: number;
  exploded: boolean;
}

const NUMBER_TONE = [
  '',
  'text-[#2f6f9f]',
  'text-[#2f7d4f]',
  'text-[#b23a26]',
  'text-[#5b3f9e]',
  'text-[#8a4a1f]',
  'text-[#12727a]',
  'text-[#3a3a3a]',
  'text-[#6b6b6b]',
];

/** مین‌روبی — هر صندلی زمین خودش را باز می‌کند، مین‌ها یکی هستند. */
export function Minesweeper({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const board = (state.board ?? []) as Cell[][];
  const rows = (state.rows as number) ?? board.length;
  const cols = (state.cols as number) ?? board[0]?.length ?? 0;
  const alive = (state.alive ?? []) as boolean[];
  const revealedCounts = (state.cellsRevealed ?? []) as number[];
  const winner = state.winner as number | null;
  const [flagMode, setFlagMode] = useState(false);

  const mine = alive[mySeat] !== false && phase === 'playing';

  const tap = (row: number, col: number) => {
    const cell = board[row]?.[col];
    if (!cell || !mine) return;
    if (!flagMode && cell.revealed) return;
    onMove({ action: flagMode ? 'flag' : 'reveal', row, col });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-3">
        <p className="text-[11px] text-ink">
          {alive[mySeat] === false ? 'شما از این زمین بیرون افتادید؛ می‌توانید تماشا کنید.' : 'زمین شما'}
        </p>
        <button
          type="button"
          onClick={() => setFlagMode((current) => !current)}
          aria-pressed={flagMode}
          className={`min-h-9 rounded-full px-3 text-[11px] font-semibold transition-colors ${
            flagMode ? 'bg-brand-600 text-white' : 'border border-line text-ink/80'
          }`}
        >
          حالت پرچم
        </button>
      </div>

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart} />

      <div
        className="mx-auto grid w-full max-w-sm gap-[2px] rounded-2xl bg-espresso p-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        role="grid"
        aria-label="زمین مین‌روبی"
      >
        {board.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            const hidden = !cell.revealed;
            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                type="button"
                onClick={() => tap(rowIndex, colIndex)}
                disabled={!mine}
                aria-label={`ردیف ${formatCountFa(rowIndex + 1)}، ستون ${formatCountFa(colIndex + 1)}${
                  cell.flagged ? '، پرچم' : cell.revealed ? '، باز' : '، بسته'
                }`}
                className={`flex aspect-square items-center justify-center rounded-[0.3rem] text-[11px] font-bold transition-colors ${
                  hidden
                    ? 'bg-[#9c7b5c] hover:bg-[#b08a67]'
                    : cell.exploded
                      ? 'bg-danger-500 text-white'
                      : 'bg-[#e9dcc8]'
                } ${cell.flagged && hidden ? 'text-cream' : NUMBER_TONE[cell.adjacent] ?? 'text-ink'}`}
              >
                {cell.flagged && hidden ? (
                  <Flag aria-hidden className="size-3.5" />
                ) : cell.mine && !hidden ? (
                  <Bomb aria-hidden className="size-4" />
                ) : cell.revealed && cell.adjacent > 0 ? (
                  formatCountFa(cell.adjacent)
                ) : null}
              </button>
            );
          }),
        )}
      </div>

      <ul className="mx-auto flex max-w-sm flex-wrap justify-center gap-2 text-[10px] text-muted">
        {seats.map((seat) => (
          <li key={seat.index} className={`rounded-full border px-2.5 py-1 ${alive[seat.index] === false ? 'border-danger-200 text-danger-700' : 'border-line'}`}>
            {seat.nameFa}: <span className="num">{formatCountFa(revealedCounts[seat.index] ?? 0)}</span>
          </li>
        ))}
      </ul>

      <p className="text-center text-[10px] text-muted">
        {flagMode ? 'برای گذاشتن یا برداشتن پرچم روی خانه بزنید.' : 'روی خانه بزنید تا باز شود؛ پرچم برای مین‌های حدسی است.'}
      </p>
    </div>
  );
}
