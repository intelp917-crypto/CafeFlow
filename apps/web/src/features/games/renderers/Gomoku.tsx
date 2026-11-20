import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';
import { formatCountFa } from '../../../lib/format';

/**
 * پنج در خط — پانزده در پانزده روی همان میزی که دوز بازی می‌شود.
 *
 * خانه‌ها کوچک‌اند، پس صفحه اسکرول افقی می‌گیرد به‌جای اینکه انگشت روی
 * خانه‌های نیم‌سطحی اشتباه بزند.
 */
export function Gomoku({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const board = (state.board ?? []) as Array<Array<number | null>>;
  const currentPlayer = state.currentPlayer as number;
  const winner = state.winner as number | null;
  const history = (state.moveHistory ?? []) as Array<{ row: number; col: number }>;
  const last = history[history.length - 1];
  const myTurn = phase === 'playing' && currentPlayer === mySeat;

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null && winner >= 0 ? null : currentPlayer}
        hint={myTurn ? 'یک خانهٔ خالی را بزنید' : 'نوبت حریف است'}
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          {winner !== null && winner >= 0 ? `${seatName(seats, winner)} پنج‌تای خودش را ردیف کرد.` : 'صفحه پر شد.'}
        </p>
      </ResultOverlay>

      <div className="overflow-x-auto pb-1">
        <div
          className="mx-auto grid w-max gap-[2px] rounded-2xl bg-[#c8a97a] p-2"
          style={{ gridTemplateColumns: `repeat(${board[0]?.length ?? 15}, minmax(22px, 1fr))` }}
          role="grid"
          aria-label="صفحهٔ پنج در خط"
        >
          {board.map((row, rowIndex) =>
            row.map((value, colIndex) => {
              const isLast = last?.row === rowIndex && last?.col === colIndex;
              const open = value === null && myTurn;
              return (
                <button
                  key={`${rowIndex}-${colIndex}`}
                  type="button"
                  role="gridcell"
                  disabled={value !== null || !myTurn}
                  onClick={() => onMove({ row: rowIndex, col: colIndex })}
                  aria-label={`ردیف ${formatCountFa(rowIndex + 1)}، ستون ${formatCountFa(colIndex + 1)}${
                    value === null ? '' : value === 0 ? '، تیره' : '، روشن'
                  }`}
                  className={`flex size-[22px] items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                    open ? 'bg-cream/50 hover:bg-cream' : 'bg-transparent'
                  }`}
                >
                  {value !== null ? (
                    <span
                      className={`size-[18px] rounded-full ${
                        value === 0 ? 'bg-espresso' : 'bg-cream ring-1 ring-black/15'
                      } ${isLast ? 'ring-2 ring-brand-500' : ''}`}
                    />
                  ) : null}
                </button>
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}
