import { useState } from 'react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';
import { PlayingCard, type CardValue } from '../shared/PlayingCard';

const PLAY_NAMES: Record<string, string> = {
  single: 'تک',
  pair: 'جفت',
  triple: 'سه‌تایی',
  straight: 'راست',
  flush: 'هم‌رنگ',
  full_house: 'فول‌هاوس',
  four_one: 'چهار به‌علاوهٔ یک',
  straight_flush: 'راست هم‌رنگ',
};

interface LastPlay {
  player: number;
  cards: CardValue[];
  play: { type: string };
}

interface RoundResult {
  left: number;
  mult: number;
  points: number;
}

/**
 * بیگ‌تو — 3 or 4 seats climb until someone empties their hand.
 *
 * Rule details live in the engine; the screen's job is to make the two ways to
 * act obvious (play the selected cards, or pass) and to show why a seat is stuck.
 */
export function BigTwo({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [picked, setPicked] = useState<string[]>([]);

  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const winner = (state.winner as number | null) ?? null;
  const hands = (state.hands as Array<CardValue[] | null> | undefined) ?? [];
  const hand = hands[mySeat] ?? [];
  const lastPlay = (state.lastPlay as LastPlay | null) ?? null;
  const lastPlayPlayer = (state.lastPlayPlayer as number) ?? -1;
  const passed = (state.passed as boolean[]) ?? [];
  const scores = (state.scores as number[]) ?? [];
  const cumulative = (state.cumulativeScore as number[] | null) ?? null;
  const roundResult = (state.roundResult as RoundResult[] | null) ?? null;
  const opened = Boolean(state._opened);
  const myTurn = phase === 'playing' && currentPlayer === mySeat && winner === null;
  const canPass = myTurn && Boolean(lastPlay) && lastPlayPlayer !== mySeat;
  const nextSeat = hands.length > 0 ? (mySeat + 1) % hands.length : mySeat;
  const nextHasOne = (hands[nextSeat]?.length ?? 0) === 1;

  const selected = picked.filter((id) => hand.some((card) => card.id === id));

  const toggle = (id: string) => {
    setPicked((current) => (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]));
  };

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null ? null : currentPlayer}
        hint={
          winner !== null
            ? 'دست تمام شد'
            : !opened
              ? 'اولین حرکت باید سه خشت باشد'
              : myTurn
                ? canPass
                  ? 'ترکیبی بزنید که بزرگ‌تر باشد یا پاس بدهید'
                  : 'شما زمین‌بازی را شروع می‌کنید'
                : 'نوبت حریف است'
        }
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        {roundResult && winner !== null ? (
          <p className="mt-1 text-[11px] text-muted">
            {roundResult
              .map((result, seatIndex) =>
                seatIndex === winner
                  ? null
                  : `${seatName(seats, seatIndex)}: ${result.points < 0 ? '−' : '+'}${formatCountFa(
                      Math.abs(result.points),
                    )}`,
              )
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
      </ResultOverlay>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="mb-1.5 text-[10px] text-muted">روی میز</p>
          {lastPlay ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {lastPlay.cards.map((card) => (
                  <PlayingCard key={card.id} card={card} size="sm" />
                ))}
              </div>
              <p className="text-[10px] text-muted">
                {seatName(seats, lastPlay.player)} — {PLAY_NAMES[lastPlay.play.type] ?? lastPlay.play.type}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-muted">میز خالی است؛ زمین‌بازی آزاد است.</p>
          )}
        </div>

        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="mb-1.5 text-[10px] text-muted">امتیاز کل</p>
          <ul className="space-y-1">
            {seats.map((seat) => (
              <li key={seat.index} className="flex items-center justify-between text-[11px]">
                <span className="text-ink/80">
                  {seat.nameFa}
                  {passed[seat.index] ? <span className="mr-1.5 text-[9px] text-muted">پاس</span> : null}
                </span>
                <span className="num font-semibold text-ink">
                  {formatCountFa((cumulative ?? scores)[seat.index] ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {nextHasOne && myTurn ? (
        <p className="rounded-2xl border border-brand-300 bg-brand-50 px-4 py-2.5 text-[11px] text-brand-800">
          بازیکن بعدی فقط یک کارت دارد؛ اگر تک می‌بندید باید بالاترین کارت دستتان باشد.
        </p>
      ) : null}

      <section aria-label="دست شما" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted">
            دست شما ({formatCountFa(hand.length)} کارت)
          </p>
          {selected.length > 0 ? (
            <p className="text-[11px] text-brand-700">{formatCountFa(selected.length)} کارت انتخاب شده</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {hand.map((card) => (
            <PlayingCard
              key={card.id}
              card={card}
              selected={picked.includes(card.id)}
              disabled={!myTurn}
              onClick={() => toggle(card.id)}
            />
          ))}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              onMove({ cards: selected });
              setPicked([]);
            }}
            disabled={!myTurn || selected.length === 0}
            className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white transition-colors enabled:hover:bg-brand-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            بازی کارت‌های انتخاب‌شده
          </button>
          <button
            type="button"
            onClick={() => {
              onMove({ pass: true });
              setPicked([]);
            }}
            disabled={!canPass}
            className="min-h-11 rounded-full border border-line bg-surface px-5 text-xs font-semibold text-ink transition-colors enabled:hover:border-brand-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            پاس
          </button>
          {selected.length > 0 ? (
            <button type="button" onClick={() => setPicked([])} className="min-h-11 rounded-full px-4 text-[11px] text-muted">
              پاک کردن
            </button>
          ) : null}
        </div>
        <p className={cn('text-[10px]', selected.length > 0 ? 'text-muted' : 'text-transparent')} aria-hidden={selected.length === 0}>
          ترکیب‌های مجاز: تک، جفت، سه‌تایی، راست، هم‌رنگ، فول‌هاوس، چهار+یک و راست هم‌رنگ.
        </p>
      </section>
    </div>
  );
}
