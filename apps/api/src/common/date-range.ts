import { badRequest } from './errors';

const TEHRAN_OFFSET_MINUTES = 210;

export interface DayRange {
  /** Calendar day boundaries are Tehran-local; `from`/`to` are `YYYY-MM-DD`. */
  from: string;
  to: string;
  startIso: string;
  endIso: string;
}

function todayTehran(): string {
  return new Date(Date.now() + TEHRAN_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

function isValidDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Resolves a Tehran calendar range from optional `YYYY-MM-DD` bounds.
 *
 * With no bounds the range is today (plus `defaultDays` forward days), which is
 * what the dashboard-style screens want without a client-supplied date.
 */
export function resolveDayRange(from?: string, to?: string, defaultDays = 0): DayRange {
  if (from && !isValidDate(from)) throw badRequest('تاریخ شروع معتبر نیست.', 'INVALID_DATE_RANGE');
  if (to && !isValidDate(to)) throw badRequest('تاریخ پایان معتبر نیست.', 'INVALID_DATE_RANGE');

  const today = todayTehran();
  const startDate = from ?? to ?? today;
  const endDate = to ?? addDays(startDate, defaultDays);

  if (startDate > endDate) {
    throw badRequest('تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.', 'INVALID_DATE_RANGE');
  }
  if (addDays(startDate, 400) < endDate) {
    throw badRequest('بازه تاریخ بیش از حد بزرگ است.', 'INVALID_DATE_RANGE');
  }

  return {
    from: startDate,
    to: endDate,
    startIso: `${startDate}T00:00:00.000+03:30`,
    endIso: `${addDays(endDate, 1)}T00:00:00.000+03:30`,
  };
}
