import { useState } from 'react';
import { Eye, Layers } from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, SeatList, TurnBar, seatName } from '../shared/GamePieces';

interface KittenCard {
  type: string;
  id: string;
}

const CARDS: Record<string, { name: string; help: string }> = {
  explode: { name: 'بچه‌گربهٔ انفجاری', help: 'اگر بی‌خنثی‌سازی بکشید، بیرون می‌روید.' },
  defuse: { name: 'خنثی‌سازی', help: 'برای زنده ماندن از انفجار؛ بازی نمی‌شود، نگهش دارید.' },
  attack: { name: 'حمله', help: 'یک بازیکن دو نوبت پشت‌سرهم بازی می‌کند.' },
  skip: { name: 'رد کردن', help: 'بدون کشیدن کارت، نوبت را تمام می‌کند.' },
  future: { name: 'دیدن آینده', help: 'سه کارت روی دسته را می‌بینید.' },
  shuffle: { name: 'بُر زدن', help: 'دسته را دوباره بُر می‌زند.' },
  favor: { name: 'درخواست', help: 'از یک بازیکن یک کارت تصادفی می‌گیرید.' },
  steal: { name: 'دزدی', help: 'از یک بازیکن یک کارت تصادفی می‌دزدید.' },
};

const TARGETED = new Set(['attack', 'favor', 'steal']);

function cardName(type: string): string {
  return CARDS[type]?.name ?? type;
}

interface LastAction {
  player: number;
  type: string;
  target?: number;
}

/**
 * بچه‌گربه‌های انفجاری — play cards, then draw; an exploding kitten knocks a
 * seat out unless a defuse sends it back into the deck. The engine owns the
 * deck order and the defuse/place rules; the screen only shows what is public
 * and asks for a target (or a place for the kitten) when one is needed.
 */
