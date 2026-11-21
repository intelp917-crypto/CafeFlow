import { useState } from 'react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';
import { PlayingCard, type CardValue } from '../shared/PlayingCard';

const PHASE_NAMES: Record<string, string> = {
  preflop: 'پیش از فلاپ',
  flop: 'فلاپ',
  turn: 'ترن',
  river: 'ریور',
  showdown: 'رویت',
};

const HAND_NAMES: Record<string, string> = {
  high_card: 'کارت بالا',
  pair: 'جفت',
  two_pair: 'دو جفت',
  three: 'سهتایی',
  straight: 'راست',
  flush: 'همرنگ',
  full_house: 'فولهاوس',
  four: 'چهارتایی',
  straight_flush: 'راست همرنگ',
  royal_flush: 'راست همرنگ سلطنتی',
};

interface ShowdownHand {
  player: number;
  cards: CardValue[];
  hand: { type: string };
}

/**
 * تگزاس هولدم — یک دست در هر اتاق؛ سهم‌ها، بلایندها و رِیز حداقلی را موتور
 * قواعد کنترل می‌کند. هر صندلی فقط کارت‌های خودش را می‌بیند و بقیه فقط تعداد
 * کارت و وضعیت فولد/آل‌این را.
 */
export function Texas({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [raiseTo, setRaiseTo] = useState('');

  const gamePhase = (state.phase as string) ?? 'preflop';
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const winner = (state.winner as number | null) ?? null;
  const community = (state.communityCards as CardValue[] | undefined) ?? [];
  const hole = (state.holeCards as CardValue[] | undefined) ?? [];
  const chips = (state.chips as number[]) ?? [];
  const bets = (state.bets as number[]) ?? [];
  const folded = (state.folded as boolean[]) ?? [];
  const allIn = (state.allIn as boolean[]) ?? [];
  const counts = (state.opponentHoleCounts as number[]) ?? [];
  const dealer = (state.dealer as number | null) ?? null;
  const pot = (state.pot as number) ?? 0;
  const currentBet = (state.currentBet as number) ?? 0;
  const lastRaise = (state.lastRaise as number) ?? 0;
  const showdown = (state.showdownHands as ShowdownHand[] | undefined) ?? [];
  const handNumber = (state.handNumber as number) ?? 1;

  const myBet = bets[mySeat] ?? 0;
  const toCall = Math.max(0, currentBet - myBet);
  const myChips = chips[mySeat] ?? 0;
  const myTurn =
    phase === 'playing' && gamePhase !== 'showdown' && currentPlayer === mySeat && winner === null && !folded[mySeat] && !allIn[mySeat];
  const minRaise = Math.max(currentBet + lastRaise, currentBet + 1);
  const raiseValue = Number.parseInt(raiseTo.replace(/[^\d]/g, ''), 10);

  const act = (move: Record<string, unknown>) => {
    onMove(move);
    setRaiseTo('');
  };

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null ? null : currentPlayer}
        hint={
          winner !== null
            ? 'این دست تمام شد'
            : myTurn
              ? toCall > 0
                ? `${formatCountFa(toCall)} برای کال لازم است`
                : 'می‌توانید چک کنید یا رِیز بزنید'
              : `نوبت ${seatName(seats, currentPlayer)} است`
        }
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        {showdown.length > 0 ? (
          <ul className="mt-2 space-y-1 text-[11px] text-ink/80">
            {showdown.map((entry) => (
              <li key={entry.player}>
                {seatName(seats, entry.player)} — {HAND_NAMES[entry.hand?.type] ?? entry.hand?.type}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-muted">همهٔ حریف‌ها فولد کردند.</p>
        )}
      </ResultOverlay>

      <div className="rounded-[1.75rem] border border-line/70 bg-[#e9ded0] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink/80">
          <p>{PHASE_NAMES[gamePhase] ?? gamePhase}</p>
          <p className="num">دست {formatCountFa(handNumber)}</p>
          <p className="num font-semibold text-brand-800">گلدان: {formatCountFa(pot)}</p>
        </div>

        <div className="mt-3 flex flex-wrap justify-center gap-1.5" aria-label="کارت‌های روی میز">
          {community.map((card) => (
            <PlayingCard key={card.id} card={card} />
          ))}
          {Array.from({ length: Math.max(0, 5 - community.length) }).map((_, index) => (
            <PlayingCard
              key={`back-${index}`}
              card={{ id: `back-${index}`, rank: '2', suit: 's' }}
              faceDown
            />
          ))}
        </div>

        <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
          {seats.map((seat) => (
            <li
              key={seat.index}
              className={cn(
                'flex items-center justify-between rounded-xl border px-3 py-2 text-[11px]',
                currentPlayer === seat.index && winner === null
                  ? 'border-brand-400 bg-brand-50'
                  : 'border-line/70 bg-surface/80',
                folded[seat.index] && 'opacity-60',
              )}
            >
              <span className="flex items-center gap-1.5 text-ink/80">
                {seat.nameFa}
                {dealer === seat.index ? (
                  <span className="rounded-full bg-espresso px-1.5 text-[9px] text-cream">دیлер</span>
                ) : null}
                {folded[seat.index] ? <span className="text-[9px] text-muted">فولد</span> : null}
                {allIn[seat.index] ? <span className="text-[9px] text-brand-700">آل‌این</span> : null}
              </span>
              <span className="num text-muted">
                {formatCountFa(chips[seat.index] ?? 0)} ژتون
                {bets[seat.index] ? <span className="mr-2 text-ink">شرط {formatCountFa(bets[seat.index]!)}</span> : null}
                {seat.index !== mySeat && !folded[seat.index] ? (
                  <span className="mr-2">{formatCountFa(counts[seat.index] ?? 0)} کارت</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <section aria-label="کارت‌های شما" className="space-y-2">
        <p className="text-[11px] text-muted">کارت‌های شما</p>
        <div className="flex flex-wrap gap-1.5">
          {hole.map((card) => (
            <PlayingCard key={card.id} card={card} />
          ))}
          {hole.length === 0 ? <p className="text-[11px] text-muted">در این دست کارتی ندارید.</p> : null}
        </div>
        <p className="num text-[10px] text-muted">
          بلایند کوچک {formatCountFa(state.smallBlind ?? 0)} · بلایند بزرگ {formatCountFa(state.bigBlind ?? 0)} · حداقل رِیز{' '}
          {formatCountFa(minRaise)}
        </p>
      </section>

      {myTurn ? (
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            onClick={() => act({ action: 'fold' })}
            className="min-h-11 rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            فولد
          </button>
          {toCall === 0 ? (
            <button
              type="button"
              onClick={() => act({ action: 'check' })}
              className="min-h-11 rounded-full bg-brand-600 px-4 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              چک
            </button>
          ) : (
            <button
              type="button"
              onClick={() => act({ action: 'call' })}
              disabled={myChips < toCall}
              className="min-h-11 rounded-full bg-brand-600 px-4 text-xs font-bold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              کال {formatCountFa(toCall)}
            </button>
          )}
          <div className="flex items-end gap-1.5">
            <label className="text-[10px] text-muted">
              رِیز تا
              <input
                inputMode="numeric"
                value={raiseTo}
                onChange={(event) => setRaiseTo(event.target.value)}
                placeholder={String(minRaise)}
                className="num mt-1 block min-h-11 w-24 rounded-xl border border-line bg-cream px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              />
            </label>
            <button
              type="button"
              onClick={() => act({ action: 'raise', amount: raiseValue })}
              disabled={!Number.isInteger(raiseValue) || raiseValue <= currentBet || myChips < raiseValue - myBet}
              className="min-h-11 rounded-full border border-brand-300 bg-brand-50 px-4 text-xs font-bold text-brand-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              رِیز
            </button>
          </div>
          <button
            type="button"
            onClick={() => act({ action: 'all_in' })}
            disabled={myChips <= 0}
            className="min-h-11 rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            آل‌این ({formatCountFa(myChips)})
          </button>
        </div>
      ) : null}
    </div>
  );
}
