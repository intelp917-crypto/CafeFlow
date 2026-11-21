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
  pairs: 'جفت‌های پشت‌سرهم',
  plane: 'هواپیما',
  bomb: 'بمب!',
};

const RANK_FA: Record<string, string> = {
  '3': 'سه',
  '4': 'چهار',
  '5': 'پنج',
  '6': 'شش',
  '7': 'هفت',
  '8': 'هشت',
  '9': 'نُه',
  '10': 'ده',
  J: 'سرباز',
  Q: 'بی‌بی',
  K: 'شاه',
  A: 'آس',
  '2': 'دو',
};

const SUIT_FA: Record<string, string> = { s: 'پیک', h: 'دل', c: 'خاج', d: 'خشت' };

function cardLabel(id: string): string {
  const suit = id.slice(-1);
  const rank = id.slice(0, -1);
  const rankFa = RANK_FA[rank] ?? rank;
  const suitFa = SUIT_FA[suit];
  return suitFa ? `${rankFa} ${suitFa}` : id;
}

interface LastPlay {
  player: number;
  cards: CardValue[];
  play: { type: string; length: number; size: number };
}

interface RoundResult {
  winner: number;
  remaining: CardValue[][];
  spring: boolean[];
  scores: number[];
  bombs: number[];
}

/**
 * پائو دِه‌کوآی — two or three seats climb until one empties their hand; the
 * round scores by cards left, a player who never played pays double, and a
 * match runs three rounds. The engine holds those rules; this screen makes the
 * opening card, the last play to beat and the between-round pause visible.
 */
export function Paodekuai({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [picked, setPicked] = useState<string[]>([]);

  const gamePhase = (state.phase as string) ?? 'playing';
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const winner = (state.winner as number | null) ?? null;
  const hands = (state.hands as Array<CardValue[] | null> | undefined) ?? [];
  const hand = hands[mySeat] ?? [];
  const lastPlay = (state.lastPlay as LastPlay | null) ?? null;
  const passed = (state.passed as boolean[]) ?? [];
  const oneCard = (state.oneCard as boolean[]) ?? [];
  const firstCard = (state.firstCard as string | null) ?? null;
  const round = (state.currentRound as number) ?? 1;
  const rounds = (state.totalRounds as number) ?? 3;
  const cumulative = (state.cumulativeScore as number[]) ?? [];
  const roundResult = (state.roundResult as RoundResult | null) ?? null;

  const roundOver = gamePhase === 'roundEnd';
  const matchOver = gamePhase === 'matchEnd' || winner !== null;
  const myTurn = phase === 'playing' && gamePhase === 'playing' && currentPlayer === mySeat && winner === null;
  const canPass = myTurn && Boolean(lastPlay) && lastPlay!.player !== mySeat;
  const selected = picked.filter((id) => hand.some((card) => card.id === id));
  const remaining = roundResult?.remaining ?? [];

  const toggle = (id: string) => {
    setPicked((current) => (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]));
  };

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={matchOver ? null : currentPlayer}
        hint={
          matchOver
            ? 'مسابقه تمام شد'
            : roundOver
              ? 'دور تمام شد؛ برای دور بعد آماده شوید'
              : myTurn
                ? firstCard
                  ? `اولین حرکت باید ${cardLabel(firstCard)} را داشته باشد`
                  : canPass
                    ? 'ترکیبی بزنید که بزرگ‌تر باشد یا پاس بدهید'
                    : 'شما زمین‌بازی را شروع می‌کنید'
                : `نوبت ${seatName(seats, currentPlayer)} است`
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-2.5 text-[11px]">
        <p className="text-muted">
          دور {formatCountFa(round)} از {formatCountFa(rounds)}
        </p>
        {roundResult ? (
          <p className="text-ink/80">دور را {seatName(seats, roundResult.winner)} برد.</p>
        ) : null}
      </div>

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          {seats
            .map((seat) => `${seat.nameFa}: ${formatCountFa(cumulative[seat.index] ?? 0)}`)
            .join(' · ')}
        </p>
      </ResultOverlay>

      <div className="grid gap-2 sm:grid-cols-2">
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

        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="mb-1.5 text-[10px] text-muted">بازیکنان</p>
          <ul className="space-y-1">
            {seats.map((seat) => (
              <li key={seat.index} className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-ink/80">
                  {seat.nameFa}
                  {passed[seat.index] ? <span className="text-[9px] text-muted">پاس</span> : null}
                  {oneCard[seat.index] && !roundOver ? (
                    <span className="rounded-full bg-brand-50 px-1.5 text-[9px] text-brand-800">یک کارت</span>
                  ) : null}
                </span>
                <span className="num text-muted">
                  {formatCountFa(
                    roundOver ? (remaining[seat.index]?.length ?? 0) : (hands[seat.index]?.length ?? 0),
                  )}{' '}
                  کارت
                  <span className="mr-2 font-semibold text-ink">{formatCountFa(cumulative[seat.index] ?? 0)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {roundOver && roundResult ? (
        <div className="space-y-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="text-xs font-semibold text-ink">
            دستِ {formatCountFa(round)} تمام شد — {seatName(seats, roundResult.winner)} بیرون آمد.
          </p>
          <ul className="space-y-1">
            {seats.map((seat) => (
              <li key={seat.index} className="flex items-center justify-between text-[11px] text-ink/80">
                <span>
                  {seat.nameFa}
                  {roundResult.spring[seat.index] ? <span className="mr-1.5 text-[9px] text-brand-700">دست‌نخورده (×۲)</span> : null}
                </span>
                <span className="num">
                  {formatCountFa(roundResult.remaining[seat.index]?.length ?? 0)} کارت مانده
                  <span className="mr-2 font-semibold text-ink">
                    {roundResult.scores[seat.index] > 0 ? '+' : ''}
                    {formatCountFa(roundResult.scores[seat.index] ?? 0)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {phase === 'playing' ? (
            <button
              type="button"
              onClick={() => onMove({ action: 'next_round' })}
              className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              دور بعد
            </button>
          ) : null}
        </div>
      ) : null}

      {!roundOver && firstCard ? (
        <p className="rounded-2xl border border-brand-300 bg-brand-50 px-4 py-2.5 text-[11px] text-brand-800">
          اولین حرکت این مسابقه باید {cardLabel(firstCard)} داشته باشد.
        </p>
      ) : null}

      <section aria-label="دست شما" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted">دست شما ({formatCountFa(hand.length)} کارت)</p>
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
              onMove({ cards: [] });
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
        <p className={cn('text-[10px] text-muted')}>
          تک، جفت، سه‌تایی، راست، جفت‌های پشت‌سرهم، هواپیما و بمب مجاز است.
        </p>
      </section>
    </div>
  );
}
