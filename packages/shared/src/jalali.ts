/**
 * Jalali (Shamsi) calendar utilities.
 *
 * Implemented locally to avoid a runtime dependency: the conversion is the
 * well-known jalaali algorithm (Borkowski), operating on UTC day numbers so
 * that day boundaries are stable regardless of the host timezone.
 *
 * Iran has observed a fixed +03:30 offset since 2022 (no DST), which is why
 * the Tehran helpers below use a constant offset.
 */

import { toLatinDigits, toPersianDigits } from './money';

const TEHRAN_OFFSET_MINUTES = 210;

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
];

function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

function mod(a: number, b: number): number {
  return a - Math.trunc(a / b) * b;
}

interface JalCalResult {
  leap: number;
  gy: number;
  march: number;
}

export function jalCal(jy: number): JalCalResult {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;

  if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error(`سال شمسی نامعتبر است: ${jy}`);

  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }

  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;

  return { leap, gy, march };
}

export function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

export function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

export function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

export function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;

  if (k >= 0) {
    if (k <= 185) {
      return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }

  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export interface JalaliDate {
  jy: number;
  jm: number;
  jd: number;
}

function utcDayNumber(date: Date): number {
  return g2d(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function toJalali(date: Date): JalaliDate {
  return d2j(utcDayNumber(date));
}

export function toGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  return d2g(j2d(jy, jm, jd));
}

export function isJalaliLeapYear(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeapYear(jy) ? 30 : 29;
}

export const JALALI_MONTHS_FA = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

export const JALALI_WEEKDAYS_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export interface FormatJalaliOptions {
  /** Include hour:minute. Default false. */
  withTime?: boolean;
  /** Month as Persian name instead of a number. Default false. */
  monthName?: boolean;
  /** Digit mode for the rendered string. Default 'fa'. */
  digits?: 'fa' | 'latin';
}

/**
 * Formats a Date as a Jalali string in Tehran local time, e.g. «۱۴۰۵/۰۸/۲۷».
 */
export function formatJalali(date: Date, options: FormatJalaliOptions = {}): string {
  const { withTime = false, monthName = false, digits = 'fa' } = options;
  const tehran = new Date(date.getTime() + TEHRAN_OFFSET_MINUTES * 60_000);
  const { jy, jm, jd } = toJalali(tehran);

  const year = String(jy);
  const month = monthName ? JALALI_MONTHS_FA[jm - 1] : pad2(jm);
  const day = pad2(jd);
  let result = monthName ? `${day} ${month} ${year}` : `${year}/${month}/${day}`;

  if (withTime) {
    result += ` ${pad2(tehran.getUTCHours())}:${pad2(tehran.getUTCMinutes())}`;
  }
  return digits === 'fa' ? toPersianDigits(result) : result;
}

/** Parses «۱۴۰۵/۰۸/۲۷» or «1405-8-27» into a Gregorian UTC date at Tehran midnight. */
export function parseJalali(input: string): Date {
  const normalized = toLatinDigits(input).trim().replace(/[-.]/g, '/');
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalized);
  if (!match) throw new Error('تاریخ شمسی نامعتبر است. قالب صحیح: ۱۴۰۵/۰۸/۲۷');
  const jy = Number(match[1]);
  const jm = Number(match[2]);
  const jd = Number(match[3]);
  if (jm < 1 || jm > 12 || jd < 1 || jd > jalaliMonthLength(jy, jm)) {
    throw new Error('تاریخ شمسی نامعتبر است.');
  }
  const g = toGregorian(jy, jm, jd);
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd, 0, 0, 0) - TEHRAN_OFFSET_MINUTES * 60_000);
}

/** Jalali label for "today" in Tehran, used by dashboards and reports. */
export function todayJalali(now: Date = new Date()): string {
  return formatJalali(now, { monthName: true });
}

export interface DayRange {
  startIso: string;
  endIso: string;
  jalaliLabel: string;
  weekdayFa: string;
}

/**
 * UTC range covering the current Tehran calendar day. Stored timestamps are
 * ISO-8601 UTC, so "today's sales" can be answered with a single range query.
 */
export function tehranDayRange(now: Date = new Date()): DayRange {
  const local = new Date(now.getTime() + TEHRAN_OFFSET_MINUTES * 60_000);
  const startMs =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
    TEHRAN_OFFSET_MINUTES * 60_000;
  const start = new Date(startMs);
  const end = new Date(startMs + 24 * 60 * 60_000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    jalaliLabel: formatJalali(now, { monthName: true }),
    weekdayFa: JALALI_WEEKDAYS_FA[local.getUTCDay()],
  };
}
