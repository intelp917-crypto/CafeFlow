import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';

/**
 * رمز داوینچی — colour is public, the number is the secret.
 *
 * Every move is one of five phases the engine publishes, so the screen follows
 * `state.phase` rather than guessing: draw, place a joker, guess, pay a penalty,
 * or the initial joker placement before the first turn.
 */
interface Tile {
  id?: string;
  color: 'black' | 'white';
  num: number | null;
  wild?: boolean;
  locked?: boolean;
  numRevealed?: boolean;
}

interface GuessResult {
  correct: boolean;
  guesser: number;
  targetPlayer: number;
  tileIndex: number;
  guessNum: number | null;
  guessJoker: boolean;
}

function TileFace({
  tile,
  revealed,
  selected,
  disabled,
  onClick,
  label,
}: {
  tile: Tile;
  revealed: boolean;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  label?: string;
}) {
  const black = tile.color === 'black';
  const known = revealed && tile.num !== null && tile.num >= 0;
  const content = (
    <>
      {known ? (
        <span className="font-display text-lg font-bold leading-none">{formatCountFa(tile.num!)}</span>
      ) : revealed && tile.wild ? (
        <Sparkles aria-hidden className="size-5" />
      ) : (
        <span className="font-display text-lg font-bold leading-none">؟</span>
      )}
      <span className="mt-1 text-[8px] opacity-80">{black ? 'سیاه' : 'سفید'}</span>
    </>
  );

  const className = cn(
    'flex h-16 w-12 shrink-0 flex-col items-center justify-center rounded-xl border-2 transition-transform duration-150 motion-reduce:transform-none',
    black ? 'border-espresso bg-espresso text-cream' : 'border-espresso/40 bg-cream text-espresso',
    selected ? '-translate-y-1.5 ring-2 ring-brand-300' : '',
  );

  if (!onClick) {
    return <span className={className}>{content}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        className,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 enabled:hover:-translate-y-1 disabled:opacity-55',
      )}
    >
      {content}
    </button>
  );
}

