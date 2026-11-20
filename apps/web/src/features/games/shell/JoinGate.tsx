import { useState } from 'react';
import type { GameCatalogItem } from '@cafeflow/shared';
import { Alert, Spinner } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';

const MODE_FA: Record<string, string> = {
  turn: 'نوبتی',
  realtime: 'هم‌زمان',
  phase: 'مرحله‌ای',
};

export interface JoinGateProps {
  tableNameFa: string;
  games: GameCatalogItem[];
  loading: boolean;
  error: string | null;
  joiningGameId: string | null;
  onJoin: (gameId: string, nameFa: string) => void;
}

/**
 * The first screen after scanning the table sticker: pick a game, say your name,
 * and the table becomes the room — no code to type, no account to make.
 */
export function JoinGate({ tableNameFa, games, loading, error, joiningGameId, onJoin }: JoinGateProps) {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('cafeflow:game-name') ?? '';
    } catch {
      return '';
    }
  });

  const submit = (gameId: string) => {
    try {
      if (name.trim()) localStorage.setItem('cafeflow:game-name', name.trim());
    } catch {
      // Private mode: the name simply is not remembered.
    }
    onJoin(gameId, name.trim());
  };

  return (
    <div className="space-y-4">
      <section className="rounded-[1.75rem] border border-line/70 bg-surface p-5">
        <p className="text-[10px] text-brand-700">بازی میزی {tableNameFa}</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink">با هم‌میزهایتان بازی کنید</h1>
        <p className="mt-2 text-[11px] leading-6 text-muted">
          هر کس روی گوشی خودش همین کد QR میز را اسکن کند و یک بازی را انتخاب کند؛ همه در یک اتاق
          می‌افتند. نیازی به نصب برنامه یا ساختن حساب نیست.
        </p>

        <label htmlFor="game-name" className="mt-4 block text-[11px] font-medium text-ink">
          نام شما روی میز
        </label>
        <input
          id="game-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={24}
          placeholder="مثلاً سارا"
          className="mt-1.5 min-h-11 w-full rounded-2xl border border-line bg-canvas px-3 text-xs text-ink outline-none transition-colors focus:border-brand-300 focus-visible:ring-2 focus-visible:ring-brand-200"
        />
      </section>

      {error ? <Alert tone="danger" title="شروع بازی ممکن نشد">{error}</Alert> : null}

      {loading ? (
        <div className="flex justify-center py-8 text-brand-600">
          <Spinner size="lg" label="در حال گرفتن فهرست بازی‌ها…" />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {[...games].sort((a, b) => Number(b.playable) - Number(a.playable)).map((game) => (
            <li key={game.id}>
              <article
                className={`flex h-full flex-col rounded-[1.5rem] border border-line/70 bg-surface p-4 transition-colors hover:border-brand-300 ${
                  game.playable ? '' : 'opacity-75'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-display text-base font-bold text-ink">{game.nameFa}</h2>
                    <p className="mt-0.5 text-[11px] text-muted">{game.taglineFa}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-cream px-2.5 py-1 text-[10px] text-ink/80">
                    {MODE_FA[game.mode] ?? game.mode}
                  </span>
                </div>

                <p className="mt-2 flex-1 text-[11px] leading-6 text-ink/70">{game.descriptionFa}</p>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="num text-[10px] text-muted">
                    {game.minPlayers === game.maxPlayers
                      ? `${formatCountFa(game.maxPlayers)} بازیکن`
                      : `${formatCountFa(game.minPlayers)} تا ${formatCountFa(game.maxPlayers)} بازیکن`}
                  </span>
                  {game.playable ? (
                    <button
                      type="button"
                      onClick={() => submit(game.id)}
                      disabled={joiningGameId !== null}
                      className="min-h-11 rounded-full bg-espresso px-4 text-[11px] font-semibold text-cream transition-colors hover:bg-brand-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    >
                      {joiningGameId === game.id ? 'در حال ورود…' : 'بازی با این میز'}
                    </button>
                  ) : (
                    <span className="flex min-h-11 items-center rounded-full border border-dashed border-line px-4 text-[11px] text-muted">
                      به‌زودی
                    </span>
                  )}
                </div>

                <details className="mt-2 text-[11px] text-ink/70">
                  <summary className="cursor-pointer text-brand-700">قانون بازی</summary>
                  <p className="mt-1 leading-6">{game.howToFa}</p>
                </details>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
