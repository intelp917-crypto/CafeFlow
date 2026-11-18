import { describe, expect, it } from 'vitest';
import {
  formatRial,
  groupDigits,
  parseAmountInput,
  percentOf,
  assertIntegerAmount,
  toLatinDigits,
  toPersianDigits,
} from '../src/money';

describe('digit conversion', () => {
  it('converts ASCII digits to Persian digits', () => {
    expect(toPersianDigits('1405/08/27')).toBe('۱۴۰۵/۰۸/۲۷');
  });

  it('converts Persian and Arabic-Indic digits back to ASCII', () => {
    expect(toLatinDigits('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890');
    expect(toLatinDigits('٠١٢٣')).toBe('0123');
  });
});

describe('rial formatting', () => {
  it('groups thousands with the Persian separator', () => {
    expect(groupDigits(125000)).toBe('125٬000');
    expect(groupDigits(0)).toBe('0');
    expect(groupDigits(999)).toBe('999');
  });

  it('formats with Persian digits and rial unit by default', () => {
    expect(formatRial(125000)).toBe('۱۲۵٬۰۰۰ ریال');
  });

  it('supports latin digits and omitting the unit', () => {
    expect(formatRial(125000, { digits: 'latin' })).toBe('125٬000 ریال');
    expect(formatRial(4200, { withUnit: false })).toBe('۴٬۲۰۰');
  });

  it('rejects non-integer amounts', () => {
    expect(() => formatRial(10.5)).toThrow();
    expect(() => assertIntegerAmount(1.25)).toThrow();
  });
});

describe('amount parsing', () => {
  it('parses Persian, grouped and spaced input', () => {
    expect(parseAmountInput('۱۲٬۵۰۰')).toBe(12500);
    expect(parseAmountInput('12,500')).toBe(12500);
    expect(parseAmountInput(' 12 500 ریال')).toBe(12500);
  });

  it('returns NaN for empty input', () => {
    expect(Number.isNaN(parseAmountInput(''))).toBe(true);
    expect(Number.isNaN(parseAmountInput('ریال'))).toBe(true);
  });
});

describe('percentOf', () => {
  it('rounds to the nearest rial deterministically', () => {
    expect(percentOf(100000, 9)).toBe(9000);
    expect(percentOf(99999, 9)).toBe(9000);
    expect(percentOf(12345, 10)).toBe(1235);
  });

  it('rejects negative percentages', () => {
    expect(() => percentOf(1000, -1)).toThrow();
  });
});
