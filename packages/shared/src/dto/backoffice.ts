import { z } from 'zod';

/**
 * Contracts for the back-office surfaces that complete the phase-9 modules:
 * staff shifts and attendance, expenses and profit reporting, purchasing and
 * waste, and the outbound message centre.
 *
 * Every route behind these types is session-authenticated, permission-gated
 * and — for optional modules — blocked by the module guard.
 */

const isoDateTime = (label: string) =>
  z
    .string({ error: `${label} الزامی است.` })
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), `${label} معتبر نیست.`);

const calendarDate = (label: string) =>
  z
    .string({ error: `${label} باید به شکل YYYY-MM-DD باشد.` })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} باید به شکل YYYY-MM-DD باشد.`);

/* --------------------------- employees & shifts --------------------------- */

export const EMPLOYEE_STATUSES = ['active', 'on_leave', 'inactive'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const EMPLOYEE_STATUS_LABELS_FA: Record<EmployeeStatus, string> = {
  active: 'فعال',
  on_leave: 'مرخصی',
  inactive: 'غیرفعال',
};

export const createEmployeeSchema = z.object({
  userId: z.string({ error: 'کاربر الزامی است.' }).trim().min(1, 'کاربر الزامی است.'),
  employeeCode: z.string().trim().max(24, 'کد پرسنلی بیش از حد طولانی است.').optional(),
  departmentId: z.string().trim().max(64).optional(),
  floorId: z.string().trim().max(64).optional(),
  positionFa: z.string().trim().max(60, 'عنوان شغلی بیش از حد طولانی است.').optional(),
  hiredAt: calendarDate('تاریخ استخدام').optional(),
  status: z.enum(EMPLOYEE_STATUSES, { error: 'وضعیت کارمند نامعتبر است.' }).default('active'),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z
  .object({
    employeeCode: z.string().trim().max(24).optional(),
    departmentId: z.string().trim().max(64).nullable().optional(),
    floorId: z.string().trim().max(64).nullable().optional(),
    positionFa: z.string().trim().max(60).nullable().optional(),
    hiredAt: calendarDate('تاریخ استخدام').nullable().optional(),
    status: z.enum(EMPLOYEE_STATUSES, { error: 'وضعیت کارمند نامعتبر است.' }).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'حداقل یک تغییر لازم است.',
  });
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export interface EmployeeRow {
  id: string;
  userId: string;
  fullName: string;
  username: string;
  employeeCode: string | null;
  departmentId: string | null;
  departmentNameFa: string | null;
  floorId: string | null;
  floorNameFa: string | null;
  positionFa: string | null;
  hiredAt: string | null;
  status: EmployeeStatus;
  statusLabelFa: string;
  isUserActive: boolean;
  shiftsThisWeek: number;
}

export interface EmployeesResponse {
  items: EmployeeRow[];
  summary: { total: number; active: number; onLeave: number };
  /** Users without an employee profile yet, so the UI can offer them. */
  candidates: Array<{ id: string; fullName: string; username: string }>;
  departments: Array<{ id: string; nameFa: string }>;
  floors: Array<{ id: string; nameFa: string }>;
}

export const SHIFT_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

export const SHIFT_STATUS_LABELS_FA: Record<ShiftStatus, string> = {
  scheduled: 'برنامه‌ریزی‌شده',
  completed: 'انجام‌شده',
  cancelled: 'لغو‌شده',
};

export const createShiftSchema = z
  .object({
    employeeId: z.string({ error: 'کارمند الزامی است.' }).trim().min(1, 'کارمند الزامی است.'),
    startsAt: isoDateTime('زمان شروع'),
    endsAt: isoDateTime('زمان پایان'),
    note: z.string().trim().max(200, 'یادداشت بیش از حد طولانی است.').optional(),
  })
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
    message: 'زمان پایان باید بعد از شروع باشد.',
    path: ['endsAt'],
  })
  .refine((value) => Date.parse(value.endsAt) - Date.parse(value.startsAt) <= 24 * 60 * 60 * 1000, {
    message: 'یک شیفت نمی‌تواند بیش از ۲۴ ساعت باشد.',
    path: ['endsAt'],
  });
export type CreateShiftInput = z.infer<typeof createShiftSchema>;

export interface ShiftRow {
  id: string;
  employeeId: string;
  employeeName: string;
  departmentNameFa: string | null;
  startsAt: string;
  endsAt: string;
  durationHours: number;
  status: ShiftStatus;
  statusLabelFa: string;
  note: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  workedHours: number;
}

export interface ShiftsResponse {
  from: string;
  to: string;
  items: ShiftRow[];
  summary: { scheduled: number; completed: number; hours: number };
}

export interface StaffPerformanceRow {
  employeeId: string;
  fullName: string;
  positionFa: string | null;
  departmentNameFa: string | null;
  shifts: number;
  scheduledHours: number;
  workedHours: number;
  ordersServed: number;
  paymentsCount: number;
  revenue: number;
}

export interface StaffPerformanceResponse {
  from: string;
  to: string;
  items: StaffPerformanceRow[];
  totals: { workedHours: number; ordersServed: number; revenue: number };
}

/* --------------------------------- finance -------------------------------- */

export const EXPENSE_CATEGORIES = [
  'ingredients',
  'rent',
  'salary',
  'utilities',
  'marketing',
  'maintenance',
  'equipment',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS_FA: Record<ExpenseCategory, string> = {
  ingredients: 'مواد اولیه',
  rent: 'اجاره',
  salary: 'حقوق و دستمزد',
  utilities: 'آب، برق و گاز',
  marketing: 'بازاریابی',
  maintenance: 'تعمیر و نگهداری',
  equipment: 'تجهیزات',
  other: 'سایر',
};

export const createExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES, { error: 'دسته هزینه نامعتبر است.' }),
  amount: z
    .number({ error: 'مبلغ هزینه باید عدد باشد.' })
    .int('مبلغ هزینه باید عدد صحیح ریال باشد.')
    .min(1, 'مبلغ هزینه باید بیشتر از صفر باشد.')
    .max(100_000_000_000, 'مبلغ هزینه بیش از حد مجاز است.'),
  description: z.string().trim().max(200, 'شرح بیش از حد طولانی است.').optional(),
  spentAt: isoDateTime('زمان هزینه').optional(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export interface ExpenseRow {
  id: string;
  category: ExpenseCategory;
  categoryLabelFa: string;
  amount: number;
  description: string | null;
  spentAt: string;
  createdByName: string | null;
}

export interface FinanceSummaryResponse {
  from: string;
  to: string;
  revenue: number;
  refunds: number;
  netRevenue: number;
  expenses: number;
  profit: number;
  marginPercent: number;
  expensesByCategory: Array<{ category: ExpenseCategory; labelFa: string; total: number }>;
  daily: Array<{ date: string; revenue: number; expenses: number; profit: number }>;
  expensesList: ExpenseRow[];
}

/* ------------------------------- purchasing ------------------------------- */

export const createSupplierSchema = z.object({
  nameFa: z.string({ error: 'نام تأمین‌کننده الزامی است.' }).trim().min(2, 'نام تأمین‌کننده الزامی است.').max(80),
  phone: z.string().trim().max(24, 'شماره تماس معتبر نیست.').optional(),
  address: z.string().trim().max(200, 'نشانی بیش از حد طولانی است.').optional(),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export interface SupplierRow {
  id: string;
  nameFa: string;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  purchaseCount: number;
  lastPurchaseAt: string | null;
}

export const createPurchaseSchema = z.object({
  supplierId: z.string().trim().max(64).optional(),
  invoiceNo: z.string().trim().max(40, 'شماره فاکتور بیش از حد طولانی است.').optional(),
  purchasedAt: isoDateTime('زمان خرید').optional(),
  items: z
    .array(
      z.object({
        ingredientId: z.string({ error: 'ماده اولیه الزامی است.' }).trim().min(1, 'ماده اولیه الزامی است.'),
        qty: z.number({ error: 'مقدار باید عدد باشد.' }).positive('مقدار باید بیشتر از صفر باشد.').max(1_000_000),
        unitCost: z
          .number({ error: 'بهای واحد باید عدد باشد.' })
          .int('بهای واحد باید عدد صحیح ریال باشد.')
          .min(0, 'بهای واحد نمی‌تواند منفی باشد.')
          .max(100_000_000, 'بهای واحد بیش از حد مجاز است.'),
      }),
    )
    .min(1, 'حداقل یک قلم کالا لازم است.')
    .max(60, 'تعداد اقلام خرید بیش از حد مجاز است.'),
});
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;

export interface PurchaseRow {
  id: string;
  supplierId: string | null;
  supplierNameFa: string | null;
  invoiceNo: string | null;
  total: number;
  purchasedAt: string;
  itemCount: number;
  createdByName: string | null;
}

export const createWasteSchema = z.object({
  ingredientId: z.string({ error: 'ماده اولیه الزامی است.' }).trim().min(1, 'ماده اولیه الزامی است.'),
  qty: z.number({ error: 'مقدار باید عدد باشد.' }).positive('مقدار باید بیشتر از صفر باشد.').max(1_000_000),
  reason: z.string({ error: 'دلیل ضایعات الزامی است.' }).trim().min(2, 'دلیل ضایعات الزامی است.').max(200),
});
export type CreateWasteInput = z.infer<typeof createWasteSchema>;

export interface WasteRow {
  id: string;
  ingredientId: string;
  ingredientNameFa: string;
  qty: number;
  unitSymbol: string | null;
  reason: string | null;
  recordedByName: string | null;
  createdAt: string;
}

/* ------------------------------ message centre ---------------------------- */

export const MESSAGE_CHANNELS = ['sms', 'push', 'inapp'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_CHANNEL_LABELS_FA: Record<MessageChannel, string> = {
  sms: 'پیامک',
  push: 'اعلان مرورگر',
  inapp: 'درون‌برنامه',
};

export const MESSAGE_STATUSES = ['queued', 'sending', 'sent', 'failed', 'skipped'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_STATUS_LABELS_FA: Record<MessageStatus, string> = {
  queued: 'در صف',
  sending: 'در حال ارسال',
  sent: 'ارسال‌شده',
  failed: 'ناموفق',
  skipped: 'رد شده',
};

export const MESSAGE_STATUS_TONES: Record<MessageStatus, 'brand' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  queued: 'warning',
  sending: 'brand',
  sent: 'success',
  failed: 'danger',
  skipped: 'neutral',
};

export const createTemplateSchema = z.object({
  key: z
    .string({ error: 'کلید قالب الزامی است.' })
    .trim()
    .min(2, 'کلید قالب الزامی است.')
    .max(40, 'کلید قالب بیش از حد طولانی است.')
    .regex(/^[a-z0-9_]+$/, 'کلید قالب فقط می‌تواند شامل حروف کوچک انگلیسی، رقم و زیرخط باشد.'),
  channel: z.enum(MESSAGE_CHANNELS, { error: 'کانال پیام نامعتبر است.' }),
  titleFa: z.string({ error: 'عنوان الزامی است.' }).trim().min(2, 'عنوان الزامی است.').max(120),
  bodyFa: z.string({ error: 'متن پیام الزامی است.' }).trim().min(2, 'متن پیام الزامی است.').max(500),
  isActive: z.boolean().default(true),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z
  .object({
    titleFa: z.string().trim().min(2, 'عنوان الزامی است.').max(120).optional(),
    bodyFa: z.string().trim().min(2, 'متن پیام الزامی است.').max(500).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'حداقل یک تغییر لازم است.',
  });
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export interface MessageTemplateRow {
  id: string;
  key: string;
  channel: MessageChannel;
  channelLabelFa: string;
  titleFa: string;
  bodyFa: string;
  isActive: boolean;
}

export const sendMessageSchema = z
  .object({
    channel: z.enum(['sms', 'push'], { error: 'کانال ارسال نامعتبر است.' }),
    templateKey: z.string().trim().max(40).optional(),
    titleFa: z.string().trim().max(120).optional(),
    bodyFa: z.string().trim().max(500).optional(),
    recipients: z
      .array(z.string().trim().min(3).max(80))
      .min(1, 'حداقل یک گیرنده لازم است.')
      .max(200, 'تعداد گیرندگان بیش از حد مجاز است.'),
    variables: z.record(z.string(), z.string().trim().max(120)).optional(),
  })
  .refine((value) => Boolean(value.templateKey) || Boolean(value.bodyFa), {
    message: 'متن پیام یا یک قالب انتخاب کنید.',
    path: ['bodyFa'],
  });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export interface OutboxRow {
  id: string;
  channel: MessageChannel;
  channelLabelFa: string;
  templateKey: string | null;
  recipient: string | null;
  titleFa: string | null;
  bodyFa: string | null;
  status: MessageStatus;
  statusLabelFa: string;
  attempts: number;
  lastError: string | null;
  scheduledAt: string;
  sentAt: string | null;
}

export interface MessagesResponse {
  items: OutboxRow[];
  templates: MessageTemplateRow[];
  summary: { queued: number; sent: number; failed: number };
}

export interface SendMessageResponse {
  queued: number;
  items: OutboxRow[];
}