export function ExplodingKittens({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [targeting, setTargeting] = useState<{ cardId: string; type: string } | null>(null);

  const gamePhase = (state.phase as string) ?? 'play';
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const winner = (state.winner as number | null) ?? null;
  const hands = (state.hands as Array<KittenCard[] | null> | undefined) ?? [];
  const hand = hands[mySeat] ?? [];
  const deck = (state.deck as Array<unknown> | undefined) ?? [];
  const alive = (state.alive as boolean[]) ?? [];
  const extraTurns = (state.extraTurns as number[]) ?? [];
  const peeked = (state.peekedCards as KittenCard[] | null) ?? null;
  const lastAction = (state.lastAction as LastAction | null) ?? null;

  const myTurn = phase === 'playing' && gamePhase !== 'over' && currentPlayer === mySeat && winner === null;
  const myPlace = myTurn && gamePhase === 'place';
  const canDraw = myTurn && gamePhase === 'play';
  const aliveTargets = seats.filter((seat) => seat.index !== mySeat && alive[seat.index] !== false);

  const play = (type: string, cardId: string, targetPlayer?: number) => {
    onMove(targetPlayer === undefined ? { cardId } : { cardId, targetPlayer });
    setTargeting(null);
  };

  const actionText = (action: LastAction): string => {
    const who = seatName(seats, action.player);
    const target = action.target !== undefined ? seatName(seats, action.target) : null;
    switch (action.type) {
      case 'draw':
        return `${who} یک کارت کشید.`;
      case 'defuse':
        return `${who} با خنثی‌سازی جان سالم برد.`;
      case 'explode':
        return `${who} با بچه‌گربهٔ انفجاری منفجر شد و بیرون رفت.`;
      case 'attack':
        return target ? `${who} به ${target} حمله کرد.` : `${who} حمله کرد.`;
      case 'favor':
      case 'steal':
        return target ? `${who} از ${target} یک کارت گرفت.` : `${who} کارت ${cardName(action.type)} را بازی کرد.`;
      default:
        return `${who} کارت «${cardName(action.type)}» را بازی کرد.`;
    }
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
            : myPlace
              ? 'بچه‌گربه را کجای دسته بگذارید؟'
              : myTurn
                ? gamePhase === 'play'
                  ? 'می‌توانید کارت بازی کنید یا کارت بکشید'
                  : 'کارت بکشید'
                : `نوبت ${seatName(seats, currentPlayer)} است`
        }
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">آخرین بازمانده برنده است.</p>
      </ResultOverlay>

      <SeatList seats={seats} activeSeat={winner !== null ? null : currentPlayer} />

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted">دستهٔ کارت</p>
            <span className="num inline-flex items-center gap-1 rounded-full border border-line/70 px-2 py-0.5 text-[10px] text-ink/80">
              <Layers aria-hidden className="size-3" />
              {formatCountFa(deck.length)} کارت
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {seats.map((seat) => (
              <li key={seat.index} className="flex items-center justify-between text-[11px]">
                <span className={cn('flex items-center gap-1.5', alive[seat.index] === false ? 'text-muted line-through' : 'text-ink/80')}>
                  {seat.nameFa}
                  {alive[seat.index] === false ? <span className="text-[9px] no-underline">بیرون</span> : null}
                  {(extraTurns[seat.index] ?? 0) > 0 ? (
                    <span className="rounded-full bg-brand-50 px-1.5 text-[9px] text-brand-800">
                      {formatCountFa(extraTurns[seat.index])} نوبت اضافه
                    </span>
                  ) : null}
                </span>
                <span className="num text-muted">{formatCountFa(hands[seat.index]?.length ?? 0)} کارت</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="mb-1.5 text-[10px] text-muted">آخرین اتفاق</p>
          {lastAction ? (
            <p className="text-[11px] text-ink/80" role="status">
              {actionText(lastAction)}
            </p>
          ) : (
            <p className="text-[11px] text-muted">هنوز کارتی بازی نشده است.</p>
          )}
          {peeked && peeked.length > 0 ? (
            <div className="mt-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
              <p className="inline-flex items-center gap-1 text-[10px] text-brand-800">
                <Eye aria-hidden className="size-3" />
                آیندهٔ دسته (فقط شما)
              </p>
              <p className="mt-1 text-[11px] text-ink">{peeked.map((card) => cardName(card.type)).join(' · ')}</p>
            </div>
          ) : null}
        </div>
      </div>

      {myPlace ? (
        <div className="space-y-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="text-xs text-ink">خنثی‌سازی کار کرد. بچه‌گربه را کجای دسته برگردانیم؟</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onMove({ position: 'top' })}
              className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              بالای دسته
            </button>
            <button
              type="button"
              onClick={() => onMove({ position: 'bottom' })}
              className="min-h-11 rounded-full border border-line bg-surface px-5 text-xs font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              پایین دسته
            </button>
            <button
              type="button"
              onClick={() => onMove({ position: 'random' })}
              className="min-h-11 rounded-full border border-line bg-surface px-5 text-xs font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              جای تصادفی
            </button>
          </div>
        </div>
      ) : null}

      {targeting ? (
        <div className="space-y-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="text-xs text-ink">
            «{cardName(targeting.type)}» را روی کدام بازیکن بازی می‌کنید؟
          </p>
          <div className="flex flex-wrap gap-2">
            {aliveTargets.map((seat) => (
              <button
                key={seat.index}
                type="button"
                onClick={() => play(targeting.type, targeting.cardId, seat.index)}
                className="min-h-11 rounded-full bg-brand-600 px-4 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                {seat.nameFa}
              </button>
            ))}
            {targeting.type === 'attack' ? (
              <button
                type="button"
                onClick={() => play(targeting.type, targeting.cardId)}
                className="min-h-11 rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                همان نفر بعد
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setTargeting(null)}
              className="min-h-11 rounded-full px-4 text-[11px] text-muted"
            >
              منصرف شدم
            </button>
          </div>
        </div>
      ) : null}

      <section aria-label="دست شما" className="space-y-2">
        <p className="text-[11px] text-muted">دست شما ({formatCountFa(hand.length)} کارت)</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {hand.map((card) => {
            const meta = CARDS[card.type] ?? { name: card.type, help: '' };
            const disabled = !myTurn || gamePhase !== 'play' || card.type === 'defuse';
            return (
              <li key={card.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (TARGETED.has(card.type)) setTargeting({ cardId: card.id, type: card.type });
                    else play(card.type, card.id);
                  }}
                  className="flex w-full flex-col items-start gap-0.5 rounded-2xl border border-line/70 bg-surface px-3 py-2 text-right transition-colors enabled:hover:border-brand-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  <span className="text-[11px] font-semibold text-ink">{meta.name}</span>
                  <span className="text-[10px] text-muted">{meta.help}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {hand.length === 0 ? <p className="text-[11px] text-muted">کارتی در دست ندارید.</p> : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => onMove({ draw: true })}
            disabled={!canDraw}
            className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white transition-colors enabled:hover:bg-brand-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            کارت بکش
          </button>
          <p className="self-center text-[10px] text-muted">با کشیدن کارت، نوبت شما تمام می‌شود.</p>
        </div>
      </section>
    </div>
  );
}
