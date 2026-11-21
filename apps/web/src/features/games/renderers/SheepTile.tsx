import {
  Apple,
  Cake,
  Cherry,
  Coffee,
  Croissant,
  Fish,
  Flower2,
  Gem,
  Heart,
  IceCreamCone,
  Leaf,
  Moon,
  Pizza,
  Star,
  Sun,
  Undo2,
  Shuffle,
  Layers3,
  Trophy,
} from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, seatName } from '../shared/GamePieces';

interface Tile {
  id: number;
  x: number;
  y: number;
  z: number;
  level: number;
  faceDown?: boolean;
}

interface Slot {
  pattern: number;
  fromId: number;
}

interface Progress {
  level: number;
  removed: Record<string, boolean>;
  slot: Slot[];
  score: number;
  eliminated: boolean;
  powers: { undo: number; shuffle: number; pop3: number };
}

const PATTERNS = [
  { Icon: Coffee, tone: 'bg-[#f4e2cb] text-[#6b4021]' },
  { Icon: Cake, tone: 'bg-[#f6ded7] text-[#8a3f35]' },
  { Icon: Croissant, tone: 'bg-[#f7e8c9] text-[#8a641f]' },
  { Icon: Cherry, tone: 'bg-[#f6d8d8] text-[#9a3030]' },
  { Icon: Apple, tone: 'bg-[#f3dcd2] text-[#94452a]' },
  { Icon: Pizza, tone: 'bg-[#f7e3c6] text-[#8b531b]' },
  { Icon: Fish, tone: 'bg-[#dce9ee] text-[#3b6476]' },
  { Icon: Leaf, tone: 'bg-[#dfeadb] text-[#3e6a45]' },
  { Icon: Flower2, tone: 'bg-[#f1dcea] text-[#7c3d68]' },
  { Icon: Star, tone: 'bg-[#f5e8c4] text-[#8d6a12]' },
  { Icon: Heart, tone: 'bg-[#f4d9dd] text-[#96384a]' },
  { Icon: Moon, tone: 'bg-[#e2e2ee] text-[#4b5079]' },
  { Icon: Sun, tone: 'bg-[#f8e8c7] text-[#8d6414]' },
  { Icon: Gem, tone: 'bg-[#dce9ea] text-[#346b70]' },
];

const CELL = 52;

/**
 * گلهٔ گوسفند — یک صفحهٔ تختِ لایه‌ای: کاشی‌های روی هم را بردار و سه‌تای
 * یکسان را در نوار پایین جمع کن. هر بازیکن پیشرفت خودش را دارد و همه
 * هم‌زمان بازی می‌کنند؛ کاشی‌های پنهان تا آزاد نشوند نشان داده نمی‌شوند.
 */
