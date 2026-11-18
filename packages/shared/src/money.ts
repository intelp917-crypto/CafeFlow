/**
 * Money helpers.
 *
 * All monetary values are integer amounts in Iranian rial. Floats are never
 * used for money, and the server always recomputes totals from stored item
 * snapshots — the client's arithmetic is only a preview.
 */

export type DigitMode = 'fa' | 'latin';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const ARABIC_INDIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

export function toLatinDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC_DIGITS.indexOf(d)));
}

export function assertIntegerAmount(value: number, label = 'مبلغ'): number {
  if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new Error(`${label} باید عدد صحیح (ریال) باشد.`);
  }
  return value;
}

/** Groups thousands with the Persian thousands separator (٬). */
export function groupDigits(value: number): string {
  const sign = value < 0 ? '-' : '';
  const digits = Math.abs(Math.trunc(value)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
}

export interface FormatMoneyOptions {
  digits?: DigitMode;
  /** Appended unit text, default «ریال». Pass '' to omit. */
  unit?: string;
  /** Keep the currency word off but still group digits. */
  withUnit?: boolean;
}

/** Formats an integer rial amount for display: ۱۲۵٬۰۰۰ ریال */
export function formatRial(amount: number, options: FormatMoneyOptions = {}): string {
  const { digits = 'fa', unit = 'ریال', withUnit = true } = options;
  assertIntegerAmount(amount);
  const grouped = groupDigits(amount);
  const rendered = digits === 'fa' ? toPersianDigits(grouped) : grouped;
  return withUnit ? `${rendered} ${unit}` : rendered;
}

/** Parses user input ("۱۲٬۵۰۰", "12,500", "12 500") into an integer amount. */
export function parseAmountInput(input: string): number {
  const cleaned = toLatinDigits(String(input))
    .replace(/[٬,\s\u200c]/g, '')
    .replace(/[^\d-]/g, '');
  if (cleaned === '' || cleaned === '-') return NaN;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : NaN;
}

/**
 * Rounds a percentage-based computation to the nearest rial. Used for tax and
 * service charge so that the same inputs always produce the same integer.
 */
export function percentOf(amountRial: number, percent: number): number {
  assertIntegerAmount(amountRial);
  if (!Number.isFinite(percent) || percent < 0) throw new Error('درصد نامعتبر است.');
  return Math.round((amountRial * percent) / 100);
}

export function sumRial(amounts: number[]): number {
  return amounts.reduce((total, amount) => total + assertIntegerAmount(amount), 0);
}
