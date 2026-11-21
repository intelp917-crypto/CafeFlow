import { useState } from 'react';
import { ArrowRightLeft, Building2, Coins, Dices, Flag, MapPin, ShieldAlert, TrainFront } from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';

interface Space {
  type: string;
  name?: string;
  nameEn?: string;
  price?: number;
  rent?: number[];
  color?: string;
  group?: number;
  amount?: number;
}

interface Property {
  owner: number;
  houses: number;
}

const PLAYER_COLORS = ['#a34c25', '#5f7d68', '#3f6f8f', '#a34b74', '#7a5aa0', '#a07a2e'];

/** 28 cells on an 8×8 perimeter, laid out like a classic board. */
function gridPosition(index: number): { row: number; col: number } {
  if (index <= 6) return { row: 8, col: 8 - index };
  if (index <= 13) return { row: 8 - (index - 6), col: 1 };
  if (index <= 20) return { row: 1, col: 1 + (index - 13) };
  return { row: 1 + (index - 20), col: 8 };
}

function typeIcon(type: string) {
  if (type === 'railroad') return TrainFront;
  if (type === 'tax' || type === 'utility') return Coins;
  if (type === 'chance') return ShieldAlert;
  if (type === 'go') return Flag;
  if (type === 'go_to_jail' || type === 'jail_visit') return MapPin;
  return Building2;
}

/**
 * مونوپلی — خرید و ساخت روی یک صفحهٔ ۲۸ خانه‌ای. اجاره، شانس، زندان و
 * ورشکستگی از قواعد می‌آید؛ صفحه فقط همان وضعیت را نشان می‌دهد و تاس و
 * خرید/ساخت را می‌فرستد.
 */