export function SheepTile({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const players = (state.players as Progress[] | undefined) ?? [];
  const me = players[mySeat];
  const layout = (state.layout as Tile[] | undefined) ?? [];
  const patterns = (state.patterns as Array<Record<string, number>> | undefined) ?? [];
  const patternMap = patterns[state.sameBoard === false ? mySeat : 0] ?? {};
  const sameBoard = state.sameBoard !== false;
  const winner = (state.winner as number | null) ?? null;
  const slotSize = (state.slotSize as number) ?? 7;

  const level = me?.level ?? 1;
  const removed = me?.removed ?? {};
  const slot = me?.slot ?? [];
  const powers = me?.powers ?? { undo: 0, shuffle: 0, pop3: 0 };
  const tiles = layout.filter((tile) => tile.level === level);

  const isBlocked = (tile: Tile) =>
    tiles.some(
      (other) =>
        other !== tile &&
        !removed[other.id] &&
        other.z > tile.z &&
        Math.abs(other.x - tile.x) < 1 &&
        Math.abs(other.y - tile.y) < 1,
    );

  const minX = Math.min(...tiles.map((tile) => tile.x), 0);
  const minY = Math.min(...tiles.map((tile) => tile.y), 0);
  const maxX = Math.max(...tiles.map((tile) => tile.x), 0);
  const maxY = Math.max(...tiles.map((tile) => tile.y), 0);
  const width = (maxX - minX + 1) * CELL + 16;
  const height = (maxY - minY + 1) * CELL + 16;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-2.5 text-[11px]">
        <p className="flex items-center gap-1.5 text-ink">
          <Trophy aria-hidden className="size-3.5 text-brand-600" />
          مرحلهٔ {formatCountFa(level)} · <span className="num font-bold">{formatCountFa(me?.score ?? 0)}</span> امتیاز
        </p>
        <p className="text-muted">{sameBoard ? 'همه یک چیدمان دارند' : 'هر نفر چیدمان خودش را دارد'} · هم‌زمان</p>
      </div>

      <ResultOverlay
        seats={seats}
        winner={winner !== null && winner >= 0 ? winner : null}
        phase={phase}
        canRestart={canRestart}
        onRestart={onRestart}
        headline={winner === -2 ? 'نوار پر شد؛ این دست را باختید' : undefined}
      >
        <p className="mt-1 text-[11px] text-muted">
          {seats.map((seat) => `${seat.nameFa}: ${formatCountFa(players[seat.index]?.score ?? 0)}`).join(' · ')}
        </p>
      </ResultOverlay>

      <div className="scroll-thin overflow-x-auto rounded-2xl border border-line/70 bg-[radial-gradient(circle_at_50%_38%,#fbf3e5_0%,#efe4d3_55%,#e3d4bf_100%)] p-2">
        {me?.eliminated ? (
          <p className="py-10 text-center text-xs text-muted">نوار شما پر شد؛ نتیجهٔ بقیه را تماشا کنید.</p>
        ) : (
          <div
            className="relative mx-auto"
            style={{ width, height, minWidth: width }}
            role="group"
            aria-label="کاشی‌های روی میز"
          >
            {tiles.map((tile) => {
              const hiddenByStack = isBlocked(tile);
              const gone = Boolean(removed[tile.id]);
              if (gone) return null;
              const pattern = patternMap[tile.id];
              const visual = pattern !== undefined ? PATTERNS[pattern % PATTERNS.length] : null;
              const Icon = visual?.Icon;
              return (
                <button
                  key={tile.id}
                  type="button"
                  onClick={() => onMove({ type: 'pick', tileId: tile.id })}
                  disabled={hiddenByStack || phase !== 'playing' || winner !== null}
                  aria-label={`کاشی ${formatCountFa(tile.id + 1)}${visual ? `، طرح ${formatCountFa(pattern + 1)}` : '، پنهان'}`}
                  className={cn(
                    'absolute grid place-items-center rounded-lg border shadow-[0_3px_0_rgba(41,27,19,0.18)] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                    visual ? `${visual.tone} border-black/10` : 'border-[#b7a68f] bg-[#cbb99f]',
                    hiddenByStack ? 'opacity-45 saturate-50' : 'hover:-translate-y-0.5',
                  )}
                  style={{
                    left: (tile.x - minX) * CELL + 8,
                    top: (tile.y - minY) * CELL + 8,
                    width: CELL - 3,
                    height: CELL - 3,
                    zIndex: tile.z + 1,
                  }}
                >
                  {Icon ? <Icon aria-hidden className="size-5" strokeWidth={2.2} /> : <span className="text-[13px] text-[#8f7a61]">؟</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-2xl border border-line/70 bg-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted">نوار شما ({formatCountFa(slot.length)} از {formatCountFa(slotSize)})</p>
          <p className="text-[9px] text-muted">سه‌تای یکسان خودکار می‌رود</p>
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: slotSize }).map((_, index) => {
            const entry = slot[index];
            const visual = entry ? PATTERNS[entry.pattern % PATTERNS.length] : null;
            const Icon = visual?.Icon;
            return (
              <span
                key={index}
                className={cn(
                  'grid h-11 flex-1 place-items-center rounded-lg border',
                  visual ? `${visual.tone} border-black/10` : 'border-dashed border-line bg-canvas/40',
                )}
              >
                {Icon ? <Icon aria-hidden className="size-5" /> : null}
              </span>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <PowerButton label="برگردان" count={powers.undo} icon={<Undo2 aria-hidden className="size-3.5" />} disabled={slot.length === 0} onClick={() => onMove({ type: 'power_undo' })} />
          <PowerButton label="جابه‌جایی" count={powers.shuffle} icon={<Shuffle aria-hidden className="size-3.5" />} disabled={false} onClick={() => onMove({ type: 'power_shuffle' })} />
          <PowerButton label="حذف سه‌تا" count={powers.pop3} icon={<Layers3 aria-hidden className="size-3.5" />} disabled={slot.length === 0} onClick={() => onMove({ type: 'power_pop3' })} />
        </div>
      </div>

      <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
        <p className="mb-1.5 text-[10px] text-muted">هم‌میزها</p>
        <ul className="space-y-1">
          {seats.map((seat) => {
            const progress = players[seat.index];
            return (
              <li key={seat.index} className="flex items-center justify-between text-[11px]">
                <span className={cn(progress?.eliminated ? 'text-muted line-through' : 'text-ink/80')}>
                  {seat.nameFa}
                  {seat.index === mySeat ? <span className="mr-1 text-[9px] text-brand-700">شما</span> : null}
                </span>
                <span className="num text-[10px] text-muted">
                  مرحلهٔ {formatCountFa(progress?.level ?? 1)} · {formatCountFa(progress?.score ?? 0)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function PowerButton({
  label,
  count,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={count <= 0 || disabled}
      className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line bg-surface px-3 text-[10px] font-semibold text-ink/80 disabled:opacity-40"
    >
      {icon}
      {label}
      <span className="num rounded-full bg-cream px-1.5 text-[9px] text-muted">{formatCountFa(count)}</span>
    </button>
  );
}
