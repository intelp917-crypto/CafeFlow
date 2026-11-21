import { useState } from 'react';
import { Crosshair } from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';

const SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', c: '♣', d: '♦' };
const RANK_FA: Record<string, string> = { J: 'سرباز', Q: 'بی‌بی', K: 'شاه' };
const SUIT_FA: Record<string, string> = { s: 'پیک', h: 'دل', c: 'گشنیز', d: 'خشت' };

interface BarCard {
  rank: string;
  suit: string;
  id: string;
}

function cardName(card: BarCard): string {
  if (card.suit === 'ghost') return 'کارت روح';
  if (card.suit === 'wild') return 'کارت وحشی';
  return `${RANK_FA[card.rank] ?? card.rank} ${SUIT_FA[card.suit] ?? ''}`;
}

function CardChip({ card, small }: { card: BarCard; small?: boolean }) {
  const ghost = card.suit === 'ghost';
  const wild = card.suit === 'wild';
  return (
    <span
      aria-label={cardName(card)}
      className={cn(
        'inline-flex flex-col items-center justify-center rounded-lg border bg-surface leading-none',
        small ? 'h-9 w-7 text-[10px]' : 'h-12 w-9 text-xs',
        ghost || wild ? 'border-brand-400 text-brand-700' : 'border-line text-ink',
      )}
    >
      <span className="num font-bold">
        {ghost ? 'روح' : wild ? '★' : card.rank}
      </span>
      <span aria-hidden className={cn('mt-0.5', small ? 'text-[9px]' : 'text-[11px]')}>
        {ghost || wild ? 'وحشی' : (SUIT_SYMBOL[card.suit] ?? '')}
      </span>
    </span>
  );
}

interface Claim {
  playerIndex: number;
  count: number;
  claimedRank: string;
}

/**
 * میخانهٔ دروغگو — play one to three cards face down as the round's rank, then
 * call the last claim a lie. A failed challenge ends in a round of Russian
 * roulette. The engine hides hands and the bullet chambers; the screen only
 * shows the pile size, the revealed cards after a challenge, and who is due to
 * pull the trigger.
 */
