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

  queueReceipt(orderId: string, actor: ActingUser): { job: PrintJob; existed: boolean } {
    const order = this.orders.detail(orderId);

    if (!RECEIPT_STATUSES.includes(order.status)) {
      throw conflict(
        'برای چاپ رسید، سفارش باید سرو شده یا تسویه شده باشد.',
        'RECEIPT_NOT_AVAILABLE',
      );
    }

    const lines = this.buildReceiptLines(orderId);
    const dedupeKey = `receipt:${orderId}:${order.paidTotal}`;
    const existing = this.repository.findByDedupeKey(dedupeKey);
    if (existing) return { job: existing, existed: true };

    return {
      job: this.repository.insert({
        orderId,
        kind: 'receipt',
        dedupeKey,
        lines,
        createdByUserId: actor.userId,
      }),
      existed: false,
    };
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

  /** Plain-text receipt, RTL-friendly and printer-agnostic. */
  buildReceiptLines(orderId: string): string[] {
    const order = this.orders.detail(orderId);
    const settings =
      this.database.get<{ restaurant_name_fa: string }>(
        "SELECT restaurant_name_fa FROM settings WHERE id = 'singleton'",
      ) ?? { restaurant_name_fa: 'کافه‌فلو' };

    const lines: string[] = [
      settings.restaurant_name_fa,
      'رسید فروش',
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

    lines.push('', 'از انتخاب شما سپاسگزاریم.');

    return lines;
  }
}
