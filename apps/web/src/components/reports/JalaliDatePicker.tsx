import { useEffect, useMemo, useState } from 'react';
import { JALALI_MONTHS_FA, jalaliMonthLength, toGregorian, toJalali, toLatinDigits } from '@cafeflow/shared';

const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
const TEHRAN_OFFSET_MINUTES = 210;

interface JalaliParts {
  jy: number;
  jm: number;
  jd: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Reads the same «۱۴۰۵/۰۸/۲۷» string the report page already stores. */
function parseJalali(value: string): JalaliParts | null {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(toLatinDigits(value.trim()));
  if (!match) return null;
  const jy = Number(match[1]);
  const jm = Number(match[2]);
  const jd = Number(match[3]);
  if (jm < 1 || jm > 12 || jd < 1 || jd > jalaliMonthLength(jy, jm)) return null;
  return { jy, jm, jd };
}

function formatJalaliValue(jy: number, jm: number, jd: number): string {
  return `${jy}/${pad2(jm)}/${pad2(jd)}`;
}

function todayJalali(): JalaliParts {
  return toJalali(new Date(Date.now() + TEHRAN_OFFSET_MINUTES * 60_000));
}

/** Persian week starts on Saturday; JS `getUTCDay()` starts on Sunday. */
function firstWeekdayOffset(jy: number, jm: number): number {
  const { gy, gm, gd } = toGregorian(jy, jm, 1);
  const weekday = new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay();
  return (weekday + 1) % 7;
}

/**
 * Calendar popover for the report filters. It keeps the page's existing Jalali
 * text value, so presets, validation and the API request stay unchanged.
 */
export function JalaliDatePicker({
  value,
  onChange,
  placeholder = '۱۴۰۵/۰۸/۲۷',
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseJalali(value);
  const today = todayJalali();
  const [view, setView] = useState<{ jy: number; jm: number }>(() => {
    const base = selected ?? today;
    return { jy: base.jy, jm: base.jm };
  });

  // Preset buttons replace the value; the grid follows without closing.
  useEffect(() => {
    const parsed = parseJalali(value);
    if (parsed) setView({ jy: parsed.jy, jm: parsed.jm });
  }, [value]);

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

  const pick = (jy: number, jm: number, jd: number) => {
    onChange(formatJalaliValue(jy, jm, jd));
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={ariaLabel}
        aria-expanded={open}
        dir="ltr"
        className="flex h-9 w-40 items-center justify-between rounded-xl border border-line bg-surface px-3 text-xs"
      >
        <span className={selected ? 'num text-ink' : 'text-muted'}>
          {selected ? formatJalaliValue(selected.jy, selected.jm, selected.jd) : placeholder}
        </span>
        <span aria-hidden className="text-muted">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="انتخاب تاریخ جلالی"
          className="absolute z-20 mt-1 w-64 rounded-xl border border-line bg-surface p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => move(-1)}
              aria-label="ماه قبل"
              className="rounded-lg border border-line px-2 py-0.5 text-xs text-muted"
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
              className="rounded-lg border border-line px-2 py-0.5 text-xs text-muted"
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
                selected !== null &&
                selected.jy === view.jy &&
                selected.jm === view.jm &&
                selected.jd === day;
              const isToday = today.jy === view.jy && today.jm === view.jm && today.jd === day;

              return (
                <button
                  key={`${view.jy}-${view.jm}-${day}`}
                  type="button"
                  onClick={() => pick(view.jy, view.jm, day)}
                  className={`num rounded-lg border py-1 text-[11px] ${
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

          <div className="mt-2 flex items-center justify-between gap-1.5 border-t border-line pt-2">
            <button
              type="button"
              onClick={() => pick(today.jy, today.jm, today.jd)}
              className="text-[10px] text-brand-700"
            >
              امروز
            </button>
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className="text-[10px] text-muted"
            >
              پاک کردن
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-[10px] text-muted">
              بستن
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
