import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ORDER_TRANSITIONS,
  PREP_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
  canPrepTransition,
  canTransition,
  percentOf,
  type AddStaffOrderItemsInput,
  type CreateStaffOrderInput,
  type ListOrdersQuery,
  type OrderStatus,
  type PrepQueueItem,
  type PrepStatus,
  type ServiceRequestRow,
  type StaffOrderDetail,
  type StaffTablesResponse,
  type TerminalRequestRow,
  type UpdateOrderItemInput,
} from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';
import { AuditService } from '../audit/audit.service';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import { InventoryService } from '../inventory/inventory.service';
import type { PricedOrder } from '../public/public.service';
import { PublicService } from '../public/public.service';
import { OrdersRepository } from './orders.repository';

export interface ActingUser {
  userId: string;
  username: string;
  permissions: string[];
}

interface OrderState {
  id: string;
  code: string;
  status: OrderStatus;
  tableId: string | null;
  sessionId: string | null;
}

/**
 * Finds the shortest legal path between two statuses using the shared state
 * machine. Automation (prep finishing) must walk the same edges as staff, so a
 * unit going from "queued" to "ready" cannot jump the order past confirmation.
 */
function findStatusPath(from: OrderStatus, to: OrderStatus): OrderStatus[] | null {
  if (from === to) return [];
  const queue: Array<{ status: OrderStatus; path: OrderStatus[] }> = [{ status: from, path: [] }];
  const seen = new Set<OrderStatus>([from]);

  while (queue.length > 0) {
    const current = queue.shift() as { status: OrderStatus; path: OrderStatus[] };
    for (const next of ORDER_TRANSITIONS[current.status]) {
      if (next === to) return [...current.path, next];
      if (!seen.has(next)) {
        seen.add(next);
        queue.push({ status: next, path: [...current.path, next] });
      }
    }
  }
  return null;
}

