import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';
import { formatCountFa } from '../../../lib/format';

/**
 * دوز — the shortest game at the table.
 *
 * The board is a 3×3 grid of buttons so a thumb can play it one-handed while the
 * other hand holds a cup; the server owns every rule, including who may tap.
 */
export function TicTacToe({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const board = (state.board ?? []) as Array<number | null>;
  const currentPlayer = state.currentPlayer as number;
  const winner = state.winner as number | null;
  const myTurn = phase === 'playing' && currentPlayer === mySeat;

  const mark = (value: number | null) => (value === 0 ? '✕' : value === 1 ? '○' : '');

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null && winner !== undefined ? null : currentPlayer}
        hint={myTurn ? 'یک خانه را انتخاب کنید' : 'منتظر حرکت بعدی باشید'}
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
            ? `${seatName(seats, winner)} سه‌خانهٔ پشت‌سرهم را گرفت.`
            : 'خانه‌ها پر شدند و کسی سه‌تا پشت‌سرهم نگرفت.'}
        </p>
      </ResultOverlay>

      <div className="mx-auto grid w-full max-w-xs grid-cols-3 gap-2.5" role="grid" aria-label="صفحهٔ دوز">
        {board.map((value, cell) => {
          const disabled = !myTurn || value !== null || phase !== 'playing';
          return (
            <button
              key={cell}
              type="button"
              role="gridcell"
              aria-label={`خانهٔ ${formatCountFa(cell + 1)}${
                value === null ? '' : value === 0 ? '، ضربدر' : '، دایره'
              }`}
              disabled={disabled}
              onClick={() => onMove({ cell })}
              className={`flex aspect-square items-center justify-center rounded-2xl border text-3xl font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                value === null
                  ? 'border-line/70 bg-surface text-ink enabled:hover:border-brand-300 enabled:hover:bg-brand-50'
                  : value === 0
                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                    : 'border-espresso/20 bg-espresso/5 text-espresso'
              } ${disabled ? 'cursor-default' : ''}`}
            >
              {mark(value)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
