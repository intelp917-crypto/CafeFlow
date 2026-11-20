import { useState } from 'react';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay } from '../shared/GamePieces';
import { formatCountFa } from '../../../lib/format';

interface Cell {
  value: number;
  given: boolean;
  mineFill: boolean;
}

/** سودوکو — همه یک جدول دارند و هر کس جدول خودش را پر می‌کند. */
export function Sudoku({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const board = (state.board ?? []) as Cell[][];
  const done = (state.doneCount as number) ?? 0;
  const blanks = (state.blanks as number) ?? 0;
  const lives = (state.lives as number) ?? 0;
  const hints = (state.hints as number) ?? 0;
  const eliminated = Boolean(state.eliminated);
  const winner = state.winner as number | null;
  const [picked, setPicked] = useState<{ row: number; col: number } | null>(null);

  const playable = phase === 'playing' && !eliminated;
  const selectedCell = picked ? board[picked.row]?.[picked.col] : null;

  const pick = (row: number, col: number) => {
    if (!playable) return;
    const cell = board[row]?.[col];
    if (!cell || cell.given || cell.mineFill) return;
    setPicked({ row, col });
  };

  const type = (value: number) => {
    if (!picked) return;
    onMove({ row: picked.row, col: picked.col, val: value });
    setPicked(null);
  };

  const progress = blanks > 0 ? Math.round((done / blanks) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-3 text-[11px]">
        <span className="text-ink">
          پیشرفت: <span className="num font-bold">{formatCountFa(done)}</span> از{' '}
          <span className="num">{formatCountFa(blanks)}</span>
        </span>
        <span className="num text-muted">
          جان {formatCountFa(lives)} · راهنما {formatCountFa(hints)}
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-line/50">
        <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300" style={{ width: `${progress}%` }} />
      </div>

      {eliminated ? (
        <p className="rounded-2xl border border-danger-200 bg-danger-50 px-4 py-3 text-center text-[11px] text-danger-700">
          جان‌های شما تمام شد؛ می‌توانید تماشا کنید.
        </p>
      ) : null}

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart} />

      <div className="mx-auto grid w-full max-w-sm grid-cols-[repeat(9,minmax(0,1fr))] overflow-hidden rounded-2xl border-2 border-ink/25">
        {board.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            const thickRight = colIndex === 2 || colIndex === 5;
            const thickBottom = rowIndex === 2 || rowIndex === 5;
            const isPicked = picked?.row === rowIndex && picked?.col === colIndex;
            const editable = playable && !cell.given && !cell.mineFill;
            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                type="button"
                onClick={() => pick(rowIndex, colIndex)}
                disabled={!editable}
                aria-label={`ردیف ${formatCountFa(rowIndex + 1)}، ستون ${formatCountFa(colIndex + 1)}${
                  cell.value ? `، ${formatCountFa(cell.value)}` : '، خالی'
                }`}
                className={`flex aspect-square items-center justify-center border border-line/50 text-[11px] font-semibold transition-colors sm:text-sm ${
                  thickRight ? 'border-l-2 border-l-ink/25' : ''
                } ${thickBottom ? 'border-b-2 border-b-ink/25' : ''} ${
                  cell.given ? 'bg-cream text-ink' : cell.mineFill ? 'bg-brand-50 text-brand-700' : 'bg-surface text-ink'
                } ${isPicked ? 'ring-2 ring-inset ring-brand-500' : ''} ${editable ? 'hover:bg-brand-50' : ''}`}
              >
                {cell.value ? formatCountFa(cell.value) : ''}
              </button>
            );
          }),
        )}
      </div>

      <div className="mx-auto grid max-w-sm grid-cols-9 gap-1">
        {Array.from({ length: 9 }, (_, index) => index + 1).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => type(value)}
            disabled={!picked || !playable}
            aria-label={`عدد ${formatCountFa(value)}`}
            className="num min-h-11 rounded-xl border border-line bg-surface text-sm font-bold text-ink transition-colors enabled:hover:border-brand-300 enabled:hover:bg-brand-50 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            {formatCountFa(value)}
          </button>
        ))}
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => onMove({ type: 'hint' })}
          disabled={!playable || hints <= 0}
          className="min-h-11 rounded-full border border-line bg-surface px-5 text-[11px] font-semibold text-ink transition-colors enabled:hover:border-brand-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          راهنما ({formatCountFa(hints)})
        </button>
      </div>

      {selectedCell ? null : (
        <p className="text-center text-[10px] text-muted">یک خانهٔ خالی را انتخاب کنید، بعد عدد را بزنید.</p>
      )}
    </div>
  );
}
