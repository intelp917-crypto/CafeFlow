import { useState } from 'react';
import { Crown, Sparkles } from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';
import { PlayingCard, type CardValue } from '../shared/PlayingCard';

const PLAY_NAMES: Record<string, string> = {
  single: 'تک',
  pair: 'جفت',
  triple: 'سه‌تایی',
  triple_one: 'سه‌تایی + تک',
  triple_two: 'سه‌تایی + جفت',
  straight: 'راست',
  consecutive_pairs: 'جفت‌های پشت‌سرهم',
  plane: 'سه‌تایی‌های پشت‌سرهم',
  plane_wings_1: 'هواپیما با بال تک',
  plane_wings_2: 'هواپیما با بال جفت',
  four_two: 'چهار + دو تک',
  four_two_pairs: 'چهار + دو جفت',
  bomb: 'بمب!',
  rocket: 'موشک!',
};

interface LastPlay {
  player: number;
  cards: CardValue[];
  play: { type: string };
}

/**
 * زمیندار — three seats, one landlord, and a bidding phase before the first card.
 *
 * The room is exactly three players; the bottom cards stay face-down until the
 * engine hands them to the landlord, and only then does the real game start.
 */
export function DouDizhu({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [picked, setPicked] = useState<string[]>([]);

  const gamePhase = (state.phase as string) ?? 'bidding';
  const callPhase = (state.callPhase as string) ?? 'call';
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const currentBidder = (state.currentBidder as number) ?? 0;
  const landlord = (state.landlord as number | null) ?? null;
  const winner = (state.winner as number | null) ?? null;
  const hands = (state.hands as Array<CardValue[] | null> | undefined) ?? [];
  const hand = hands[mySeat] ?? [];
  const bottom = (state.bottomCards as Array<CardValue | null> | undefined) ?? [];
  const lastPlay = (state.lastPlay as LastPlay | null) ?? null;
  const passed = (state.passed as boolean[]) ?? [];
  const cumulative = (state.cumulativeScore as number[]) ?? [];
  const multiplier = (state.gameMultiplier as number) ?? 1;
  const currentBid = (state.currentBid as number) ?? 0;
  const eligible = (state.eligibleForRob as boolean[]) ?? [];

  const bidding = phase === 'playing' && gamePhase === 'bidding';
  const myBidTurn = bidding && currentBidder === mySeat && winner === null;
  const myTurn = phase === 'playing' && gamePhase === 'playing' && currentPlayer === mySeat && winner === null;
  const canPass = myTurn && Boolean(lastPlay) && lastPlay!.player !== mySeat;
  const activeSeat = bidding ? currentBidder : currentPlayer;

  const selected = picked.filter((id) => hand.some((card) => card.id === id));

  const toggle = (id: string) => {
    setPicked((current) => (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]));
  };

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null ? null : activeSeat}
        hint={
          winner !== null
            ? 'دست تمام شد'
            : bidding
              ? myBidTurn
                ? callPhase === 'call'
                  ? 'زمیندار می‌شوید یا صبر می‌کنید؟'
                  : 'زمیندار را می‌زنید؟'
                : `منتظر پیشنهاد ${seatName(seats, currentBidder)}`
              : myTurn
                ? canPass
                  ? 'ترکیبی بزنید که بزرگ‌تر باشد یا پاس بدهید'
                  : 'شما زمین‌بازی را شروع می‌کنید'
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
          winner === -2
            ? 'زمیندار برد'
            : winner === -3
              ? 'دو روستایی بردند'
              : winner !== null
                ? `${seatName(seats, winner)} برنده شد`
                : undefined
        }
      >
        <p className="mt-1 text-[11px] text-muted">
          ضریب دست: ×{formatCountFa(multiplier)} — امتیازها در جدول پایین جمع می‌شوند.
        </p>
      </ResultOverlay>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted">کارت‌های زمین</p>
            {landlord !== null ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] text-brand-800">
                <Crown aria-hidden className="size-3" />
                {seatName(seats, landlord)}
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {bottom.map((card, index) =>
              card ? (
                <PlayingCard key={card.id} card={card} size="sm" />
              ) : (
                <PlayingCard
                  key={`bottom-${index}`}
                  card={{ id: `bottom-${index}`, rank: '2', suit: 's' }}
                  faceDown
                  size="sm"
                />
              ),
            )}
          </div>
          <p className="mt-2 text-[10px] text-muted">
            {landlord === null ? 'کارت‌های زمین بعد از تعیین زمیندار رو می‌شوند.' : 'کارت‌های اضافهٔ زمیندار.'}
          </p>
        </div>

        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="mb-1.5 text-[10px] text-muted">بازیکنان</p>
          <ul className="space-y-1">
            {seats.map((seat) => (
              <li key={seat.index} className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-ink/80">
                  {seat.nameFa}
                  {landlord === seat.index ? <Crown aria-label="زمیندار" className="size-3 text-brand-700" /> : null}
                  {passed[seat.index] ? <span className="text-[9px] text-muted">پاس</span> : null}
                </span>
                <span className="num text-muted">
                  {formatCountFa(hands[seat.index]?.length ?? 0)} کارت
                  <span className="mr-2 font-semibold text-ink">{formatCountFa(cumulative[seat.index] ?? 0)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {bidding ? (
        <div className="rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="text-xs text-ink">
            {callPhase === 'call'
              ? 'مرحلهٔ اول: زمیندار را صدا بزنید.'
              : 'مرحلهٔ دوم: هر کس بخواهد زمیندارِ صدا زده‌شده را بزند و جایش را بگیرد.'}
            {currentBid > 0 ? ` پیشنهاد فعلی: ${formatCountFa(currentBid)}.` : ''}
          </p>
          {myBidTurn ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {callPhase === 'call' ? (
                <>
                  <button
                    type="button"
                    onClick={() => onMove({ call: true })}
                    className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    زمیندار می‌شوم
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove({ pass: true })}
                    className="min-h-11 rounded-full border border-line bg-surface px-5 text-xs font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    نمی‌خواهم
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onMove({ rob: true })}
                    disabled={!eligible[mySeat]}
                    className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    می‌زنم
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove({ passRob: true })}
                    className="min-h-11 rounded-full border border-line bg-surface px-5 text-xs font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    نمی‌زنم
                  </button>
                </>
              )}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-muted">منتظر پاسخ {seatName(seats, currentBidder)} باشید.</p>
          )}
        </div>
      ) : null}

      <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
        <p className="mb-1.5 text-[10px] text-muted">آخرین زمین‌بازی</p>
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

      <section aria-label="دست شما" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted">دست شما ({formatCountFa(hand.length)} کارت)</p>
          <p className="inline-flex items-center gap-1 text-[10px] text-brand-700">
            <Sparkles aria-hidden className="size-3" />
            ضریب ×{formatCountFa(multiplier)}
          </p>
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
          {hand.length === 0 ? <p className="text-[11px] text-muted">کارتی در دست ندارید.</p> : null}
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
        <p className="text-[10px] text-muted">
          تک، جفت، سه‌تایی، راست، جفت‌های پشت‌سرهم، هواپیما، چهار+دو و بمب/موشک مجاز است.
        </p>
        {selected.length > 0 ? (
          <p className={cn('text-[10px]', 'text-brand-700')} role="status">
            {formatCountFa(selected.length)} کارت انتخاب شده است.
          </p>
        ) : null}
      </section>
    </div>
  );
}
