import { z } from 'zod';
import { passwordSchema } from './auth';

/**
 * Contracts for the management surfaces of phase 6: reservations, inventory,
 * staff administration, cash sessions (finance) and the customer club (CRM).
 * Every route behind these types is session-authenticated, permission-gated and
 * — for the optional modules — also blocked by the module guard.
 */

/** Digits-only phone normalisation shared by reservations and CRM. */
export function normalizePhone(value: string): string {
  const latin = value
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
  const digits = latin.replace(/\D/g, '');
  if (digits.startsWith('0098')) return `0${digits.slice(4)}`;
  if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}`;
  return digits;
}

/* ------------------------------ reservations ------------------------------ */

export const RESERVATION_STATUSES = ['pending', 'confirmed', 'seated', 'cancelled', 'no_show'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_STATUS_LABELS_FA: Record<ReservationStatus, string> = {
  pending: 'در انتظار تأیید',
  confirmed: 'تأیید شده',
  seated: 'حاضر شد',
  cancelled: 'لغو شده',
  no_show: 'عدم حضور',
};

/** Legal status edges for a reservation; the server is the only authority. */
export const RESERVATION_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  pending: ['confirmed', 'cancelled', 'no_show'],
  confirmed: ['seated', 'cancelled', 'no_show'],
  seated: ['cancelled'],
  cancelled: [],
  no_show: [],
};

export const createReservationSchema = z.object({
  customerName: z.string().trim().min(2, 'نام مشتری الزامی است.').max(80, 'نام مشتری بیش از حد طولانی است.'),
  customerPhone: z
    .string({ error: 'شماره تماس الزامی است.' })
    .trim()
    .min(7, 'شماره تماس معتبر نیست.')
    .max(24, 'شماره تماس معتبر نیست.')
    .refine((value) => /^0?\d{7,14}$/.test(normalizePhone(value)), 'شماره تماس معتبر نیست.'),
  guestCount: z
    .number({ error: 'تعداد مهمان باید عدد باشد.' })
    .int('تعداد مهمان باید عدد صحیح باشد.')
    .min(1, 'تعداد مهمان حداقل ۱ است.')
    .max(60, 'تعداد مهمان بیش از حد مجاز است.'),
  reservedFor: z
    .string({ error: 'زمان رزرو الزامی است.' })
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), 'زمان رزرو معتبر نیست.'),
  durationMinutes: z
    .number({ error: 'مدت رزرو باید عدد باشد.' })
    .int('مدت رزرو باید عدد صحیح باشد.')
    .min(15, 'مدت رزرو حداقل ۱۵ دقیقه است.')
    .max(480, 'مدت رزرو حداکثر ۸ ساعت است.')
    .default(90),
  tableId: z.string().trim().max(64).optional(),
  note: z.string().trim().max(300, 'یادداشت بیش از حد طولانی است.').optional(),
});
export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const reservationStatusSchema = z.object({
  status: z.enum(RESERVATION_STATUSES, { error: 'وضعیت رزرو نامعتبر است.' }),
  reason: z.string().trim().max(200, 'دلیل بیش از حد طولانی است.').optional(),
});
export type ReservationStatusInput = z.infer<typeof reservationStatusSchema>;

export const listReservationsQuerySchema = z.object({
  /** Tehran calendar day (`YYYY-MM-DD`); omitted returns every upcoming row. */
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ باید به شکل YYYY-MM-DD باشد.')
    .optional(),
  status: z.string().trim().max(40).optional(),
  scope: z.enum(['upcoming', 'all']).default('upcoming'),
  tableId: z.string().trim().max(64).optional(),
});
export type ListReservationsQuery = z.infer<typeof listReservationsQuerySchema>;

export interface ReservationRow {
  id: string;
  customerName: string;
  customerPhone: string;
  guestCount: number;
  reservedFor: string;
  durationMinutes: number;
  tableId: string | null;
  tableCode: string | null;
  tableNameFa: string | null;
  tableCapacity: number | null;
  status: ReservationStatus;
  statusLabelFa: string;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
  allowedStatuses: Array<{ status: ReservationStatus; labelFa: string }>;
}

export interface ReservationsResponse {
  items: ReservationRow[];
  summary: { pending: number; confirmed: number; seated: number };
}

/* -------------------------------- inventory ------------------------------- */

export const STOCK_MOVEMENT_TYPES = ['purchase', 'sale_deduction', 'adjustment', 'waste', 'restore'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_LABELS_FA: Record<StockMovementType, string> = {
  purchase: 'خرید',
  sale_deduction: 'کسر بابت فروش',
  adjustment: 'اصلاح موجودی',
  waste: 'ضایعات',
  restore: 'بازگردانی',
};

export interface IngredientRow {
  id: string;
  nameFa: string;
  unitSymbol: string | null;
  currentQty: number;
  minQty: number;
  costPerUnit: number;
  isActive: boolean;
  isLow: boolean;
}

export interface IngredientsResponse {
  items: IngredientRow[];
  summary: { total: number; low: number; out: number };
}

export const createIngredientSchema = z.object({
  nameFa: z.string().trim().min(2, 'نام ماده اولیه الزامی است.').max(80, 'نام بیش از حد طولانی است.'),
  unitSymbol: z.string().trim().min(1, 'واحد الزامی است.').max(12, 'واحد بیش از حد طولانی است.').optional(),
  currentQty: z
    .number({ error: 'موجودی باید عدد باشد.' })
    .min(0, 'موجودی نمی‌تواند منفی باشد.')
    .max(1_000_000, 'موجودی بیش از حد مجاز است.')
    .default(0),
  minQty: z
    .number({ error: 'حد هشدار باید عدد باشد.' })
    .min(0, 'حد هشدار نمی‌تواند منفی باشد.')
    .max(1_000_000, 'حد هشدار بیش از حد مجاز است.')
    .default(0),
  costPerUnit: z
    .number({ error: 'بهای واحد باید عدد باشد.' })
    .int('بهای واحد باید عدد صحیح ریال باشد.')
    .min(0, 'بهای واحد نمی‌تواند منفی باشد.')
    .default(0),
});
export type CreateIngredientInput = z.infer<typeof createIngredientSchema>;

export const adjustStockSchema = z.object({
  delta: z
    .number({ error: 'مقدار اصلاح باید عدد باشد.' })
    .refine((value) => value !== 0, 'مقدار اصلاح نمی‌تواند صفر باشد.')
    .refine((value) => Math.abs(value) <= 1_000_000, 'مقدار اصلاح بیش از حد مجاز است.'),
  reason: z.string().trim().min(2, 'دلیل اصلاح الزامی است.').max(200, 'دلیل بیش از حد طولانی است.'),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export interface StockMovementRow {
  id: string;
  ingredientId: string;
  ingredientNameFa: string;
  type: StockMovementType;
  typeLabelFa: string;
  qty: number;
  unitSymbol: string | null;
  refType: string | null;
  refId: string | null;
  orderCode: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface RecipeItemRow {
  ingredientId: string;
  ingredientNameFa: string;
  unitSymbol: string | null;
  qty: number;
}

export interface RecipeView {
  productId: string;
  productNameFa: string;
  yieldQty: number;
  items: RecipeItemRow[];
}

export const setRecipeSchema = z.object({
  yieldQty: z
    .number({ error: 'مقدار خروجی باید عدد باشد.' })
    .positive('مقدار خروجی باید بیشتر از صفر باشد.')
    .max(10_000, 'مقدار خروجی بیش از حد مجاز است.')
    .default(1),
  items: z
    .array(
      z.object({
        ingredientId: z.string().trim().min(1, 'ماده اولیه الزامی است.'),
        qty: z.number({ error: 'مقدار باید عدد باشد.' }).positive('مقدار باید بیشتر از صفر باشد.'),
      }),
    )
    .max(60, 'تعداد اقلام دستور پخت بیش از حد مجاز است.'),
});
export type SetRecipeInput = z.infer<typeof setRecipeSchema>;

/* --------------------------------- staff ---------------------------------- */

export const createStaffSchema = z.object({
  username: z
    .string({ error: 'نام کاربری الزامی است.' })
    .trim()
    .min(3, 'نام کاربری حداقل ۳ نویسه است.')
    .max(32, 'نام کاربری حداکثر ۳۲ نویسه است.')
    .regex(/^[a-zA-Z0-9._-]+$/, 'نام کاربری فقط می‌تواند شامل حروف انگلیسی، رقم، نقطه، خط تیره و زیرخط باشد.'),
  fullName: z.string().trim().min(2, 'نام و نام خانوادگی الزامی است.').max(80, 'نام بیش از حد طولانی است.'),
  password: passwordSchema,
  roleKeys: z
    .array(z.string().trim().min(1))
    .min(1, 'حداقل یک نقش لازم است.')
    .max(8, 'تعداد نقش‌ها بیش از حد مجاز است.'),
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z
  .object({
    fullName: z.string().trim().min(2, 'نام و نام خانوادگی الزامی است.').max(80, 'نام بیش از حد طولانی است.').optional(),
    isActive: z.boolean({ error: 'وضعیت باید درست یا نادرست باشد.' }).optional(),
    roleKeys: z.array(z.string().trim().min(1)).min(1, 'حداقل یک نقش لازم است.').max(8).optional(),
    newPassword: passwordSchema.optional(),
    /** Clears TOTP + recovery codes, e.g. when a staff member lost the device. */
    resetMfa: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.fullName !== undefined ||
      value.isActive !== undefined ||
      value.roleKeys !== undefined ||
      value.newPassword !== undefined ||
      value.resetMfa !== undefined,
    { message: 'حداقل یک تغییر لازم است.' },
  );
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

/* --------------------------------- finance -------------------------------- */

export interface CashRegisterRow {
  id: string;
  nameFa: string;
  isActive: boolean;
}

export const openCashSessionSchema = z.object({
  registerId: z.string({ error: 'صندوق الزامی است.' }).trim().min(1, 'صندوق الزامی است.'),
  openingFloat: z
    .number({ error: 'موجودی اولیه باید عدد باشد.' })
    .int('موجودی اولیه باید عدد صحیح ریال باشد.')
    .min(0, 'موجودی اولیه نمی‌تواند منفی باشد.')
    .max(10_000_000_000, 'موجودی اولیه بیش از حد مجاز است.')
    .default(0),
});
export type OpenCashSessionInput = z.infer<typeof openCashSessionSchema>;

export const closeCashSessionSchema = z.object({
  closingAmount: z
    .number({ error: 'مبلغ شمارش‌شده باید عدد باشد.' })
    .int('مبلغ شمارش‌شده باید عدد صحیح ریال باشد.')
    .min(0, 'مبلغ شمارش‌شده نمی‌تواند منفی باشد.')
    .max(10_000_000_000, 'مبلغ شمارش‌شده بیش از حد مجاز است.'),
});
export type CloseCashSessionInput = z.infer<typeof closeCashSessionSchema>;

export interface CashSessionRow {
  id: string;
  registerId: string;
  registerNameFa: string;
  status: 'open' | 'closed';
  openedByName: string | null;
  openedAt: string;
  openingFloat: number;
  cashTotal: number;
  cardTotal: number;
  paymentsCount: number;
  refundsTotal: number;
  expectedAmount: number;
  closedAt: string | null;
  closingAmount: number | null;
  difference: number | null;
}

export interface CashSessionsResponse {
  registers: CashRegisterRow[];
  current: CashSessionRow | null;
  history: CashSessionRow[];
}

/* ----------------------------------- CRM ---------------------------------- */

export const LOYALTY_TIERS = ['regular', 'silver', 'gold', 'vip'] as const;
export type LoyaltyTier = (typeof LOYALTY_TIERS)[number];

export const LOYALTY_TIER_LABELS_FA: Record<LoyaltyTier, string> = {
  regular: 'عادی',
  silver: 'نقره‌ای',
  gold: 'طلایی',
  vip: 'ویژه',
};

/** Points needed for each tier; the highest satisfied threshold wins. */
export const LOYALTY_TIER_THRESHOLDS: Array<{ tier: LoyaltyTier; points: number }> = [
  { tier: 'vip', points: 1000 },
  { tier: 'gold', points: 500 },
  { tier: 'silver', points: 200 },
];

export function tierForPoints(points: number): LoyaltyTier {
  return LOYALTY_TIER_THRESHOLDS.find((entry) => points >= entry.points)?.tier ?? 'regular';
}

export const createCustomerSchema = z.object({
  name: z.string().trim().max(80, 'نام بیش از حد طولانی است.').optional(),
  phone: z
    .string({ error: 'شماره تماس الزامی است.' })
    .trim()
    .min(7, 'شماره تماس معتبر نیست.')
    .max(24, 'شماره تماس معتبر نیست.')
    .refine((value) => /^0?\d{7,14}$/.test(normalizePhone(value)), 'شماره تماس معتبر نیست.'),
  birthDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ تولد باید به شکل YYYY-MM-DD باشد.')
    .optional(),
  notes: z.string().trim().max(300, 'یادداشت بیش از حد طولانی است.').optional(),
  consentMarketing: z.boolean().default(false),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const adjustLoyaltySchema = z
  .object({
    points: z
      .number({ error: 'امتیاز باید عدد باشد.' })
      .int('امتیاز باید عدد صحیح باشد.')
      .refine((value) => Math.abs(value) <= 100_000, 'تغییر امتیاز بیش از حد مجاز است.')
      .optional(),
    wallet: z
      .number({ error: 'مبلغ کیف پول باید عدد باشد.' })
      .int('مبلغ کیف پول باید عدد صحیح ریال باشد.')
      .refine((value) => Math.abs(value) <= 10_000_000_000, 'تغییر کیف پول بیش از حد مجاز است.')
      .optional(),
    reason: z.string().trim().min(2, 'دلیل تغییر الزامی است.').max(200, 'دلیل بیش از حد طولانی است.'),
  })
  .refine((value) => (value.points ?? 0) !== 0 || (value.wallet ?? 0) !== 0, {
    message: 'حداقل یکی از امتیاز یا کیف پول باید تغییر کند.',
  });
export type AdjustLoyaltyInput = z.infer<typeof adjustLoyaltySchema>;

export interface CustomerRow {
  id: string;
  name: string | null;
  phone: string;
  birthDate: string | null;
  notes: string | null;
  consentMarketing: boolean;
  points: number;
  tier: LoyaltyTier;
  tierLabelFa: string;
  walletBalance: number;
  createdAt: string;
}

export interface LoyaltyLedgerEntry {
  id: string;
  kind: 'points' | 'wallet';
  delta: number;
  reason: string;
  createdAt: string;
}

export interface CustomerReservationHistory {
  id: string;
  reservedFor: string;
  guestCount: number;
  status: ReservationStatus;
  statusLabelFa: string;
  tableNameFa: string | null;
}

export interface CustomerDetail extends CustomerRow {
  ledger: LoyaltyLedgerEntry[];
  /** Reservations matched by the customer's normalised phone number. */
  reservations: CustomerReservationHistory[];
}

export interface CustomersResponse {
  items: CustomerRow[];
  total: number;
}
