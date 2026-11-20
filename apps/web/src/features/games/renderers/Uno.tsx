import { useState } from 'react';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';
import { formatCountFa } from '../../../lib/format';

interface UnoCard {
  id: string;
  color: 'red' | 'blue' | 'green' | 'yellow' | 'wild';
  value: string;
}

const COLOR_CLASSES: Record<string, string> = {
  red: 'bg-[#b23b2a] text-cream',
  blue: 'bg-[#2f6c8c] text-cream',
  green: 'bg-[#417650] text-cream',
  yellow: 'bg-[#c9a227] text-espresso',
  wild: 'bg-espresso text-cream',
};

const COLOR_NAMES: Record<string, string> = {
  red: 'قرمز',
  blue: 'آبی',
  green: 'سبز',
  yellow: 'زرد',
};

const VALUE_NAMES: Record<string, string> = {
  skip: 'رد',
  reverse: 'برگشت',
  wild: 'رنگ',
  '+2': '۲+',
  '+4': '۴+',
};

function cardLabel(card: UnoCard): string {
  if (card.value in VALUE_NAMES) return VALUE_NAMES[card.value]!;
  return formatCountFa(Number(card.value));
}

function CardFace({
  card,
  onClick,
  disabled,
  small = false,
}: {
  card: UnoCard;
  onClick?: () => void;
  disabled?: boolean;
  small?: boolean;
}) {
  const content = (
    <>
      <span className="font-display text-lg font-bold leading-none">{cardLabel(card)}</span>
      {card.color === 'wild' ? <span className="mt-1 text-[9px] opacity-80">هر رنگ</span> : null}
    </>
  );
  const className = `${COLOR_CLASSES[card.color] ?? COLOR_CLASSES.wild} ${
    small ? 'h-14 w-10 text-xs' : 'h-24 w-16'
  } flex flex-col items-center justify-center rounded-xl border-2 border-cream/70 shadow-[0_10px_20px_-14px_rgba(36,22,17,0.9)] transition-transform duration-150`;

  if (!onClick) {
    return <span className={className}>{content}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`کارت ${cardLabel(card)}${card.color === 'wild' ? '' : ` ${COLOR_NAMES[card.color] ?? ''}`}`}
      className={`${className} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 enabled:hover:-translate-y-1 disabled:opacity-55 motion-reduce:transform-none`}
    >
      {content}
    </button>
  );
}

/**
 * اونو — the only game here where the phone must hide something.
 *
 * The hand shown is always this seat's own: the server masks every other hand and
 * the draw pile before the state ever reaches the browser.
 */
