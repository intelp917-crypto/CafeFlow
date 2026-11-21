import { Dices, Plane } from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';

const MAIN_PATH = 52;
const HOME = 58;
const PLANES = 4;
const TOKEN_TONES = ['bg-[#aa472b]', 'bg-[#96a09f]', 'bg-[#7c5c3e]', 'bg-[#3f6b52]'];

interface PlayerState {
  planes: number[];
  finished: number;
}

function planeLabel(position: number): string {
  if (position === -1) return 'در آشیانه';
  if (position === HOME) return 'رسیده';
  if (position >= MAIN_PATH) return `خانهٔ آخر، خانهٔ ${formatCountFa(position - MAIN_PATH + 1)}`;
  return `مسیر، خانهٔ ${formatCountFa(position + 1)}`;
}

function ringIndex(player: number, position: number): number {
  return (player * 13 + position) % MAIN_PATH;
}

/**
 * شطرنج پروازی — four planes per seat, one shared 52-cell ring and a six-cell
 * home stretch. The engine owns the launch rule, the +4 colour jump, the fly
 * line and captures; the screen groups the planes into big touch buttons and
 * shows the shared ring with every plane's token on it.
 */
export function FlightChess({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const winner = (state.winner as number | null) ?? null;
  const players = (state.players as PlayerState[] | undefined) ?? [];
  const dice = (state.dice as number) ?? 1;
  const rolled = Boolean(state.hasRolled);
  const me = players[mySeat] ?? { planes: [-1, -1, -1, -1], finished: 0 };

  const myTurn = phase === 'playing' && currentPlayer === mySeat && winner === null;
  const tokens: Array<{ player: number; plane: number; absolute: number }> = [];
  players.forEach((player, seat) => {
    player.planes.forEach((position, plane) => {
      if (position >= 0 && position < MAIN_PATH) {
        tokens.push({ player: seat, plane, absolute: ringIndex(seat, position) });
      }
    });
  });

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
              ? rolled
                ? 'هواپیمای مورد نظر را انتخاب کنید'
                : 'تاس بریزید'
              : `نوبت ${seatName(seats, currentPlayer)} است`
        }
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">هر کس اول چهار هواپیمایش را به خانه برساند برنده است.</p>
      </ResultOverlay>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line/70 bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="num flex size-12 items-center justify-center rounded-2xl border border-brand-200 bg-brand-50 font-display text-xl font-bold text-brand-800">
            {formatCountFa(dice)}
          </span>
          <div>
            <p className="text-[10px] text-muted">تاس</p>
            <p className="text-[11px] text-ink">{rolled ? 'حرکت را انتخاب کنید' : 'هنوز نریخته'}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onMove({ action: 'roll' })}
          disabled={!myTurn || rolled}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand-600 px-5 text-xs font-bold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <Dices aria-hidden className="size-4" />
          تاس بریز
        </button>
      </div>

      <div className="overflow-x-auto">
        <div
          className="mx-auto grid w-full min-w-[26rem] max-w-lg grid-cols-[repeat(13,minmax(0,1fr))] gap-0.5 rounded-2xl border border-line/70 bg-[#efe3d0] p-1.5"
          role="grid"
          aria-label="مسیر ۵۲ خانه"
        >
          {Array.from({ length: MAIN_PATH }).map((_, absolute) => {
            const owner = absolute % 4;
            const here = tokens.filter((token) => token.absolute === absolute);
            return (
              <div
                key={absolute}
                role="gridcell"
                aria-label={`خانهٔ ${formatCountFa(absolute + 1)}${here.length ? `، ${here.length} هواپیما` : ''}`}
                className={cn(
                  'relative flex aspect-square items-center justify-center rounded-[3px] text-[8px]',
                  owner === 0 && 'bg-[#e8b9ac]',
                  owner === 1 && 'bg-[#cfd8d7]',
                  owner === 2 && 'bg-[#d8c3a5]',
                  owner === 3 && 'bg-[#bfd3c4]',
                )}
              >
                <span className="num text-[#6b5741]/70">{formatCountFa(absolute + 1)}</span>
                {here.length > 0 ? (
                  <span className="absolute inset-x-0.5 bottom-0.5 flex flex-wrap justify-center gap-0.5">
                    {here.map((token) => (
                      <span
                        key={`${token.player}-${token.plane}`}
                        aria-label={`${seatName(seats, token.player)}، هواپیمای ${formatCountFa(token.plane + 1)}`}
                        className={cn('size-2 rounded-full ring-1 ring-white/70', TOKEN_TONES[token.player % 4])}
                      />
                    ))}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="mb-1.5 text-[10px] text-muted">هواپیماهای شما</p>
          <div className="grid grid-cols-2 gap-1.5">
            {Array.from({ length: PLANES }).map((_, index) => {
              const position = me.planes[index] ?? -1;
              const done = position === HOME;
              const launch = position === -1;
              const disabled = !myTurn || !rolled || done || (launch && dice !== 6);
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => onMove({ action: 'move', planeIndex: index })}
                  disabled={disabled}
                  className="flex min-h-11 items-center gap-1.5 rounded-xl border border-line/70 bg-cream px-2 py-1.5 text-right text-[10px] text-ink transition-colors enabled:hover:border-brand-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  <Plane aria-hidden className="size-3.5 shrink-0 text-brand-700" />
                  <span className="min-w-0">
                    <span className="block font-semibold">هواپیمای {formatCountFa(index + 1)}</span>
                    <span className="block truncate text-muted">{planeLabel(position)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-muted">برای بلند شدن از آشیانه باید ۶ بیاورید؛ ۶ یک پرتاب دیگر هم می‌دهد.</p>
        </div>

        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="mb-1.5 text-[10px] text-muted">بازیکنان</p>
          <ul className="space-y-1">
            {seats.map((seat) => {
              const player = players[seat.index] ?? { planes: [], finished: 0 };
              return (
                <li key={seat.index} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 text-ink/80">
                    <span aria-hidden className={cn('size-2 rounded-full', TOKEN_TONES[seat.index % 4])} />
                    {seat.nameFa}
                  </span>
                  <span className="num text-muted">
                    {formatCountFa(player.finished)} از {formatCountFa(PLANES)} رسیده
                    <span className="mr-2">{player.planes.map((position) => (position === -1 ? 'آشیانه' : position === HOME ? 'خانه' : formatCountFa(position + 1))).join(' · ')}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[10px] text-muted">فرود روی هواپیمای حریف آن را به آشیانه برمی‌گرداند.</p>
        </div>
      </div>
    </div>
  );
}
