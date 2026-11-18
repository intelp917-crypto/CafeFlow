import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  PAYMENT_METHOD_LABELS_FA,
  type OrderBill,
  type OrderStatus,
  type PaymentMethod,
  type PaymentRecord,
} from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

export interface PaymentOrderRow {
  id: string;
  code: string;
  status: OrderStatus;
  total: number;
  paid_total: number;
  subtotal: number;
  discount_total: number;
  service_charge: number;
  tax_total: number;
  table_id: string | null;
  table_session_id: string | null;
}

interface BillRow {
  id: string;
  status: 'open' | 'settled' | 'void';
  total: number;
  paid_total: number;
  settled_at: string | null;
}

interface PaymentRow {
  id: string;
  method: string;
  amount: number;
  status: string;
  reference: string | null;
  paid_at: string;
  receiver: string | null;
}

/**
 * Bills and payments. Amounts are integer rial and always derived from the
 * order snapshots on the server; nothing here trusts a client-supplied total.
 */
@Injectable()
export class PaymentsRepository {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  findOrder(id: string): PaymentOrderRow | undefined {
    return this.database.get<PaymentOrderRow>(
      `SELECT id, code, status, total, paid_total, subtotal, discount_total, service_charge, tax_total,
              table_id, table_session_id
         FROM orders WHERE id = ?`,
      [id],
    );
  }

  findBill(orderId: string): OrderBill | undefined {
    const row = this.database.get<BillRow>(
      `SELECT id, status, total, paid_total, settled_at
         FROM bills WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`,
      [orderId],
    );
    if (!row) return undefined;
    return {
      id: row.id,
      status: row.status,
      total: row.total,
      paidTotal: row.paid_total,
      settledAt: row.settled_at,
    };
  }

  /** One open bill per order; created on first payment. */
  ensureBill(order: PaymentOrderRow): OrderBill {
    const existing = this.database.get<BillRow>(
      `SELECT id, status, total, paid_total, settled_at
         FROM bills WHERE order_id = ? AND status = 'open' LIMIT 1`,
      [order.id],
    );
    if (existing) {
      return {
        id: existing.id,
        status: existing.status,
        total: existing.total,
        paidTotal: existing.paid_total,
        settledAt: existing.settled_at,
      };
    }

    const id = randomUUID();
    this.database.run(
      `INSERT INTO bills (id, order_id, table_session_id, status, total, paid_total, created_at)
       VALUES (?, ?, ?, 'open', ?, 0, ?)`,
      [id, order.id, order.table_session_id, order.total, new Date().toISOString()],
    );

    return { id, status: 'open', total: order.total, paidTotal: 0, settledAt: null };
  }

  sumConfirmed(orderId: string): number {
    const row = this.database.get<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM payments
        WHERE order_id = ? AND status = 'confirmed'`,
      [orderId],
    );
    return row?.total ?? 0;
  }

  listPayments(orderId: string): PaymentRecord[] {
    return this.database
      .all<PaymentRow>(
        `SELECT p.id, p.method, p.amount, p.status, p.reference, p.paid_at, u.full_name AS receiver
           FROM payments p
           LEFT JOIN users u ON u.id = p.received_by_user_id
          WHERE p.order_id = ?
          ORDER BY p.paid_at ASC, p.rowid ASC`,
        [orderId],
      )
      .map((row) => ({
        id: row.id,
        method: row.method as PaymentMethod,
        methodLabelFa: PAYMENT_METHOD_LABELS_FA[row.method as PaymentMethod] ?? row.method,
        amount: row.amount,
        status: row.status,
        reference: row.reference,
        receivedByName: row.receiver,
        paidAt: row.paid_at,
      }));
  }

  sumRefunded(orderId: string): number {
    const row = this.database.get<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM payments
        WHERE order_id = ? AND status = 'refunded'`,
      [orderId],
    );
    return row?.total ?? 0;
  }

  /** Money actually kept: confirmed payments minus refunded amounts. */
  netPaid(orderId: string): number {
    return this.sumConfirmed(orderId) - this.sumRefunded(orderId);
  }

  insertRefund(entry: {
    orderId: string;
    billId: string | null;
    method: PaymentMethod;
    amount: number;
    reference: string;
    receivedByUserId: string;
  }): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.run(
      `INSERT INTO payments
         (id, bill_id, order_id, method, amount, status, received_by_user_id, reference, paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'refunded', ?, ?, ?, ?)`,
      [id, entry.billId, entry.orderId, entry.method, entry.amount, entry.receivedByUserId, entry.reference, now, now],
    );
    return id;
  }

  updateOrderDiscount(orderId: string, discountTotal: number, total: number): void {
    this.database.run('UPDATE orders SET discount_total = ?, total = ?, updated_at = ? WHERE id = ?', [
      discountTotal,
      total,
      new Date().toISOString(),
      orderId,
    ]);
  }

  /** Keeps an open bill in sync with a discount; settled bills stay untouched. */
  updateOpenBillTotal(orderId: string, total: number): void {
    this.database.run("UPDATE bills SET total = ? WHERE order_id = ? AND status = 'open'", [total, orderId]);
  }

  insertOrderEvent(entry: { orderId: string; type: string; actorUserId: string; payload?: unknown }): void {
    this.database.run(
      `INSERT INTO order_events (id, order_id, type, actor_user_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        entry.orderId,
        entry.type,
        entry.actorUserId,
        entry.payload === undefined ? null : JSON.stringify(entry.payload),
        new Date().toISOString(),
      ],
    );
  }

  insertPayment(entry: {
    orderId: string;
    billId: string;
    method: PaymentMethod;
    amount: number;
    reference?: string | null;
    receivedByUserId: string;
  }): string {
    const id = randomUUID();
    this.database.run(
      `INSERT INTO payments
         (id, bill_id, order_id, method, amount, status, received_by_user_id, reference, paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`,
      [
        id,
        entry.billId,
        entry.orderId,
        entry.method,
        entry.amount,
        entry.receivedByUserId,
        entry.reference ?? null,
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );
    return id;
  }

  updateBill(billId: string, paidTotal: number, status: 'open' | 'settled', settledAt: string | null): void {
    this.database.run('UPDATE bills SET paid_total = ?, status = ?, settled_at = ? WHERE id = ?', [
      paidTotal,
      status,
      settledAt,
      billId,
    ]);
  }

  updateOrderPaidTotal(orderId: string, paidTotal: number): void {
    this.database.run('UPDATE orders SET paid_total = ?, updated_at = ? WHERE id = ?', [
      paidTotal,
      new Date().toISOString(),
      orderId,
    ]);
  }

  /* ---------------------------- terminal requests ---------------------------- */

  findTerminalRequest(id: string):
    | { id: string; status: string; orderId: string | null; tableId: string | null }
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

  findOldestUnpaidOrderForTable(tableId: string): PaymentOrderRow | undefined {
    return this.database.get<PaymentOrderRow>(
      `SELECT id, code, status, total, paid_total, table_id, table_session_id
         FROM orders
        WHERE table_id = ? AND status NOT IN ('paid', 'cancelled')
        ORDER BY created_at ASC LIMIT 1`,
      [tableId],
    );
  }

  completeTerminalRequest(id: string, orderId: string | null): void {
    this.database.run(
      `UPDATE terminal_requests
          SET status = 'completed', completed_at = ?, order_id = COALESCE(?, order_id)
        WHERE id = ? AND status IN ('pending', 'assigned')`,
      [new Date().toISOString(), orderId, id],
    );
  }
}
