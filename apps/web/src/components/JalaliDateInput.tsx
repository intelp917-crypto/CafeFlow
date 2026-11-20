import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { formatJalali, toGregorian, toJalali } from '@cafeflow/shared';
import { cn } from '@cafeflow/ui';
import { JalaliCalendar, tehranTodayJalali, type JalaliDay } from './JalaliCalendar';

interface IsoParts {
  gy: number;
  gm: number;
  gd: number;
  time: string | null;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Reads `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` — the shape every form already stores. */
function parseIso(value: string): IsoParts | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const gy = Number(match[1]);
  const gm = Number(match[2]);
  const gd = Number(match[3]);
  if (gm < 1 || gm > 12 || gd < 1 || gd > 31) return null;
  const time = match[4] === undefined ? null : `${pad2(Number(match[4]))}:${match[5]}`;
  return { gy, gm, gd, time };
}

/** Gregorian wall-clock date → Jalali, with no timezone hop (UTC noon is mid-day everywhere). */
function gregorianToJalali(parts: IsoParts): JalaliDay {
  return toJalali(new Date(Date.UTC(parts.gy, parts.gm - 1, parts.gd, 12)));
}

function jalaliToIsoDay(day: JalaliDay): string {
  const { gy, gm, gd } = toGregorian(day.jy, day.jm, day.jd);
  return `${gy}-${pad2(gm)}-${pad2(gd)}`;
}

/**
 * Jalali date field for normal forms.
 *
 * The rest of the app (and the API) speaks ISO, so the value stays ISO and only
 * the label and the calendar are Jalali — a phone browser's Gregorian `<input
 * type="date">` cannot be fixed any other way. With `withTime` it also shows a
 * native time field; hours have no calendar, so native is the right control.
 */
export function JalaliDateInput({
  value,
  onChange,
  withTime = false,
  disabled = false,
  ariaLabel,
  placeholder = 'انتخاب تاریخ',
  className,
  inputClassName,
}: {
  value: string;
  onChange: (next: string) => void;
  withTime?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const parsed = parseIso(value);
  const selected = parsed ? gregorianToJalali(parsed) : null;
  const label = parsed
    ? formatJalali(new Date(Date.UTC(parsed.gy, parsed.gm - 1, parsed.gd, 12)), { monthName: true })
    : placeholder;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const emit = (day: JalaliDay, time: string | null) => {
    const isoDay = jalaliToIsoDay(day);
    onChange(withTime && time ? `${isoDay}T${time}` : isoDay);
  };

  /** A date-time field must keep a clock, so a fresh pick defaults to midday. */
  const timeOrDefault = () => (withTime ? parsed?.time ?? '12:00' : null);

  const pick = (day: JalaliDay) => {
    emit(day, timeOrDefault());
    if (!withTime) setOpen(false);
  };

  const setTime = (next: string) => {
    const day = selected ?? tehranTodayJalali();
    if (!next) {
      // Clearing the clock leaves a plain date, which every caller accepts.
      emit(day, null);
      return;
    }
    onChange(`${jalaliToIsoDay(day)}T${next}`);
  };

  return (
    <div ref={wrapper} className="relative">
      <div className="flex w-full items-center gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            'flex h-9 min-w-36 items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 text-xs transition-colors',
            disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-brand-300',
            className,
          )}
        >
          <span className={cn('num', parsed ? 'text-ink' : 'text-muted')}>{label}</span>
          <CalendarDays aria-hidden className="size-3.5 shrink-0 text-muted" />
        </button>

        {withTime ? (
          <input
            type="time"
            value={parsed?.time ?? ''}
            disabled={disabled}
            onChange={(event) => setTime(event.target.value)}
            aria-label={ariaLabel ? `${ariaLabel}، ساعت` : 'ساعت'}
            className={cn(
              'num h-9 w-24 rounded-xl border border-line bg-surface px-2 text-xs text-ink',
              inputClassName,
            )}
          />
        ) : null}
      </div>

      {open ? (
        <div
          role="dialog"
          aria-label="انتخاب تاریخ جلالی"
          className="absolute z-30 mt-1 w-64 rounded-xl border border-line bg-surface p-3 shadow-lg"
        >
          <JalaliCalendar selected={selected} onPick={pick} />

          <div className="mt-2 flex items-center justify-between gap-1.5 border-t border-line pt-2">
            <button
              type="button"
              onClick={() => {
                const today = tehranTodayJalali();
                emit(today, timeOrDefault());
                if (!withTime) setOpen(false);
              }}
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
