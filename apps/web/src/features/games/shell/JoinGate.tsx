import { useMemo, useState } from 'react';
import type { GameCatalogItem } from '@cafeflow/shared';
import { Alert, Spinner, cn } from '@cafeflow/ui';
import {
  Brain,
  ChevronDown,
  Clock3,
  Gamepad2,
  Layers,
  LayoutGrid,
  Play,
  Search,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';
import { formatCountFa } from '../../../lib/format';

const MODE_FA: Record<string, string> = {
  turn: 'نوبتی',
  realtime: 'هم‌زمان',
  phase: 'مرحله‌ای',
};

const CATEGORY_ICON: Record<string, typeof LayoutGrid> = {
  رومیزی: LayoutGrid,
  کارتی: Layers,
  فکری: Brain,
  اجتماعی: Users,
  'مسابقه‌ای': Zap,
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
 * The first screen after scanning the table sticker: a small game lounge rather
 * than a plain list. Every game has local cover art, so the picker stays fast
 * and works offline; the name is remembered for the next table.
 */
export function JoinGate({ tableNameFa, games, loading, error, joiningGameId, onJoin }: JoinGateProps) {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('cafeflow:game-name') ?? '';
    } catch {
      return '';
    }
  });
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('همه');

  const categories = useMemo(() => ['همه', ...new Set(games.map((game) => game.categoryFa))], [games]);
  const playableCount = games.filter((game) => game.playable).length;
  const filtered = useMemo(() => {
    const needle = query.trim();
    return [...games]
      .filter((game) => category === 'همه' || game.categoryFa === category)
      .filter(
        (game) =>
          !needle ||
          game.nameFa.includes(needle) ||
          game.taglineFa.includes(needle) ||
          game.descriptionFa.includes(needle),
      )
      .sort((a, b) => Number(b.playable) - Number(a.playable));
  }, [games, category, query]);

  const submit = (gameId: string) => {
    try {
      if (name.trim()) localStorage.setItem('cafeflow:game-name', name.trim());
    } catch {
      // Private mode: the name simply is not remembered.
    }
    onJoin(gameId, name.trim());
  };

  return (
    <div className="space-y-6 pb-4">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#1b1310] shadow-[0_40px_120px_-60px_rgba(0,0,0,0.9)]">
        <div
          aria-hidden
          className="absolute inset-0 opacity-35"
          style={{
            backgroundImage: "url('/games/rummikub.jpg')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-l from-[#120c0a]/98 via-[#120c0a]/88 to-[#120c0a]/55" />
        <div aria-hidden className="absolute -left-24 -top-24 size-72 rounded-full bg-[#d9814f]/20 blur-3xl" />

        <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full border border-[#e0a15f]/30 bg-[#e0a15f]/10 px-3 py-1 text-[10px] font-semibold text-[#f0c18c]">
              <Sparkles aria-hidden className="size-3" />
              لابی بازی · {tableNameFa}
            </p>
            <h1 className="mt-3 font-sans text-3xl font-black leading-tight text-[#f8eddc] sm:text-4xl">
              شبِ بازی روی میز
            </h1>
            <p className="mt-2 max-w-md text-xs leading-6 text-[#c9b6a2]">
              یک بازی انتخاب کن، اسمت را بنویس و همان گوشی را بگذار وسط میز. نه نصب، نه حساب، نه
              معطلی؛ بقیه با همان کد QR میز کنار تو می‌نشینند.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-4 text-[10px] text-[#c9b6a2]">
              <span className="inline-flex items-center gap-1.5">
                <Gamepad2 aria-hidden className="size-4 text-[#e0a15f]" />
                {formatCountFa(playableCount)} بازی آماده
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users aria-hidden className="size-4 text-[#e0a15f]" />
                تا {formatCountFa(Math.max(...games.map((game) => game.maxPlayers), 0))} نفر
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 aria-hidden className="size-4 text-[#e0a15f]" />
                دست‌های ۵ تا ۳۰ دقیقه
              </span>
            </div>

            <div className="mt-5 max-w-md">
              <label htmlFor="game-name" className="text-[11px] font-semibold text-[#f3e3cf]">
                نام شما روی میز
              </label>
              <div className="mt-1.5 flex items-center gap-2 rounded-2xl border border-white/15 bg-black/35 p-1.5 pr-3 backdrop-blur">
                <Users aria-hidden className="size-4 shrink-0 text-[#a98f79]" />
                <input
                  id="game-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={24}
                  placeholder="مثلاً سارا"
                  className="min-h-10 min-w-0 flex-1 bg-transparent text-sm text-[#f8eddc] outline-none placeholder:text-[#8c7663]"
                />
                <span className="hidden shrink-0 text-[9px] text-[#8c7663] sm:block">فقط برای همین میز</span>
              </div>
            </div>
          </div>

          <div aria-hidden dir="ltr" className="relative hidden h-60 lg:block">
            {[
              { id: 'chess', left: '0%', top: '18%', rotate: -6, width: '56%' },
              { id: 'mahjong-sichuan', left: '21%', top: '2%', rotate: 4, width: '60%' },
              { id: 'uno', left: '45%', top: '24%', rotate: -2, width: '54%' },
            ].map((card, index) => (
              <div
                key={card.id}
                className="absolute overflow-hidden rounded-2xl border border-white/15 shadow-[0_25px_60px_-20px_rgba(0,0,0,0.9)]"
                style={{
                  left: card.left,
                  top: card.top,
                  width: card.width,
                  aspectRatio: '3 / 2',
                  transform: `rotate(${card.rotate}deg)`,
                  zIndex: 3 - index,
                }}
              >
                <img src={`/games/${card.id}.jpg`} alt="" className="size-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
              </div>
            ))}
            <div className="absolute bottom-1 left-2 rounded-full border border-white/15 bg-black/45 px-3 py-1 text-[9px] text-[#e8d3ba] backdrop-blur">
              {formatCountFa(playableCount)} دستِ آماده
            </div>
          </div>
        </div>
      </section>

      {error ? <Alert tone="danger" title="شروع بازی ممکن نشد">{error}</Alert> : null}

      <section aria-label="فهرست بازی‌ها" className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Gamepad2 aria-hidden className="size-4 text-[#e0a15f]" />
            <h2 className="text-sm font-bold text-[#f5e8d6]">انتخاب بازی</h2>
            <span className="num rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-[#b9a695]">
              {formatCountFa(filtered.length)}
            </span>
          </div>
          <label className="flex min-h-11 w-full items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 text-[#c9b6a2] focus-within:border-[#e0a15f]/60 sm:w-auto">
            <Search aria-hidden className="size-4" />
            <span className="sr-only">جست‌وجوی بازی</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="دنبال کدام بازی می‌گردی؟"
              className="min-h-10 min-w-0 flex-1 bg-transparent text-xs text-[#f5e8d6] outline-none placeholder:text-[#8c7663] sm:w-52 sm:flex-none"
            />
          </label>
        </div>

        <div className="scroll-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {categories.map((item) => {
            const Icon = item === 'همه' ? Sparkles : CATEGORY_ICON[item] ?? LayoutGrid;
            const active = category === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                aria-pressed={active}
                className={cn(
                  'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e0a15f]/70',
                  active
                    ? 'border-[#e0a15f]/60 bg-[#e0a15f]/15 text-[#f3c896]'
                    : 'border-white/10 bg-white/[0.04] text-[#b9a695] hover:border-white/25 hover:text-[#f5e8d6]',
                )}
              >
                <Icon aria-hidden className="size-3.5" />
                {item}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex justify-center py-12 text-[#e0a15f]">
            <Spinner size="lg" label="در حال گرفتن فهرست بازی‌ها…" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/15 py-10 text-center text-xs text-[#b9a695]">
            بازی‌ای با این اسم پیدا نشد.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((game) => (
              <li key={game.id}>
                <GameCard game={game} joining={joiningGameId === game.id} busy={joiningGameId !== null} onPlay={() => submit(game.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function GameCard({
  game,
  joining,
  busy,
  onPlay,
}: {
  game: GameCatalogItem;
  joining: boolean;
  busy: boolean;
  onPlay: () => void;
}) {
  const ModeIcon = game.mode === 'realtime' ? Zap : game.mode === 'phase' ? Sparkles : ChevronDown;
  return (
    <article
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-[1.4rem] border bg-[#1a1310] transition-all duration-300',
        game.playable
          ? 'border-white/10 hover:-translate-y-1 hover:border-[#e0a15f]/45 hover:shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)]'
          : 'border-white/[0.06] opacity-80',
      )}
    >
      <div className="relative aspect-[3/2] overflow-hidden">
        <img
          src={`/games/${game.id}.jpg`}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            'size-full object-cover transition-transform duration-700 group-hover:scale-[1.05]',
            !game.playable && 'grayscale',
          )}
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#1a1310] via-[#1a1310]/35 to-transparent" />
        <div aria-hidden className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/55 to-transparent" />

        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/45 px-2 py-1 text-[9px] font-semibold text-[#f1dfc9] backdrop-blur">
            <ModeIcon aria-hidden className="size-3 text-[#e0a15f]" />
            {MODE_FA[game.mode] ?? game.mode}
          </span>
          {game.playable ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#7f9d84]/20 px-2 py-1 text-[9px] font-bold text-[#b9d3bd] ring-1 ring-[#9ab5a0]/25">
              <span className="size-1.5 rounded-full bg-[#a9c9ae]" />
              آماده
            </span>
          ) : (
            <span className="rounded-full border border-white/15 bg-black/40 px-2 py-1 text-[9px] text-[#b9a695]">به‌زودی</span>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 p-3.5">
          <h3 className="text-lg font-black leading-tight text-white drop-shadow">{game.nameFa}</h3>
          <p className="mt-0.5 text-[10px] text-[#dcc7b1]">{game.taglineFa}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3.5 pt-2.5">
        <p className="line-clamp-2 text-[11px] leading-5 text-[#a99786]">{game.descriptionFa}</p>

        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="num inline-flex items-center gap-1 text-[10px] text-[#9d8977]">
            <Users aria-hidden className="size-3" />
            {game.minPlayers === game.maxPlayers
              ? `${formatCountFa(game.maxPlayers)} نفر`
              : `${formatCountFa(game.minPlayers)} تا ${formatCountFa(game.maxPlayers)} نفر`}
          </span>
          {game.playable ? (
            <button
              type="button"
              onClick={onPlay}
              disabled={busy}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[#e0a15f] px-4 text-[11px] font-bold text-[#241511] transition-colors hover:bg-[#efb577] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e0a15f]/70"
            >
              <Play aria-hidden className="size-3.5 fill-current" />
              {joining ? 'در حال ورود…' : 'بیا بازی'}
            </button>
          ) : (
            <span className="inline-flex min-h-10 items-center rounded-full border border-dashed border-white/15 px-3 text-[10px] text-[#9d8977]">
              در راه است
            </span>
          )}
        </div>

        <details className="group/rules text-[10px] text-[#a99786]">
          <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between rounded-xl bg-white/[0.035] px-3 text-[#c9b6a2] transition-colors hover:bg-white/[0.06]">
            قانون بازی
            <ChevronDown aria-hidden className="size-3.5 transition-transform group-open/rules:rotate-180" />
          </summary>
          <p className="px-1 pt-2 leading-6">{game.howToFa}</p>
        </details>
      </div>
    </article>
  );
}
