import { describe, expect, it } from 'vitest';
import {
  formatJalali,
  jalaliMonthLength,
  parseJalali,
  tehranDayRange,
  toGregorian,
  toJalali,
  todayJalali,
} from '../src/jalali';

const utc = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m - 1, d, h));

describe('gregorian to jalali', () => {
  it('converts Nowruz 2026 to 1405/01/01', () => {
    expect(toJalali(utc(2026, 3, 21))).toEqual({ jy: 1405, jm: 1, jd: 1 });
  });

  it('converts the project date 2026-11-18 to 1405/08/27', () => {
    expect(toJalali(utc(2026, 11, 18))).toEqual({ jy: 1405, jm: 8, jd: 27 });
  });

  it('handles the last day of Esfand in a leap year', () => {
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
  });
});

describe('jalali to gregorian', () => {
  it('round-trips a date', () => {
    expect(toGregorian(1405, 8, 27)).toEqual({ gy: 2026, gm: 11, gd: 18 });
  });
});

describe('formatting', () => {
  it('formats with Persian digits', () => {
    expect(formatJalali(utc(2026, 11, 18, 10))).toBe('۱۴۰۵/۰۸/۲۷');
  });

  it('formats month names and time', () => {
    expect(formatJalali(utc(2026, 11, 18, 10), { monthName: true })).toBe('۲۷ آبان ۱۴۰۵');
    // +03:30 offset shifts 10:00Z to 13:30 Tehran
    expect(formatJalali(utc(2026, 11, 18, 10), { withTime: true, digits: 'latin' })).toBe('1405/08/27 13:30');
  });

  it('accepts Persian digits in month names', () => {
    expect(todayJalali(utc(2026, 3, 21, 9))).toBe('۰۱ فروردین ۱۴۰۵');
  });
});

describe('parsing', () => {
  it('parses Persian formatted dates back to Tehran midnight', () => {
    const parsed = parseJalali('۱۴۰۵/۰۸/۲۷');
    // Tehran midnight is 20:30 UTC on the previous day
    expect(parsed.toISOString()).toBe('2026-11-17T20:30:00.000Z');
  });

  it('rejects invalid dates', () => {
    expect(() => parseJalali('1405/13/01')).toThrow();
    expect(() => parseJalali('not-a-date')).toThrow();
  });
});

describe('tehranDayRange', () => {
  it('covers the Tehran calendar day in UTC bounds', () => {
    const range = tehranDayRange(new Date(Date.UTC(2026, 10, 18, 10, 0, 0)));
    expect(range.startIso).toBe('2026-11-17T20:30:00.000Z');
    expect(range.endIso).toBe('2026-11-18T20:30:00.000Z');
    expect(range.jalaliLabel).toBe('۲۷ آبان ۱۴۰۵');
    expect(range.weekdayFa).toBe('چهارشنبه');
  });
});
