import { Inject, Injectable } from '@nestjs/common';
import { tehranDayRange } from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

const ACTIVE_ORDER_STATUSES = "('submitted','awaiting_confirmation','confirmed','preparing','partially_ready','ready','served','awaiting_payment')";

export interface DashboardOverview {
  today: { jalaliLabel: string; weekdayFa: string; salesTotal: number; paymentCount: number };
  orders: { active: number; preparing: number; delayed: number; awaitingPayment: number };
  tables: { total: number; occupied: number; available: number; reserved: number };
  requests: { pending: number };
  reservations: { upcoming: number; pendingApproval: number };
  catalog: { products: number; categories: number };
  staff: { activeUsers: number };
  paymentsByMethod: Array<{ method: string; total: number; count: number }>;
  recentOrders: Array<{
    id: string;
    code: string;
    status: string;
    total: number;
    tableCode: string | null;
    createdAt: string;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    actorUsername: string | null;
    entityType: string;
    createdAt: string;
  }>;
}

/**
 * Reads live operational counters. Every figure comes from the database —
 * nothing here is static placeholder content.
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  overview(): DashboardOverview {
    const range = tehranDayRange();
    const nowIso = new Date().toISOString();

    const sales = this.database.get<{ total: number; count: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
         FROM payments
        WHERE status = 'confirmed' AND paid_at >= ? AND paid_at < ?`,
      [range.startIso, range.endIso],
    );

    const ordersActive = this.database.count(
      `SELECT COUNT(*) AS n FROM orders WHERE status IN ${ACTIVE_ORDER_STATUSES}`,
    );
    const preparing = this.database.count(
      `SELECT COUNT(*) AS n FROM orders WHERE status IN ('confirmed','preparing','partially_ready')`,
    );
    const awaitingPayment = this.database.count(
      `SELECT COUNT(*) AS n FROM orders WHERE status IN ('served','awaiting_payment')`,
    );
    const delayed = this.database.count(
      `SELECT COUNT(*) AS n FROM prep_tasks
        WHERE status IN ('queued','in_progress','delayed')
          AND (julianday('now') - julianday(created_at)) * 24 * 60 > target_minutes`,
    );

    const tablesTotal = this.database.count(
      'SELECT COUNT(*) AS n FROM dining_tables WHERE is_active = 1 AND deleted_at IS NULL',
    );
    const tablesOccupied = this.database.count(
      "SELECT COUNT(*) AS n FROM dining_tables WHERE is_active = 1 AND deleted_at IS NULL AND status = 'occupied'",
    );
    const tablesReserved = this.database.count(
      "SELECT COUNT(*) AS n FROM dining_tables WHERE is_active = 1 AND deleted_at IS NULL AND status = 'reserved'",
    );

    const pendingRequests = this.database.count(
      "SELECT COUNT(*) AS n FROM customer_requests WHERE status = 'pending'",
    );

    const reservationsUpcoming = this.database.count(
      `SELECT COUNT(*) AS n FROM reservations
        WHERE status IN ('pending','confirmed') AND reserved_for >= ?`,
      [nowIso],
    );
    const reservationsPending = this.database.count(
      "SELECT COUNT(*) AS n FROM reservations WHERE status = 'pending'",
    );

    const products = this.database.count(
      'SELECT COUNT(*) AS n FROM products WHERE is_active = 1 AND is_archived = 0 AND deleted_at IS NULL',
    );
    const categories = this.database.count(
      'SELECT COUNT(*) AS n FROM categories WHERE is_active = 1 AND deleted_at IS NULL',
    );
    const activeUsers = this.database.count('SELECT COUNT(*) AS n FROM users WHERE is_active = 1 AND deleted_at IS NULL');

    const paymentsByMethod = this.database.all<{ method: string; total: number; count: number }>(
      `SELECT method, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
         FROM payments
        WHERE status = 'confirmed' AND paid_at >= ? AND paid_at < ?
        GROUP BY method
        ORDER BY total DESC`,
      [range.startIso, range.endIso],
    );

    const recentOrders = this.database
      .all<{
        id: string;
        code: string;
        status: string;
        total: number;
        table_code: string | null;
        created_at: string;
      }>(
        `SELECT o.id, o.code, o.status, o.total, t.code AS table_code, o.created_at
           FROM orders o
           LEFT JOIN dining_tables t ON t.id = o.table_id
          ORDER BY o.created_at DESC
          LIMIT 8`,
      )
      .map((row) => ({
        id: row.id,
        code: row.code,
        status: row.status,
        total: row.total,
        tableCode: row.table_code,
        createdAt: row.created_at,
      }));

    const recentActivity = this.database
      .all<{ id: string; action: string; actor_username: string | null; entity_type: string; created_at: string }>(
        `SELECT id, action, actor_username, entity_type, created_at
           FROM audit_logs
          ORDER BY created_at DESC
          LIMIT 6`,
      )
      .map((row) => ({
        id: row.id,
        action: row.action,
        actorUsername: row.actor_username,
        entityType: row.entity_type,
        createdAt: row.created_at,
      }));

    return {
      today: {
        jalaliLabel: range.jalaliLabel,
        weekdayFa: range.weekdayFa,
        salesTotal: sales?.total ?? 0,
        paymentCount: sales?.count ?? 0,
      },
      orders: {
        active: ordersActive,
        preparing,
        delayed,
        awaitingPayment,
      },
      tables: {
        total: tablesTotal,
        occupied: tablesOccupied,
        available: Math.max(tablesTotal - tablesOccupied - tablesReserved, 0),
        reserved: tablesReserved,
      },
      requests: { pending: pendingRequests },
      reservations: { upcoming: reservationsUpcoming, pendingApproval: reservationsPending },
      catalog: { products, categories },
      staff: { activeUsers },
      paymentsByMethod,
      recentOrders,
      recentActivity,
    };
  }
}
