import { describe, expect, it } from 'vitest';
import {
  comparePersian,
  isValidIranianMobile,
  normalizeForSearch,
  normalizePersian,
  persianEquals,
} from '../src/persian';

describe('normalizePersian', () => {
  it('folds Arabic yeh and kaf into Persian letters', () => {
    expect(normalizePersian('كيك')).toBe('کیک');
    expect(normalizePersian('علي')).toBe('علی');
  });

  it('normalizes Arabic-Indic and Persian digits to ASCII', () => {
    expect(normalizePersian('۱۲۳')).toBe('123');
    expect(normalizePersian('٤٥٦')).toBe('456');
  });

  it('removes diacritics, zero-width characters and duplicated spaces', () => {
    expect(normalizePersian('  قَهوهٔ  تلخ  ')).toBe('قهوه تلخ');
  });

  it('collapses thousands separators so amounts compare equal', () => {
    expect(normalizePersian('۱۲٬۵۰۰')).toBe('12500');
  });
});

describe('search helpers', () => {
  it('treats different Arabic presentations as the same word', () => {
    expect(normalizeForSearch('كيك شکلاتي')).toBe(normalizeForSearch('کیک شکلاتی'));
    expect(persianEquals('كتاب', 'کتاب')).toBe(true);
  });

  it('sorts Persian strings with locale collation', () => {
    const sorted = ['پسته', 'بادام', 'آلبالو'].sort(comparePersian);
    expect(sorted[0]).toBe('آلبالو');
  });
});

describe('mobile validation', () => {
  it('accepts Persian-digit Iranian mobile numbers', () => {
    expect(isValidIranianMobile('۰۹۱۲۳۴۵۶۷۸۹')).toBe(true);
    expect(isValidIranianMobile('09123456789')).toBe(true);
  });

  it('rejects malformed numbers', () => {
    expect(isValidIranianMobile('0912345')).toBe(false);
    expect(isValidIranianMobile('12345')).toBe(false);
  });
});
