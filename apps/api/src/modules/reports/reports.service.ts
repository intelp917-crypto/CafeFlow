import { Inject, Injectable } from '@nestjs/common';
import {
  PAYMENT_METHOD_LABELS_FA,
  type PaymentMethod,
  type ReportSummary,
} from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';
import { badRequest } from '../../common/errors';

const TEHRAN_OFFSET_MINUTES = 210;

export interface DateRange {
  startIso: string;
  endIso: string;
  from: string;
  to: string;
}

function todayTehran(): string {
  return new Date(Date.now() + TEHRAN_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

function dayStart(date: string): string {
  return `${date}T00:00:00.000+03:30`;
}

function nextDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function assertCalendarDate(value: string, label: string): void {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest(`${label} تاریخ معتبری نیست.`, 'INVALID_DATE_RANGE');
  }
}

export function resolveRange(from?: string, to?: string): DateRange {
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) assertCalendarDate(from, 'تاریخ شروع');
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) assertCalendarDate(to, 'تاریخ پایان');

  const today = todayTehran();
  const startDate = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : today;
  const endDate = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : today;

  if (startDate > endDate) {
    throw badRequest('تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.', 'INVALID_DATE_RANGE');
  }

  return { startIso: dayStart(startDate), endIso: dayStart(nextDay(endDate)), from: startDate, to: endDate };
}

/**
 * Sales reporting. Every number is aggregated from `payments` and `order_items`
 * rows inside the requested Tehran-day range; refunds are subtracted, not
 * ignored.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  summary(range: DateRange): ReportSummary {
    const params = [range.startIso, range.endIso];

    const salesRow = this.database.get<{ total: number; count: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
         FROM payments
        WHERE status = 'confirmed' AND paid_at >= ? AND paid_at < ?`,
      params,
    );
    const refundsRow = this.database.get<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM payments
        WHERE status = 'refunded' AND paid_at >= ? AND paid_at < ?`,
      params,
    );
    const ordersRow = this.database.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM orders
        WHERE status = 'paid' AND paid_at >= ? AND paid_at < ?`,
      params,
    );

    const sales = salesRow?.total ?? 0;
    const refunds = refundsRow?.total ?? 0;
    const orders = ordersRow?.count ?? 0;

    const byMethod = this.database
      .all<{ method: PaymentMethod; total: number; count: number }>(
        `SELECT method, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
           FROM payments
          WHERE status = 'confirmed' AND paid_at >= ? AND paid_at < ?
          GROUP BY method
          ORDER BY total DESC`,
        params,
      )
      .map((row) => ({
        method: row.method,
        methodLabelFa: PAYMENT_METHOD_LABELS_FA[row.method] ?? row.method,
        total: row.total,
        count: row.count,
      }));

    const daily = this.database.all<{ date: string; sales: number; count: number }>(
      `SELECT date(paid_at, '+210 minutes') AS date,
              COALESCE(SUM(amount), 0) AS sales,
              COUNT(*) AS count
         FROM payments
        WHERE status = 'confirmed' AND paid_at >= ? AND paid_at < ?
        GROUP BY date
        ORDER BY date ASC`,
      params,
    );

    const topProducts = this.database.all<{ name_fa: string; quantity: number; revenue: number }>(
      `SELECT oi.product_name_snapshot AS name_fa,
              COALESCE(SUM(oi.quantity), 0) AS quantity,
              COALESCE(SUM(oi.total), 0) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'paid' AND o.paid_at >= ? AND o.paid_at < ?
        GROUP BY oi.product_name_snapshot
        ORDER BY revenue DESC
        LIMIT 10`,
      params,
    );

    return {
      from: range.from,
      to: range.to,
      totals: {
        sales,
        refunds,
        net: sales - refunds,
        payments: salesRow?.count ?? 0,
        orders,
        averageOrder: orders > 0 ? Math.round(sales / orders) : 0,
      },
      byMethod,
      daily,
      topProducts: topProducts.map((row) => ({
        nameFa: row.name_fa,
        quantity: row.quantity,
        revenue: row.revenue,
      })),
    };
  }

  paymentsCsv(range: DateRange): string {
    const rows = this.database.all<{
      paid_at: string;
      code: string | null;
      method: string;
      amount: number;
      status: string;
      receiver: string | null;
    }>(
      `SELECT p.paid_at, o.code, p.method, p.amount, p.status, u.full_name AS receiver
         FROM payments p
         LEFT JOIN orders o ON o.id = p.order_id
         LEFT JOIN users u ON u.id = p.received_by_user_id
        WHERE p.paid_at >= ? AND p.paid_at < ?
        ORDER BY p.paid_at ASC`,
      [range.startIso, range.endIso],
    );

    const escape = (value: string | number | null): string => {
      const text = value === null ? '' : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };

    const lines = [
      ['زمان پرداخت', 'کد سفارش', 'روش', 'مبلغ (ریال)', 'وضعیت', 'دریافت‌کننده'].map(escape).join(','),
      ...rows.map((row) =>
        [
          row.paid_at,
          row.code ?? '',
          PAYMENT_METHOD_LABELS_FA[row.method as PaymentMethod] ?? row.method,
          row.amount,
          row.status,
          row.receiver ?? '',
        ]
          .map(escape)
          .join(','),
      ),
    ];

    return `\uFEFF${lines.join('\r\n')}`;
  }
}
