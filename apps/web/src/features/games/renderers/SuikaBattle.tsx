import { useEffect, useRef, useState } from 'react';
import { Apple, Droplets, Trophy } from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, seatName } from '../shared/GamePieces';

interface Fruit {
  id: number;
  type: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  merged?: boolean;
}

const FRUITS = [
  { name: 'گیلاس', color: '#b93a32', r: 12 },
  { name: 'توت', color: '#8e4b8f', r: 15 },
  { name: 'پرتقال', color: '#e07a25', r: 18 },
  { name: 'لیمو', color: '#d8b62c', r: 22 },
  { name: 'کیوی', color: '#7c9a4a', r: 26 },
  { name: 'سیب', color: '#c94b39', r: 30 },
  { name: 'گلابی', color: '#a8b94a', r: 35 },
  { name: 'هلو', color: '#e59a4a', r: 40 },
  { name: 'آناناس', color: '#c9a53a', r: 46 },
  { name: 'خربزه', color: '#4f9a5a', r: 52 },
  { name: 'هندوانه', color: '#2f7d4b', r: 58 },
];

const WIDTH = 360;
const HEIGHT = 480;
const DANGER_LINE = 62;

/**
 * نبرد میوه‌ها — فیزیک سبک روی همین گوشی اجرا می‌شود و سرور فقط امتیاز،
 * دفعات انداختن و ادغام‌ها را نگه می‌دارد. دو میوهٔ یکسان که به هم برسند
 * یکی می‌شوند و میوهٔ بزرگ‌تری می‌سازند؛ پر شدن جعبه یعنی پایان.
 */
