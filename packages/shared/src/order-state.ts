/**
 * Order state machine.
 *
 * The same definition is used by the API (authoritative enforcement) and by
 * the dashboards (to render only the actions that are legal). A transition
 * that is not listed here must be rejected by the backend, no matter what the
 * client sends.
 */

export const ORDER_STATUSES = [
  'draft',
  'submitted',
  'awaiting_confirmation',
  'confirmed',
  'preparing',
  'partially_ready',
  'ready',
  'served',
  'awaiting_payment',
  'paid',
  'cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS_FA: Record<OrderStatus, string> = {
  draft: 'پیش‌نویس',
  submitted: 'ثبت شده',
  awaiting_confirmation: 'در انتظار تأیید',
  confirmed: 'تأیید شده',
  preparing: 'در حال آماده‌سازی',
  partially_ready: 'بخشی آماده',
  ready: 'آماده تحویل',
  served: 'سرو شده',
  awaiting_payment: 'در انتظار پرداخت',
  paid: 'پرداخت شده',
  cancelled: 'لغو شده',
};

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['awaiting_confirmation', 'confirmed', 'cancelled'],
  awaiting_confirmation: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['partially_ready', 'ready', 'cancelled'],
  partially_ready: ['ready', 'cancelled'],
  ready: ['served', 'cancelled'],
  served: ['awaiting_payment', 'paid'],
  awaiting_payment: ['paid'],
  paid: [],
  cancelled: [],
};

export const TERMINAL_ORDER_STATUSES: OrderStatus[] = ['paid', 'cancelled'];

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

export class OrderTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`انتقال وضعیت سفارش از «${ORDER_STATUS_LABELS_FA[from]}» به «${ORDER_STATUS_LABELS_FA[to]}» مجاز نیست.`);
    this.name = 'OrderTransitionError';
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new OrderTransitionError(from, to);
}

/** Legal next statuses for a given status, with Persian labels. */
export function nextStatuses(from: OrderStatus): Array<{ status: OrderStatus; labelFa: string }> {
  return ORDER_TRANSITIONS[from].map((status) => ({ status, labelFa: ORDER_STATUS_LABELS_FA[status] }));
}

/* ------------------------------------------------------------------ */
/* Preparation (per-department item) workflow                          */
/* ------------------------------------------------------------------ */

export const PREP_STATUSES = ['queued', 'in_progress', 'ready', 'delayed', 'cancelled'] as const;

export type PrepStatus = (typeof PREP_STATUSES)[number];

export const PREP_STATUS_LABELS_FA: Record<PrepStatus, string> = {
  queued: 'در صف',
  in_progress: 'در حال آماده‌سازی',
  ready: 'آماده',
  delayed: 'تأخیر',
  cancelled: 'لغو شده',
};

export const PREP_TRANSITIONS: Record<PrepStatus, PrepStatus[]> = {
  queued: ['in_progress', 'ready', 'cancelled'],
  in_progress: ['ready', 'delayed', 'cancelled'],
  delayed: ['in_progress', 'ready', 'cancelled'],
  ready: [],
  cancelled: [],
};

export function canPrepTransition(from: PrepStatus, to: PrepStatus): boolean {
  return PREP_TRANSITIONS[from].includes(to);
}
