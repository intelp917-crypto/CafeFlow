import { useState } from 'react';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar } from '../shared/GamePieces';
import { formatCountFa } from '../../../lib/format';

type Piece = { type: 'm' | 'k'; side: number };

/** چکرز — مهره را بردار و مقصد را بزن؛ زدن اجباری در سرور اعمال می‌شود. */
export function Checkers({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const board = (state.board ?? []) as Array<Array<Piece | null>>;
  const currentPlayer = state.currentPlayer as number;
  const winner = state.winner as number | null;
  const mustCapture = Boolean(state.mustCapture);
  const history = (state.moveHistory ?? []) as Array<{ from: { row: number; col: number }; to: { row: number; col: number } }>;
  const last = history[history.length - 1];
  const myTurn = phase === 'playing' && currentPlayer === mySeat;
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);

  const click = (row: number, col: number) => {
    const piece = board[row]?.[col] ?? null;
    if (selected) {
      if (selected.row === row && selected.col === col) {
        setSelected(null);
        return;
      }
      onMove({ from: selected, to: { row, col } });
      setSelected(null);
      return;
    }
    if (piece && piece.side === mySeat && myTurn) setSelected({ row, col });
  };

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null && winner >= 0 ? null : currentPlayer}
        hint={myTurn ? (mustCapture ? 'زدن اجباری است؛ مهره را انتخاب کنید' : 'مهره را بزنید، بعد مقصد') : 'نوبت حریف است'}
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          {winner !== null && winner >= 0 ? 'مهره‌های حریف تمام شد.' : 'بازی مساوی شد.'}
        </p>
      </ResultOverlay>

      <div className="mx-auto grid w-full max-w-sm grid-cols-[repeat(8,minmax(0,1fr))] overflow-hidden rounded-2xl border border-line/70">
        {board.map((row, rowIndex) =>
          row.map((piece, colIndex) => {
            const dark = (rowIndex + colIndex) % 2 === 1;
            const isSelected = selected?.row === rowIndex && selected?.col === colIndex;
            const isLast =
              (last?.from.row === rowIndex && last?.from.col === colIndex) ||
              (last?.to.row === rowIndex && last?.to.col === colIndex);
            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                type="button"
                onClick={() => click(rowIndex, colIndex)}
                disabled={!myTurn || phase !== 'playing' || !dark}
                aria-label={`ردیف ${formatCountFa(rowIndex + 1)}، ستون ${formatCountFa(colIndex + 1)}${
                  piece ? `، ${piece.side === 0 ? 'قرمز' : 'سیاه'}${piece.type === 'k' ? ' شاه' : ''}` : ''
                }`}
                className={`relative flex aspect-square items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  dark ? 'bg-[#8a6448]' : 'bg-[#e8d9c4]'
                } ${isSelected ? 'ring-2 ring-inset ring-brand-500' : isLast ? 'ring-2 ring-inset ring-brand-300' : ''}`}
              >
                {piece ? (
                  <span
                    className={`flex size-[74%] items-center justify-center rounded-full text-[10px] font-bold ${
                      piece.side === 0
                        ? 'bg-danger-600 text-cream ring-1 ring-black/25'
                        : 'bg-espresso text-cream ring-1 ring-black/40'
                    }`}
                  >
                    {piece.type === 'k' ? 'ش' : ''}
                  </span>
                ) : null}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
