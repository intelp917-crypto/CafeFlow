import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';
import { formatCountFa } from '../../../lib/format';

interface ReversiMove {
  row: number;
  col: number;
}

/**
 * اتللو — the board grows with the group's setting (8، ۱۰ یا ۱۲ خانه).
 *
 * Only the cells the rules call legal are tappable, so a beginner never has to
 * memorise the flipping rule to see where a move is possible.
 */
export function Reversi({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const board = (state.board ?? []) as Array<Array<number | null>>;
  const size = (state.boardSize as number) ?? board.length ?? 8;
  const currentPlayer = state.currentPlayer as number;
  const winner = state.winner as number | null;
  const scores = (state.scores ?? {}) as Record<string, number>;
  const legal = (state.legalMoves ?? []) as ReversiMove[];
  const myTurn = phase === 'playing' && currentPlayer === mySeat;
  const lastMove = state.lastMove as ReversiMove | null;
  const myLegal = myTurn ? legal : [];

  const isLegal = (row: number, col: number) => myLegal.some((move) => move.row === row && move.col === col);

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null && winner !== undefined ? null : currentPlayer}
        hint={
          myTurn
            ? myLegal.length > 0
              ? 'روی خانه‌های روشن بزنید'
              : 'حرکتی ندارید؛ نوبت را رد کنید'
            : 'نوبت حریف است'
        }
      />

      <div className="mx-auto flex w-full max-w-sm items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-2.5 text-xs">
        {seats.slice(0, 2).map((seat) => (
          <div key={seat.index} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-3 rounded-full ${seat.index === 0 ? 'bg-espresso' : 'bg-cream ring-1 ring-line'}`}
            />
            <span className="max-w-[6rem] truncate text-ink/80">{seat.nameFa}</span>
            <span className="num font-bold text-ink">{formatCountFa(scores[seat.index] ?? 0)}</span>
          </div>
        ))}
      </div>

      <ResultOverlay
        seats={seats}
        winner={winner}
        phase={phase}
        canRestart={canRestart}
        onRestart={onRestart}
      >
        <p className="mt-1 text-[11px] text-muted">
          {winner !== null && winner !== undefined && winner >= 0
            ? `${seatName(seats, winner)} مهره‌های بیشتری داشت.`
            : 'مهره‌ها برابر شدند.'}
        </p>
      </ResultOverlay>

      <div
        className="mx-auto grid w-full max-w-sm gap-1 rounded-3xl bg-[#2c6b45] p-2"
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
        role="grid"
        aria-label="صفحهٔ اتللو"
      >
        {board.map((row, rowIndex) =>
          row.map((value, colIndex) => {
            const legalHere = isLegal(rowIndex, colIndex);
            const isLast = lastMove?.row === rowIndex && lastMove?.col === colIndex;
            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                type="button"
                role="gridcell"
                disabled={!legalHere}
                onClick={() => onMove({ row: rowIndex, col: colIndex })}
                aria-label={`ردیف ${formatCountFa(rowIndex + 1)}، ستون ${formatCountFa(colIndex + 1)}${
                  value === null ? '' : value === 0 ? '، مهرهٔ تیره' : '، مهرهٔ روشن'
                }`}
                className={`relative flex aspect-square items-center justify-center rounded-[0.35rem] border border-black/10 transition-colors duration-150 ${
                  legalHere ? 'bg-[#3a8256] hover:bg-[#46966a]' : 'bg-[#357a4e]'
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200`}
              >
                {value !== null ? (
                  <span
                    className={`size-[78%] rounded-full ${
                      value === 0 ? 'bg-espresso' : 'bg-cream ring-1 ring-black/10'
                    } ${isLast ? 'ring-2 ring-brand-300' : ''}`}
                  />
                ) : legalHere ? (
                  <span aria-hidden="true" className="size-2 rounded-full bg-cream/45" />
                ) : null}
              </button>
            );
          }),
        )}
      </div>

      {myTurn && myLegal.length === 0 && phase === 'playing' ? (
        <button
          type="button"
          onClick={() => onMove({ pass: true })}
          className="mx-auto block min-h-11 rounded-full border border-line bg-surface px-5 text-xs font-semibold text-ink transition-colors hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          رد کردن نوبت
        </button>
      ) : null}
    </div>
  );
}
