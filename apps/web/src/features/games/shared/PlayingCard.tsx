import type { ReactNode } from 'react';
import { Ghost, Sparkles } from 'lucide-react';
import { cn } from '@cafeflow/ui';

/**
 * One playing card, shared by every card table.
 *
 * The rank is the only thing a guest compares across games, so it stays in the
 * same corner and the same size everywhere; a hidden card is a pattern, never
 * an empty box, or a hand of five looks like a hand of zero.
 */
export interface CardValue {
  id: string;
  rank: string;
  suit: string;
}

const SUIT_SYMBOLS: Record<string, string> = { s: '♠', h: '♥', c: '♣', d: '♦' };
const SUIT_NAMES: Record<string, string> = {
  s: 'پیک',
  h: 'دل',
  c: 'گشنیز',
  d: 'خشت',
};
const RANK_LABELS: Record<string, string> = {
  '2': '۲',
  '3': '۳',
  '4': '۴',
  '5': '۵',
  '6': '۶',
  '7': '۷',
  '8': '۸',
  '9': '۹',
  '10': '۱۰',
};

function rankLabel(rank: string): string {
  return RANK_LABELS[rank] ?? rank;
}

export function cardName(card: CardValue): string {
  if (card.rank === '👻') return 'دوشیزه';
  if (card.rank === '小王') return 'جوکر کوچک';
  if (card.rank === '大王') return 'جوکر بزرگ';
  if (!card.suit) return rankLabel(card.rank);
  return `${rankLabel(card.rank)} ${SUIT_NAMES[card.suit] ?? ''}`.trim();
}

function cardFace(card: CardValue): ReactNode {
  if (card.rank === '👻') {
    return (
      <>
        <Ghost aria-hidden className="size-5 text-brand-700" />
        <span className="mt-1 text-[9px] font-semibold text-brand-800">دوشیزه</span>
      </>
    );
  }
  if (card.rank === '小王' || card.rank === '大王') {
    return (
      <>
        <Sparkles aria-hidden className="size-4 text-brand-700" />
        <span className="mt-0.5 text-[9px] font-semibold text-espresso">جوکر</span>
        <span className="text-[8px] text-muted">{card.rank === '大王' ? 'بزرگ' : 'کوچک'}</span>
      </>
    );
  }
  return (
    <>
      <span className="font-display text-sm font-bold leading-none">{rankLabel(card.rank)}</span>
      <span className="mt-0.5 text-base leading-none">{SUIT_SYMBOLS[card.suit] ?? '·'}</span>
    </>
  );
}

export function PlayingCard({
  card,
  faceDown = false,
  selected = false,
  disabled = false,
  onClick,
  size = 'md',
  className,
  label,
}: {
  card: CardValue;
  faceDown?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md';
  className?: string;
  /** Overrides the accessible name, e.g. "کارت سوم رضا". */
  label?: string;
}) {
  const red = card.suit === 'h' || card.suit === 'd';
  const base = cn(
    'flex shrink-0 select-none flex-col items-center justify-center rounded-xl border-2 shadow-[0_8px_16px_-12px_rgba(36,22,17,0.9)] transition-transform duration-150 motion-reduce:transform-none',
    size === 'sm' ? 'h-16 w-11' : 'h-24 w-16',
    faceDown
      ? 'border-line bg-[repeating-linear-gradient(135deg,#efe4da_0px,#efe4da_6px,#e3d3c6_6px,#e3d3c6_12px)] text-transparent'
      : red
        ? 'border-cream bg-surface text-[#b23b2a]'
        : 'border-cream bg-surface text-espresso',
    selected ? '-translate-y-1.5 border-brand-500 ring-2 ring-brand-300' : '',
    className,
  );

  if (!onClick) {
    return (
      <span className={base} aria-hidden={faceDown ? true : undefined}>
        {faceDown ? null : cardFace(card)}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label ?? (faceDown ? 'کارت پنهان' : `کارت ${cardName(card)}`)}
      aria-pressed={selected}
      className={cn(
        base,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 enabled:hover:-translate-y-1 disabled:opacity-55',
      )}
    >
      {cardFace(card)}
    </button>
  );
}

/** Face-down hand of an opponent that only shows how many cards they hold. */
export function HiddenFan({ count, size = 'sm' }: { count: number; size?: 'sm' | 'md' }) {
  return (
    <span className="flex items-center gap-1">
      {Array.from({ length: count }).map((_, index) => (
        <PlayingCard
          key={index}
          card={{ id: `hidden-${index}`, rank: '2', suit: 's' }}
          faceDown
          size={size}
        />
      ))}
    </span>
  );
}