export function Davinci({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [guess, setGuess] = useState<{ player: number; tile: number } | null>(null);

  const gamePhase = (state.phase as string) ?? 'draw';
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const penaltyPlayer = (state.penaltyPlayer as number | null) ?? null;
  const winner = (state.winner as number | null) ?? null;
  const tiles = (state.tiles as Tile[][]) ?? [];
  const numRevealed = (state.numRevealed as boolean[][]) ?? [];
  const eliminated = (state.eliminated as boolean[]) ?? [];
  const drawnTile = (state.drawnTile as Tile | null) ?? null;
  const lastGuess = (state.lastGuessResult as GuessResult | null) ?? null;
  const myTiles = tiles[mySeat] ?? [];
  const mine = phase === 'playing' && currentPlayer === mySeat && winner === null;
  const inGuess = mine && gamePhase === 'guess';
  const placing = mine && (gamePhase === 'place' || gamePhase === 'init_place');

  const hint =
    gamePhase === 'over'
      ? 'دست تمام شد'
      : gamePhase === 'penalty'
        ? penaltyPlayer === mySeat
          ? 'یک مهرهٔ خودتان را رو کنید'
          : `منتظر جریمهٔ ${seatName(seats, penaltyPlayer)}`
        : gamePhase === 'place' || gamePhase === 'init_place'
          ? 'جای جوکر را انتخاب کنید'
          : mine
            ? gamePhase === 'draw'
              ? 'یک مهره بکشید'
              : 'حدس بزنید یا نوبت را تمام کنید'
            : 'نوبت حریف است';

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null ? null : gamePhase === 'penalty' ? penaltyPlayer : currentPlayer}
        hint={hint}
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          {winner !== null && winner >= 0
            ? `همهٔ مهره‌های ${seatName(seats, winner)} رو شد.`
            : 'همه جز یک نفر از بازی خارج شدند.'}
        </p>
      </ResultOverlay>

      <section aria-label="مهره‌های حریف" className="space-y-2">
        {seats
          .filter((seat) => seat.index !== mySeat)
          .map((seat) => {
            const hand = tiles[seat.index] ?? [];
            const revealedFlags = numRevealed[seat.index] ?? [];
            return (
              <div
                key={seat.index}
                className={cn(
                  'rounded-2xl border px-3 py-2.5',
                  eliminated[seat.index] ? 'border-line/50 bg-canvas opacity-60' : 'border-line/70 bg-surface',
                )}
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-ink">
                    {seat.nameFa}
                    {eliminated[seat.index] ? <span className="mr-2 text-[10px] text-muted">خارج شد</span> : null}
                  </p>
                  <p className="text-[10px] text-muted">
                    {formatCountFa(revealedFlags.filter(Boolean).length)} از {formatCountFa(hand.length)} رو شده
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {hand.map((tile, index) => {
                    const revealed = Boolean(revealedFlags[index]);
                    const selected = guess?.player === seat.index && guess.tile === index;
                    return (
                      <TileFace
                        key={`${seat.index}-${index}`}
                        tile={tile}
                        revealed={revealed}
                        selected={selected}
                        disabled={!inGuess || revealed || Boolean(eliminated[seat.index])}
                        label={`حدس مهرهٔ ${formatCountFa(index + 1)} ${seat.nameFa}`}
                        onClick={() => setGuess({ player: seat.index, tile: index })}
                      />
                    );
                  })}
                  {hand.length === 0 ? <p className="text-[11px] text-muted">مهره‌ای ندارد.</p> : null}
                </div>
              </div>
            );
          })}
      </section>

      {lastGuess ? (
        <p
          className={cn(
            'rounded-2xl border px-4 py-2.5 text-[11px]',
            lastGuess.correct ? 'border-success-600/40 bg-success-50 text-success-700' : 'border-danger-600/40 bg-danger-50 text-danger-700',
          )}
          role="status"
        >
          {lastGuess.correct
            ? `حدس درست بود: ${seatName(seats, lastGuess.targetPlayer)} یک مهرهٔ دیگر رو کرد.`
            : 'حدس غلط بود؛ یکی از مهره‌های خودتان رو می‌شود.'}
        </p>
      ) : null}

      {inGuess && guess ? (
        <div className="rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="mb-2 text-xs font-semibold text-ink">
            عدد مهرهٔ {seatName(seats, guess.player)} چیست؟
          </p>
          <div className="grid grid-cols-6 gap-1.5">
            {Array.from({ length: 12 }).map((_, number) => (
              <button
                key={number}
                type="button"
                onClick={() => {
                  onMove({ targetPlayer: guess.player, tileIndex: guess.tile, guessNum: number, continueGuess: true });
                  setGuess(null);
                }}
                className="min-h-11 rounded-xl border border-line bg-surface font-display text-sm font-bold text-ink transition-colors hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                {formatCountFa(number)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              onMove({ targetPlayer: guess.player, tileIndex: guess.tile, guessJoker: true, continueGuess: true });
              setGuess(null);
            }}
            className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-espresso text-xs font-semibold text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <Sparkles aria-hidden className="size-4" /> جوکر است
          </button>
          <button
            type="button"
            onClick={() => setGuess(null)}
            className="mt-2 min-h-11 w-full rounded-xl text-[11px] text-muted"
          >
            انصراف
          </button>
        </div>
      ) : null}

      {placing ? (
        <div className="rounded-2xl border border-line/70 bg-surface p-3">
          <p className="mb-2 text-xs text-ink">
            {gamePhase === 'init_place' ? 'این جوکر را کجای مهره‌هایتان بگذارید؟' : 'جوکر کشیده‌شده را کجا بگذارید؟'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: myTiles.length + 1 }).map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => onMove({ placeIndex: index })}
                className="min-h-11 rounded-xl border border-brand-300 bg-brand-50 px-3 text-[11px] font-semibold text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                جایگاه {formatCountFa(index + 1)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {penaltyPlayer === mySeat && gamePhase === 'penalty' ? (
        <p className="rounded-2xl border border-brand-300 bg-brand-50 px-4 py-2.5 text-[11px] text-ink">
          یکی از مهره‌های پنهان خودتان را انتخاب کنید تا رو شود.
        </p>
      ) : null}

      <section aria-label="مهره‌های شما" className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted">مهره‌های شما</p>
          {drawnTile && mine ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-brand-700">کشیده‌شده:</span>
              <TileFace tile={drawnTile} revealed label="مهرهٔ کشیده‌شده" />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {myTiles.map((tile, index) => (
            <TileFace
              key={`${mySeat}-${index}`}
              tile={tile}
              revealed
              selected={penaltyPlayer === mySeat && gamePhase === 'penalty'}
              disabled={!(penaltyPlayer === mySeat && gamePhase === 'penalty') || Boolean(numRevealed[mySeat]?.[index])}
              onClick={() => onMove({ revealIndex: index })}
              label={
                numRevealed[mySeat]?.[index]
                  ? `مهرهٔ ${formatCountFa(index + 1)} رو شده`
                  : `رو کردن مهرهٔ ${formatCountFa(index + 1)}`
              }
            />
          ))}
        </div>
        {gamePhase === 'draw' && mine ? (
          <button
            type="button"
            onClick={() => onMove({})}
            className="min-h-11 w-full rounded-full bg-brand-600 px-5 text-xs font-bold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            کارت کشیدن
          </button>
        ) : null}
        {inGuess && state.guessedThisTurn ? (
          <button
            type="button"
            onClick={() => onMove({ pass: true })}
            className="min-h-11 w-full rounded-full border border-line bg-surface px-5 text-xs font-semibold text-ink transition-colors hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            پایان نوبت
          </button>
        ) : null}
      </section>
    </div>
  );
}
