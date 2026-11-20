import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  PAYMENT_METHOD_LABELS_FA,
  type BillSplit,
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
  split_label: string | null;
}

interface SplitRow {
  id: string;
  bill_id: string;
  label: string;
  amount: number;
  is_paid: number;
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

  /* --------------------------------- splits -------------------------------- */

  /** Shares of the latest bill; a settled bill keeps all of them marked paid. */
  listSplits(orderId: string): BillSplit[] {
    return this.database
      .all<{ id: string; label: string; amount: number; is_paid: number }>(
        `SELECT s.id, s.label, s.amount, s.is_paid
           FROM bill_splits s
          WHERE s.bill_id = (SELECT id FROM bills WHERE order_id = ? ORDER BY created_at DESC LIMIT 1)
          ORDER BY s.rowid ASC`,
        [orderId],
      )
      .map((row) => ({ id: row.id, label: row.label, amount: row.amount, isPaid: row.is_paid === 1 }));
  }

  hasOpenSplits(orderId: string): boolean {
    const row = this.database.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM bill_splits s
         JOIN bills b ON b.id = s.bill_id
        WHERE b.order_id = ? AND b.status = 'open'`,
      [orderId],
    );
    return (row?.n ?? 0) > 0;
  }

  /** Replaces the shares of the bill; the caller wraps it in a transaction. */
  replaceSplits(billId: string, shares: { label: string; amount: number }[]): void {
    this.database.run('DELETE FROM bill_splits WHERE bill_id = ?', [billId]);
    for (const share of shares) {
      this.database.run('INSERT INTO bill_splits (id, bill_id, label, amount, is_paid) VALUES (?, ?, ?, ?, 0)', [
        randomUUID(),
        billId,
        share.label,
        share.amount,
      ]);
    }
  }

  clearSplits(orderId: string): number {
    const result = this.database.run(
      `DELETE FROM bill_splits
        WHERE bill_id IN (SELECT id FROM bills WHERE order_id = ? AND status = 'open')`,
      [orderId],
    );
    return result.changes;
  }

  /**
   * Marks shares paid in order while their cumulative amount is covered. A
   * share already settled by an explicit share payment is never unmarked, and
   * its amount is subtracted first so a later partial payment cannot settle the
   * wrong person's share.
   */
  syncSplits(billId: string, paidTotal: number): void {
    const rows = this.database.all<{ id: string; amount: number; is_paid: number }>(
      'SELECT id, amount, is_paid FROM bill_splits WHERE bill_id = ? ORDER BY rowid ASC',
      [billId],
    );

    let covered = paidTotal;
    for (const row of rows) {
      if (row.is_paid === 1) covered -= row.amount;
    }

    let cumulative = 0;
    for (const row of rows) {
      if (row.is_paid === 1) continue;
      cumulative += row.amount;
      const isPaid = cumulative <= covered ? 1 : 0;
      if (isPaid !== row.is_paid) {
        this.database.run('UPDATE bill_splits SET is_paid = ? WHERE id = ?', [isPaid, row.id]);
      }
    }
  }

  /** One share of this order's latest bill, for explicit payment attribution. */
  findSplit(orderId: string, splitId: string): SplitRow | undefined {
    return this.database.get<SplitRow>(
      `SELECT s.id, s.bill_id, s.label, s.amount, s.is_paid
         FROM bill_splits s
         JOIN bills b ON b.id = s.bill_id
        WHERE s.id = ? AND b.order_id = ?
        ORDER BY b.created_at DESC
        LIMIT 1`,
      [splitId, orderId],
    );
  }

  markSplitPaid(splitId: string): void {
    this.database.run('UPDATE bill_splits SET is_paid = 1 WHERE id = ?', [splitId]);
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
        `SELECT p.id, p.method, p.amount, p.status, p.reference, p.paid_at, u.full_name AS receiver,
                s.label AS split_label
           FROM payments p
           LEFT JOIN users u ON u.id = p.received_by_user_id
           LEFT JOIN bill_splits s ON s.id = p.bill_split_id
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
        splitLabelFa: row.split_label,
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
    cashRegisterId: string | null;
  }): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.run(
      `INSERT INTO payments
         (id, bill_id, order_id, method, amount, status, received_by_user_id, cash_register_id,
          reference, paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'refunded', ?, ?, ?, ?, ?)`,
      [
        id,
        entry.billId,
        entry.orderId,
        entry.method,
        entry.amount,
        entry.receivedByUserId,
        entry.cashRegisterId,
        entry.reference,
        now,
        now,
      ],
    );
    return id;
  }

  /**
   * Which register the money belongs to. One open session is unambiguous and is
   * used even when another cashier opened it; with several open sessions only
   * the actor's own session is used, never an arbitrary guess.
   */
  openCashRegisterFor(userId: string): string | null {
    const open = this.database.all<{ cash_register_id: string; opened_by_user_id: string }>(
      `SELECT cash_register_id, opened_by_user_id FROM cash_sessions
        WHERE status = 'open' ORDER BY opened_at DESC`,
    );
    if (open.length === 0) return null;
    if (open.length === 1) return open[0]!.cash_register_id;
    return open.find((row) => row.opened_by_user_id === userId)?.cash_register_id ?? null;
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
    cashRegisterId: string | null;
    billSplitId: string | null;
  }): string {
    const id = randomUUID();
    this.database.run(
      `INSERT INTO payments
         (id, bill_id, order_id, method, amount, status, received_by_user_id, cash_register_id,
          bill_split_id, reference, paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.billId,
        entry.orderId,
        entry.method,
        entry.amount,
        entry.receivedByUserId,
        entry.cashRegisterId,
        entry.billSplitId,
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