const AUTO_ADVANCE_NOTE = 'به‌روزرسانی خودکار بر اساس پیشرفت آماده‌سازی';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB_SERVICE) private readonly database: DatabaseService,
    @Inject(OrdersRepository) private readonly repository: OrdersRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(PublicService) private readonly publicMenu: PublicService,
  ) {}

  list(query: ListOrdersQuery) {
    const { items, total } = this.repository.listOrders(query);
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / query.pageSize), 1),
    };
  }

  detail(id: string): StaffOrderDetail {
    const order = this.repository.findOrder(id);
    if (!order) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');

    const allowed = ORDER_TRANSITIONS[order.status]
      .filter((status) => status !== 'paid' && status !== 'partially_ready')
      .map((status) => ({
        status,
        labelFa: status === 'cancelled' ? 'لغو سفارش' : `تغییر به ${this.statusLabel(status)}`,
      }));

    return { ...order, allowedTransitions: allowed };
  }

  transition(id: string, to: OrderStatus, actor: ActingUser, reason?: string): StaffOrderDetail {
    const order = this.repository.findOrderState(id);
    if (!order) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');

    if (TERMINAL_ORDER_STATUSES.includes(order.status)) {
      throw conflict('این سفارش بسته شده است و وضعیت آن قابل تغییر نیست.', 'ORDER_CLOSED');
    }

    if (to === 'paid') {
      throw conflict(
        'وضعیت «پرداخت شده» فقط از پرداخت‌های تأییدشده مشتق می‌شود؛ تسویه را از صفحه صندوق ثبت کنید.',
        'PAYMENT_REQUIRED',
      );
    }

    if (to === 'partially_ready') {
      throw badRequest(
        'وضعیت «بخشی آماده» به‌صورت خودکار از صف آماده‌سازی تعیین می‌شود.',
        'DERIVED_STATUS',
      );
    }

    if (!canTransition(order.status, to)) {
      throw conflict(
        `تغییر وضعیت از «${this.statusLabel(order.status)}» به «${this.statusLabel(to)}» مجاز نیست.`,
        'ORDER_TRANSITION_INVALID',
      );
    }

    if (to === 'cancelled') {
      if (!actor.permissions.includes('orders.cancel')) {
        throw forbidden('برای لغو سفارش مجوز «orders.cancel» لازم است.', 'PERMISSION_DENIED');
      }
      if (!reason || reason.trim().length === 0) {
        throw badRequest('دلیل لغو سفارش الزامی است.', 'CANCEL_REASON_REQUIRED');
      }
    }

    this.database.transaction(() => {
      this.changeStatus(order, to, { actor, reason, auto: false });
    });

    const detail = this.detail(id);

    if (to === 'cancelled') {
      this.audit.record({
        actorUserId: actor.userId,
        actorUsername: actor.username,
        action: 'order.cancelled',
        entityType: 'order',
        entityId: order.id,
        before: { status: order.status },
        after: { status: to, reason: reason?.trim() ?? null, code: order.code },
      });
    }

    return detail;
  }

  /* ---------------------------- staff ordering ---------------------------- */

  /**
   * A waiter enters the order at the table. Lines are priced by the same menu
   * engine as the QR flow, so availability, options, extras, hours and every
   * amount are decided server-side; the order starts confirmed because the
   * guest agreed with the staff member standing there.
   */
  createStaffOrder(input: CreateStaffOrderInput, actor: ActingUser): StaffOrderDetail {
    const priced = this.publicMenu.priceLines(input.items);
    const table = input.tableId ? this.repository.findTable(input.tableId) : undefined;
    if (input.tableId && !table) throw notFound('میزی با این شناسه یافت نشد.', 'TABLE_NOT_FOUND');

    const id = randomUUID();
    const code = this.publicMenu.nextOrderCode();

    this.database.transaction(() => {
      const sessionId = table
        ? table.sessionId ?? this.repository.openTableSession(table.id, actor.userId)
        : null;
      if (table) this.repository.setTableStatus(table.id, 'occupied');

      this.repository.insertOrder({
        id,
        code,
        tableId: table?.id ?? null,
        sessionId,
        source: 'waiter',
        subtotal: priced.subtotal,
        discountTotal: 0,
        serviceCharge: priced.serviceCharge,
        taxTotal: priced.taxTotal,
        total: priced.total,
        note: input.note ?? null,
        createdByUserId: actor.userId,
      });

      this.insertPricedItems(id, priced);

      this.repository.insertEvent({
        orderId: id,
        type: 'order.created',
        fromStatus: null,
        toStatus: 'submitted',
        actorUserId: actor.userId,
        payload: {
          source: 'waiter',
          itemCount: priced.items.length,
          total: priced.total,
          tableId: table?.id ?? null,
        },
      });

      this.walk(
        { id, code, status: 'submitted', tableId: table?.id ?? null, sessionId },
        ['confirmed'],
        actor,
        undefined,
        false,
      );
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'order.created_by_staff',
      entityType: 'order',
      entityId: id,
      before: null,
      after: { code, tableId: table?.id ?? null, total: priced.total, itemCount: priced.items.length },
    });

    return this.detail(id);
  }

  /**
   * Extra rounds on an open order: the same table keeps one order, so the
   * kitchen sees a single stream and the bill grows with the new lines.
   */
  addStaffItems(orderId: string, input: AddStaffOrderItemsInput, actor: ActingUser): StaffOrderDetail {
    const state = this.repository.findOrderState(orderId);
    if (!state) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');
    if (TERMINAL_ORDER_STATUSES.includes(state.status)) {
      throw conflict('این سفارش بسته شده است و افزودن قلم به آن ممکن نیست.', 'ORDER_CLOSED');
    }

    const totals = this.repository.findOrderTotals(orderId);
    if (!totals) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');

    const priced = this.publicMenu.priceLines(input.items);
    const percents = this.publicMenu.chargePercents();
    const subtotal = totals.subtotal + priced.subtotal;
    const serviceCharge = percentOf(subtotal, percents.serviceChargePercent);
    const taxTotal = percentOf(subtotal + serviceCharge, percents.taxPercent);
    const total = Math.max(0, subtotal - totals.discountTotal + serviceCharge + taxTotal);

    this.database.transaction(() => {
      this.insertPricedItems(orderId, priced);
      this.repository.updateOrderTotals(orderId, { subtotal, serviceCharge, taxTotal, total });
      this.repository.insertEvent({
        orderId,
        type: 'order.items_added',
        fromStatus: state.status,
        toStatus: state.status,
        actorUserId: actor.userId,
        payload: { itemCount: priced.items.length, addedSubtotal: priced.subtotal },
      });
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'order.items_added',
      entityType: 'order',
      entityId: orderId,
      before: totals,
      after: { subtotal, serviceCharge, taxTotal, total, addedItemCount: priced.items.length },
    });

    return this.detail(orderId);
  }

  /**
   * A line can shrink or disappear until the guest is served. Amounts are
   * recomputed from the remaining lines (never subtracted incrementally), and
   * an open bill follows the new total.
   */
  updateItem(
    orderId: string,
    itemId: string,
    input: UpdateOrderItemInput,
    actor: ActingUser,
  ): StaffOrderDetail {
    const state = this.repository.findOrderState(orderId);
    if (!state) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');
    if (TERMINAL_ORDER_STATUSES.includes(state.status) || state.status === 'awaiting_payment') {
      throw conflict('این سفارش بسته شده است و اقلام آن قابل تغییر نیست.', 'ORDER_CLOSED');
    }
    if (state.status === 'served') {
      throw conflict('سفارش سرو شده است و اقلام آن قابل کاهش نیست.', 'ORDER_ALREADY_SERVED');
    }

    const item = this.repository.findOrderItem(orderId, itemId);
    if (!item) throw notFound('قلم سفارش یافت نشد.', 'ORDER_ITEM_NOT_FOUND');
    if (item.status === 'cancelled') throw conflict('این قلم قبلاً حذف شده است.', 'ITEM_CANCELLED');
    if (item.status === 'served') throw conflict('این قلم سرو شده است و قابل تغییر نیست.', 'ITEM_SERVED');

    const totals = this.repository.findOrderTotals(orderId);
    if (!totals) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');

    const percents = this.publicMenu.chargePercents();
    const quantity = input.quantity;

    this.database.transaction(() => {
      if (quantity === 0) {
        this.repository.cancelOrderItem(itemId);
      } else {
        this.repository.setOrderItemQuantity(itemId, quantity, item.unitPrice * quantity);
      }

      const subtotal = this.repository.sumActiveSubtotal(orderId);
      const serviceCharge = percentOf(subtotal, percents.serviceChargePercent);
      const taxTotal = percentOf(subtotal + serviceCharge, percents.taxPercent);
      const total = Math.max(0, subtotal - totals.discountTotal + serviceCharge + taxTotal);
      this.repository.updateOrderTotals(orderId, { subtotal, serviceCharge, taxTotal, total });

      this.repository.insertEvent({
        orderId,
        type: quantity === 0 ? 'order.item_removed' : 'order.item_updated',
        fromStatus: state.status,
        toStatus: state.status,
        actorUserId: actor.userId,
        payload: {
          itemId,
          productNameFa: item.productNameFa,
          fromQuantity: item.quantity,
          toQuantity: quantity,
        },
      });
    });

    const after = this.repository.findOrderTotals(orderId);
    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: quantity === 0 ? 'order.item_removed' : 'order.item_updated',
      entityType: 'order',
      entityId: orderId,
      before: totals,
      after: after ?? null,
      metadata: { itemId, productNameFa: item.productNameFa, fromQuantity: item.quantity, toQuantity: quantity },
    });

    return this.detail(orderId);
  }

  /** Writes priced lines plus one preparation task per line, inside a transaction. */
  private insertPricedItems(orderId: string, priced: PricedOrder): void {
    for (const item of priced.items) {
      const itemId = randomUUID();
      this.repository.insertOrderItem({
        id: itemId,
        orderId,
        productId: item.product.id,
        productNameFa: item.product.name_fa,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        total: item.total,
        departmentId: item.product.department_id,
        options: item.options,
        extras: item.extras,
        note: item.note,
      });
      this.repository.insertPrepTask({
        orderItemId: itemId,
        orderId,
        departmentId: item.product.department_id,
        targetMinutes: item.product.prep_minutes,
      });
    }
  }

  /* ------------------------------ prep flow ----------------------------- */

  prepQueue(params: { kind?: string; includeFinished?: boolean }): { items: PrepQueueItem[] } {
    return { items: this.repository.listPrepQueue({ kind: params.kind, includeFinished: params.includeFinished === true }) };
  }

  transitionPrep(id: string, to: PrepStatus, actor: ActingUser): StaffOrderDetail {
    const task = this.repository.findPrepTask(id);
    if (!task) throw notFound('آیتم آماده‌سازی یافت نشد.', 'PREP_NOT_FOUND');

    if (!canPrepTransition(task.status as PrepStatus, to)) {
      throw conflict(
        `تغییر وضعیت آماده‌سازی از «${task.status}» به «${to}» مجاز نیست.`,
        'PREP_TRANSITION_INVALID',
      );
    }

    if (task.orderStatus === 'cancelled' || task.orderStatus === 'paid') {
      throw conflict('این سفارش بسته شده است.', 'ORDER_CLOSED');
    }

    this.database.transaction(() => {
      this.repository.updatePrepTask(id, to);

      if (to === 'in_progress') this.repository.setOrderItemsStatusForPrep(id, 'preparing');
      else if (to === 'ready') this.repository.setOrderItemsStatusForPrep(id, 'ready');
      else if (to === 'cancelled') this.repository.setOrderItemsStatusForPrep(id, 'cancelled');
      else if (to === 'delayed') this.repository.setOrderItemsStatusForPrep(id, 'preparing');

      this.repository.insertEvent({
        orderId: task.orderId,
        type: 'prep.status_changed',
        fromStatus: null,
        toStatus: null,
        actorUserId: actor.userId,
        payload: { prepTaskId: id, status: to },
      });

      this.syncOrderProgress(task.orderId, actor);
    });

    return this.detail(task.orderId);
  }

  /**
   * Derives the order status from its prep units. Called after every prep
   * change; walks the legal path so events stay consistent with the machine.
   */
  private syncOrderProgress(orderId: string, actor: ActingUser | null): void {
    const state = this.repository.findOrderState(orderId);
    if (!state || TERMINAL_ORDER_STATUSES.includes(state.status)) return;

    const counts = this.repository.prepStatusCounts(orderId);
    if (counts.total === 0) return;

    const open = counts.total - counts.ready - counts.cancelled;

    let target: OrderStatus | null = null;
    if (open === 0) target = counts.cancelled === counts.total ? 'cancelled' : 'ready';
    else if (counts.ready > 0) target = 'partially_ready';
    else if (counts.inProgress > 0 || counts.delayed > 0) target = 'preparing';

    if (!target || target === state.status) return;

    if (target === 'cancelled' && counts.cancelled === counts.total) {
      const path = findStatusPath(state.status, 'cancelled');
      if (!path) return;
      this.walk(state, path, null, 'همه اقلام سفارش لغو شد.', true);
      return;
    }

    const path = findStatusPath(state.status, target);
    if (!path) return;

    // Automation never confirms on its own unless a prep unit already started.
    if (state.status === 'submitted' || state.status === 'awaiting_confirmation') {
      const started = counts.inProgress > 0 || counts.delayed > 0 || counts.ready > 0;
      if (!started) return;
    }

    this.walk(state, path, actor, undefined, true);
  }

  private walk(
    state: OrderState,
    path: OrderStatus[],
    actor: ActingUser | null,
    reason: string | undefined,
    auto: boolean,
  ): void {
    let current: OrderState = state;
    for (const next of path) {
      this.changeStatus(current, next, { actor, reason, auto });
      current = { ...current, status: next };
    }
  }

  private changeStatus(
    order: OrderState,
    to: OrderStatus,
    options: { actor: ActingUser | null; reason?: string; auto: boolean },
  ): void {
    const now = new Date().toISOString();

    this.repository.updateOrder(order.id, {
      status: to,
      servedAt: to === 'served' ? now : undefined,
      closedAt: to === 'cancelled' ? now : undefined,
      cancelReason: to === 'cancelled' ? options.reason : undefined,
      cancelledByUserId: to === 'cancelled' ? options.actor?.userId : undefined,
    });

    this.repository.insertEvent({
      orderId: order.id,
      type: options.auto ? 'order.status_auto' : 'order.status_changed',
      fromStatus: order.status,
      toStatus: to,
      actorUserId: options.actor?.userId ?? null,
      payload: options.auto ? { note: AUTO_ADVANCE_NOTE } : options.reason ? { reason: options.reason } : undefined,
    });

    if (to === 'cancelled') {
      this.repository.cancelRemainingWork(order.id);
      // Put recipe ingredients back; a no-op while the inventory module is off.
      this.inventory.restoreForOrder(order.id);
      this.releaseTableIfIdle(order);
    }

    if (to === 'awaiting_payment' && order.tableId) {
      this.repository.setTableStatus(order.tableId, 'waiting_payment');
      this.repository.notifyRole(
        'cashier',
        'order.awaiting_payment',
        'سفارش آماده تسویه است',
        `سفارش ${order.code} در انتظار پرداخت است.`,
        { orderId: order.id, code: order.code },
      );
    }

    if (to === 'ready') {
      this.repository.notifyRole(
        'waiter',
        'order.ready',
        'سفارش آماده تحویل است',
        `سفارش ${order.code} آماده سرو است.`,
        { orderId: order.id, code: order.code },
      );
    }
  }

  /** Closes the table session only when no other order is still active there. */
  private releaseTableIfIdle(order: OrderState): void {
    if (!order.sessionId) return;
    const remaining = this.repository.countActiveOrdersInSession(order.sessionId, order.id);
    if (remaining > 0) return;

    this.repository.closeSession(order.sessionId);
    if (order.tableId) this.repository.setTableStatus(order.tableId, 'available');
  }

  /**
   * Moves an order to `paid`. Called by the payments module inside its own
   * transaction so the payment row, bill and order status cannot diverge.
   */
  markPaid(orderId: string, actor: ActingUser | null): void {
    const state = this.repository.findOrderState(orderId);
    if (!state) throw notFound('سفارش یافت نشد.', 'ORDER_NOT_FOUND');

    const path = findStatusPath(state.status, 'paid');
    if (!path) {
      throw conflict(
        `سفارش در وضعیت «${this.statusLabel(state.status)}» قابل تسویه نیست.`, 
        'ORDER_NOT_PAYABLE',
      );
    }

    this.walk(state, path, actor, undefined, true);
    this.repository.updateOrder(orderId, { status: 'paid', paidAt: new Date().toISOString() });

    this.audit.record({
      actorUserId: actor?.userId ?? null,
      actorUsername: actor?.username ?? null,
      action: 'order.paid',
      entityType: 'order',
      entityId: orderId,
      before: { status: state.status },
      after: { status: 'paid', code: state.code },
    });
  }

  /* -------------------------------- tables ------------------------------ */

  tables(): StaffTablesResponse {
    return this.repository.listTables();
  }

  /** A served order with a partial payment is waiting for the rest of the bill. */
  markAwaitingPayment(orderId: string, actor: ActingUser | null): void {
    const state = this.repository.findOrderState(orderId);
    if (!state || state.status === 'awaiting_payment') return;

    const path = findStatusPath(state.status, 'awaiting_payment');
    if (!path) return;
    this.walk(state, path, actor, undefined, true);
  }

  /**
   * Closing a table requires every order of the open session to be settled or
   * cancelled. The check runs against the database, never the client.
   */
  closeTable(tableId: string, actor: ActingUser) {
    if (!actor.permissions.includes('layout.write') && !actor.permissions.includes('payments.create')) {
      throw forbidden('برای بستن میز مجوز «layout.write» یا «payments.create» لازم است.', 'PERMISSION_DENIED');
    }

    const table = this.repository.findTable(tableId);
    if (!table) throw notFound('میز یافت نشد.', 'TABLE_NOT_FOUND');
    if (!table.sessionId) throw conflict('این میز نشست باز ندارد.', 'TABLE_NO_OPEN_SESSION');

    const orders = this.repository.listSessionOrders(table.sessionId);
    const unpaid = orders.filter((order) => order.status !== 'paid' && order.status !== 'cancelled');

    if (unpaid.length > 0) {
      throw conflict(
        `برای بستن میز ابتدا ${unpaid.length} سفارش تسویه‌نشده را تسویه یا لغو کنید.`,
        'TABLE_HAS_UNPAID_ORDERS',
        unpaid.map((order) => ({ id: order.id, code: order.code, status: order.status, remaining: order.total - order.paid_total })),
      );
    }

    const closedAt = new Date().toISOString();
    this.database.transaction(() => {
      this.repository.closeSession(table.sessionId as string);
      this.repository.setTableStatus(table.id, 'available');
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'table.closed',
      entityType: 'dining_table',
      entityId: table.id,
      before: { status: table.status, sessionId: table.sessionId },
      after: { status: 'available', closedOrders: orders.length },
    });

    return { tableId: table.id, code: table.code, sessionId: table.sessionId, closedAt, closedOrders: orders.length };
  }

  /* ------------------------------- requests ----------------------------- */

  serviceRequests(status: 'pending' | 'all'): { items: ServiceRequestRow[] } {
    return { items: this.repository.listServiceRequests(status) };
  }

  updateServiceRequest(id: string, status: 'accepted' | 'done' | 'cancelled', actor: ActingUser) {
    const request = this.repository.findServiceRequest(id);
    if (!request) throw notFound('درخواست مشتری یافت نشد.', 'REQUEST_NOT_FOUND');

    if (request.status === 'done' || request.status === 'cancelled') {
      throw conflict('این درخواست قبلاً بسته شده است.', 'REQUEST_CLOSED');
    }

    this.repository.updateServiceRequest(id, status, actor.userId);
    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: `customer_request.${status}`,
      entityType: 'customer_request',
      entityId: id,
      before: { status: request.status, type: request.type },
      after: { status },
    });

    return { id, status };
  }

  terminalRequests(status: 'pending' | 'all'): { items: TerminalRequestRow[] } {
    return { items: this.repository.listTerminalRequests(status) };
  }

  private statusLabel(status: OrderStatus): string {
    return (
      {
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
      } as Record<OrderStatus, string>
    )[status];
  }
}