export function LiarsBar({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [picked, setPicked] = useState<string[]>([]);

  const gamePhase = (state.phase as string) ?? 'playing';
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const winner = (state.winner as number | null) ?? null;
  const hands = (state.hands as Array<BarCard[] | null> | undefined) ?? [];
  const hand = (hands[mySeat] ?? []).filter((card): card is BarCard => Boolean(card));
  const themeRank = (state.themeRank as string) ?? 'J';
  const alive = (state.alive as boolean[]) ?? [];
  const pileCards = (state.pileCards as unknown[] | undefined) ?? [];
  const claims = (state.pileClaims as Claim[] | undefined) ?? [];
  const lastClaimant = (state.lastClaimant as number) ?? -1;
  const revealed = (state.revealedPile as BarCard[] | null) ?? null;
  const shootQueue = (state.shootQueue as number[] | undefined) ?? [];
  const currentShooter = (state.currentShooter as number) ?? -1;
  const lastShots = (state.lastShotResults as Array<{ player: number; dead: boolean; firedCount: number }> | undefined) ?? [];
  const firedShots = (state.firedShots as number[]) ?? [];

  const shooting = gamePhase === 'shooting';
  const out = alive[mySeat] === false;
  const myTurn = phase === 'playing' && gamePhase === 'playing' && currentPlayer === mySeat && !out && winner === null;
  const myShot = shooting && currentShooter === mySeat;
  const canSuspect = phase === 'playing' && gamePhase === 'playing' && !out && lastClaimant >= 0 && lastClaimant !== mySeat;
  const selected = picked.filter((id) => hand.some((card) => card.id === id));

  const toggle = (id: string) => {
    setPicked((current) => {
      if (current.includes(id)) return current.filter((candidate) => candidate !== id);
      if (current.length >= 3) return current;
      return [...current, id];
    });
  };

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null ? null : shooting ? currentShooter : currentPlayer}
        hint={
          winner !== null
            ? 'بازی تمام شد'
            : out
              ? 'شما بیرون هستید؛ تماشاگر باشید'
              : shooting
                ? myShot
                  ? 'ماشه را بکشید'
                  : `منتظر شلیک ${seatName(seats, currentShooter)}`
                : myTurn
                  ? `یک تا سه کارت را به‌عنوان ${RANK_FA[themeRank] ?? themeRank} بازی کنید`
                  : 'منتظر نوبت حریف'
        }
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">آخرین بازمانده برنده است.</p>
      </ResultOverlay>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="mb-1.5 text-[10px] text-muted">رتبهٔ این دور</p>
          <p className="font-display text-lg font-bold text-ink">{RANK_FA[themeRank] ?? themeRank}</p>
          <p className="mt-1 text-[10px] text-muted">
            روی میز {formatCountFa(pileCards.length)} کارت · آخرین ادعا:{' '}
            {lastClaimant >= 0 ? seatName(seats, lastClaimant) : 'هنوز کسی ادعا نکرده'}
          </p>
          {claims.length > 0 ? (
            <p className="mt-1 text-[10px] text-muted">
              ادعاها: {claims.map((claim) => `${seatName(seats, claim.playerIndex)} ×${formatCountFa(claim.count)}`).join(' · ')}
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="mb-1.5 text-[10px] text-muted">بازیکنان</p>
          <ul className="space-y-1">
            {seats.map((seat) => (
              <li key={seat.index} className="flex items-center justify-between text-[11px]">
                <span className={cn('flex items-center gap-1.5', alive[seat.index] === false ? 'text-muted line-through' : 'text-ink/80')}>
                  {seat.nameFa}
                  {alive[seat.index] === false ? <span className="text-[9px] no-underline">بیرون</span> : null}
                </span>
                <span className="num text-muted">
                  {formatCountFa(hands[seat.index]?.length ?? 0)} کارت
                  <span className="mr-2">{formatCountFa(firedShots[seat.index] ?? 0)} شلیک</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {shooting ? (
        <div className="space-y-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="text-xs text-ink">
            {shootQueue.length > 0
              ? `شلیک برای ${shootQueue.map((seat) => seatName(seats, seat)).join(' و ')} — هر نفر یک بار ماشه را می‌کشد.`
              : 'شلیک‌ها شروع شد.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onMove({ action: 'shoot' })}
              disabled={!myShot}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand-600 px-5 text-xs font-bold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <Crosshair aria-hidden className="size-4" />
              ماشه را بکش
            </button>
            <p className="text-[10px] text-muted">
              صف شلیک: {shootQueue.length > 0 ? shootQueue.map((seat) => seatName(seats, seat)).join(' → ') : '—'}
            </p>
          </div>
          {lastShots.length > 0 ? (
            <ul className="space-y-1 text-[11px] text-ink/80">
              {lastShots.map((shot, index) => (
                <li key={`${shot.player}-${index}`}>
                  {seatName(seats, shot.player)} — شلیک {formatCountFa(shot.firedCount)}:{' '}
                  {shot.dead ? 'بیرون رفت' : 'خالی بود'}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {revealed ? (
        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="mb-1.5 text-[10px] text-muted">کارت‌های رو‌شدهٔ میز</p>
          <div className="flex flex-wrap gap-1.5">
            {revealed.map((card, index) => (
              <CardChip key={`${card.id}-${index}`} card={card} small />
            ))}
          </div>
        </div>
      ) : null}

      <section aria-label="دست شما" className="space-y-2">
        <p className="text-[11px] text-muted">دست شما ({formatCountFa(hand.length)} کارت)</p>
        <div className="flex flex-wrap gap-1.5">
          {hand.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => toggle(card.id)}
              disabled={!myTurn}
              aria-pressed={picked.includes(card.id)}
              className={cn(
                'min-h-11 rounded-xl border p-0.5 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                picked.includes(card.id) ? 'border-brand-500 bg-brand-50' : 'border-transparent',
              )}
            >
              <CardChip card={card} />
            </button>
          ))}
          {hand.length === 0 ? <p className="text-[11px] text-muted">کارتی در دست ندارید.</p> : null}
        </div>
        <p className="text-[10px] text-muted">وحشی هر رتبه‌ای حساب می‌شود؛ کارت روح همه را به شلیک می‌برد.</p>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              onMove({ action: 'play', cardIds: selected });
              setPicked([]);
            }}
            disabled={!myTurn || selected.length === 0}
            className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white transition-colors enabled:hover:bg-brand-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            بازی به‌عنوان {RANK_FA[themeRank] ?? themeRank}
          </button>
          <button
            type="button"
            onClick={() => {
              onMove({ action: 'suspect' });
              setPicked([]);
            }}
            disabled={!canSuspect}
            className="min-h-11 rounded-full border border-line bg-surface px-5 text-xs font-semibold text-ink transition-colors enabled:hover:border-brand-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            دروغ می‌گوید!
          </button>
          {selected.length > 0 ? (
            <button type="button" onClick={() => setPicked([])} className="min-h-11 rounded-full px-4 text-[11px] text-muted">
              پاک کردن
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
