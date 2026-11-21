import { Hand } from 'lucide-react';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';
import { PlayingCard, cardName, type CardValue } from '../shared/PlayingCard';

/**
 * دوشیزهٔ پیر — every pair leaves the table and whoever keeps the ghost loses.
 *
 * The opponent's cards are handed over as nulls of the right length, so the
 * index a guest taps is the same index the engine draws. That is the whole game:
 * pick a position, hope it is not the ghost.
 */
export function OldMaid({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const winner = (state.winner as number | null) ?? null;
  const loser = (state.loser as number | null) ?? null;
  const hand = (state.hands?.[mySeat] as CardValue[] | null) ?? [];
  const handSizes = (state.handSizes as number[]) ?? [];
  const lastDraw = (state.lastDraw as { from: number; to: number; card: CardValue | null } | null) ?? null;
  const lastDiscards = (state.lastDiscards as { player: number; pairs: Array<{ rank: string }> } | null) ?? null;
  const myTurn = phase === 'playing' && currentPlayer === mySeat && winner === null;

  // The engine draws from the next guest clockwise who still holds cards.
  let target = -1;
  for (let step = 1; step < handSizes.length; step += 1) {
    const candidate = (mySeat + step) % handSizes.length;
    if ((handSizes[candidate] ?? 0) > 0) {
      target = candidate;
      break;
    }
  }

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null ? null : currentPlayer}
        hint={
          winner !== null
            ? 'دست تمام شد'
            : myTurn
              ? 'از دست نفر بعدی یک کارت بردارید'
              : 'نوبت حریف است'
        }
      />

      <ResultOverlay
        seats={seats}
        winner={winner}
        phase={phase}
        canRestart={canRestart}
        onRestart={onRestart}
        headline={
          loser !== null && loser >= 0
            ? `${seatName(seats, loser)} با کارت تنها ماند`
            : 'همه کارت‌هایشان را خالی کردند'
        }
      >
        <p className="mt-1 text-[11px] text-muted">در دوشیزهٔ پیر همه برنده‌اند جز کسی که کارت بی‌جفت را نگه دارد.</p>
      </ResultOverlay>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="text-[10px] text-muted">کارت‌های هر نفر</p>
          <ul className="mt-2 space-y-1">
            {seats.map((seat) => (
              <li key={seat.index} className="flex items-center justify-between text-[11px]">
                <span className={seat.index === mySeat ? 'font-semibold text-ink' : 'text-ink/80'}>
                  {seat.nameFa}
                  {seat.index === currentPlayer ? <span className="mr-1.5 text-[9px] text-brand-700">نوبت</span> : null}
                </span>
                <span className="num text-muted">{formatCountFa(handSizes[seat.index] ?? 0)} کارت</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="text-[10px] text-muted">آخرین برداشت</p>
          {lastDraw?.card ? (
            <div className="mt-2 flex items-center gap-2">
              <PlayingCard card={lastDraw.card} size="sm" />
              <p className="text-[11px] text-ink/80">
                {seatName(seats, lastDraw.to)} از {seatName(seats, lastDraw.from)} کارت {cardName(lastDraw.card)} را برداشت.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-muted">هنوز کارتی برداشته نشده است.</p>
          )}
          {lastDiscards && lastDiscards.pairs.length > 0 ? (
            <p className="mt-2 text-[10px] text-success-700">
              {formatCountFa(lastDiscards.pairs.length)} جفت کنار گذاشته شد
              {lastDiscards.pairs.length > 0
                ? ` (${lastDiscards.pairs
                    .map((pair) => cardName({ id: pair.rank, rank: pair.rank, suit: '' }))
                    .join('، ')})`
                : ''}
              .
            </p>
          ) : null}
        </div>
      </div>

      {myTurn && target >= 0 ? (
        <section aria-label={`دست ${seatName(seats, target)}`} className="space-y-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Hand aria-hidden className="size-4" />
            یک کارت از {seatName(seats, target)} بردارید
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: handSizes[target] ?? 0 }).map((_, index) => (
              <PlayingCard
                key={index}
                card={{ id: `draw-${index}`, rank: '2', suit: 's' }}
                faceDown
                label={`کارت ${formatCountFa(index + 1)} ${seatName(seats, target)}`}
                onClick={() => onMove({ cardIndex: index })}
              />
            ))}
          </div>
        </section>
      ) : null}

      {myTurn && target < 0 ? (
        <p className="rounded-2xl border border-line/70 bg-canvas px-4 py-2.5 text-[11px] text-muted">
          کسی کارتی برای برداشتن ندارد.
        </p>
      ) : null}

      <section aria-label="دست شما" className="space-y-2">
        <p className="text-[11px] text-muted">دست شما ({formatCountFa(hand.length)} کارت)</p>
        <div className="flex flex-wrap gap-1.5">
          {hand.map((card) => (
            <PlayingCard key={card.id} card={card} />
          ))}
          {hand.length === 0 ? <p className="text-[11px] text-success-700">دست شما خالی است؛ شما برنده‌اید.</p> : null}
        </div>
      </section>
    </div>
  );
}
