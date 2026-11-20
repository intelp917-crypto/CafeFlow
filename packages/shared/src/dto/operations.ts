import { z } from 'zod';
import { ORDER_STATUSES, PREP_STATUSES, ORDER_STATUS_LABELS_FA, type OrderStatus } from '../order-state';
import type { CustomerRequestType } from './public';

/**
 * Contracts for the staff operational surfaces (phase 3): order queue, prep
 * queue, live tables and customer requests. These are authenticated routes —
 * unlike `dto/public.ts`, nothing here is reachable without a session.
 */

/** Statuses that still need work before an order can be closed. */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  'submitted',
  'awaiting_confirmation',
  'confirmed',
  'preparing',
  'partially_ready',
  'ready',
  'served',
  'awaiting_payment',
];

export const orderTransitionSchema = z.object({
  to: z.enum(ORDER_STATUSES, { error: 'وضعیت مقصد نامعتبر است.' }),
  reason: z.string().trim().max(300, 'دلیل بیش از حد طولانی است.').optional(),
});
export type OrderTransitionInput = z.infer<typeof orderTransitionSchema>;

/**
 * A staff-entered order line. The waiter picks freely from the live menu; the
 * server prices every line with the same engine as the customer QR flow, so a
 * manual order can never carry a client-side price.
 */
export const staffOrderLineSchema = z.object({
  productId: z.string({ error: 'محصول الزامی است.' }).trim().min(1, 'محصول الزامی است.'),
  quantity: z
    .number({ error: 'تعداد باید عدد باشد.' })
    .int('تعداد باید عدد صحیح باشد.')
    .min(1, 'تعداد حداقل ۱ است.')
    .max(30, 'از هر قلم حداکثر ۳۰ عدد مجاز است.'),
  optionIds: z.array(z.string().trim().max(64)).max(20, 'حداکثر ۲۰ گزینه برای هر قلم مجاز است.').default([]),
  extraIds: z.array(z.string().trim().max(64)).max(20, 'حداکثر ۲۰ افزودنی برای هر قلم مجاز است.').default([]),
  note: z.string().trim().max(200, 'یادداشت قلم بیش از حد طولانی است.').optional(),
});
export type StaffOrderLineInput = z.infer<typeof staffOrderLineSchema>;

export const createStaffOrderSchema = z.object({
  /** Empty or null means a takeaway order without a table. */
  tableId: z.string().trim().max(64).nullable().optional(),
  note: z.string().trim().max(300, 'یادداشت سفارش بیش از حد طولانی است.').optional(),
  items: z
    .array(staffOrderLineSchema)
    .min(1, 'حداقل یک قلم برای سفارش لازم است.')
    .max(30, 'تعداد اقلام سفارش بیش از حد مجاز است.'),
});
export type CreateStaffOrderInput = z.infer<typeof createStaffOrderSchema>;

export const addStaffOrderItemsSchema = z.object({
  items: z
    .array(staffOrderLineSchema)
    .min(1, 'حداقل یک قلم لازم است.')
    .max(30, 'تعداد اقلام بیش از حد مجاز است.'),
});
export type AddStaffOrderItemsInput = z.infer<typeof addStaffOrderItemsSchema>;

/** `0` removes the line; any other value replaces the quantity. */
export const updateOrderItemSchema = z.object({
  quantity: z
    .number({ error: 'تعداد باید عدد باشد.' })
    .int('تعداد باید عدد صحیح باشد.')
    .min(0, 'تعداد نمی‌تواند منفی باشد.')
    .max(99, 'تعداد بیش از حد مجاز است.'),
});
export type UpdateOrderItemInput = z.infer<typeof updateOrderItemSchema>;

/** `proforma: true` prints the bill before the order is served. */
export const receiptRequestSchema = z.object({
  proforma: z.boolean({ error: 'نوع رسید باید درست یا نادرست باشد.' }).optional(),
});
export type ReceiptRequestInput = z.infer<typeof receiptRequestSchema>;

