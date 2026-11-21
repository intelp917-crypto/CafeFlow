import { useState } from 'react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar } from '../shared/GamePieces';

const ROWS = 10;
const COLS = 9;

const PIECES: Record<string, { short: string; name: string }> = {
  K: { short: 'شا', name: 'شاه' },
  A: { short: 'مش', name: 'مشاور' },
  E: { short: 'فی', name: 'فیل' },
  H: { short: 'اس', name: 'اسب' },
  R: { short: 'رخ', name: 'رخ' },
  C: { short: 'تو', name: 'توپ' },
  P: { short: 'سر', name: 'سرباز' },
};

interface Piece {
  type: string;
  side: number;
}

interface LegalMove {
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
}

/**
 * شطرنج چینی (شیاچی) — nine files, ten ranks and a river. The engine sends the
 * mover's legal moves only, so the board can mark destinations without
 * duplicating any of the palace, elephant or cannon rules.
 */
export function ChineseChess({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);

  const board = (state.board as Piece[][]) ?? [];
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const winner = (state.winner as number | null) ?? null;
  const legalMoves = (state.legalMoves as LegalMove[] | undefined) ?? [];
  const history = (state.moveHistory as Array<{ piece?: Piece; captured?: Piece | null }> | undefined) ?? [];
  const lastMove = history[history.length - 1];

  const myTurn = phase === 'playing' && currentPlayer === mySeat && winner === null;
  const targets = selected
    ? legalMoves.filter((move) => move.fromRow === selected.row && move.fromCol === selected.col)
    : [];
  const targetKeys = new Set(targets.map((move) => `${move.toRow},${move.toCol}`));

  const click = (row: number, col: number) => {
    if (!myTurn) return;
    const piece = board[row]?.[col];
    if (selected && targetKeys.has(`${row},${col}`)) {
      onMove({ from: { row: selected.row, col: selected.col }, to: { row, col } });
      setSelected(null);
      return;
    }
    if (piece && piece.side === mySeat) {
      setSelected({ row, col });
      return;
    }
    setSelected(null);
  };

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null ? null : currentPlayer}
        hint={
          winner !== null
            ? 'بازی تمام شد'
            : myTurn
              ? selected
                ? 'یک مقصد روشن را بزنید'
                : 'مهرهٔ خودتان را انتخاب کنید'
              : 'منتظر حرکت حریف'
        }
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          {formatCountFa(history.length)} حرکت انجام شده است.
          {lastMove?.captured
            ? ` آخرین حرکت ${PIECES[lastMove.captured.type]?.name ?? lastMove.captured.type} را گرفت.`
            : ''}
        </p>
      </ResultOverlay>

      <div className="overflow-x-auto">
        <div
          className="mx-auto grid w-full min-w-[26rem] max-w-md grid-cols-9 gap-0.5 rounded-2xl border border-line/70 bg-[#e8d6b8] p-1.5"
          role="grid"
          aria-label="صفحهٔ شطرنج چینی"
        >
          {Array.from({ length: ROWS }).map((_, row) => (
            <div key={`row-${row}`} className="contents">
              {Array.from({ length: COLS }).map((__, col) => {
                const piece = board[row]?.[col];
                const isTarget = targetKeys.has(`${row},${col}`);
                const isSelected = selected?.row === row && selected?.col === col;
                return (
                  <button
                    key={`${row}-${col}`}
                    type="button"
                    role="gridcell"
                    onClick={() => click(row, col)}
                    aria-label={
                      piece
                        ? `${PIECES[piece.type]?.name ?? piece.type} ${piece.side === 0 ? 'سرخ' : 'سیاه'} — ردیف ${formatCountFa(row + 1)}، ستون ${formatCountFa(col + 1)}`
                        : `خانهٔ خالی — ردیف ${formatCountFa(row + 1)}، ستون ${formatCountFa(col + 1)}`
                    }
                    className={cn(
                      'relative flex aspect-square items-center justify-center rounded-[3px] border border-[#c9b494]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                      isSelected && 'bg-[#d9c3a0]',
                      isTarget && 'bg-[#cfe3c8]',
                    )}
                  >
                    {piece ? (
                      <span
                        className={cn(
                          'flex size-[86%] items-center justify-center rounded-full border text-[10px] font-bold',
                          piece.side === 0
                            ? 'border-brand-700 bg-[#fbf1e4] text-brand-800'
                            : 'border-[#2a211a] bg-[#3a2f26] text-[#f6efe2]',
                        )}
                      >
                        {PIECES[piece.type]?.short ?? piece.type}
                      </span>
                    ) : null}
                    {isTarget ? <span aria-hidden className="size-2 rounded-full bg-brand-600/80" /> : null}
                  </button>
                );
              })}
              {row === 4 ? (
                <div className="col-span-9 flex items-center justify-center py-0.5 text-[9px] tracking-[0.4em] text-[#8a6f4f]">
                  رودخانه
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted">
        <p>سرخ از پایین، سیاه از بالا. مهره‌های با نقطهٔ سبز، مقصدهای مجاز شما هستند.</p>
        {selected ? (
          <button type="button" onClick={() => setSelected(null)} className="min-h-11 rounded-full px-4 text-[11px] text-muted">
            لغو انتخاب
          </button>
        ) : null}
      </div>
    </div>
  );
}
