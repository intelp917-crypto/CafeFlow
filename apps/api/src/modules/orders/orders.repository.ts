import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ACTIVE_ORDER_STATUSES,
  staffOrderStatusFa,
  type ListOrdersQuery,
  type PrepQueueItem,
  type ServiceRequestRow,
  type StaffOrderDetailBase,
  type StaffOrderEvent,
  type StaffOrderItem,
  type StaffOrderSummary,
  type StaffTableRow,
  type StaffTablesResponse,
  type TerminalRequestRow,
  CUSTOMER_REQUEST_LABELS_FA,
  PAYMENT_METHOD_LABELS_FA,
  type OrderBill,
  type PaymentMethod,
  type PaymentRecord,
} from '@cafeflow/shared';
import type { OrderStatus } from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

interface OrderSummaryRow {
  id: string;
  code: string;
  status: OrderStatus;
  source: string;
  total: number;
  paid_total: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  table_id: string | null;
  table_code: string | null;
  table_name_fa: string | null;
  item_count: number;
  prep_total: number;
  prep_ready: number;
  prep_in_progress: number;
  prep_queued: number;
  prep_delayed: number;
  delayed_now: number;
}

interface OrderDetailRow extends OrderSummaryRow {
  subtotal: number;
  discount_total: number;
  service_charge: number;
  tax_total: number;
  cancel_reason: string | null;
  table_session_id: string | null;
  submitted_at: string | null;
  served_at: string | null;
}

interface OrderItemRow {
  id: string;
  product_name_snapshot: string;
  quantity: number;
  unit_price_snapshot: number;
  total: number;
  note: string | null;
  status: string;
  options_json: string | null;
  extras_json: string | null;
  department_kind: string | null;
  department_name: string | null;
  prep_id: string | null;
  prep_status: string | null;
  target_minutes: number | null;
}

interface OrderEventRow {
  id: string;
  type: string;
  from_status: string | null;
  to_status: string | null;
  actor_name: string | null;
  created_at: string;
}

interface TableRow {
  id: string;
  code: string;
  name_fa: string;
  capacity: number;
  shape: string;
  status: string;
  floor_name_fa: string | null;
  area_name_fa: string | null;
  waiter_name: string | null;
  session_id: string | null;
  opened_at: string | null;
  active_orders: number;
  open_total: number;
  pending_requests: number;
}

interface PrepRow {
  id: string;
  order_id: string;
  order_code: string;
  table_code: string | null;
  table_name_fa: string | null;
  product_name_snapshot: string;
  quantity: number;
  note: string | null;
  status: string;
  item_status: string;
  department_kind: string | null;
  department_name: string | null;
  target_minutes: number;
  created_at: string;
  elapsed_minutes: number;
}