export function Monopoly({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [selected, setSelected] = useState<number | null>(null);

  const board = (state.board as Space[] | undefined) ?? [];
  const positions = (state.positions as number[] | undefined) ?? [];
  const cash = (state.cash as number[] | undefined) ?? [];
  const properties = (state.properties as Record<string, Property> | undefined) ?? {};
  const eliminated = (state.eliminated as boolean[] | undefined) ?? [];
  const inJail = (state.inJail as boolean[] | undefined) ?? [];
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const dice = (state.dice as number[] | undefined) ?? [0, 0];
  const gamePhase = (state.phase as string) ?? 'waiting';
  const pendingAction = (state.pendingAction as string | null) ?? null;
  const winner = (state.winner as number | null) ?? null;
  const round = (state.round as number) ?? 1;
  const roundLimit = (state.roundLimit as number) ?? 0;
  const lastCard = (state.lastCard as { type?: string; amount?: number; target?: number; steps?: number } | null) ?? null;
  const lastRent = (state.lastRent as { from: number; to: number; amount: number } | null) ?? null;
  const trade = (state.tradeOffer as {
    from: number;
    to: number;
    offerCash: number;
    requestCash: number;
    offerProps: number[];
    requestProps: number[];
  } | null) ?? null;
  const rollAgain = Boolean(state.rollAgain);

  const myTurn = phase === 'playing' && gamePhase !== 'gameover' && currentPlayer === mySeat && !trade && !eliminated[mySeat];
  const landedSpace = board[positions[mySeat] ?? 0];
  const myProperties = Object.entries(properties)
    .filter(([, property]) => property.owner === mySeat)
    .map(([index, property]) => ({ index: Number(index), ...property }));
  const buildable = myProperties.filter(({ index }) => {
    const space = board[index];
    if (!space || space.type !== 'property' || !space.group) return false;
    return board.every((other, otherIndex) => {
      if (!other || other.type !== 'property' || other.group !== space.group) return true;
      return properties[String(otherIndex)]?.owner === mySeat;
    });
  });

  const roll = () => onMove({ type: 'roll' });
  const buy = () => onMove({ type: 'buy' });
  const skip = () => onMove({ type: 'skip_buy' });
  const build = (spaceIndex: number) => onMove({ type: 'build', spaceIndex });
  const endTurn = () => onMove({ type: 'end_turn' });

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null ? null : currentPlayer}
        hint={
          winner !== null
            ? 'بازی تمام شد'
            : gamePhase === 'landed' && pendingAction === 'can_buy'
              ? 'می‌توانید این ملک را بخرید'
              : inJail[mySeat]
                ? 'در زندان هستید؛ برای آزادی تاس بیندازید'
                : `دور ${formatCountFa(round)}${roundLimit ? ` از ${formatCountFa(roundLimit)}` : ''}`
        }
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          {cash.map((value, seat) => `${seatName(seats, seat)}: ${formatCountFa(Math.max(0, value))} سکه`).join(' · ')}
        </p>
      </ResultOverlay>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div dir="ltr" className="scroll-thin mx-auto w-full max-w-[38rem] overflow-x-auto">
          <div className="grid min-w-[32rem] grid-cols-8 gap-[2px] rounded-2xl bg-espresso p-[3px] shadow-[0_18px_40px_-22px_rgba(41,27,19,0.8)]">
            {board.map((space, index) => {
              const place = gridPosition(index);
              const property = properties[String(index)];
              const here = positions.map((position, seat) => (position === index ? seat : -1)).filter((seat) => seat >= 0);
              const Icon = typeIcon(space.type);
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => setSelected(index)}
                  aria-label={`${space.name ?? index}${property ? `، مالک ${seatName(seats, property.owner)}` : ''}`}
                  aria-pressed={selected === index}
                  style={{ gridRow: place.row, gridColumn: place.col }}
                  className={cn(
                    'relative flex min-h-14 min-w-0 flex-col justify-between overflow-hidden rounded-[7px] border bg-cream p-1 text-right transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                    selected === index ? 'border-brand-500 ring-1 ring-brand-300' : 'border-line/70',
                  )}
                >
                  {space.color ? <span aria-hidden className="absolute inset-x-0 top-0 h-1.5" style={{ backgroundColor: space.color }} /> : null}
                  <span className="mt-1.5 flex items-center gap-0.5 text-[8px] text-muted">
                    <Icon aria-hidden className="size-2.5 shrink-0" />
                    <span className="num">{formatCountFa(index)}</span>
                  </span>
                  <span className="line-clamp-2 text-[7.5px] font-semibold leading-3 text-ink">
                    {space.name ?? space.nameEn ?? space.type}
                  </span>
                  {space.price ? (
                    <span className="num text-[7px] text-muted">{formatCountFa(space.price)}</span>
                  ) : null}
                  {property ? (
                    <span
                      aria-hidden
                      className="absolute inset-x-0 top-1.5 h-0.5"
                      style={{ backgroundColor: PLAYER_COLORS[property.owner % PLAYER_COLORS.length] }}
                    />
                  ) : null}
                  {property && property.houses > 0 ? (
                    <span className="num absolute bottom-0.5 left-0.5 rounded bg-white/80 px-1 text-[6px] text-ink">
                      {property.houses === 5 ? 'هتل' : `×${formatCountFa(property.houses)}`}
                    </span>
                  ) : null}
                  {here.length > 0 ? (
                    <span className="absolute bottom-1 right-1 flex gap-0.5">
                      {here.map((seat) => (
                        <span
                          key={seat}
                          title={seatName(seats, seat)}
                          className="num grid size-3 place-items-center rounded-full text-[6px] font-bold text-white ring-1 ring-white"
                          style={{ backgroundColor: PLAYER_COLORS[seat % PLAYER_COLORS.length] }}
                        >
                          {formatCountFa(seat + 1)}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              );
            })}

            <div
              aria-label="وسط صفحه"
              className="col-start-2 col-end-8 row-start-2 row-end-8 m-1 flex flex-col items-center justify-center gap-2 rounded-xl bg-[#f3e9da] p-3"
              style={{ gridRow: '2 / 8', gridColumn: '2 / 8' }}
            >
              <div className="flex items-center gap-2">
                {dice.map((die, index) => (
                  <span
                    key={index}
                    className="num grid size-10 place-items-center rounded-lg border border-line bg-white text-lg font-black text-ink shadow-sm"
                  >
                    {die > 0 ? formatCountFa(die) : '·'}
                  </span>
                ))}
                <Dices aria-hidden className="size-5 text-brand-600" />
              </div>
              {rollAgain ? <p className="text-[9px] text-brand-700">دوبل! یک بار دیگر تاس بریزید.</p> : null}
              {lastRent ? (
                <p className="text-center text-[9px] text-ink/70">
                  {seatName(seats, lastRent.from)} به {seatName(seats, lastRent.to)} مبلغ{' '}
                  <span className="num font-bold">{formatCountFa(lastRent.amount)}</span> سکه اجاره داد.
                </p>
              ) : null}
              {lastCard ? <ChanceCard card={lastCard} /> : null}
              <p className="rounded-full bg-white/70 px-2.5 py-0.5 text-[8px] text-muted">روی خانه‌ها بزنید تا جزئیات را ببینید</p>
            </div>
          </div>
        </div>

        <aside className="space-y-3">
          <div className="rounded-2xl border border-line/70 bg-surface p-3">
            <p className="mb-2 inline-flex items-center gap-1 text-[10px] font-semibold text-muted">
              <Coins aria-hidden className="size-3.5" />
              کیف پول میز
            </p>
            <ul className="space-y-1.5">
              {seats.map((seat) => (
                <li
                  key={seat.index}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-[11px]',
                    currentPlayer === seat.index ? 'bg-brand-50 text-ink' : 'text-ink/75',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: PLAYER_COLORS[seat.index % PLAYER_COLORS.length] }}
                    />
                    <span className="truncate">{seat.nameFa}</span>
                    {inJail[seat.index] ? <span className="text-[8px] text-danger-600">زندان</span> : null}
                    {eliminated[seat.index] ? <span className="text-[8px] text-muted">ورشکسته</span> : null}
                  </span>
                  <span className="num shrink-0 font-bold">{formatCountFa(Math.max(0, cash[seat.index] ?? 0))}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-line/70 bg-surface p-3">
            <p className="mb-2 text-[10px] font-semibold text-muted">نوبت شما</p>
            {myTurn && gamePhase === 'waiting' ? (
              <button
                type="button"
                onClick={roll}
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-brand-600 px-4 text-xs font-bold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <Dices aria-hidden className="size-4" />
                تاس بریز
              </button>
            ) : null}

            {myTurn && gamePhase === 'landed' && pendingAction === 'can_buy' && landedSpace ? (
              <div className="space-y-2">
                <p className="text-[11px] text-ink/80">
                  «{landedSpace.name}» با قیمت <span className="num font-bold">{formatCountFa(landedSpace.price ?? 0)}</span> سکه.
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={buy} className="min-h-11 flex-1 rounded-full bg-brand-600 px-3 text-[11px] font-bold text-white">
                    بخر
                  </button>
                  <button type="button" onClick={skip} className="min-h-11 flex-1 rounded-full border border-line bg-surface px-3 text-[11px] font-semibold text-ink">
                    رد کن
                  </button>
                </div>
              </div>
            ) : null}

            {myTurn && (gamePhase === 'landed' || gamePhase === 'end_turn') ? (
              <button
                type="button"
                onClick={endTurn}
                className="mt-2 min-h-11 w-full rounded-full bg-espresso px-4 text-xs font-semibold text-cream hover:bg-brand-800"
              >
                پایان نوبت
              </button>
            ) : null}

            {!myTurn ? (
              <p className="text-[11px] leading-5 text-muted">
                {winner !== null ? 'دست تمام شده است.' : `منتظر ${seatName(seats, currentPlayer)} باشید.`}
              </p>
            ) : null}

            {trade && trade.to === mySeat ? (
              <div className="mt-2 space-y-2 rounded-xl border border-brand-200 bg-brand-50 p-2">
                <p className="inline-flex items-center gap-1 text-[10px] text-brand-800">
                  <ArrowRightLeft aria-hidden className="size-3" />
                  پیشنهاد معامله از {seatName(seats, trade.from)}
                </p>
                <p className="text-[10px] text-ink/80">
                  {formatCountFa(trade.offerCash)} سکه + {formatCountFa(trade.offerProps.length)} ملک در برابر{' '}
                  {formatCountFa(trade.requestCash)} سکه + {formatCountFa(trade.requestProps.length)} ملک
                </p>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => onMove({ type: 'trade_accept' })} className="min-h-10 flex-1 rounded-full bg-brand-600 text-[10px] font-bold text-white">
                    قبول
                  </button>
                  <button type="button" onClick={() => onMove({ type: 'trade_decline' })} className="min-h-10 flex-1 rounded-full border border-line text-[10px]">
                    رد
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {selected !== null ? (
            <SpaceDetails space={board[selected]} property={properties[String(selected)]} seats={seats} />
          ) : null}

          {myProperties.length > 0 ? (
            <div className="rounded-2xl border border-line/70 bg-surface p-3">
              <p className="mb-2 inline-flex items-center gap-1 text-[10px] font-semibold text-muted">
                <Building2 aria-hidden className="size-3.5" />
                ملک‌های شما
              </p>
              <ul className="space-y-1.5">
                {myProperties.map((property) => {
                  const space = board[property.index];
                  const canBuild = myTurn && buildable.some((entry) => entry.index === property.index) && property.houses < 5;
                  return (
                    <li key={property.index} className="flex items-center justify-between gap-1.5 text-[10px]">
                      <span className="min-w-0 truncate text-ink/80">
                        {space?.name ?? property.index}
                        {property.houses > 0 ? <span className="num mr-1 text-[8px] text-muted">{property.houses === 5 ? 'هتل' : `${formatCountFa(property.houses)} خانه`}</span> : null}
                      </span>
                      {canBuild ? (
                        <button
                          type="button"
                          onClick={() => build(property.index)}
                          className="min-h-8 shrink-0 rounded-full bg-brand-50 px-2.5 text-[9px] font-bold text-brand-800 ring-1 ring-brand-200"
                        >
                          ساخت
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function ChanceCard({ card }: { card: { type?: string; amount?: number; target?: number; steps?: number } }) {
  let text = 'کارت شانس';
  if (card.type === 'birthday') text = 'تولد! هر بازیکن ۵۰ سکه می‌دهد.';
  else if (card.type === 'jail') text = 'مستقیم به زندان!';
  else if (card.type === 'goto') text = 'به خانهٔ شروع بروید و ۲۰۰ سکه بگیرید.';
  else if (card.type === 'advance') text = card.steps && card.steps > 0 ? `${formatCountFa(card.steps)} خانه جلو بروید.` : `${formatCountFa(Math.abs(card.steps ?? 0))} خانه عقب بروید.`;
  else if (card.type === 'free_rent') text = 'کارت معافیت از اجاره گرفتید.';
  else if (typeof card.amount === 'number') text = card.amount >= 0 ? `${formatCountFa(card.amount)} سکه دریافت کردید.` : `${formatCountFa(Math.abs(card.amount))} سکه پرداخت کردید.`;
  return (
    <p className="flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 text-center text-[9px] text-brand-800">
      <ShieldAlert aria-hidden className="size-3 shrink-0" />
      {text}
    </p>
  );
}

function SpaceDetails({
  space,
  property,
  seats,
}: {
  space: Space | undefined;
  property: Property | undefined;
  seats: GameRendererProps['seats'];
}) {
  if (!space) return null;
  return (
    <div className="rounded-2xl border border-line/70 bg-surface p-3">
      <p className="text-[10px] text-muted">جزئیات خانه</p>
      <p className="mt-0.5 text-xs font-bold text-ink">{space.name ?? space.nameEn ?? space.type}</p>
      {property ? (
        <p className="mt-1 text-[10px] text-ink/70">
          مالک: {seatName(seats, property.owner)} · {property.houses === 5 ? 'هتل' : `${formatCountFa(property.houses)} خانه`}
        </p>
      ) : space.price ? (
        <p className="num mt-1 text-[10px] text-ink/70">قیمت {formatCountFa(space.price)} سکه</p>
      ) : null}
      {space.rent ? (
        <p className="num mt-1 text-[9px] text-muted">اجاره: {space.rent.map((rent) => formatCountFa(rent)).join(' · ')}</p>
      ) : null}
    </div>
  );
}
