import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';
import { formatCountFa } from '../../../lib/format';

const COLUMNS = 7;

/**
 * چهار در خط — a gravity board.
 *
 * Each column is one button, so a tap anywhere in the column drops the disc in the
 * lowest empty cell. Legal columns come from the rules, never from the client.
 */
export function ConnectFour({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const board = (state.board ?? Array.from({ length: 6 }, () => Array(COLUMNS).fill(null))) as Array<
    Array<number | null>
  >;
  const currentPlayer = state.currentPlayer as number;
  const winner = state.winner as number | null;
  const legal = (state.legalMoves ?? []) as number[];
  const myTurn = phase === 'playing' && currentPlayer === mySeat;
  const lastMove = state.lastMove as { row: number; col: number } | null;

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null && winner !== undefined ? null : currentPlayer}
        hint={myTurn ? 'روی یک ستون بزنید' : 'نوبت حریف است'}
      />

      <ResultOverlay
        seats={seats}
        winner={winner}
        phase={phase}
        canRestart={canRestart}
        onRestart={onRestart}
      >
        <p className="mt-1 text-[11px] text-muted">
          {winner !== null && winner !== undefined && winner >= 0
            ? `${seatName(seats, winner)} چهار مهره را ردیف کرد.`
            : 'صفحه پر شد و ردیف چهارتایی ساخته نشد.'}
        </p>
      </ResultOverlay>

      <div className="mx-auto grid w-full max-w-md grid-cols-7 gap-1.5 rounded-3xl bg-espresso/90 p-2.5">
        {Array.from({ length: COLUMNS }, (_, col) => {
          const disabled = !myTurn || phase !== 'playing' || !legal.includes(col);
          return (
            <button
              key={col}
              type="button"
              disabled={disabled}
              onClick={() => onMove({ col })}
              aria-label={`ستون ${formatCountFa(col + 1)}`}
              className="group flex flex-col gap-1.5 rounded-xl px-0.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 enabled:hover:bg-cream/10"
            >
              {board.map((row, rowIndex) => {
                const value = row[col] ?? null;
                const isLast = lastMove?.row === rowIndex && lastMove?.col === col;
                return (
                  <span
                    key={rowIndex}
                    className={`aspect-square w-full rounded-full transition-colors duration-150 ${
                      value === 0
                        ? 'bg-brand-400'
                        : value === 1
                          ? 'bg-cream'
                          : 'bg-espresso/55 ring-1 ring-inset ring-cream/10'
                    } ${isLast ? 'ring-2 ring-brand-200' : ''}`}
                  />
                );
              })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
