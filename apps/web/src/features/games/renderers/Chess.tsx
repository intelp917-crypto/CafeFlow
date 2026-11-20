import { useState } from 'react';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar } from '../shared/GamePieces';
import { formatCountFa } from '../../../lib/format';

type Piece = { type: string; side: number };

/** Persian initials keep the board readable without emoji. */
const LETTER: Record<string, string> = {
  K: 'ش',
  Q: 'و',
  R: 'ر',
  B: 'ف',
  N: 'ا',
  P: 'س',
};

const FILES_FA = ['الف', 'ب', 'پ', 'ت', 'ث', 'ج', 'چ', 'ح'];

/**
 * شطرنج — انتخاب مهره، سپس خانهٔ مقصد.
 *
 * قانون کامل در سرور است؛ اگر حرکت مجاز نباشد همان‌جا رد می‌شود و پیام فارسی
 * روی صفحه می‌آید. ارتقای سرباز همیشه به وزیر است تا هیچ‌کس در میانهٔ دست
 * جلوی یک پنجرهٔ انتخاب گیر نکند.
 */
export function Chess({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const board = (state.board ?? []) as Array<Array<Piece | null>>;
  const currentPlayer = state.currentPlayer as number;
  const winner = state.winner as number | null;
  const history = (state.moveHistory ?? []) as Array<{ from: { row: number; col: number }; to: { row: number; col: number } }>;
  const last = history[history.length - 1];
  const myTurn = phase === 'playing' && currentPlayer === mySeat;
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);

  const click = (row: number, col: number) => {
    const piece = board[row]?.[col] ?? null;
    if (selected) {
      const sameCell = selected.row === row && selected.col === col;
      if (sameCell) {
        setSelected(null);
        return;
      }
      if (piece && piece.side === mySeat) {
        setSelected({ row, col });
        return;
      }
      onMove({ from: selected, to: { row, col }, promote: 'q' });
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
        hint={myTurn ? 'مهره را بزنید، بعد خانهٔ مقصد' : 'نوبت حریف است'}
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          {winner !== null && winner >= 0 ? 'شاه حریف مات شد.' : 'بازی مساوی شد.'}
        </p>
      </ResultOverlay>

      <div className="mx-auto grid w-full max-w-sm grid-cols-[repeat(8,minmax(0,1fr))] gap-0 overflow-hidden rounded-2xl border border-line/70">
        {board.map((row, rowIndex) =>
          row.map((piece, colIndex) => {
            const dark = (rowIndex + colIndex) % 2 === 1;
            const isSelected = selected?.row === rowIndex && selected?.col === colIndex;
            const isLast =
              (last?.from.row === rowIndex && last?.from.col === colIndex) ||
              (last?.to.row === rowIndex && last?.to.col === colIndex);
            const mine = piece?.side === mySeat;

            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                type="button"
                onClick={() => click(rowIndex, colIndex)}
                disabled={!myTurn || phase !== 'playing'}
                aria-label={`${FILES_FA[colIndex]} ${formatCountFa(8 - rowIndex)}${
                  piece ? `، ${piece.side === 0 ? 'روشن' : 'تیره'} ${LETTER[piece.type] ?? ''}` : ''
                }`}
                className={`relative flex aspect-square items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  dark ? 'bg-[#b08968]' : 'bg-[#f0e2cf]'
                } ${isSelected ? 'ring-2 ring-inset ring-brand-600' : isLast ? 'ring-2 ring-inset ring-brand-300' : ''}`}
              >
                {piece ? (
                  <span
                    className={`flex size-[78%] items-center justify-center rounded-full text-[11px] font-bold sm:text-sm ${
                      piece.side === 0
                        ? 'bg-cream text-espresso ring-1 ring-black/20'
                        : 'bg-espresso text-cream ring-1 ring-black/40'
                    } ${mine ? '' : 'opacity-90'}`}
                  >
                    {LETTER[piece.type] ?? '؟'}
                  </span>
                ) : null}
              </button>
            );
          }),
        )}
      </div>

      <p className="text-center text-[10px] text-muted">
        ارتقای سرباز همیشه وزیر می‌شود.
      </p>
    </div>
  );
}
