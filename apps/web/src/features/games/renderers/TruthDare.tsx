import { Sparkles } from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { SeatList, seatName } from '../shared/GamePieces';

interface Card {
  id: string;
  kind: string;
  text: string;
  deckName: string;
  player: number;
}

/**
 * جرئت یا حقیقت — کارت مشترک روی میز؛ هر کس نوبتش شد یکی از سه دکمه را
 * می‌زند و همه همان کارت را می‌بینند. تاریخچهٔ کوتاهی از کارت‌های قبلی هم
 * می‌ماند و بازی پایانی ندارد؛ میزبان با «دست تازه» از نو شروع می‌کند.
 */
export function TruthDare({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const current = (state.currentCard as Card | null) ?? null;
  const history = (state.history as Card[] | undefined) ?? [];
  const draws = (state.drawCount as number) ?? 0;
  const disabled = phase !== 'playing';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SeatList seats={seats} activeSeat={current?.player ?? null} />
        <p className="num text-[10px] text-muted">{formatCountFa(draws)} کارت کشیده شده</p>
      </div>

      <div
        className={cn(
          'rounded-[1.75rem] border p-6 text-center',
          current?.kind === 'dare' ? 'border-brand-300 bg-brand-50' : 'border-line/70 bg-surface',
        )}
        role="status"
        aria-live="polite"
      >
        <p className="inline-flex items-center gap-1 text-[10px] text-brand-700">
          <Sparkles aria-hidden className="size-3" />
          {current ? (current.kind === 'truth' ? 'حقیقت' : 'جرئت') : 'هنوز کارتی رو نشده'}
        </p>
        <p className="mt-2 font-display text-lg font-bold leading-8 text-ink">
          {current ? current.text : 'یکی از سه دکمه را بزنید تا کارت رو شود.'}
        </p>
        {current ? (
          <p className="mt-2 text-[10px] text-muted">
            {seatName(seats, current.player)} · دستهٔ {current.deckName}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onMove({ action: 'draw', kind: 'truth' })}
          disabled={disabled}
          className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          حقیقت
        </button>
        <button
          type="button"
          onClick={() => onMove({ action: 'draw', kind: 'dare' })}
          disabled={disabled}
          className="min-h-11 rounded-full bg-espresso px-5 text-xs font-bold text-cream disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          جرئت
        </button>
        <button
          type="button"
          onClick={() => onMove({ action: 'draw', kind: 'random' })}
          disabled={disabled}
          className="min-h-11 rounded-full border border-line bg-surface px-5 text-xs font-semibold text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          تصادفی
        </button>
        {canRestart ? (
          <button type="button" onClick={onRestart} className="min-h-11 rounded-full px-4 text-[11px] text-muted">
            دستِ تازه
          </button>
        ) : null}
      </div>

      {history.length > 0 ? (
        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="mb-1.5 text-[10px] text-muted">کارت‌های قبلی</p>
          <ul className="space-y-1">
            {history.slice(0, 6).map((card) => (
              <li key={card.id} className="text-[11px] text-ink/80">
                <span className="text-muted">{card.kind === 'truth' ? 'حقیقت' : 'جرئت'} · </span>
                {card.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-[10px] text-muted">
        شما {seatName(seats, mySeat)} هستید؛ هر کس می‌تواند کارت بکشد و بقیه همان را می‌بینند.
      </p>
    </div>
  );
}