export function Uno({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [pendingWild, setPendingWild] = useState<string | null>(null);
  const myHand = (state.hands?.[mySeat] ?? []) as UnoCard[];
  const discard = (state.discard ?? []) as UnoCard[];
  const top = discard[0];
  const currentPlayer = state.currentPlayer as number;
  const currentColor = (state.currentColor as string) ?? top?.color ?? 'red';
  const drawStack = (state.drawStack as number) ?? 0;
  const winner = state.winner as number | null;
  const pending = state.pendingChallenge as { target: number; by: number } | null;
  const myTurn = phase === 'playing' && currentPlayer === mySeat;
  const challengeTarget = pending?.target === mySeat;
  const calledUno = (state.unoCalled?.[mySeat] as boolean) ?? true;

  const playCard = (card: UnoCard) => {
    if (card.color === 'wild' && !card.value.includes('+')) {
      setPendingWild(card.id);
      return;
    }
    onMove({ cardId: card.id });
  };

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null && winner !== undefined ? null : pending ? pending.target : currentPlayer}
        hint={
          pending
            ? challengeTarget
              ? '۴+ روی شماست: بپذیرید یا اعتراض کنید'
              : 'منتظر پاسخ بازیکن ۴+ باشید'
            : myTurn
              ? 'یک کارت هم‌رنگ یا هم‌عدد بیندازید'
              : 'نوبت حریف است'
        }
      />

      <ResultOverlay
        seats={seats}
        winner={winner}
        phase={phase}
        canRestart={canRestart}
        onRestart={onRestart}
      >
        <p className="mt-1 text-[11px] text-muted">
          {winner !== null && winner !== undefined && winner >= 0
            ? `${seatName(seats, winner)} همهٔ کارت‌هایش را انداخت.`
            : 'دست تمام شد.'}
        </p>
      </ResultOverlay>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line/70 bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted">روی زمین</span>
          {top ? <CardFace card={top} small /> : null}
          <div className="space-y-1 text-[11px] text-ink/80">
            <p>
              رنگ فعلی:{' '}
              <span className={`inline-block size-2.5 rounded-full align-middle ${
                currentColor === 'red'
                  ? 'bg-[#b23b2a]'
                  : currentColor === 'blue'
                    ? 'bg-[#2f6c8c]'
                    : currentColor === 'green'
                      ? 'bg-[#417650]'
                      : 'bg-[#c9a227]'
              }`} />{' '}
              {COLOR_NAMES[currentColor] ?? '—'}
            </p>
            {drawStack > 0 ? <p className="num text-brand-700">جریمهٔ روی میز: {formatCountFa(drawStack)}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onMove({})}
            disabled={!myTurn || Boolean(pending)}
            className="min-h-11 rounded-full border border-line bg-surface px-4 text-[11px] font-semibold text-ink transition-colors enabled:hover:border-brand-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            {drawStack > 0 ? `کشیدن ${formatCountFa(drawStack)} کارت` : 'کارت کشیدن'}
          </button>
          {myHand.length === 1 && !calledUno ? (
            <button
              type="button"
              onClick={() => onMove({ uno: true })}
              disabled={!myTurn}
              className="min-h-11 rounded-full bg-brand-600 px-4 text-[11px] font-bold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              اونو!
            </button>
          ) : null}
        </div>
      </div>

      {pending && challengeTarget ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-brand-300 bg-brand-50 px-4 py-3">
          <p className="text-xs text-ink">۴+ برای شما آمده؛ جریمه را می‌کشید یا اعتراض می‌کنید؟</p>
          <button
            type="button"
            onClick={() => onMove({ challengeResponse: 'accept' })}
            className="min-h-11 rounded-full border border-line bg-surface px-4 text-[11px] font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            می‌کشم
          </button>
          <button
            type="button"
            onClick={() => onMove({ challengeResponse: 'challenge' })}
            className="min-h-11 rounded-full bg-espresso px-4 text-[11px] font-semibold text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            اعتراض
          </button>
        </div>
      ) : null}

      {pendingWild ? (
        <div className="rounded-2xl border border-line/70 bg-surface p-3">
          <p className="mb-2 text-xs text-ink">رنگ بعدی را انتخاب کنید:</p>
          <div className="flex flex-wrap gap-2">
            {Object.keys(COLOR_NAMES).map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => {
                  onMove({ cardId: pendingWild, chosenColor: color });
                  setPendingWild(null);
                }}
                className={`min-h-11 rounded-full px-4 text-[11px] font-semibold ${COLOR_CLASSES[color]}`}
              >
                {COLOR_NAMES[color]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPendingWild(null)}
              className="min-h-11 rounded-full border border-line px-4 text-[11px] text-muted"
            >
              انصراف
            </button>
          </div>
        </div>
      ) : null}

      <section aria-label="دست شما" className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted">دست شما ({formatCountFa(myHand.length)} کارت)</p>
          <p className="text-[11px] text-muted">
            {seats
              .filter((seat) => !seat.isYou)
              .map((seat) => `${seat.nameFa}: ${formatCountFa((state.hands?.[seat.index] ?? []).length)}`)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {myHand.map((card) => (
            <CardFace
              key={card.id}
              card={card}
              disabled={!myTurn || Boolean(pending) || phase !== 'playing'}
              onClick={() => playCard(card)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