export const prepTransitionSchema = z.object({
  to: z.enum(PREP_STATUSES, { error: 'وضعیت آماده‌سازی نامعتبر است.' }),
});
export type PrepTransitionInput = z.infer<typeof prepTransitionSchema>;

export const serviceRequestStatusSchema = z.object({
  status: z.enum(['accepted', 'done', 'cancelled'], { error: 'وضعیت درخواست نامعتبر است.' }),
});
export type ServiceRequestStatusInput = z.infer<typeof serviceRequestStatusSchema>;

export const listOrdersQuerySchema = z.object({
  scope: z.enum(['active', 'all']).default('active'),
  status: z.string().trim().max(120).optional(),
  tableId: z.string().trim().max(64).optional(),
  kind: z.enum(['barista', 'kitchen', 'bar', 'other']).optional(),
  q: z.string().trim().max(32).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

export interface StaffOrderPrepCounts {
  total: number;
  ready: number;
  inProgress: number;
  queued: number;
  delayed: number;
}

export interface StaffOrderSummary {
  id: string;
  code: string;
  status: OrderStatus;
  statusLabelFa: string;
  source: string;
  tableId: string | null;
  tableCode: string | null;
  tableNameFa: string | null;
  total: number;
  paidTotal: number;
  itemCount: number;
  note: string | null;
  prep: StaffOrderPrepCounts;
  isDelayed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StaffOrderItem {
  id: string;
  productNameFa: string;
  quantity: number;
  unitPrice: number;
  total: number;
  note: string | null;
  itemStatus: string;
  departmentKind: string | null;
  departmentNameFa: string | null;
  prepId: string | null;
  prepStatus: string | null;
  targetMinutes: number | null;
  options: string[];
  extras: string[];
}

export interface StaffOrderEvent {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface StaffOrderDetailBase extends StaffOrderSummary {
  subtotal: number;
  payments: PaymentRecord[];
  bill: OrderBill | null;
  discountTotal: number;
  serviceCharge: number;
  taxTotal: number;
  cancelReason: string | null;
  sessionId: string | null;
  submittedAt: string | null;
  servedAt: string | null;
  items: StaffOrderItem[];
  events: StaffOrderEvent[];
}

export interface StaffOrderDetail extends StaffOrderDetailBase {
  allowedTransitions: Array<{ status: OrderStatus; labelFa: string }>;
}

export interface StaffTableRow {
  id: string;
  code: string;
  nameFa: string;
  capacity: number;
  shape: string;
  status: string;
  floorNameFa: string | null;
  areaNameFa: string | null;
  waiterName: string | null;
  sessionId: string | null;
  openedAt: string | null;
  activeOrders: number;
  openTotal: number;
  pendingRequests: number;
}

export interface StaffTablesResponse {
  items: StaffTableRow[];
  summary: { total: number; occupied: number; available: number; reserved: number };
}

export interface PrepQueueItem {
  id: string;
  orderId: string;
  orderCode: string;
  tableCode: string | null;
  tableNameFa: string | null;
  productNameFa: string;
  quantity: number;
  note: string | null;
  status: string;
  itemStatus: string;
  departmentKind: string | null;
  departmentNameFa: string | null;
  targetMinutes: number;
  elapsedMinutes: number;
  isDelayed: boolean;
  createdAt: string;
}

export interface ServiceRequestRow {
  id: string;
  type: CustomerRequestType;
  typeLabelFa: string;
  note: string | null;
  status: string;
  tableId: string | null;
  tableCode: string | null;
  tableNameFa: string | null;
  handledByName: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface TerminalRequestRow {
  id: string;
  status: string;
  note: string | null;
  tableCode: string | null;
  tableNameFa: string | null;
  orderCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

/* ------------------------------- payments ------------------------------- */

export const paymentMethods = ['cash', 'card', 'online', 'wallet', 'other'] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export const PAYMENT_METHOD_LABELS_FA: Record<PaymentMethod, string> = {
  cash: 'نقدی',
  card: 'کارت‌خوان',
  online: 'آنلاین',
  wallet: 'کیف پول',
  other: 'سایر',
};

export const PAYMENT_STATUS_LABELS_FA: Record<string, string> = {
  pending: 'در انتظار تأیید',
  confirmed: 'تأیید شده',
  failed: 'ناموفق',
  refunded: 'بازگشت داده شده',
};

/** Only statuses that already reached the guest can be settled. */
export const PAYABLE_ORDER_STATUSES: OrderStatus[] = ['served', 'awaiting_payment'];

export const recordPaymentSchema = z.object({
  method: z.enum(paymentMethods, { error: 'روش پرداخت نامعتبر است.' }),
  amount: z
    .number({ error: 'مبلغ باید عدد باشد.' })
    .int('مبلغ باید عدد صحیح ریال باشد.')
    .min(1, 'مبلغ باید بیشتر از صفر باشد.')
    .max(10_000_000_000, 'مبلغ بیش از حد مجاز است.'),
  reference: z.string().trim().max(80, 'شماره پیگیری بیش از حد طولانی است.').optional(),
  /** When set, the payment must match that share exactly and settles it. */
  splitId: z.string().trim().max(64).optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const completeTerminalRequestSchema = z.object({
  orderId: z.string().trim().max(64).optional(),
  method: z.enum(paymentMethods, { error: 'روش پرداخت نامعتبر است.' }).optional(),
  amount: z.number({ error: 'مبلغ باید عدد باشد.' }).int('مبلغ باید عدد صحیح ریال باشد.').min(1, 'مبلغ باید بیشتر از صفر باشد.').optional(),
});
export type CompleteTerminalRequestInput = z.infer<typeof completeTerminalRequestSchema>;

export interface PaymentRecord {
  id: string;
  method: PaymentMethod;
  methodLabelFa: string;
  amount: number;
  status: string;
  reference: string | null;
  receivedByName: string | null;
  paidAt: string;
  /** Set when the payment settled one explicit share of a split bill. */
  splitLabelFa: string | null;
}

export interface OrderBill {
  id: string;
  status: 'open' | 'settled' | 'void';
  total: number;
  paidTotal: number;
  settledAt: string | null;
}

/** Splitting is only offered before the first payment, so the shares are final. */
export const splitBillSchema = z.object({
  parts: z
    .number({ error: 'تعداد سهم باید عدد باشد.' })
    .int('تعداد سهم باید عدد صحیح باشد.')
    .min(2, 'تقسیم دست‌کم دو سهم دارد.')
    .max(20, 'حداکثر ۲۰ سهم مجاز است.'),
});
export type SplitBillInput = z.infer<typeof splitBillSchema>;

/**
 * Explicit shares typed by the cashier. Labels are optional (a default
 * «سهم n» is used); the server only requires that the amounts add up to the
 * order total, so no rial is invented or lost.
 */
export const customSplitSchema = z.object({
  splits: z
    .array(
      z.object({
        label: z.string().trim().max(40, 'برچسب سهم بیش از حد طولانی است.').optional(),
        amount: z
          .number({ error: 'مبلغ سهم باید عدد باشد.' })
          .int('مبلغ سهم باید عدد صحیح ریال باشد.')
          .min(1, 'مبلغ هر سهم باید بیشتر از صفر باشد.')
          .max(10_000_000_000, 'مبلغ سهم بیش از حد مجاز است.'),
      }),
    )
    .min(2, 'تقسیم دست‌کم دو سهم دارد.')
    .max(20, 'حداکثر ۲۰ سهم مجاز است.'),
});
export type CustomSplitInput = z.infer<typeof customSplitSchema>;

export interface BillSplit {
  id: string;
  label: string;
  amount: number;
  isPaid: boolean;
}

export interface OrderPaymentsResponse {
  orderId: string;
  code: string;
  status: OrderStatus;
  total: number;
  discountTotal: number;
  paidTotal: number;
  remaining: number;
  payable: boolean;
  bill: OrderBill | null;
  splits: BillSplit[];
  payments: PaymentRecord[];
}

export interface TableCloseResult {
  tableId: string;
  code: string;
  sessionId: string;
  closedAt: string;
  closedOrders: number;
}

export interface TerminalCompletionResult {
  request: { id: string; status: string };
  order: { id: string; code: string; status: OrderStatus; total: number; paidTotal: number; remaining: number } | null;
  payment: PaymentRecord | null;
}

/* ------------------------------- discounts ------------------------------- */

/** Discounts above this share of the subtotal need an approving role. */
export const LARGE_DISCOUNT_PERCENT = 20;

export const applyDiscountSchema = z
  .object({
    amount: z
      .number({ error: 'مبلغ تخفیف باید عدد باشد.' })
      .int('مبلغ تخفیف باید عدد صحیح ریال باشد.')
      .min(0, 'مبلغ تخفیف نمی‌تواند منفی باشد.')
      .optional(),
    percent: z
      .number({ error: 'درصد تخفیف باید عدد باشد.' })
      .min(0, 'درصد تخفیف نمی‌تواند منفی باشد.')
      .max(100, 'درصد تخفیف حداکثر ۱۰۰ است.')
      .optional(),
    reason: z.string().trim().min(3, 'دلیل تخفیف الزامی است.').max(200, 'دلیل تخفیف بیش از حد طولانی است.'),
  })
  .refine((value) => (value.amount === undefined) !== (value.percent === undefined), {
    message: 'دقیقاً یکی از مبلغ یا درصد تخفیف را بفرستید.',
  });
export type ApplyDiscountInput = z.infer<typeof applyDiscountSchema>;

/* -------------------------------- refunds -------------------------------- */

export const refundPaymentSchema = z.object({
  amount: z
    .number({ error: 'مبلغ بازپرداخت باید عدد باشد.' })
    .int('مبلغ بازپرداخت باید عدد صحیح ریال باشد.')
    .min(1, 'مبلغ بازپرداخت باید بیشتر از صفر باشد.'),
  reason: z.string().trim().min(3, 'دلیل بازپرداخت الزامی است.').max(200, 'دلیل بازپرداخت بیش از حد طولانی است.'),
  method: z.enum(paymentMethods, { error: 'روش پرداخت نامعتبر است.' }).optional(),
});
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;

export interface RefundResult {
  refundId: string;
  amount: number;
  paidTotal: number;
  remaining: number;
  status: OrderStatus;
}

/* ------------------------------ notifications ----------------------------- */

export interface NotificationItem {
  id: string;
  type: string;
  titleFa: string;
  bodyFa: string | null;
  roleKey: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
}

/* --------------------------------- print ---------------------------------- */

export const PRINT_JOB_STATUS_LABELS_FA: Record<string, string> = {
  queued: 'در صف چاپ',
  sent: 'ارسال‌شده به چاپگر',
  printed: 'چاپ شد',
  failed: 'ناموفق',
  cancelled: 'لغو شد',
};

export interface PrintJob {
  id: string;
  orderId: string;
  orderCode: string | null;
  kind: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  printedAt: string | null;
  receipt: string[];
}

export interface ReportSummary {
  from: string;
  to: string;
  totals: {
    sales: number;
    refunds: number;
    net: number;
    payments: number;
    orders: number;
    averageOrder: number;
  };
  byMethod: Array<{ method: PaymentMethod; methodLabelFa: string; total: number; count: number }>;
  daily: Array<{ date: string; sales: number; count: number }>;
  topProducts: Array<{ nameFa: string; quantity: number; revenue: number }>;
}

export const SERVICE_REQUEST_STATUS_LABELS_FA: Record<string, string> = {
  pending: 'در انتظار',
  accepted: 'در حال رسیدگی',
  done: 'انجام شد',
  cancelled: 'لغو شده',
};

export const TABLE_STATUS_LABELS_FA: Record<string, string> = {
  available: 'آزاد',
  occupied: 'اشغال',
  reserved: 'رزرو',
  waiting_service: 'در انتظار سرویس',
  waiting_payment: 'در انتظار پرداخت',
  cleaning: 'نظافت',
  unavailable: 'غیرقابل استفاده',
};

/** Persian label for any order status, with a safe fallback. */
export function staffOrderStatusFa(status: string): string {
  return ORDER_STATUS_LABELS_FA[status as OrderStatus] ?? status;
}
