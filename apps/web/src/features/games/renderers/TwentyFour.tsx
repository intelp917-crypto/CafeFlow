import { useState } from 'react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, seatName } from '../shared/GamePieces';

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function toLatin(value: string): string {
  return value
    .replace(/[۰-۹]/g, (digit) => String(FA_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(AR_DIGITS.indexOf(digit)))
    .replace(/[×xX]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-');
}

/**
 * بیست‌وچهار — چهار عدد، چهار عملگر و یک هدف. پاسخ‌ها تا پایان دور مخفی
 * می‌مانند و برندهٔ هر دور با پاسخ درست مشخص می‌شود؛ مسابقه چند دور دارد.
 */
export function TwentyFour({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [expression, setExpression] = useState('');

  const numbers = (state.numbers as number[] | undefined) ?? [];
  const gamePhase = (state.phase as string) ?? 'playing';
  const winner = (state.winner as number | null) ?? null;
  const roundWinner = (state.roundWinner as number | null) ?? null;
  const roundsWon = (state.roundsWon as number[] | undefined) ?? [];
  const round = (state.currentRound as number) ?? 1;
  const rounds = (state.maxRounds as number) ?? 5;
  const submissions = (state.playerSubmissions as Record<string, { correct?: boolean }> | undefined) ?? {};
  const mine = submissions[String(mySeat)];
  const solutions = (state.solutions as Array<{ player: number; expression: string }> | undefined) ?? [];

  const roundOver = gamePhase === 'round_end';
  const playing = gamePhase === 'playing' && winner === null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-2.5 text-[11px]">
        <p className="text-muted">
          دور {formatCountFa(round)} از {formatCountFa(rounds)}
        </p>
        <p className="text-muted">
          {roundsWon.length > 0
            ? roundsWon.map((won, seat) => `${seatName(seats, seat)}: ${formatCountFa(won)}`).join(' · ')
            : 'هنوز دوری برده نشده'}
        </p>
      </div>

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          {roundsWon.map((won, seat) => `${seatName(seats, seat)}: ${formatCountFa(won)} دور`).join(' · ')}
        </p>
      </ResultOverlay>

      <div className="rounded-[1.75rem] border border-brand-200 bg-surface p-5">
        <p className="text-center text-[10px] text-brand-700">با این چهار عدد به ۲۴ برسید</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2" aria-label="اعداد این دور">
          {numbers.map((number, index) => (
            <span
              key={`${number}-${index}`}
              className="num flex size-16 items-center justify-center rounded-2xl border border-brand-200 bg-brand-50 font-display text-2xl font-bold text-brand-800"
            >
              {formatCountFa(number)}
            </span>
          ))}
        </div>
        <p className="mt-2 text-center text-[10px] text-muted">هر عدد فقط یک بار؛ + − × ÷ و پرانتز مجاز است.</p>
      </div>

      {roundOver ? (
        <div className="space-y-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="text-xs font-semibold text-ink">
            {roundWinner !== null && roundWinner >= 0
              ? `${seatName(seats, roundWinner)} این دور را برد.`
              : 'این دور برنده نداشت.'}
          </p>
          {solutions.length > 0 ? (
            <ul className="space-y-1 text-[11px] text-ink/80">
              {solutions.slice(-3).map((solution, index) => (
                <li key={index} className="num" dir="ltr">
                  {seatName(seats, solution.player)}: {solution.expression} = 24
                </li>
              ))}
            </ul>
          ) : null}
          {phase === 'playing' && winner === null ? (
            <button
              type="button"
              onClick={() => onMove({ action: 'next_round' })}
              className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              {round >= rounds ? 'پایان مسابقه' : 'دور بعد'}
            </button>
          ) : null}
        </div>
      ) : (
        <form
          className="space-y-2 rounded-2xl border border-line/70 bg-surface p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const value = toLatin(expression).trim();
            if (!value) return;
            onMove({ expression: value });
            setExpression('');
          }}
        >
          <label htmlFor="tf-expression" className="block text-[11px] text-muted">
            عبارت شما (مثلاً <span className="num">(3+5)*3</span>)
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="tf-expression"
              dir="ltr"
              inputMode="text"
              autoComplete="off"
              value={expression}
              onChange={(event) => setExpression(event.target.value)}
              disabled={!playing || Boolean(mine?.correct)}
              placeholder="(3+5)*3"
              className="num min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-cream px-3 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!playing || Boolean(mine?.correct) || expression.trim().length === 0}
              className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              ثبت پاسخ
            </button>
          </div>
          <p className={cn('text-[10px]', mine?.correct ? 'text-success-700' : 'text-muted')}>
            {mine?.correct
              ? 'پاسخ درست شما ثبت شد؛ تا پایان دور منتظر بمانید.'
              : 'پاسخ‌ها تا پایان دور برای بقیه دیده نمی‌شوند.'}
          </p>
        </form>
      )}
    </div>
  );
}
