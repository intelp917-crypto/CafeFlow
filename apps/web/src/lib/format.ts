import { formatJalali, formatRial, groupDigits, toPersianDigits } from '@cafeflow/shared';

export { formatRial, toPersianDigits, groupDigits };

/** «۱۴۰۵/۰۸/۲۷ ۱۴:۳۰» from an ISO timestamp; dash when absent. */
export function formatDateTimeFa(iso: string | null | undefined): string {
  if (!iso) return '—';
  return formatJalali(new Date(iso), { withTime: true });
}

/** «۲۷ آبان ۱۴۰۵» from an ISO timestamp. */
export function formatDateFa(iso: string | null | undefined): string {
  if (!iso) return '—';
  return formatJalali(new Date(iso), { monthName: true });
}

/** Grouped Persian integer, used for counters. */
export function formatCountFa(value: number): string {
  return toPersianDigits(groupDigits(value));
}

/** Relative time in Persian, coarse on purpose (dashboards only). */
export function relativeTimeFa(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'همین حالا';
  if (minutes < 60) return `${toPersianDigits(minutes)} دقیقه پیش`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${toPersianDigits(hours)} ساعت پیش`;
  const days = Math.round(hours / 24);
  return `${toPersianDigits(days)} روز پیش`;
}

const PAYMENT_METHOD_FA: Record<string, string> = {
  cash: 'نقدی',
  card: 'کارت‌خوان',
  online: 'آنلاین',
  wallet: 'کیف پول',
  other: 'سایر',
};

export function paymentMethodFa(method: string): string {
  return PAYMENT_METHOD_FA[method] ?? method;
}