export function SuikaBattle({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fruitsRef = useRef<Fruit[]>([]);
  const aimRef = useRef(WIDTH / 2);
  const nextId = useRef(1);
  const lastDrop = useRef(0);
  const overSent = useRef(false);
  const riskRef = useRef(0);
  const stateRef = useRef(state);
  const moveRef = useRef(onMove);
  const [aim, setAim] = useState(WIDTH / 2);
  const myDrops = (state.drops as number[] | undefined)?.[mySeat] ?? 0;

  stateRef.current = state;
  moveRef.current = onMove;

  const scores = (state.scores as number[] | undefined) ?? [];
  const current = (state.current as number[] | undefined) ?? [];
  const next = (state.next as number[] | undefined) ?? [];
  const eliminated = (state.eliminated as boolean[] | undefined) ?? [];
  const winner = (state.winner as number | null) ?? null;
  const myType = current[mySeat] ?? 0;
  const nextType = next[mySeat] ?? 0;
  const live = phase === 'playing' && winner === null && !eliminated[mySeat];

  useEffect(() => {
    if (myDrops === 0 && winner === null) {
      fruitsRef.current = [];
      riskRef.current = 0;
      overSent.current = false;
    }
  }, [myDrops, winner]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let raf = 0;
    let last = performance.now();

    const draw = () => {
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
      background.addColorStop(0, '#2a1c14');
      background.addColorStop(1, '#170f0b');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      ctx.strokeStyle = 'rgba(224,161,95,0.10)';
      ctx.lineWidth = 1;
      for (let y = 0; y < HEIGHT; y += 24) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(WIDTH, y);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(224,161,95,0.35)';
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(0, DANGER_LINE);
      ctx.lineTo(WIDTH, DANGER_LINE);
      ctx.stroke();
      ctx.setLineDash([]);

      if (live && !overSent.current) {
        const drop = FRUITS[myType] ?? FRUITS[0]!;
        ctx.strokeStyle = 'rgba(224,161,95,0.28)';
        ctx.beginPath();
        ctx.moveTo(aimRef.current, DANGER_LINE);
        ctx.lineTo(aimRef.current, HEIGHT - 10);
        ctx.stroke();

        ctx.globalAlpha = 0.9;
        drawFruit(ctx, aimRef.current, 34, drop, true);
        ctx.globalAlpha = 1;
      }

      for (const fruit of fruitsRef.current) {
        drawFruit(ctx, fruit.x, fruit.y, FRUITS[fruit.type] ?? FRUITS[0]!, false);
      }

      // Side rails and basket rim, so the box reads as a physical crate.
      ctx.fillStyle = 'rgba(224,161,95,0.10)';
      ctx.fillRect(0, 0, 8, HEIGHT);
      ctx.fillRect(WIDTH - 8, 0, 8, HEIGHT);
      ctx.strokeStyle = 'rgba(224,161,95,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, HEIGHT - 6);
      ctx.lineTo(WIDTH, HEIGHT - 6);
      ctx.stroke();
      ctx.fillStyle = 'rgba(224,161,95,0.12)';
      ctx.fillRect(0, HEIGHT - 18, WIDTH, 12);
    };

    const step = (now: number) => {
      const dt = Math.min(2, Math.max(0.4, (now - last) / 16.67));
      last = now;
      const fruits = fruitsRef.current;

      for (const fruit of fruits) {
        if (fruit.merged) continue;
        fruit.vy += 0.42 * dt;
        fruit.vx *= 0.995;
        fruit.x += fruit.vx * dt;
        fruit.y += fruit.vy * dt;
        const r = (FRUITS[fruit.type] ?? FRUITS[0]!).r;
        if (fruit.x - r < 0) {
          fruit.x = r;
          fruit.vx = Math.abs(fruit.vx) * 0.35;
        }
        if (fruit.x + r > WIDTH) {
          fruit.x = WIDTH - r;
          fruit.vx = -Math.abs(fruit.vx) * 0.35;
        }
        if (fruit.y + r > HEIGHT - 6) {
          fruit.y = HEIGHT - 6 - r;
          fruit.vy = -Math.abs(fruit.vy) * 0.18;
          fruit.vx *= 0.88;
        }
        if (fruit.y - r < 0) {
          fruit.y = r;
          fruit.vy = Math.abs(fruit.vy) * 0.2;
        }
      }

      for (let i = 0; i < fruits.length; i += 1) {
        const a = fruits[i]!;
        if (a.merged) continue;
        for (let j = i + 1; j < fruits.length; j += 1) {
          const b = fruits[j]!;
          if (b.merged || a.type !== b.type) continue;
          const ra = (FRUITS[a.type] ?? FRUITS[0]!).r;
          const rb = (FRUITS[b.type] ?? FRUITS[0]!).r;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy);
          if (distance > ra + rb - 2) continue;
          if (a.type < FRUITS.length - 1) {
            a.merged = true;
            b.merged = true;
            const type = a.type + 1;
            fruits.push({
              id: nextId.current++,
              type,
              x: (a.x + b.x) / 2,
              y: (a.y + b.y) / 2,
              vx: 0,
              vy: -1.5,
            });
            moveRef.current({ type: 'merge', fruitType: type });
          }
        }
      }
      fruitsRef.current = fruits.filter((fruit) => !fruit.merged).slice(-60);

      if (live && !overSent.current) {
        const atRisk = fruitsRef.current.some((fruit) => {
          const r = (FRUITS[fruit.type] ?? FRUITS[0]!).r;
          return fruit.y - r < DANGER_LINE && Math.abs(fruit.vy) < 1.2;
        });
        riskRef.current = atRisk ? riskRef.current + dt : 0;
        if (riskRef.current > 70) {
          overSent.current = true;
          moveRef.current({ type: 'gameover' });
        }
      }

      draw();
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [live, myType]);

  const dropAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!live || overSent.current) return;
    const now = performance.now();
    if (now - lastDrop.current < 220) return;
    lastDrop.current = now;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(16, Math.min(WIDTH - 16, ((event.clientX - rect.left) / rect.width) * WIDTH));
    aimRef.current = x;
    setAim(x);
    const fruit = FRUITS[myType] ?? FRUITS[0]!;
    fruitsRef.current.push({
      id: nextId.current++,
      type: myType,
      x,
      y: DANGER_LINE - fruit.r - 4,
      vx: 0,
      vy: 0,
    });
    onMove({ type: 'drop' });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-2.5 text-[11px]">
        <p className="inline-flex items-center gap-1.5 text-ink">
          <Droplets aria-hidden className="size-3.5 text-brand-600" />
          انداختن و یکی‌کردن میوه‌ها · همه هم‌زمان
        </p>
        <p className="num text-[10px] text-muted">امتیاز شما: {formatCountFa(scores[mySeat] ?? 0)}</p>
      </div>

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          {seats.map((seat) => `${seat.nameFa}: ${formatCountFa(scores[seat.index] ?? 0)}`).join(' · ')}
        </p>
      </ResultOverlay>

      <div className="mx-auto w-full max-w-[26rem]">
        <div className="overflow-hidden rounded-[1.4rem] border border-[#e0a15f]/25 bg-[#1b120e] shadow-[0_25px_60px_-30px_rgba(0,0,0,0.9)]">
          <canvas
            ref={canvasRef}
            onPointerDown={dropAt}
            onPointerMove={(event) => {
              if (!live) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const x = Math.max(16, Math.min(WIDTH - 16, ((event.clientX - rect.left) / rect.width) * WIDTH));
              aimRef.current = x;
              setAim(x);
            }}
            className="block aspect-[3/4] w-full touch-none"
            style={{ touchAction: 'none' }}
            aria-label="زمین بازی نبرد میوه‌ها"
            role="img"
          />
        </div>
      </div>

      <div className="mx-auto flex max-w-[26rem] items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-[10px] text-muted">
          <Apple aria-hidden className="size-3.5 text-brand-600" />
          بعدی: {FRUITS[nextType]?.name ?? '—'}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted">
          <span className="size-2 rounded-full" style={{ backgroundColor: FRUITS[myType]?.color ?? '#000' }} />
          در دست: {FRUITS[myType]?.name ?? '—'}
        </span>
        <span className="num text-[9px] text-muted" title={`موقعیت افقی ${formatCountFa(Math.round((aim / WIDTH) * 100))}٪`}>
          جای انداختن
        </span>
      </div>

      <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
        <p className="mb-1.5 flex items-center gap-1 text-[10px] text-muted">
          <Trophy aria-hidden className="size-3" />
          جدول امتیاز
        </p>
        <ul className="space-y-1">
          {seats.map((seat) => (
            <li key={seat.index} className={cn('flex items-center justify-between text-[11px]', eliminated[seat.index] && 'text-muted')}>
              <span>
                {seat.nameFa}
                {eliminated[seat.index] ? <span className="mr-1 text-[8px]">پر شد</span> : null}
                {seat.index === mySeat ? <span className="mr-1 text-[9px] text-brand-700">شما</span> : null}
              </span>
              <span className="num font-semibold text-ink">{formatCountFa(scores[seat.index] ?? 0)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function drawFruit(ctx: CanvasRenderingContext2D, x: number, y: number, fruit: { color: string; r: number; name: string }, ghost: boolean) {
  ctx.save();
  ctx.globalAlpha = ghost ? 0.55 : 1;
  const gradient = ctx.createRadialGradient(x - fruit.r * 0.35, y - fruit.r * 0.4, fruit.r * 0.15, x, y, fruit.r);
  gradient.addColorStop(0, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.25, fruit.color);
  gradient.addColorStop(1, shade(fruit.color, -28));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, fruit.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.shadowColor = 'rgba(20,12,8,0.55)';
  ctx.shadowBlur = 3;
  ctx.font = `700 ${Math.max(8, Math.min(12, fruit.r * 0.38))}px Vazirmatn, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (fruit.r > 15) ctx.fillText(fruit.name, x, y);
  ctx.restore();
}

function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const num = Number.parseInt(value.length === 3 ? value.split('').map((char) => char + char).join('') : value, 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return `rgb(${r}, ${g}, ${b})`;
}
