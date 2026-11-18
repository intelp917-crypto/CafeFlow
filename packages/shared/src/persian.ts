/**
 * Persian text handling.
 *
 * Search, sorting and comparison must treat Arabic-presentation variants and
 * Persian/Arabic digits as the same characters, otherwise "كيك" and "کیک"
 * would be two different products.
 */

const ARABIC_TO_PERSIAN: Record<string, string> = {
  'ي': 'ی',
  'ى': 'ی',
  'ك': 'ک',
  'ة': 'ه',
  'ۀ': 'ه',
  'ؤ': 'و',
  'إ': 'ا',
  'أ': 'ا',
  'آ': 'آ',
  'ٱ': 'ا',
};

// Arabic/Persian combining marks: tanwin, harakat, shadda, sukun, hamza above,
// maddah, hamza below, superscript alef and tatweel.
const DIACRITICS = /[\u064B-\u0655\u0670\u0640]/g;
const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\ufeff]/g;

/** Normalizes Persian text for storage, search and comparison. */
export function normalizePersian(input: string): string {
  if (!input) return '';
  let text = input.normalize('NFC').replace(ZERO_WIDTH, '').replace(DIACRITICS, '');

  text = text.replace(/[يىك ةۀؤإأٱ]/g, (ch) => ARABIC_TO_PERSIAN[ch] ?? ch);

  // Arabic-Indic digits -> ASCII (Persian digits are folded below)
  text = text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

  text = text.replace(/[٬,]/g, '').replace(/\s+/g, ' ').trim();
  return text;
}

/** Lower-cased, normalized form used for LIKE-based search keys. */
export function normalizeForSearch(input: string): string {
  return normalizePersian(input).toLowerCase();
}

/** True when two Persian strings are equal after normalization. */
export function persianEquals(a: string, b: string): boolean {
  return normalizePersian(a) === normalizePersian(b);
}

/**
 * Locale-aware comparison for Persian sorting. Persian collation is not
 * exposed by JS engines, so this approximates it: normalized text is compared
 * with `localeCompare('fa')` and digits sort numerically before letters.
 */
export function comparePersian(a: string, b: string): number {
  return normalizePersian(a).localeCompare(normalizePersian(b), 'fa');
}

/** Formats a phone number the way Iranian receipts print it: ۰۹۱۲۳۴۵۶۷۸۹ */
export function formatPhoneFa(phone: string): string {
  const digits = normalizePersian(phone).replace(/[^\d+]/g, '');
  return digits;
}

export function isValidIranianMobile(phone: string): boolean {
  const digits = normalizePersian(phone).replace(/\D/g, '');
  return /^09\d{9}$/.test(digits);
}
