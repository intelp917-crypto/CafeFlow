import { useEffect, useMemo, useState } from 'react';
import { JALALI_MONTHS_FA, jalaliMonthLength, toGregorian, toJalali } from '@cafeflow/shared';

const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
/** Iran has had a fixed +03:30 offset since 2022, so "today" needs no tz library. */
const TEHRAN_OFFSET_MINUTES = 210;

export interface JalaliDay {
  jy: number;
  jm: number;
  jd: number;
}

export function tehranTodayJalali(): JalaliDay {
  return toJalali(new Date(Date.now() + TEHRAN_OFFSET_MINUTES * 60_000));
}

/** Persian week starts on Saturday; JS `getUTCDay()` starts on Sunday. */
function firstWeekdayOffset(jy: number, jm: number): number {
  const { gy, gm, gd } = toGregorian(jy, jm, 1);
  const weekday = new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay();
  return (weekday + 1) % 7;
}

/**
 * One month of the Jalali calendar, with no input chrome of its own.
 *
 * Both the report filter and the app-wide date field render this, so the two can
 * never disagree about leap years or where a month starts.
 */
export function JalaliCalendar({
  selected,
  onPick,
  className,
}: {
  selected: JalaliDay | null;
  onPick: (day: JalaliDay) => void;
  className?: string;
}) {
  const today = useMemo(tehranTodayJalali, []);
  const [view, setView] = useState<{ jy: number; jm: number }>(() => {
    const base = selected ?? today;
    return { jy: base.jy, jm: base.jm };
  });

  // A preset or a typed value can move the selection outside the visible month.
  useEffect(() => {
    if (selected) setView({ jy: selected.jy, jm: selected.jm });
  }, [selected?.jy, selected?.jm, selected?.jd]);

  const cells = useMemo(() => {
    const offset = firstWeekdayOffset(view.jy, view.jm);
    const length = jalaliMonthLength(view.jy, view.jm);
    const grid: Array<number | null> = Array.from({ length: offset }, () => null);
    for (let day = 1; day <= length; day += 1) grid.push(day);
    return grid;
  }, [view]);

  const move = (delta: number) => {
    setView((current) => {
      const index = current.jy * 12 + current.jm - 1 + delta;
      return { jy: Math.floor(index / 12), jm: (index % 12) + 1 };
    });
  };

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => move(-1)}
          aria-label="ماه قبل"
          className="rounded-lg border border-line px-2 py-0.5 text-xs text-muted hover:border-brand-300"
        >
          ›
        </button>
        <span className="text-xs font-semibold text-ink">
          {JALALI_MONTHS_FA[view.jm - 1]} {view.jy.toLocaleString('fa-IR', { useGrouping: false })}
        </span>
        <button
          type="button"
          onClick={() => move(1)}
          aria-label="ماه بعد"
          className="rounded-lg border border-line px-2 py-0.5 text-xs text-muted hover:border-brand-300"
        >
          ‹
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted">
        {WEEKDAYS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (day === null) return <span key={`empty-${index}`} />;
          const isSelected =
            selected !== null && selected.jy === view.jy && selected.jm === view.jm && selected.jd === day;
          const isToday = today.jy === view.jy && today.jm === view.jm && today.jd === day;

          return (
            <button
              key={`${view.jy}-${view.jm}-${day}`}
              type="button"
              onClick={() => onPick({ jy: view.jy, jm: view.jm, jd: day })}
              aria-label={`${day} ${JALALI_MONTHS_FA[view.jm - 1]}`}
              aria-pressed={isSelected}
              className={`num rounded-lg border py-1 text-[11px] transition-colors ${
                isSelected
                  ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700'
                  : isToday
                    ? 'border-brand-200 text-brand-700'
                    : 'border-transparent text-ink hover:border-line'
              }`}
            >
              {day.toLocaleString('fa-IR', { useGrouping: false })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
