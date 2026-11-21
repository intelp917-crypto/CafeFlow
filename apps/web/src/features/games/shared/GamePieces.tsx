import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@cafeflow/ui';
import type { GameRoomPhase, GameSeatView } from '@cafeflow/shared';
import { formatCountFa } from '../../../lib/format';

export interface GameRendererProps {
  state: Record<string, any>;
  seats: GameSeatView[];
  mySeat: number;
  phase: GameRoomPhase;
  deadline: number;
  canRestart: boolean;
  onMove: (move: Record<string, unknown>) => void;
  onRestart: () => void;
}

export function seatName(seats: GameSeatView[], index: number | null | undefined): string {
  if (index === null || index === undefined || index < 0) return 'بدون برنده';
  return seats.find((seat) => seat.index === index)?.nameFa ?? `بازیکن ${formatCountFa(index + 1)}`;
}

/** Everyone at the table, with the seat that must act marked. */
export function SeatList({
  seats,
  activeSeat,
  className,
}: {
  seats: GameSeatView[];
  activeSeat?: number | null;
  className?: string;
}) {
  return (
    <ul className={cn('flex flex-wrap gap-2', className)}>
      {seats.map((seat) => (
        <li
          key={seat.index}
          className={cn(
            'flex min-w-0 items-center gap-2 rounded-2xl border px-3 py-2 text-[11px] transition-colors',
            activeSeat === seat.index
              ? 'border-brand-400 bg-brand-50 text-ink'
              : 'border-line/70 bg-surface text-ink/80',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-2 shrink-0 rounded-full',
              !seat.connected ? 'bg-line' : seat.ready ? 'bg-success-600' : 'bg-brand-400',
            )}
          />
          <span className="max-w-[9rem] truncate">{seat.nameFa}</span>
          {seat.isHost ? <span className="text-[10px] text-brand-700">میزبان</span> : null}
          {seat.isYou ? <span className="text-[10px] text-muted">شما</span> : null}
          {!seat.connected ? <span className="text-[10px] text-danger-600">قطع</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Whose turn it is, said plainly. */
export function TurnBar({
  seats,
  mySeat,
  currentSeat,
  hint,
}: {
  seats: GameSeatView[];
  mySeat: number;
  currentSeat: number | null;
  hint?: ReactNode;
}) {
  const mine = currentSeat === mySeat;
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-3',
        mine ? 'border-brand-300 bg-brand-50' : 'border-line/70 bg-surface',
      )}
      role="status"
      aria-live="polite"
    >
      <p className="text-xs font-semibold text-ink">
        {mine ? 'نوبت شماست' : currentSeat === null ? 'در انتظار شروع' : `نوبت ${seatName(seats, currentSeat)}`}
      </p>
      {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

/** Counts down the phase the rules engine publishes as `deadline`. */
export function Timer({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  if (!deadline) return null;
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <span className="num inline-flex items-center gap-1 rounded-full border border-line/70 px-2.5 py-1 text-[11px] text-ink/80">
      {formatCountFa(seconds)} ثانیه
    </span>
  );
}

/** End-of-hand card: who won (or a draw) and what happens next. */
export function ResultOverlay({
  seats,
  winner,
  phase,
  canRestart,
  onRestart,
  headline,
  children,
}: {
  seats: GameSeatView[];
  winner: number | null | undefined;
  phase: GameRoomPhase;
  canRestart: boolean;
  onRestart: () => void;
  /** Overrides the one-line verdict (games that end without a single winner). */
  headline?: ReactNode;
  children?: ReactNode;
}) {
  if (phase !== 'over') return null;
  const draw = winner === null || winner === undefined || winner < 0;
  return (
    <div className="rounded-[1.75rem] border border-brand-200 bg-surface p-5 text-center shadow-[0_30px_70px_-58px_rgba(41,27,19,0.65)]">
      <p className="text-[10px] text-brand-700">پایان دست</p>
      <p className="mt-1 font-display text-xl font-bold text-ink">
        {headline ?? (draw ? 'بدون برندهٔ مشخص' : `${seatName(seats, winner)} برنده شد`)}
      </p>
      {children}
      {canRestart ? (
        <button
          type="button"
          onClick={onRestart}
          className="mt-4 min-h-11 rounded-full bg-espresso px-5 text-xs font-semibold text-cream transition-colors hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          دستِ تازه
        </button>
      ) : (
        <p className="mt-3 text-[11px] text-muted">برای دست بعدی، میزبان شروع می‌کند.</p>
      )}
    </div>
  );
}