interface ServiceRequestDbRow {
  id: string;
  type: ServiceRequestRow['type'];
  note: string | null;
  status: string;
  table_id: string | null;
  table_code: string | null;
  table_name_fa: string | null;
  handled_by_name: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface TerminalRequestDbRow {
  id: string;
  status: string;
  note: string | null;
  table_code: string | null;
  table_name_fa: string | null;
  order_code: string | null;
  created_at: string;
  completed_at: string | null;
}

const SUMMARY_COLUMNS = `
  o.id, o.code, o.status, o.source, o.total, o.paid_total, o.note, o.created_at, o.updated_at,
  o.table_id, t.code AS table_code, t.name_fa AS table_name_fa,
  (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
  (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id) AS prep_total,
  (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id AND p.status = 'ready') AS prep_ready,
  (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id AND p.status = 'in_progress') AS prep_in_progress,
  (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id AND p.status = 'queued') AS prep_queued,
  (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id AND p.status = 'delayed') AS prep_delayed,
  (SELECT COUNT(*) FROM prep_tasks p
    WHERE p.order_id = o.id AND p.status IN ('queued', 'in_progress', 'delayed')
      AND (julianday('now') - julianday(p.created_at)) * 1440 > p.target_minutes) AS delayed_now
`;

function parseJsonList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as Array<{ nameFa?: unknown }>;
    return Array.isArray(parsed)
      ? parsed.map((entry) => (typeof entry?.nameFa === 'string' ? entry.nameFa : '')).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function toSummary(row: OrderSummaryRow): StaffOrderSummary {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    statusLabelFa: staffOrderStatusFa(row.status),
    source: row.source,
    tableId: row.table_id,
    tableCode: row.table_code,
    tableNameFa: row.table_name_fa,
    total: row.total,
    paidTotal: row.paid_total,
    itemCount: row.item_count,
    note: row.note,
    prep: {
      total: row.prep_total,
      ready: row.prep_ready,
      inProgress: row.prep_in_progress,
      queued: row.prep_queued,
      delayed: row.prep_delayed,
    },
    isDelayed: row.delayed_now > 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Read model for the staff surfaces. Every figure comes from the database; the
 * SQL is parameterised and shared by the list, detail, prep and table screens.
 */
@Injectable()
export class OrdersRepository {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  listOrders(params: ListOrdersQuery): { items: StaffOrderSummary[]; total: number } {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (params.scope === 'active') {
      const placeholders = ACTIVE_ORDER_STATUSES.map(() => '?').join(', ');
      clauses.push(`o.status IN (${placeholders})`);
      values.push(...ACTIVE_ORDER_STATUSES);
    }

    if (params.status) {
      const requested = params.status
        .split(',')
        .map((status) => status.trim())
        .filter((status): status is OrderStatus => (ACTIVE_ORDER_STATUSES as string[]).includes(status) || status === 'paid' || status === 'cancelled' || status === 'draft');
      if (requested.length > 0) {
        clauses.push(`o.status IN (${requested.map(() => '?').join(', ')})`);
        values.push(...requested);
      }
    }

    if (params.tableId) {
      clauses.push('o.table_id = ?');
      values.push(params.tableId);
    }

    if (params.q) {
      clauses.push('o.code LIKE ?');
      values.push(`%${params.q.toUpperCase()}%`);
    }

    if (params.kind) {
      clauses.push(
        `EXISTS (SELECT 1 FROM order_items oi2 JOIN departments d2 ON d2.id = oi2.department_id
                  WHERE oi2.order_id = o.id AND d2.kind = ?)`,
      );
      values.push(params.kind);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = this.database.count(`SELECT COUNT(*) AS n FROM orders o ${where}`, values);

    const rows = this.database.all<OrderSummaryRow>(
      `SELECT ${SUMMARY_COLUMNS}
         FROM orders o
         LEFT JOIN dining_tables t ON t.id = o.table_id
        ${where}
        ORDER BY o.created_at DESC
        LIMIT ? OFFSET ?`,
      [...values, params.pageSize, (params.page - 1) * params.pageSize],
    );

    return { items: rows.map(toSummary), total };
  }

  findOrder(id: string): StaffOrderDetailBase | undefined {
    const row = this.database.get<OrderDetailRow>(
      `SELECT ${SUMMARY_COLUMNS}, o.subtotal, o.discount_total, o.service_charge, o.tax_total,
              o.cancel_reason, o.table_session_id, o.submitted_at, o.served_at
         FROM orders o
         LEFT JOIN dining_tables t ON t.id = o.table_id
        WHERE o.id = ?`,
      [id],
    );
    if (!row) return undefined;

    const items = this.database
      .all<OrderItemRow>(
        `SELECT oi.id, oi.product_name_snapshot, oi.quantity, oi.unit_price_snapshot, oi.total,
                oi.note, oi.status, oi.options_json, oi.extras_json,
                d.kind AS department_kind, d.name_fa AS department_name,
                p.id AS prep_id, p.status AS prep_status, p.target_minutes
           FROM order_items oi
           LEFT JOIN departments d ON d.id = oi.department_id
           LEFT JOIN prep_tasks p ON p.order_item_id = oi.id
          WHERE oi.order_id = ?
          ORDER BY oi.created_at ASC, oi.rowid ASC`,
        [id],
      )
      .map<StaffOrderItem>((item) => ({
        id: item.id,
        productNameFa: item.product_name_snapshot,
        quantity: item.quantity,
        unitPrice: item.unit_price_snapshot,
        total: item.total,
        note: item.note,
        itemStatus: item.status,
        departmentKind: item.department_kind,
        departmentNameFa: item.department_name,
        prepId: item.prep_id,
        prepStatus: item.prep_status,
        targetMinutes: item.target_minutes,
        options: parseJsonList(item.options_json),
        extras: parseJsonList(item.extras_json),
      }));

    const events = this.database
      .all<OrderEventRow>(
        `SELECT e.id, e.type, e.from_status, e.to_status, e.created_at, u.full_name AS actor_name
           FROM order_events e
           LEFT JOIN users u ON u.id = e.actor_user_id
          WHERE e.order_id = ?
          ORDER BY e.created_at ASC, e.rowid ASC`,
        [id],
      )
      .map<StaffOrderEvent>((event) => ({
        id: event.id,
        type: event.type,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        actorName: event.actor_name,
        createdAt: event.created_at,
      }));

    const billRow = this.database.get<{
      id: string;
      status: string;
      total: number;
      paid_total: number;
      settled_at: string | null;
    }>('SELECT id, status, total, paid_total, settled_at FROM bills WHERE order_id = ? ORDER BY created_at DESC LIMIT 1', [id]);

    const bill: OrderBill | null = billRow
      ? {
          id: billRow.id,
          status: billRow.status as OrderBill['status'],
          total: billRow.total,
          paidTotal: billRow.paid_total,
          settledAt: billRow.settled_at,
        }
      : null;

    const payments = this.database
      .all<{
        id: string;
        method: string;
        amount: number;
        status: string;
        reference: string | null;
        paid_at: string;
        receiver: string | null;
      }>(
        `SELECT p.id, p.method, p.amount, p.status, p.reference, p.paid_at, u.full_name AS receiver
           FROM payments p
           LEFT JOIN users u ON u.id = p.received_by_user_id
          WHERE p.order_id = ?
          ORDER BY p.paid_at ASC, p.rowid ASC`,
        [id],
      )
      .map<PaymentRecord>((payment) => ({
        id: payment.id,
        method: payment.method as PaymentMethod,
        methodLabelFa: PAYMENT_METHOD_LABELS_FA[payment.method as PaymentMethod] ?? payment.method,
        amount: payment.amount,
        status: payment.status,
        reference: payment.reference,
        receivedByName: payment.receiver,
        paidAt: payment.paid_at,
      }));

    return {
      ...toSummary(row),
      subtotal: row.subtotal,
      discountTotal: row.discount_total,
      serviceCharge: row.service_charge,
      taxTotal: row.tax_total,
      cancelReason: row.cancel_reason,
      sessionId: row.table_session_id,
      submittedAt: row.submitted_at,
      servedAt: row.served_at,
      bill,
      payments,
      items,
      events,
    };
  }

  findOrderState(id: string): {
    id: string;
    code: string;
    status: OrderStatus;
    tableId: string | null;
    sessionId: string | null;
  } | undefined {
    const row = this.database.get<{
      id: string;
      code: string;
      status: OrderStatus;
      table_id: string | null;
      table_session_id: string | null;
    }>('SELECT id, code, status, table_id, table_session_id FROM orders WHERE id = ?', [id]);
    if (!row) return undefined;
    return { id: row.id, code: row.code, status: row.status, tableId: row.table_id, sessionId: row.table_session_id };
  }

  updateOrder(
    id: string,
    fields: {
      status: OrderStatus;
      servedAt?: string;
      paidAt?: string;
      closedAt?: string;
      cancelReason?: string;
      cancelledByUserId?: string;
    },
  ): void {
    const columns = ['status = ?', 'updated_at = ?'];
    const values: unknown[] = [fields.status, new Date().toISOString()];

    if (fields.servedAt !== undefined) {
      columns.push('served_at = ?');
      values.push(fields.servedAt);
    }
    if (fields.paidAt !== undefined) {
      columns.push('paid_at = ?');
      values.push(fields.paidAt);
    }
    if (fields.closedAt !== undefined) {
      columns.push('closed_at = ?');
      values.push(fields.closedAt);
    }
    if (fields.cancelReason !== undefined) {
      columns.push('cancel_reason = ?');
      values.push(fields.cancelReason);
    }
    if (fields.cancelledByUserId !== undefined) {
      columns.push('cancelled_by_user_id = ?');
      values.push(fields.cancelledByUserId);
    }

    this.database.run(`UPDATE orders SET ${columns.join(', ')} WHERE id = ?`, [...values, id]);
  }

  insertEvent(entry: {
    orderId: string;
    type: string;
    fromStatus: string | null;
    toStatus: string | null;
    actorUserId?: string | null;
    payload?: unknown;
  }): void {
    this.database.run(
      `INSERT INTO order_events (id, order_id, type, from_status, to_status, actor_user_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        entry.orderId,
        entry.type,
        entry.fromStatus,
        entry.toStatus,
        entry.actorUserId ?? null,
        entry.payload === undefined ? null : JSON.stringify(entry.payload),
        new Date().toISOString(),
      ],
    );
  }

  cancelRemainingWork(orderId: string): void {
    this.database.run(
      `UPDATE prep_tasks SET status = 'cancelled' WHERE order_id = ? AND status IN ('queued', 'in_progress', 'delayed')`,
      [orderId],
    );
    this.database.run(
      `UPDATE order_items SET status = 'cancelled' WHERE order_id = ? AND status NOT IN ('ready', 'served', 'cancelled')`,
      [orderId],
    );
  }

  countActiveOrdersInSession(sessionId: string, exceptOrderId: string): number {
    return this.database.count(
      `SELECT COUNT(*) AS n FROM orders
        WHERE table_session_id = ? AND id <> ?
          AND status IN (${ACTIVE_ORDER_STATUSES.map(() => '?').join(', ')})`,
      [sessionId, exceptOrderId, ...ACTIVE_ORDER_STATUSES],
    );
  }

  findTable(tableId: string): { id: string; code: string; status: string; sessionId: string | null } | undefined {
    const row = this.database.get<{ id: string; code: string; status: string; session_id: string | null }>(
      `SELECT t.id, t.code, t.status, s.id AS session_id
         FROM dining_tables t
         LEFT JOIN table_sessions s ON s.table_id = t.id AND s.status = 'open'
        WHERE t.id = ? AND t.deleted_at IS NULL`,
      [tableId],
    );
    if (!row) return undefined;
    return { id: row.id, code: row.code, status: row.status, sessionId: row.session_id };
  }

  listSessionOrders(sessionId: string): Array<{
    id: string;
    code: string;
    status: OrderStatus;
    total: number;
    paid_total: number;
  }> {
    return this.database.all(
      `SELECT id, code, status, total, paid_total FROM orders
        WHERE table_session_id = ? ORDER BY created_at ASC`,
      [sessionId],
    );
  }

  findTerminalRequest(id: string):
    | {
        id: string;
        status: string;
        orderId: string | null;
        tableId: string | null;
      }
    | undefined {
    const row = this.database.get<{
      id: string;
      status: string;
      order_id: string | null;
      table_id: string | null;
    }>('SELECT id, status, order_id, table_id FROM terminal_requests WHERE id = ?', [id]);
    if (!row) return undefined;
    return { id: row.id, status: row.status, orderId: row.order_id, tableId: row.table_id };
  }

  /** Oldest order for a table that has not been paid or cancelled yet. */
  findOldestUnpaidOrderForTable(tableId: string):
    | { id: string; code: string; status: OrderStatus; total: number; paid_total: number }
    | undefined {
    return this.database.get(
      `SELECT id, code, status, total, paid_total FROM orders
        WHERE table_id = ? AND status NOT IN ('paid', 'cancelled')
        ORDER BY created_at ASC LIMIT 1`,
      [tableId],
    );
  }

  closeSession(sessionId: string): void {
    this.database.run(
      "UPDATE table_sessions SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'open'",
      [new Date().toISOString(), sessionId],
    );
  }

  setTableStatus(tableId: string, status: string): void {
    this.database.run('UPDATE dining_tables SET status = ?, updated_at = ? WHERE id = ?', [
      status,
      new Date().toISOString(),
      tableId,
    ]);
  }

  /* ------------------------------- prep -------------------------------- */

  listPrepQueue(params: { kind?: string; includeFinished: boolean }): PrepQueueItem[] {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (!params.includeFinished) {
      clauses.push("p.status IN ('queued', 'in_progress', 'delayed')");
      clauses.push("o.status NOT IN ('cancelled', 'paid')");
    }
    if (params.kind) {
      clauses.push('d.kind = ?');
      values.push(params.kind);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    return this.database
      .all<PrepRow>(
        `SELECT p.id, p.order_id, o.code AS order_code, t.code AS table_code, t.name_fa AS table_name_fa,
                oi.product_name_snapshot, oi.quantity, oi.note, p.status, oi.status AS item_status,
                d.kind AS department_kind, d.name_fa AS department_name, p.target_minutes, p.created_at,
                CAST((julianday('now') - julianday(p.created_at)) * 1440 AS INTEGER) AS elapsed_minutes
           FROM prep_tasks p
           JOIN orders o ON o.id = p.order_id
           JOIN order_items oi ON oi.id = p.order_item_id
           LEFT JOIN dining_tables t ON t.id = o.table_id
           LEFT JOIN departments d ON d.id = p.department_id
          ${where}
          ORDER BY p.status = 'queued' DESC, p.created_at ASC
          LIMIT 200`,
        values,
      )
      .map<PrepQueueItem>((row) => ({
        id: row.id,
        orderId: row.order_id,
        orderCode: row.order_code,
        tableCode: row.table_code,
        tableNameFa: row.table_name_fa,
        productNameFa: row.product_name_snapshot,
        quantity: row.quantity,
        note: row.note,
        status: row.status,
        itemStatus: row.item_status,
        departmentKind: row.department_kind,
        departmentNameFa: row.department_name,
        targetMinutes: row.target_minutes,
        elapsedMinutes: row.elapsed_minutes,
        isDelayed:
          (row.status === 'queued' || row.status === 'in_progress' || row.status === 'delayed') &&
          row.elapsed_minutes > row.target_minutes,
        createdAt: row.created_at,
      }));
  }

  findPrepTask(id: string): {
    id: string;
    orderId: string;
    status: string;
    orderStatus: OrderStatus;
    tableId: string | null;
    targetMinutes: number;
  } | undefined {
    const row = this.database.get<{
      id: string;
      order_id: string;
      status: string;
      order_status: OrderStatus;
      table_id: string | null;
      target_minutes: number;
    }>(
      `SELECT p.id, p.order_id, p.status, o.status AS order_status, o.table_id, p.target_minutes
         FROM prep_tasks p JOIN orders o ON o.id = p.order_id
        WHERE p.id = ?`,
      [id],
    );
    if (!row) return undefined;
    return {
      id: row.id,
      orderId: row.order_id,
      status: row.status,
      orderStatus: row.order_status,
      tableId: row.table_id,
      targetMinutes: row.target_minutes,
    };
  }

  updatePrepTask(id: string, status: string): void {
    const now = new Date().toISOString();
    this.database.run(
      `UPDATE prep_tasks
          SET status = ?,
              started_at = CASE WHEN ? = 'in_progress' AND started_at IS NULL THEN ? ELSE started_at END,
              ready_at = CASE WHEN ? = 'ready' THEN ? ELSE ready_at END
        WHERE id = ?`,
      [status, status, now, status, now, id],
    );
  }

  setOrderItemStatus(itemId: string, status: string): void {
    this.database.run('UPDATE order_items SET status = ? WHERE id = ?', [status, itemId]);
  }

  setOrderItemsStatusForPrep(prepTaskId: string, status: string): void {
    this.database.run(
      `UPDATE order_items SET status = ?
        WHERE id = (SELECT order_item_id FROM prep_tasks WHERE id = ?)`,
      [status, prepTaskId],
    );
  }

  prepStatusCounts(orderId: string): {
    total: number;
    ready: number;
    cancelled: number;
    inProgress: number;
    delayed: number;
    open: number;
  } {
    const row = this.database.get<{
      total: number;
      ready: number;
      cancelled: number;
      in_progress: number;
      delayed: number;
    }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END), 0) AS ready,
              COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
              COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress,
              COALESCE(SUM(CASE WHEN status = 'delayed' THEN 1 ELSE 0 END), 0) AS delayed
         FROM prep_tasks WHERE order_id = ?`,
      [orderId],
    );
    const total = row?.total ?? 0;
    const ready = row?.ready ?? 0;
    const cancelled = row?.cancelled ?? 0;
    const inProgress = row?.in_progress ?? 0;
    const delayed = row?.delayed ?? 0;
    return { total, ready, cancelled, inProgress, delayed, open: total - ready - cancelled };
  }

  /* ------------------------------- tables ------------------------------ */

  listTables(): StaffTablesResponse {
    const rows = this.database.all<TableRow>(
      `SELECT t.id, t.code, t.name_fa, t.capacity, t.shape, t.status,
              f.name_fa AS floor_name_fa, a.name_fa AS area_name_fa, u.full_name AS waiter_name,
              s.id AS session_id, s.opened_at,
              (SELECT COUNT(*) FROM orders o
                WHERE o.table_id = t.id AND o.status IN (${ACTIVE_ORDER_STATUSES.map(() => '?').join(', ')})) AS active_orders,
              (SELECT COALESCE(SUM(o.total), 0) FROM orders o
                WHERE o.table_id = t.id AND o.status IN (${ACTIVE_ORDER_STATUSES.map(() => '?').join(', ')})) AS open_total,
              (SELECT COUNT(*) FROM customer_requests r
                WHERE r.table_id = t.id AND r.status = 'pending') AS pending_requests
         FROM dining_tables t
         LEFT JOIN floors f ON f.id = t.floor_id
         LEFT JOIN areas a ON a.id = t.area_id
         LEFT JOIN users u ON u.id = t.waiter_user_id
         LEFT JOIN table_sessions s ON s.table_id = t.id AND s.status = 'open'
        WHERE t.deleted_at IS NULL AND t.is_active = 1
        ORDER BY f.sort_order ASC, t.code ASC`,
      [...ACTIVE_ORDER_STATUSES, ...ACTIVE_ORDER_STATUSES],
    );

    const items: StaffTableRow[] = rows.map((row) => ({
      id: row.id,
      code: row.code,
      nameFa: row.name_fa,
      capacity: row.capacity,
      shape: row.shape,
      status: row.status,
      floorNameFa: row.floor_name_fa,
      areaNameFa: row.area_name_fa,
      waiterName: row.waiter_name,
      sessionId: row.session_id,
      openedAt: row.opened_at,
      activeOrders: row.active_orders,
      openTotal: row.open_total,
      pendingRequests: row.pending_requests,
    }));

    return {
      items,
      summary: {
        total: items.length,
        occupied: items.filter((table) => table.status === 'occupied' || table.status === 'waiting_service' || table.status === 'waiting_payment').length,
        available: items.filter((table) => table.status === 'available').length,
        reserved: items.filter((table) => table.status === 'reserved').length,
      },
    };
  }

  /* ------------------------------ requests ----------------------------- */

  listServiceRequests(status: 'pending' | 'all'): ServiceRequestRow[] {
    const where = status === 'pending' ? "WHERE r.status = 'pending'" : '';
    return this.database
      .all<ServiceRequestDbRow>(
        `SELECT r.id, r.type, r.note, r.status, r.table_id, t.code AS table_code, t.name_fa AS table_name_fa,
                u.full_name AS handled_by_name, r.created_at, r.resolved_at
           FROM customer_requests r
           LEFT JOIN dining_tables t ON t.id = r.table_id
           LEFT JOIN users u ON u.id = r.handled_by_user_id
          ${where}
          ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END, r.created_at DESC
          LIMIT 100`,
      )
      .map<ServiceRequestRow>((row) => ({
        id: row.id,
        type: row.type,
        typeLabelFa: CUSTOMER_REQUEST_LABELS_FA[row.type] ?? row.type,
        note: row.note,
        status: row.status,
        tableId: row.table_id,
        tableCode: row.table_code,
        tableNameFa: row.table_name_fa,
        handledByName: row.handled_by_name,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
      }));
  }

  findServiceRequest(id: string): { id: string; status: string; type: string } | undefined {
    return this.database.get<{ id: string; status: string; type: string }>(
      'SELECT id, status, type FROM customer_requests WHERE id = ?',
      [id],
    );
  }

  updateServiceRequest(id: string, status: string, handledBy: string): void {
    const now = new Date().toISOString();
    this.database.run(
      `UPDATE customer_requests
          SET status = ?, handled_by_user_id = ?,
              resolved_at = CASE WHEN ? IN ('done', 'cancelled') THEN ? ELSE resolved_at END
        WHERE id = ?`,
      [status, handledBy, status, now, id],
    );
  }

  listTerminalRequests(status: 'pending' | 'all'): TerminalRequestRow[] {
    const where = status === 'pending' ? "WHERE tr.status IN ('pending', 'assigned')" : '';
    return this.database
      .all<TerminalRequestDbRow>(
        `SELECT tr.id, tr.status, tr.note, t.code AS table_code, t.name_fa AS table_name_fa,
                o.code AS order_code, tr.created_at, tr.completed_at
           FROM terminal_requests tr
           LEFT JOIN dining_tables t ON t.id = tr.table_id
           LEFT JOIN orders o ON o.id = tr.order_id
          ${where}
          ORDER BY tr.created_at DESC
          LIMIT 100`,
      )
      .map<TerminalRequestRow>((row) => ({
        id: row.id,
        status: row.status,
        note: row.note,
        tableCode: row.table_code,
        tableNameFa: row.table_name_fa,
        orderCode: row.order_code,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      }));
  }

  completeTerminalRequest(id: string, orderId: string | null = null): void {
    this.database.run(
      `UPDATE terminal_requests
          SET status = 'completed', completed_at = ?, order_id = COALESCE(?, order_id)
        WHERE id = ? AND status IN ('pending', 'assigned')`,
      [new Date().toISOString(), orderId, id],
    );
  }

  notifyRole(roleKey: string, type: string, titleFa: string, bodyFa: string, data: unknown): void {
    this.database.run(
      `INSERT INTO notifications (id, role_key, type, title_fa, body_fa, data_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), roleKey, type, titleFa, bodyFa, JSON.stringify(data), new Date().toISOString()],
    );
  }
}
