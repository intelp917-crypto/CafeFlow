import { useState } from 'react';
import { jalaliMonthLength, toLatinDigits } from '@cafeflow/shared';
import { JalaliCalendar, tehranTodayJalali, type JalaliDay } from '../JalaliCalendar';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Reads the «۱۴۰۵/۰۸/۲۷» string the report page already stores. */
function parseJalaliValue(value: string): JalaliDay | null {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(toLatinDigits(value.trim()));
  if (!match) return null;
  const jy = Number(match[1]);
  const jm = Number(match[2]);
  const jd = Number(match[3]);
  if (jm < 1 || jm > 12 || jd < 1 || jd > jalaliMonthLength(jy, jm)) return null;
  return { jy, jm, jd };
}

function formatJalaliValue({ jy, jm, jd }: JalaliDay): string {
  return `${jy}/${pad2(jm)}/${pad2(jd)}`;
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
  const selected = parseJalaliValue(value);
  const today = tehranTodayJalali();

  const pick = (day: JalaliDay) => {
    onChange(formatJalaliValue(day));
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-9 w-40 items-center justify-between rounded-xl border border-line bg-surface px-3 text-xs"
      >
        <span className={selected ? 'num text-ink' : 'text-muted'}>
          {selected ? formatJalaliValue(selected) : placeholder}
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
          <JalaliCalendar selected={selected} onPick={pick} />

          <div className="mt-2 flex items-center justify-between gap-1.5 border-t border-line pt-2">
            <button type="button" onClick={() => pick(today)} className="text-[10px] text-brand-700">
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
