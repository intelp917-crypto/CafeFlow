import { useState } from 'react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';
import { PlayingCard, cardName, type CardValue } from '../shared/PlayingCard';

const DIRECTION_FA: Record<string, string> = {
  left: 'به چپ',
  right: 'به راست',
  across: 'رودررو',
  none: 'بدون رد کردن',
};

/** دل — four seats, thirteen tricks, and every heart costs a point. */
export function Hearts({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [picked, setPicked] = useState<string[]>([]);

  const gamePhase = (state.phase as string) ?? 'passing';
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const winner = (state.winner as number | null) ?? null;
  const hand = (state.myHand as CardValue[]) ?? [];
  const handSizes = (state.handSizes as number[]) ?? [];
  const trick = (state.currentTrick as Array<{ player: number; card: CardValue }>) ?? [];
  const lastTrick = (state.lastTrick as Array<{ player: number; card: CardValue }> | null) ?? null;
  const scores = (state.scores as number[]) ?? [0, 0, 0, 0];
  const roundScores = (state.roundScores as number[]) ?? [0, 0, 0, 0];
  const myPassCards = (state.myPassCards as string[] | null) ?? null;
  const passDirection = (state.passDirection as string) ?? 'left';
  const passRound = (state.passRound as number) ?? 0;
  const round = (state.round as number) ?? 1;
  const targetScore = (state.targetScore as number) ?? 100;
  const myTurn = phase === 'playing' && gamePhase === 'playing' && currentPlayer === mySeat;

  const toggle = (id: string) => {
    setPicked((current) =>
      current.includes(id) ? current.filter((candidate) => candidate !== id) : current.length >= 3 ? current : [...current, id],
    );
  };

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={gamePhase === 'passing' ? null : winner !== null ? null : currentPlayer}
        hint={
          gamePhase === 'over'
            ? 'دست تمام شد'
            : gamePhase === 'passing'
              ? myPassCards
                ? 'سه کارت شما رد شد؛ منتظر بقیه باشید'
                : `سه کارت را ${DIRECTION_FA[passDirection] ?? ''} رد کنید`
              : state.heartsBroken
                ? 'دل شکسته شد؛ حالا می‌توانید با دل شروع کنید'
                : 'یک کارت هم‌خال بیندازید'
        }
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          بازی تا {formatCountFa(targetScore)} امتیاز منفی ادامه داشت؛ کمترین امتیاز برنده است.
        </p>
      </ResultOverlay>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="text-[10px] text-muted">دور {formatCountFa(round)} — دست {formatCountFa((state.trickCount as number) ?? 0)} از ۱۳</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {trick.length === 0 ? (
              <p className="text-[11px] text-muted">هنوز کارتی روی میز نیست.</p>
            ) : (
              trick.map((entry) => (
                <div key={`${entry.player}-${entry.card.id}`} className="flex flex-col items-center gap-1">
                  <PlayingCard card={entry.card} size="sm" />
                  <span className="max-w-14 truncate text-[9px] text-muted">{seatName(seats, entry.player)}</span>
                </div>
              ))
            )}
          </div>
          {lastTrick && trick.length === 0 ? (
            <p className="mt-2 text-[10px] text-muted">
              دست قبل: {seatName(seats, lastTrick[lastTrick.length - 1]!.player)} با{' '}
              {cardName(lastTrick[lastTrick.length - 1]!.card)} برد.
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="mb-1.5 text-[10px] text-muted">امتیازها (کمتر بهتر)</p>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-muted">
                <th className="text-right font-normal">بازیکن</th>
                <th className="text-left font-normal">این دور</th>
                <th className="text-left font-normal">کل</th>
              </tr>
            </thead>
            <tbody>
              {seats.map((seat) => (
                <tr key={seat.index} className={cn(seat.index === mySeat ? 'text-ink' : 'text-ink/80')}>
                  <td className="py-0.5">{seat.nameFa}</td>
                  <td className="num text-left">{formatCountFa(roundScores[seat.index] ?? 0)}</td>
                  <td className="num text-left font-semibold">{formatCountFa(scores[seat.index] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {gamePhase === 'passing' && !myPassCards ? (
        <div className="space-y-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="text-xs text-ink">
            سه کارت انتخاب کنید تا {DIRECTION_FA[passDirection] ?? ''} رد شوند ({formatCountFa(picked.length)} از ۳)
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onMove({ cards: picked })}
              disabled={picked.length !== 3}
              className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              رد کردن این سه کارت
            </button>
            <button
              type="button"
              onClick={() => onMove({ pass: true })}
              className="min-h-11 rounded-full border border-line bg-surface px-4 text-[11px] font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              انتخاب خودکار
            </button>
            {picked.length > 0 ? (
              <button
                type="button"
                onClick={() => setPicked([])}
                className="min-h-11 rounded-full px-4 text-[11px] text-muted"
              >
                پاک کردن
              </button>
            ) : null}
          </div>
          <p className="text-[10px] text-muted">
            دور {formatCountFa(passRound + 1)} از چرخهٔ رد کردن؛ همه می‌توانند هم‌زمان کارت‌هایشان را بفرستند.
          </p>
        </div>
      ) : null}

      {myPassCards ? (
        <p className="rounded-2xl border border-line/70 bg-canvas px-4 py-2.5 text-[11px] text-muted">
          سه کارت شما ثبت شد. وقتی همه بفرستند، بازی شروع می‌شود.
        </p>
      ) : null}

      <section aria-label="دست شما" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted">
            دست شما ({formatCountFa(hand.length)} کارت)
          </p>
          <p className="text-[10px] text-muted">
            {seats
              .filter((seat) => seat.index !== mySeat)
              .map((seat) => `${seat.nameFa}: ${formatCountFa(handSizes[seat.index] ?? 0)}`)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {hand.map((card) => (
            <PlayingCard
              key={card.id}
              card={card}
              selected={picked.includes(card.id)}
              disabled={gamePhase === 'passing' ? myPassCards !== null : !myTurn}
              onClick={() => (gamePhase === 'passing' ? toggle(card.id) : onMove({ card: card.id }))}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
