import { Inject, Injectable } from '@nestjs/common';
import { formatJalali, groupDigits, type PrintJob } from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';
import { conflict, notFound } from '../../common/errors';
import { OrdersService, type ActingUser } from '../orders/orders.service';
import { PrintRepository } from './print.repository';

const RECEIPT_STATUSES = ['served', 'awaiting_payment', 'paid'];

/**
 * Receipts are rendered server-side and stored in the print queue. The queue is
 * what a print bridge (scripts/print-bridge.mjs) consumes; this module never
 * talks to a printer directly, so a duplicate click cannot duplicate paper.
 */
@Injectable()
export class PrintService {
  constructor(
    @Inject(DB_SERVICE) private readonly database: DatabaseService,
    @Inject(PrintRepository) private readonly repository: PrintRepository,
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  queueReceipt(
    orderId: string,
    actor: ActingUser,
    options: { proforma?: boolean } = {},
  ): { job: PrintJob; existed: boolean } {
    const order = this.orders.detail(orderId);
    const proforma = options.proforma === true;

    if (proforma) {
      if (order.status === 'cancelled') {
        throw conflict('سفارش لغو شده پیش‌فاکتور نمی‌گیرد.', 'ORDER_CLOSED');
      }
    } else if (!RECEIPT_STATUSES.includes(order.status)) {
      throw conflict(
        'برای چاپ رسید، سفارش باید سرو شده یا تسویه شده باشد؛ برای پیش از سرو از پیش‌فاکتور استفاده کنید.',
        'RECEIPT_NOT_AVAILABLE',
      );
    }

    const lines = this.buildReceiptLines(orderId, proforma);
    const dedupeKey = proforma
      ? `proforma:${orderId}:${order.total}`
      : `receipt:${orderId}:${order.paidTotal}`;
    const existing = this.repository.findByDedupeKey(dedupeKey);
    if (existing) return { job: existing, existed: true };

    return {
      job: this.repository.insert({
        orderId,
        kind: proforma ? 'proforma' : 'receipt',
        dedupeKey,
        lines,
        createdByUserId: actor.userId,
      }),
      existed: false,
    };
  }

  /**
   * One ticket per preparation department. The dedupe key carries the current
   * quantity mix, so reprinting the same round returns the existing job instead
   * of duplicating paper, while a later round produces a new ticket.
   */
  queueTickets(orderId: string, actor: ActingUser): { jobs: PrintJob[]; created: number } {
    const order = this.orders.detail(orderId);
    if (order.status === 'cancelled') {
      throw conflict('سفارش لغو شده بلیت چاپ نمی‌خواهد.', 'ORDER_CLOSED');
    }

    const restaurantName = this.restaurantName();
    const groups = new Map<string, { label: string; kind: string; items: typeof order.items }>();

    for (const item of order.items) {
      if (item.itemStatus === 'cancelled') continue;
      const kind = item.departmentKind ?? 'other';
      const label = item.departmentNameFa ?? 'بدون واحد';
      const key = `${kind}|${label}`;
      const group = groups.get(key) ?? { label, kind, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }

    const jobs: PrintJob[] = [];
    let created = 0;

    for (const [key, group] of groups) {
      const quantity = group.items.reduce((sum, item) => sum + item.quantity, 0);
      const dedupeKey = `ticket:${orderId}:${key}:${quantity}`;
      const existing = this.repository.findByDedupeKey(dedupeKey);
      if (existing) {
        jobs.push(existing);
        continue;
      }

      jobs.push(
        this.repository.insert({
          orderId,
          kind: group.kind,
          dedupeKey,
          lines: this.buildTicketLines(order, group.label, group.items, quantity, restaurantName),
          createdByUserId: actor.userId,
        }),
      );
      created += 1;
    }

    return { jobs, created };
  }

  list(status?: 'queued' | 'sent' | 'printed' | 'failed' | 'cancelled'): { items: PrintJob[] } {
    return { items: this.repository.list(status) };
  }

  markPrinted(id: string): PrintJob {
    const job = this.repository.findById(id);
    if (!job) throw notFound('کار چاپ یافت نشد.', 'PRINT_JOB_NOT_FOUND');
    const updated = this.repository.updateStatus(id, 'printed', null);
    if (!updated) throw notFound('کار چاپ یافت نشد.', 'PRINT_JOB_NOT_FOUND');
    return updated;
  }

  markFailed(id: string, error: string): PrintJob {
    const job = this.repository.findById(id);
    if (!job) throw notFound('کار چاپ یافت نشد.', 'PRINT_JOB_NOT_FOUND');
    const updated = this.repository.updateStatus(id, 'failed', error.slice(0, 200));
    if (!updated) throw notFound('کار چاپ یافت نشد.', 'PRINT_JOB_NOT_FOUND');
    return updated;
  }

  /**
   * Claims a queued job for the bridge that is about to print it. Claiming is
   * idempotent for a job already sent, so a bridge retry after a dropped
   * response is harmless, while a printed job cannot be taken again.
   */
  markSent(id: string): PrintJob {
    const job = this.repository.findById(id);
    if (!job) throw notFound('کار چاپ یافت نشد.', 'PRINT_JOB_NOT_FOUND');
    if (job.status === 'sent') return job;
    if (job.status === 'printed') {
      throw conflict('این کار قبلاً چاپ شده است.', 'PRINT_JOB_ALREADY_PRINTED');
    }
    if (job.status === 'cancelled') {
      throw conflict('این کار چاپ لغو شده است.', 'PRINT_JOB_CLOSED');
    }
    if (!this.repository.claimForSending(id)) {
      throw conflict('این کار دیگر در صف نیست؛ پل دیگری آن را برداشته است.', 'PRINT_JOB_NOT_QUEUED');
    }
    const claimed = this.repository.findById(id);
    if (!claimed) throw notFound('کار چاپ یافت نشد.', 'PRINT_JOB_NOT_FOUND');
    return claimed;
  }

  private restaurantName(): string {
    return (
      this.database.get<{ restaurant_name_fa: string }>(
        "SELECT restaurant_name_fa FROM settings WHERE id = 'singleton'",
      ) ?? { restaurant_name_fa: 'کافه‌فلو' }
    ).restaurant_name_fa;
  }

  /** Department ticket: what to make, for which order and table, no money. */
  private buildTicketLines(
    order: ReturnType<OrdersService['detail']>,
    departmentLabel: string,
    items: ReturnType<OrdersService['detail']>['items'],
    quantity: number,
    restaurantName: string,
  ): string[] {
    const lines: string[] = [
      restaurantName,
      `بلیت ${departmentLabel}`,
      '',
      `سفارش: ${order.code}`,
      `میز: ${order.tableNameFa ?? 'بدون میز'}`,
      `تاریخ: ${formatJalali(new Date(order.createdAt))}`,
      '--------------------------------',
    ];

    for (const item of items) {
      lines.push(`${item.quantity} × ${item.productNameFa}`);
      if (item.options.length > 0) lines.push(`  گزینه: ${item.options.join('، ')}`);
      if (item.extras.length > 0) lines.push(`  افزودنی: ${item.extras.join('، ')}`);
      if (item.note) lines.push(`  یادداشت: ${item.note}`);
    }

    lines.push('--------------------------------', `جمع: ${quantity} قلم`);
    return lines;
  }

  /** Plain-text receipt or proforma, RTL-friendly and printer-agnostic. */
  buildReceiptLines(orderId: string, proforma = false): string[] {
    const order = this.orders.detail(orderId);
    const settings =
      this.database.get<{ restaurant_name_fa: string }>(
        "SELECT restaurant_name_fa FROM settings WHERE id = 'singleton'",
      ) ?? { restaurant_name_fa: 'کافه‌فلو' };

    const lines: string[] = [
      settings.restaurant_name_fa,
      proforma ? 'پیش‌فاکتور' : 'رسید فروش',
      '',
      `شماره سفارش: ${order.code}`,
      `میز: ${order.tableNameFa ?? 'بدون میز'}`,
      `تاریخ: ${formatJalali(new Date(order.createdAt))}`,
      '--------------------------------',
    ];

    for (const item of order.items) {
      lines.push(`${item.productNameFa} × ${item.quantity} — ${groupDigits(item.total)} ریال`);
      if (item.options.length > 0) lines.push(`  گزینه: ${item.options.join('، ')}`);
      if (item.extras.length > 0) lines.push(`  افزودنی: ${item.extras.join('، ')}`);
      if (item.note) lines.push(`  یادداشت: ${item.note}`);
    }

    lines.push('--------------------------------');
    lines.push(`جمع اقلام: ${groupDigits(order.subtotal)} ریال`);
    if (order.discountTotal > 0) lines.push(`تخفیف: -${groupDigits(order.discountTotal)} ریال`);
    if (order.serviceCharge > 0) lines.push(`حق سرویس: ${groupDigits(order.serviceCharge)} ریال`);
    if (order.taxTotal > 0) lines.push(`مالیات: ${groupDigits(order.taxTotal)} ریال`);
    lines.push(`مبلغ کل: ${groupDigits(order.total)} ریال`);
    lines.push(`پرداخت‌شده: ${groupDigits(order.paidTotal)} ریال`);

    const confirmed = order.payments.filter((payment) => payment.status === 'confirmed');
    if (confirmed.length > 0) {
      lines.push('پرداخت‌ها:');
      for (const payment of confirmed) {
        lines.push(`  ${payment.methodLabelFa}: ${groupDigits(payment.amount)} ریال`);
      }
    }

    lines.push('');
    lines.push(
      proforma
        ? 'این پیش‌فاکتور است و رسید نهایی نیست.'
        : 'از انتخاب شما سپاسگزاریم.',
    );

    return lines;
  }
}
