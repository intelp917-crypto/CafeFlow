import { useState } from 'react';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar } from '../shared/GamePieces';
import { formatCountFa } from '../../../lib/format';

/**
 * بمب عددی — یک عدد پنهان در بازهٔ اعلام‌شده.
 *
 * بازه بعد از هر حدس کوچک می‌شود، پس عدد را داخل همان بازه می‌گیریم و دکمه را
 * تا وقتی ورودی معتبر نیست فعال نمی‌کنیم؛ پیام خطای چینی موتور را هم نشان
 * نمی‌دهیم و فقط وضعیت خودمان را می‌نویسیم.
 */
export function NumberBomb({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const low = (state.low as number) ?? 1;
  const high = (state.high as number) ?? 100;
  const currentPlayer = state.currentPlayer as number;
  const winner = state.winner as number | null;
  const lives = (state.lives ?? []) as number[];
  const last = state.lastGuess as { player: number; guess: number; hit: boolean } | null;
  const myTurn = phase === 'playing' && currentPlayer === mySeat && (lives[mySeat] ?? 0) > 0;
  const [guess, setGuess] = useState('');

  const value = Number(guess);
  const valid = Number.isInteger(value) && value >= low && value <= high;

  const submit = () => {
    if (!valid) return;
    onMove({ guess: value });
    setGuess('');
  };

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null && winner >= 0 ? null : currentPlayer}
        hint={myTurn ? 'یک عدد در بازه حدس بزنید' : 'نوبت حریف است'}
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart} />

      <div className="rounded-[1.75rem] border border-line/70 bg-surface p-5 text-center">
        <p className="text-[10px] text-muted">عدد پنهان بین این دو عدد است</p>
        <p className="num mt-1 font-display text-2xl font-bold text-ink">
          {formatCountFa(low)} تا {formatCountFa(high)}
        </p>

        <div className="mt-4 flex items-center justify-center gap-2">
          <input
            value={guess}
            onChange={(event) => setGuess(event.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
            inputMode="numeric"
            disabled={!myTurn}
            aria-label="عدد حدس"
            placeholder={formatCountFa(Math.round((low + high) / 2))}
            className="num h-11 w-28 rounded-2xl border border-line bg-canvas px-3 text-center text-base font-bold text-ink outline-none focus:border-brand-300 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!myTurn || !valid}
            className="min-h-11 rounded-full bg-espresso px-5 text-xs font-bold text-cream transition-colors enabled:hover:bg-brand-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            حدس
          </button>
        </div>

        {last ? (
          <p className={`mt-3 text-[11px] ${last.hit ? 'text-danger-700' : 'text-ink/70'}`}>
            {seats[last.player]?.nameFa ?? 'بازیکن'} عدد <span className="num">{formatCountFa(last.guess)}</span> را گفت؛{' '}
            {last.hit ? 'روی بمب نشست!' : 'بمب نبود.'}
          </p>
        ) : (
          <p className="mt-3 text-[11px] text-muted">هر کس بمب را پیدا کند یک جان از دست می‌دهد.</p>
        )}
      </div>

      <ul className="flex flex-wrap justify-center gap-2 text-[10px] text-muted">
        {seats.map((seat) => (
          <li
            key={seat.index}
            className={`rounded-full border px-2.5 py-1 ${
              (lives[seat.index] ?? 0) <= 0 ? 'border-danger-200 text-danger-700' : 'border-line'
            }`}
          >
            {seat.nameFa}: <span className="num">{formatCountFa(Math.max(0, lives[seat.index] ?? 0))}</span> جان
          </li>
        ))}
      </ul>
    </div>
  );
}
