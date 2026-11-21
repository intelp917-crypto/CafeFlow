import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, Timer, seatName } from '../shared/GamePieces';

interface Question {
  en?: { q: string; opts: string[] };
  zh?: { q: string; opts: string[] };
}

interface Rank {
  player: number;
  score: number;
  correctCount: number;
}

/**
 * مسابقهٔ دانش — همه هم‌زمان روی گوشی خودشان جواب می‌دهند و تا لحظهٔ رو شدن
 * پاسخ، انتخاب بقیه پنهان است. بانک سؤال این نسخهٔ فارسی در آداپتور جایگزین
 * می‌شود؛ امتیاز و رتبه از قواعد می‌آید.
 */
export function QuizRace({ state, seats, mySeat, phase, deadline, canRestart, onMove, onRestart }: GameRendererProps) {
  const gamePhase = (state.phase as string) ?? 'question';
  const question = (state.question as Question | null) ?? null;
  const copy = question?.en ?? question?.zh ?? null;
  const choices = (state.choices as Array<number | null> | undefined) ?? [];
  const myChoice = choices[mySeat] ?? null;
  const answered = Boolean((state.answered as boolean[] | undefined)?.[mySeat]);
  const answer = (state.answer as number | null) ?? null;
  const scores = (state.scores as number[] | undefined) ?? [];
  const ranking = (state.ranking as Rank[] | undefined) ?? [];
  const winner = (state.winner as number | null) ?? null;
  const index = (state.currentQuestion as number) ?? 1;
  const total = (state.totalQuestions as number) ?? 0;
  const reveal = gamePhase === 'reveal' || gamePhase === 'over';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-2.5 text-[11px]">
        <p className="text-muted">
          سؤال {formatCountFa(index)} از {formatCountFa(total)}
        </p>
        <Timer deadline={deadline} />
        <p className="text-muted">{gamePhase === 'reveal' ? 'پاسخ رو شد' : 'همه هم‌زمان جواب می‌دهند'}</p>
      </div>

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          {scores.map((score, seat) => `${seatName(seats, seat)}: ${formatCountFa(score)}`).join(' · ')}
        </p>
      </ResultOverlay>

      <div className="rounded-[1.75rem] border border-brand-200 bg-surface p-5">
        <p className="font-display text-lg font-bold leading-8 text-ink">
          {copy?.q ?? 'در انتظار سؤال بعدی…'}
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {(copy?.opts ?? []).map((option, optionIndex) => {
            const selected = myChoice === optionIndex;
            const correct = reveal && answer === optionIndex;
            return (
              <button
                key={optionIndex}
                type="button"
                onClick={() => onMove({ answer: optionIndex })}
                disabled={answered || reveal || phase !== 'playing'}
                aria-pressed={selected}
                className={cn(
                  'flex min-h-12 items-center gap-2 rounded-2xl border px-4 py-2 text-right text-xs font-semibold transition-colors disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                  correct
                    ? 'border-success-600 bg-success-50 text-success-800'
                    : selected
                      ? 'border-brand-500 bg-brand-50 text-brand-800'
                      : 'border-line bg-cream text-ink',
                )}
              >
                <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-[10px] text-muted">
                  {formatCountFa(optionIndex + 1)}
                </span>
                {option}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[10px] text-muted">
          {answered && !reveal ? 'پاسخ شما ثبت شد؛ منتظر بقیه باشید.' : ''}
          {reveal && answer !== null ? ` پاسخ درست: گزینهٔ ${formatCountFa(answer + 1)}` : ''}
        </p>
      </div>

      <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
        <p className="mb-1.5 text-[10px] text-muted">رتبه‌بندی</p>
        <ul className="space-y-1">
          {ranking.map((entry, place) => (
            <li key={entry.player} className="flex items-center justify-between text-[11px]">
              <span className="text-ink/80">
                {formatCountFa(place + 1)}. {seatName(seats, entry.player)}
              </span>
              <span className="num text-muted">
                {formatCountFa(entry.correctCount)} درست
                <span className="mr-2 font-semibold text-ink">{formatCountFa(entry.score)}</span>
              </span>
            </li>
          ))}
          {ranking.length === 0 ? <li className="text-[11px] text-muted">هنوز امتیازی ثبت نشده است.</li> : null}
        </ul>
      </div>
    </div>
  );
}
