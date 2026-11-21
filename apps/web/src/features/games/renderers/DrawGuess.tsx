import { useRef, useState } from 'react';
import { Check, Eraser, Pencil, Undo2 } from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, Timer, seatName } from '../shared/GamePieces';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  color: string;
  width: number;
  pts: Point[];
}

interface Task {
  type?: string;
  options?: string[];
  word?: string | null;
  strokes?: Stroke[];
  canDraw?: boolean;
}

/**
 * نقاشی و حدس — یک نفر روی بوم می‌کشد و بقیه در نوبت خودشان حدس می‌زنند.
 * هر خط به‌صورت یک حرکت در سرور ذخیره می‌شود؛ واژه فقط برای نقاش دیده
 * می‌شود و واژه‌های این نسخه فارسی‌اند.
 */
export function DrawGuess({ state, seats, mySeat, phase, deadline, canRestart, onMove, onRestart }: GameRendererProps) {
  const [points, setPoints] = useState<Point[]>([]);
  const [guess, setGuess] = useState('');
  const drawing = useRef(false);

  const gamePhase = (state.phase as string) ?? 'choosing';
  const drawer = (state.drawerIndex as number) ?? 0;
  const task = (state.myTask as Task | null) ?? null;
  const word = task?.word ?? (state.word as string | null) ?? null;
  const options = task?.options ?? (state.wordOptions as string[] | undefined) ?? [];
  const strokes = task?.strokes ?? (state.strokes as Stroke[] | undefined) ?? [];
  const scores = (state.scores as number[] | undefined) ?? [];
  const correct = (state.correct as Record<string, boolean> | undefined) ?? {};
  const winner = (state.winner as number | null) ?? null;
  const iDraw = drawer === mySeat;
  const choosing = gamePhase === 'choosing';
  const playing = gamePhase === 'playing';
  const canDraw = phase === 'playing' && playing && iDraw && winner === null;
  const canGuess = phase === 'playing' && playing && !iDraw && !correct[String(mySeat)] && winner === null;

  const toBoard = (event: React.PointerEvent<SVGSVGElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * 3000) / 10,
      y: Math.round(((event.clientY - rect.top) / rect.height) * 3000) / 10,
    };
  };

  const finishStroke = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (points.length < 2) {
      setPoints([]);
      return;
    }
    onMove({ type: 'stage_stroke', stroke: { color: '#2a211a', width: 6, pts: points } });
    setPoints([]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-2.5 text-[11px]">
        <p className="text-muted">
          {choosing ? 'انتخاب واژه' : playing ? `نقاش: ${seatName(seats, drawer)}` : 'پایان دور'}
        </p>
        <Timer deadline={deadline} />
        {playing && iDraw && word ? <p className="text-brand-800">واژهٔ شما: {word}</p> : null}
      </div>

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">
          {scores.map((score, seat) => `${seatName(seats, seat)}: ${formatCountFa(score)}`).join(' · ')}
        </p>
      </ResultOverlay>

      {choosing && iDraw ? (
        <div className="space-y-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="text-xs text-ink">یک واژه برای کشیدن انتخاب کنید:</p>
          <div className="flex flex-wrap gap-2">
            {options.map((option, index) => (
              <button
                key={option}
                type="button"
                onClick={() => onMove({ type: 'choose_word', index })}
                className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white"
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-[1.75rem] border border-line/70 bg-surface p-2">
        <svg
          viewBox="0 0 300 300"
          className={cn('block aspect-square w-full touch-none rounded-2xl bg-[#fbf7ef]', canDraw && 'cursor-crosshair')}
          role="img"
          aria-label="بوم نقاشی"
          onPointerDown={(event) => {
            if (!canDraw) return;
            drawing.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            setPoints([toBoard(event)]);
          }}
          onPointerMove={(event) => {
            if (!canDraw || !drawing.current) return;
            setPoints((current) => (current.length > 80 ? current : [...current, toBoard(event)]));
          }}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
        >
          {strokes.map((stroke, index) => (
            <polyline
              key={index}
              points={stroke.pts.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke={stroke.color}
              strokeWidth={stroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {points.length > 1 ? (
            <polyline
              points={points.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke="#2a211a"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </svg>
      </div>

      {canDraw ? (
        <div className="flex flex-wrap gap-2">
          <p className="inline-flex items-center gap-1 self-center text-[10px] text-muted">
            <Pencil aria-hidden className="size-3" />
            با انگشت بکشید
          </p>
          <button
            type="button"
            onClick={() => onMove({ type: 'stage_undo' })}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink"
          >
            <Undo2 aria-hidden className="size-3.5" />
            آخرین خط
          </button>
          <button
            type="button"
            onClick={() => onMove({ type: 'stage_clear' })}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink"
          >
            <Eraser aria-hidden className="size-3.5" />
            پاک کردن
          </button>
        </div>
      ) : null}

      {canGuess ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!guess.trim()) return;
            onMove({ type: 'stage_guess', text: guess.trim() });
            setGuess('');
          }}
        >
          <input
            value={guess}
            onChange={(event) => setGuess(event.target.value)}
            placeholder="حدس شما…"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-cream px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          />
          <button type="submit" className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white">
            حدس
          </button>
        </form>
      ) : null}

      <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
        <p className="mb-1.5 text-[10px] text-muted">بازیکنان</p>
        <ul className="space-y-1">
          {seats.map((seat) => (
            <li key={seat.index} className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-ink/80">
                {seat.nameFa}
                {correct[String(seat.index)] ? <Check aria-label="درست حدس زد" className="size-3 text-success-600" /> : null}
                {seat.index === drawer ? <span className="text-[9px] text-brand-700">نقاش</span> : null}
              </span>
              <span className="num font-semibold text-ink">{formatCountFa(scores[seat.index] ?? 0)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
