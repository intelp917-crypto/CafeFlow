import { Inject, Injectable } from '@nestjs/common';
import {
  LARGE_DISCOUNT_PERCENT,
  PAYABLE_ORDER_STATUSES,
  ORDER_STATUS_LABELS_FA,
  PAYMENT_METHOD_LABELS_FA,
  type ApplyDiscountInput,
  type CompleteTerminalRequestInput,
  type CustomSplitInput,
  type OrderPaymentsResponse,
  type OrderStatus,
  type PaymentMethod,
  type RecordPaymentInput,
  type RefundPaymentInput,
  type RefundResult,
  type SplitBillInput,
  type TerminalCompletionResult,
} from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';
import { AuditService } from '../audit/audit.service';
import { OrdersService, type ActingUser } from '../orders/orders.service';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import { PaymentsRepository, type PaymentOrderRow } from './payments.repository';

/**
 * Settlement rules:
 * - only a served (or already awaiting-payment) order can take money;
 * - a bill is created on the first payment and closed when the sum reaches the
 *   order total; overpayment is refused instead of silently accepted;
 * - the `paid` status is never set directly by a client — it is derived from
 *   confirmed payment rows inside the same transaction.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DB_SERVICE) private readonly database: DatabaseService,
    @Inject(PaymentsRepository) private readonly repository: PaymentsRepository,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  summary(orderId: string): OrderPaymentsResponse {
    const order = this.repository.findOrder(orderId);
    if (!order) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');

    const paidTotal = this.repository.netPaid(orderId);
    return {
      orderId: order.id,
      code: order.code,
      status: order.status,
      total: order.total,
      discountTotal: order.discount_total,
      paidTotal,
      remaining: Math.max(order.total - paidTotal, 0),
      payable: PAYABLE_ORDER_STATUSES.includes(order.status),
      bill: this.repository.findBill(orderId) ?? null,
      splits: this.repository.listSplits(orderId),
      payments: this.repository.listPayments(orderId),
    };
  }

  record(orderId: string, input: RecordPaymentInput, actor: ActingUser): OrderPaymentsResponse {
    const order = this.repository.findOrder(orderId);
    if (!order) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');

    this.database.transaction(() => {
      this.applyPayment(order, input, actor);
    });

    return this.summary(orderId);
  }

  /**
   * Completing a terminal request settles the table's oldest unpaid order (or
   * an explicitly named one) with a card payment, and closes the request in the
   * same transaction. If there is nothing left to pay, the request is simply
   * completed — no payment record is invented.
   */
  completeTerminalRequest(
    id: string,
    input: CompleteTerminalRequestInput,
    actor: ActingUser,
  ): TerminalCompletionResult {
    const request = this.repository.findTerminalRequest(id);
    if (!request) throw notFound('درخواست کارت‌خوان یافت نشد.', 'TERMINAL_REQUEST_NOT_FOUND');
    if (request.status === 'completed' || request.status === 'cancelled') {
      throw conflict('این درخواست قبلاً بسته شده است.', 'REQUEST_CLOSED');
    }

    const targetOrderId =
      input.orderId ??
      request.orderId ??
      (request.tableId ? this.repository.findOldestUnpaidOrderForTable(request.tableId)?.id : undefined);

    let result: TerminalCompletionResult = {
      request: { id, status: 'completed' },
      order: null,
      payment: null,
    };

    this.database.transaction(() => {
      if (targetOrderId) {
        const order = this.repository.findOrder(targetOrderId);
        if (!order) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');

        const paidTotal = this.repository.netPaid(order.id);
        const remaining = Math.max(order.total - paidTotal, 0);

        if (remaining > 0) {
          this.applyPayment(
            order,
            {
              method: input.method ?? 'card',
              amount: input.amount ?? remaining,
              reference: undefined,
            },
            actor,
          );
        }

        const after = this.repository.findOrder(order.id);
        const afterPaid = this.repository.netPaid(order.id);
        const payments = this.repository.listPayments(order.id);
        result = {
          request: { id, status: 'completed' },
          order: after
            ? {
                id: after.id,
                code: after.code,
                status: after.status,
                total: after.total,
                paidTotal: afterPaid,
                remaining: Math.max(after.total - afterPaid, 0),
              }
            : null,
          payment: payments.length > 0 ? (payments[payments.length - 1] ?? null) : null,
        };
      }

      this.repository.completeTerminalRequest(id, targetOrderId ?? null);
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'terminal_request.completed',
      entityType: 'terminal_request',
      entityId: id,
      after: { orderId: targetOrderId ?? null, paymentId: result.payment?.id ?? null },
    });

    return result;
  }

  /**
   * Equal split before the first payment. The shares always sum to the order
   * total: a 1-rial remainder goes to the first shares instead of being lost.
   */
  split(orderId: string, input: SplitBillInput, actor: ActingUser): OrderPaymentsResponse {
    const order = this.repository.findOrder(orderId);
    if (!order) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');
    if (order.status === 'paid' || order.status === 'cancelled') {
      throw conflict('این سفارش بسته شده است و تقسیم نمی‌پذیرد.', 'ORDER_CLOSED');
    }
    if (!PAYABLE_ORDER_STATUSES.includes(order.status)) {
      throw conflict('سفارش هنوز قابل تسویه نیست؛ ابتدا آن را سرو کنید.', 'ORDER_NOT_PAYABLE');
    }
    if (this.repository.netPaid(orderId) > 0) {
      throw conflict(
        'پس از ثبت پرداخت نمی‌توان فاکتور را دوباره تقسیم کرد.',
        'SPLITS_AFTER_PAYMENT',
      );
    }
    if (order.total < input.parts) {
      throw badRequest('هر سهم باید دست‌کم ۱ ریال باشد.', 'SPLIT_TOO_SMALL');
    }

    const base = Math.floor(order.total / input.parts);
    const remainder = order.total - base * input.parts;
    const shares = Array.from({ length: input.parts }, (_, index) => ({
      label: `سهم ${(index + 1).toLocaleString('fa-IR', { useGrouping: false })}`,
      amount: base + (index < remainder ? 1 : 0),
    }));

    this.database.transaction(() => {
      const bill = this.repository.ensureBill(order);
      this.repository.replaceSplits(bill.id, shares);
      this.repository.insertOrderEvent({
        orderId,
        type: 'order.split_created',
        actorUserId: actor.userId,
        payload: { parts: input.parts, total: order.total },
      });
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'order.split_created',
      entityType: 'order',
      entityId: orderId,
      after: { parts: input.parts, total: order.total, code: order.code },
    });

    return this.summary(orderId);
  }

  /**
   * Explicit shares before the first payment. Amounts are typed by the cashier
   * but the server proves they add up to the order total, so the sum of the
   * shares always equals the bill and no rial is invented.
   */
  splitCustom(orderId: string, input: CustomSplitInput, actor: ActingUser): OrderPaymentsResponse {
    const order = this.repository.findOrder(orderId);
    if (!order) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');
    if (order.status === 'paid' || order.status === 'cancelled') {
      throw conflict('این سفارش بسته شده است و تقسیم نمی‌پذیرد.', 'ORDER_CLOSED');
    }
    if (!PAYABLE_ORDER_STATUSES.includes(order.status)) {
      throw conflict('سفارش هنوز قابل تسویه نیست؛ ابتدا آن را سرو کنید.', 'ORDER_NOT_PAYABLE');
    }
    if (this.repository.netPaid(orderId) > 0) {
      throw conflict(
        'پس از ثبت پرداخت نمی‌توان فاکتور را دوباره تقسیم کرد.',
        'SPLITS_AFTER_PAYMENT',
      );
    }

    const shares = input.splits.map((split, index) => ({
      label: split.label?.trim() || `سهم ${(index + 1).toLocaleString('fa-IR', { useGrouping: false })}`,
      amount: split.amount,
    }));

    const labels = new Set<string>();
    for (const share of shares) {
      if (labels.has(share.label)) {
        throw badRequest(`برچسب «${share.label}» دو بار استفاده شده است.`, 'SPLIT_LABEL_DUPLICATE');
      }
      labels.add(share.label);
    }

    const sum = shares.reduce((total, share) => total + share.amount, 0);
    if (sum !== order.total) {
      throw badRequest(
        `جمع سهم‌ها (${sum.toLocaleString('en-US')} ریال) باید دقیقاً برابر مبلغ فاکتور (${order.total.toLocaleString('en-US')} ریال) باشد.`,
        'SPLIT_TOTAL_MISMATCH',
      );
    }

    this.database.transaction(() => {
      const bill = this.repository.ensureBill(order);
      this.repository.replaceSplits(bill.id, shares);
      this.repository.insertOrderEvent({
        orderId,
        type: 'order.split_created',
        actorUserId: actor.userId,
        payload: { mode: 'custom', shares, total: order.total },
      });
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'order.split_created',
      entityType: 'order',
      entityId: orderId,
      after: { mode: 'custom', shares, total: order.total, code: order.code },
    });

    return this.summary(orderId);
  }

  /** Removes an unused split; a partially paid bill keeps its shares. */
  clearSplits(orderId: string, actor: ActingUser): OrderPaymentsResponse {
    const order = this.repository.findOrder(orderId);
    if (!order) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');
    if (this.repository.netPaid(orderId) > 0) {
      throw conflict('پس از ثبت پرداخت تقسیم فاکتور قابل لغو نیست.', 'SPLITS_AFTER_PAYMENT');
    }

    let removed = 0;
    this.database.transaction(() => {
      removed = this.repository.clearSplits(orderId);
      if (removed > 0) {
        this.repository.insertOrderEvent({
          orderId,
          type: 'order.split_cleared',
          actorUserId: actor.userId,
        });
      }
    });

    if (removed === 0) {
      throw notFound('تقسیمی برای این سفارش ثبت نشده است.', 'SPLITS_NOT_FOUND');
    }

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'order.split_cleared',
      entityType: 'order',
      entityId: orderId,
      after: { code: order.code },
    });

    return this.summary(orderId);
  }

  /**
   * Discounts are applied before any money arrives. A discount above
   * LARGE_DISCOUNT_PERCENT needs `approvals.decide` (manager/super admin), which
   * is enforced here rather than only in the UI.
   */
  applyDiscount(orderId: string, input: ApplyDiscountInput, actor: ActingUser): OrderPaymentsResponse {
    const order = this.repository.findOrder(orderId);
    if (!order) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');
    if (order.status === 'paid' || order.status === 'cancelled') {
      throw conflict('این سفارش بسته شده است و تخفیف نمی‌پذیرد.', 'ORDER_CLOSED');
    }

    const net = this.repository.netPaid(orderId);
    if (net > 0) {
      throw conflict(
        'پس از ثبت پرداخت امکان اعمال تخفیف نیست؛ ابتدا بازپرداخت کنید.',
        'DISCOUNT_AFTER_PAYMENT',
      );
    }
    if (this.repository.hasOpenSplits(orderId)) {
      throw conflict('فاکتور تقسیم شده است؛ ابتدا تقسیم را لغو کنید.', 'SPLITS_EXIST');
    }

    const requested = input.amount ?? Math.round((order.subtotal * (input.percent ?? 0)) / 100);
    if (requested > order.subtotal) {
      throw badRequest('تخفیف نمی‌تواند از جمع اقلام بیشتر باشد.', 'DISCOUNT_EXCEEDS_SUBTOTAL');
    }

    const share = order.subtotal > 0 ? (requested / order.subtotal) * 100 : 0;
    if (share > LARGE_DISCOUNT_PERCENT && !actor.permissions.includes('approvals.decide')) {
      throw forbidden(
        `تخفیف بیش از ${LARGE_DISCOUNT_PERCENT}٪ نیازمند تأیید مدیر است.`,
        'APPROVAL_REQUIRED',
      );
    }

    const total = Math.max(order.subtotal - requested, 0) + order.service_charge + order.tax_total;

    this.database.transaction(() => {
      this.repository.updateOrderDiscount(orderId, requested, total);
      this.repository.updateOpenBillTotal(orderId, total);
      this.repository.insertOrderEvent({
        orderId,
        type: 'order.discount_applied',
        actorUserId: actor.userId,
        payload: { discount: requested, total, percent: Math.round(share), reason: input.reason },
      });
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'order.discount_applied',
      entityType: 'order',
      entityId: orderId,
      before: { discount: order.discount_total, total: order.total },
      after: { discount: requested, total, code: order.code },
      metadata: { reason: input.reason, percent: Math.round(share) },
    });

    return this.summary(orderId);
  }

  /** Refunds are recorded as `refunded` payment rows; the order stays paid. */
  refund(orderId: string, input: RefundPaymentInput, actor: ActingUser): RefundResult {
    const order = this.repository.findOrder(orderId);
    if (!order) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');
    if (order.status !== 'paid') {
      throw conflict('بازپرداخت فقط برای سفارش تسویه‌شده امکان‌پذیر است.', 'ORDER_NOT_PAID');
    }

    const net = this.repository.netPaid(orderId);
    if (input.amount > net) {
      throw badRequest(
        `مبلغ بازپرداخت از مبلغ پرداخت‌شده (${net.toLocaleString('en-US')} ریال) بیشتر است.`,
        'REFUND_EXCEEDS_PAID',
      );
    }

    const bill = this.repository.findBill(orderId);
    const billId = bill?.id ?? null;
    let refundId = '';

    this.database.transaction(() => {
      refundId = this.repository.insertRefund({
        orderId,
        billId,
        method: input.method ?? 'cash',
        amount: input.amount,
        reference: `refund:${input.reason.slice(0, 60)}`,
        receivedByUserId: actor.userId,
        cashRegisterId: this.repository.openCashRegisterFor(actor.userId),
      });

      const after = this.repository.netPaid(orderId);
      this.repository.updateOrderPaidTotal(orderId, after);
      if (bill) {
        this.repository.updateBill(bill.id, after, bill.status === 'settled' ? 'settled' : 'open', bill.settledAt);
      }
      this.repository.insertOrderEvent({
        orderId,
        type: 'payment.refunded',
        actorUserId: actor.userId,
        payload: { amount: input.amount, reason: input.reason, refundId },
      });
    });

    const paidAfter = this.repository.netPaid(orderId);

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'payment.refunded',
      entityType: 'order',
      entityId: orderId,
      before: { paidTotal: net },
      after: { paidTotal: paidAfter, refundId, code: order.code },
      metadata: { amount: input.amount, reason: input.reason, method: input.method ?? 'cash' },
    });

    return {
      refundId,
      amount: input.amount,
      paidTotal: paidAfter,
      remaining: Math.max(order.total - paidAfter, 0),
      status: order.status,
    };
  }

  /* ------------------------------- internals ------------------------------- */

  private applyPayment(order: PaymentOrderRow, input: RecordPaymentInput, actor: ActingUser): void {
    if (order.status === 'paid') throw conflict('این سفارش قبلاً تسویه شده است.', 'ORDER_ALREADY_PAID');
    if (order.status === 'cancelled') throw conflict('سفارش لغو شده است و پرداخت نمی‌پذیرد.', 'ORDER_CLOSED');
    if (!PAYABLE_ORDER_STATUSES.includes(order.status)) {
      throw conflict(
        `سفارش در وضعیت «${ORDER_STATUS_LABELS_FA[order.status as OrderStatus]}» قابل تسویه نیست؛ ابتدا آن را سرو کنید.`,
        'ORDER_NOT_PAYABLE',
      );
    }

    const paidBefore = this.repository.netPaid(order.id);
    const remaining = Math.max(order.total - paidBefore, 0);

    if (remaining === 0) throw conflict('مانده‌ای برای پرداخت وجود ندارد.', 'ORDER_ALREADY_PAID');
    if (input.amount > remaining) {
      throw badRequest(
        `مبلغ پرداخت از باقیمانده (${remaining.toLocaleString('en-US')} ریال) بیشتر است.`,
        'PAYMENT_EXCEEDS_REMAINING',
      );
    }

    const bill = this.repository.ensureBill(order);

    // A payment can name the share it settles. The amount then has to match
    // that share exactly, so «این پرداخت مال کدام نفر بود» is provable later.
    const split = input.splitId ? this.repository.findSplit(order.id, input.splitId) : undefined;
    if (input.splitId) {
      if (!split || split.bill_id !== bill.id) {
        throw badRequest('سهم انتخاب‌شده متعلق به این فاکتور نیست.', 'SPLIT_NOT_FOUND');
      }
      if (split.is_paid === 1) {
        throw conflict('این سهم قبلاً پرداخت شده است.', 'SPLIT_ALREADY_PAID');
      }
      if (input.amount !== split.amount) {
        throw badRequest(
          `مبلغ پرداخت باید دقیقاً برابر سهم «${split.label}» (${split.amount.toLocaleString('en-US')} ریال) باشد.`,
          'SPLIT_AMOUNT_MISMATCH',
        );
      }
    }

    this.repository.insertPayment({
      orderId: order.id,
      billId: bill.id,
      method: input.method,
      amount: input.amount,
      reference: input.reference ?? null,
      receivedByUserId: actor.userId,
      // Ties the money to the register that is actually open, so each drawer's
      // expected cash stays its own even when several are open at once.
      cashRegisterId: this.repository.openCashRegisterFor(actor.userId),
      billSplitId: split?.id ?? null,
    });

    const paidTotal = this.repository.netPaid(order.id);
    const settled = paidTotal >= order.total;
    const now = new Date().toISOString();

    this.repository.updateBill(bill.id, paidTotal, settled ? 'settled' : 'open', settled ? now : null);
    if (split) {
      this.repository.markSplitPaid(split.id);
    } else {
      this.repository.syncSplits(bill.id, paidTotal);
    }
    this.repository.updateOrderPaidTotal(order.id, paidTotal);

    if (settled) {
      this.orders.markPaid(order.id, actor);
    } else {
      this.orders.markAwaitingPayment(order.id, actor);
    }

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: settled ? 'payment.settled' : 'payment.recorded',
      entityType: 'order',
      entityId: order.id,
      before: { paidTotal: paidBefore, status: order.status },
      after: {
        paidTotal,
        status: settled ? 'paid' : 'awaiting_payment',
        method: input.method,
        methodLabelFa: PAYMENT_METHOD_LABELS_FA[input.method as PaymentMethod],
        amount: input.amount,
      },
    });
  }
}
