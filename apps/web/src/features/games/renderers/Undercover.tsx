import { useState } from 'react';
import { Eye, MessageSquare, Vote } from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, SeatList, seatName } from '../shared/GamePieces';

interface Speech {
  round: number;
  pk: boolean;
  seat: number;
  text: string;
}

/**
 * آندرکاور — همه یک واژهٔ نزدیک دارند و باید با توصیف‌های کوتاه بفهمند واژهٔ
 * یکی فرق دارد. واژهٔ هر کس فقط برای خودش می‌آید؛ نقش‌ها بعد از رأی‌گیری یا
 * پایان بازی رو می‌شوند.
 */
export function Undercover({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [speech, setSpeech] = useState('');
  const [target, setTarget] = useState<number | null>(null);

  const gamePhase = (state.phase as string) ?? 'speech';
  const winner = (state.winner as number | null) ?? null;
  const alive = (state.alive as boolean[]) ?? [];
  const revealed = (state.revealed as boolean[]) ?? [];
  const roles = (state.roles as Array<string | null>) ?? [];
  const myWord = (state.myWord as string | null) ?? null;
  const isBlank = Boolean(state.isBlank);
  const speakers = (state.speakers as number[] | undefined) ?? [];
  const speakerPos = (state.speakerPos as number) ?? 0;
  const currentSpeaker = speakers[speakerPos] ?? null;
  const speechRound = (state.round as number) ?? 1;
  const candidates = (state.voteCandidates as number[] | undefined) ?? [];
  const votedSeats = (state.votedSeats as number[] | undefined) ?? [];
  const votes = (state.votes as Record<string, number | string> | undefined) ?? {};
  const speeches = (state.speeches as Speech[] | undefined) ?? [];
  const lastExile = (state.lastExiled as number | null) ?? null;
  const myVote = votes[String(mySeat)];
  const speaking = gamePhase === 'speech' && currentSpeaker === mySeat && winner === null;
  const voting = gamePhase === 'vote' && winner === null && alive[mySeat] !== false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-2.5 text-[11px]">
        <p className="text-muted">دور {formatCountFa(speechRound)}</p>
        <p className="text-muted">
          {gamePhase === 'speech'
            ? currentSpeaker !== null
              ? `نوبت صحبت ${seatName(seats, currentSpeaker)}`
              : 'در حال آماده‌سازی صحبت‌ها'
            : gamePhase === 'vote'
              ? `${formatCountFa(votedSeats.length)} رأی ثبت شده`
              : 'پایان رأی‌گیری'}
        </p>
      </div>

      <SeatList seats={seats} activeSeat={currentSpeaker ?? null} />

      <ResultOverlay
        seats={seats}
        winner={winner !== null && winner >= 0 ? winner : null}
        phase={phase}
        canRestart={canRestart}
        onRestart={onRestart}
        headline={winner === -2 ? 'شهروندها بردند' : winner === -3 ? 'آندرکاور برد' : undefined}
      >
        {winner !== null ? (
          <p className="mt-1 text-[11px] text-muted">
            نقش‌ها: {seats.map((seat) => `${seat.nameFa} — ${roleName(roles[seat.index] ?? null)}`).join(' · ')}
          </p>
        ) : null}
      </ResultOverlay>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3">
          <p className="inline-flex items-center gap-1 text-[10px] text-brand-800">
            <Eye aria-hidden className="size-3" />
            واژهٔ شما
          </p>
          <p className="mt-1 font-display text-lg font-bold text-ink">{isBlank ? 'کارت خالی' : myWord ?? '—'}</p>
          <p className="mt-1 text-[10px] text-muted">
            {isBlank ? 'شما واژه ندارید؛ با شنیدن توصیف‌ها خودتان را جا بزنید.' : 'واژه را مستقیم نگویید؛ توصیف کنید.'}
          </p>
        </div>

        <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
          <p className="mb-1.5 text-[10px] text-muted">وضعیت بازیکنان</p>
          <ul className="space-y-1">
            {seats.map((seat) => (
              <li key={seat.index} className="flex items-center justify-between text-[11px]">
                <span className={cn(alive[seat.index] ? 'text-ink/80' : 'text-muted line-through')}>
                  {seat.nameFa}
                  {revealed[seat.index] && roles[seat.index] ? (
                    <span className="mr-1.5 text-[9px] no-underline text-brand-700">{roleName(roles[seat.index])}</span>
                  ) : null}
                </span>
                <span className="text-[10px] text-muted">
                  {alive[seat.index] ? (votedSeats.includes(seat.index) ? 'رأی داده' : 'زنده') : 'بیرون'}
                </span>
              </li>
            ))}
          </ul>
          {lastExile !== null ? (
            <p className="mt-2 text-[10px] text-brand-700">آخرین اخراجی: {seatName(seats, lastExile)}</p>
          ) : null}
        </div>
      </div>

      {speaking ? (
        <form
          className="space-y-2 rounded-2xl border border-brand-300 bg-brand-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!speech.trim()) return;
            onMove({ type: 'speak', text: speech.trim() });
            setSpeech('');
          }}
        >
          <label htmlFor="uc-speech" className="text-xs text-ink">
            نوبت شماست؛ یک توصیف کوتاه بدهید (بدون گفتن خود واژه).
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="uc-speech"
              value={speech}
              onChange={(event) => setSpeech(event.target.value)}
              maxLength={80}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-cream px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            />
            <button type="submit" className="min-h-11 rounded-full bg-brand-600 px-4 text-xs font-bold text-white">
              بگو
            </button>
            <button
              type="button"
              onClick={() => onMove({ type: 'done', text: '' })}
              className="min-h-11 rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink"
            >
              رد کردن
            </button>
          </div>
        </form>
      ) : null}

      {voting ? (
        <div className="space-y-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="inline-flex items-center gap-1 text-xs text-ink">
            <Vote aria-hidden className="size-3.5" />
            به کی رأی می‌دهید؟
          </p>
          <div className="flex flex-wrap gap-1.5">
            {candidates
              .filter((seat) => seat !== mySeat)
              .map((seat) => (
                <button
                  key={seat}
                  type="button"
                  onClick={() => setTarget(seat)}
                  aria-pressed={target === seat}
                  className={cn(
                    'min-h-11 rounded-full px-4 text-xs font-semibold',
                    target === seat ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-ink',
                  )}
                >
                  {seatName(seats, seat)}
                </button>
              ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onMove({ type: 'vote', target: target ?? -1 });
                setTarget(null);
              }}
              disabled={myVote !== undefined}
              className="min-h-11 rounded-full bg-espresso px-5 text-xs font-semibold text-cream disabled:opacity-50"
            >
              ثبت رأی
            </button>
            <button
              type="button"
              onClick={() => onMove({ type: 'vote', target: -1 })}
              disabled={myVote !== undefined}
              className="min-h-11 rounded-full px-4 text-[11px] text-muted"
            >
              رأی نمی‌دهم
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
        <p className="mb-1.5 inline-flex items-center gap-1 text-[10px] text-muted">
          <MessageSquare aria-hidden className="size-3" />
          صحبت‌ها
        </p>
        {speeches.length === 0 ? (
          <p className="text-[11px] text-muted">هنوز کسی صحبت نکرده است.</p>
        ) : (
          <ul className="space-y-1">
            {speeches.slice(-10).map((entry, index) => (
              <li key={index} className="text-[11px] text-ink/80">
                <span className="text-muted">
                  {seatName(seats, entry.seat)}
                  {entry.pk ? ' (رأی مجدد)' : ''}:{' '}
                </span>
                {entry.text || '—'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function roleName(role: string | null): string {
  if (role === 'civilian') return 'شهروند';
  if (role === 'undercover') return 'آندرکاور';
  if (role === 'blank') return 'کارت خالی';
  return 'نامعلوم';
}
