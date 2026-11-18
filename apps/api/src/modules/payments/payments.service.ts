import { Inject, Injectable } from '@nestjs/common';
import {
  LARGE_DISCOUNT_PERCENT,
  PAYABLE_ORDER_STATUSES,
  ORDER_STATUS_LABELS_FA,
  PAYMENT_METHOD_LABELS_FA,
  type ApplyDiscountInput,
  type CompleteTerminalRequestInput,
  type OrderPaymentsResponse,
  type OrderStatus,
  type PaymentMethod,
  type RecordPaymentInput,
  type RefundPaymentInput,
  type RefundResult,
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
    this.repository.insertPayment({
      orderId: order.id,
      billId: bill.id,
      method: input.method,
      amount: input.amount,
      reference: input.reference ?? null,
      receivedByUserId: actor.userId,
    });

    const paidTotal = this.repository.netPaid(order.id);
    const settled = paidTotal >= order.total;
    const now = new Date().toISOString();

    this.repository.updateBill(bill.id, paidTotal, settled ? 'settled' : 'open', settled ? now : null);
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
