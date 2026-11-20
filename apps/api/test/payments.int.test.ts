import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  DEMO_PASSWORD,
  createTestApp,
  countAudit,
  login,
  server,
  type TestContext,
} from './helpers';

type Agent = ReturnType<typeof request.agent>;

interface TableSeed {
  token: string;
  code: string;
  id: string;
}

const tables: TableSeed[] = [];
let context: TestContext;
let espresso: { id: string; base_price: number };

function tableByIndex(index: number): TableSeed {
  const table = tables[index];
  if (!table) throw new Error(`Test table ${index} is missing.`);
  return table;
}

async function placeOrder(table: TableSeed, items: unknown[]) {
  const agent = request.agent(server(context.app));
  const response = await agent
    .post('/api/v1/public/orders')
    .send({ qrToken: table.token, clientRequestId: randomUUID(), items });
  expect(response.status).toBe(201);
  return response.body as { id: string; code: string };
}

/** Walks the legal path to `served` so the order becomes payable. */
async function serveOrder(agent: Agent, orderId: string): Promise<number> {
  let total = 0;
  for (const to of ['confirmed', 'preparing', 'ready', 'served'] as const) {
    const response = await agent.post(`/api/v1/orders/${orderId}/transition`).send({ to });
    expect(response.status).toBe(200);
    total = response.body.total;
  }
  return total;
}

async function createServedOrder(index: number): Promise<{ id: string; code: string; total: number }> {
  const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;
  const order = await placeOrder(tableByIndex(index), [
    { productId: espresso.id, quantity: 1, optionIds: [], extraIds: [] },
  ]);
  const total = await serveOrder(waiter, order.id);
  return { ...order, total };
}

function latestTerminalRequestId(): string {
  const row = context.db
    .prepare('SELECT id FROM terminal_requests ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get() as { id: string };
  return row.id;
}

beforeAll(async () => {
  context = await createTestApp();
  const db = context.db;

  tables.push(
    ...(db
      .prepare(
        `SELECT q.token, t.code, t.id
           FROM qr_codes q JOIN dining_tables t ON t.id = q.table_id
          WHERE q.kind = 'table'
          ORDER BY t.code`,
      )
      .all() as TableSeed[]),
  );

  espresso = db.prepare("SELECT id, base_price FROM products WHERE name_fa = 'اسپرسو'").get() as {
    id: string;
    base_price: number;
  };
});

afterAll(async () => {
  await context.close();
});

describe('payment eligibility', () => {
  it('refuses payment until the order is served', async () => {
    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const order = await placeOrder(tableByIndex(0), [
      { productId: espresso.id, quantity: 1, optionIds: [], extraIds: [] },
    ]);

    const early = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: espresso.base_price });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('ORDER_NOT_PAYABLE');

    await serveOrder(waiter, order.id);

    const accepted = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: espresso.base_price });
    expect(accepted.status).toBe(201);
    expect(accepted.body.status).toBe('paid');
  });

  it('rejects a second settlement and refunds nothing implicitly', async () => {
    const order = await createServedOrder(0);
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;

    const first = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'card', amount: order.total });
    expect(first.status).toBe(201);

    const second = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: 1000 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ORDER_ALREADY_PAID');
  });

  it('refuses payment on a cancelled order', async () => {
    const manager = (await login(context.app, 'manager', DEMO_PASSWORD)).agent;
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const order = await placeOrder(tableByIndex(2), [
      { productId: espresso.id, quantity: 1, optionIds: [], extraIds: [] },
    ]);

    const cancelled = await manager
      .post(`/api/v1/orders/${order.id}/transition`)
      .send({ to: 'cancelled', reason: 'انصراف مشتری' });
    expect(cancelled.status).toBe(200);

    const payment = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: 1000 });
    expect(payment.status).toBe(409);
    expect(payment.body.error.code).toBe('ORDER_CLOSED');
  });
});

describe('partial and split payments', () => {
  it('keeps the bill open on a partial payment and settles with the remainder', async () => {
    const order = await createServedOrder(1);
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;

    const partial = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: 300_000 });
    expect(partial.status).toBe(201);
    expect(partial.body.status).toBe('awaiting_payment');
    expect(partial.body.paidTotal).toBe(300_000);
    expect(partial.body.remaining).toBe(order.total - 300_000);
    expect(partial.body.bill.status).toBe('open');

    const overpay = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'card', amount: order.total });
    expect(overpay.status).toBe(400);
    expect(overpay.body.error.code).toBe('PAYMENT_EXCEEDS_REMAINING');

    const rest = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'card', amount: order.total - 300_000, reference: 'TRX-99001' });
    expect(rest.status).toBe(201);
    expect(rest.body.status).toBe('paid');
    expect(rest.body.paidTotal).toBe(order.total);
    expect(rest.body.remaining).toBe(0);
    expect(rest.body.bill.status).toBe('settled');
    expect(rest.body.payments).toHaveLength(2);
    expect(rest.body.payments[1].methodLabelFa).toBe('کارت‌خوان');

    const stored = context.db
      .prepare('SELECT paid_total, paid_at, status FROM orders WHERE id = ?')
      .get(order.id) as { paid_total: number; paid_at: string | null; status: string };
    expect(stored.paid_total).toBe(order.total);
    expect(stored.status).toBe('paid');
    expect(stored.paid_at).toBeTruthy();

    const bill = context.db
      .prepare('SELECT status, paid_total, settled_at FROM bills WHERE order_id = ?')
      .get(order.id) as { status: string; paid_total: number; settled_at: string | null };
    expect(bill.status).toBe('settled');
    expect(bill.paid_total).toBe(order.total);
    expect(bill.settled_at).toBeTruthy();

    expect(countAudit(context.db, 'payment.recorded')).toBeGreaterThan(0);
    expect(countAudit(context.db, 'payment.settled')).toBeGreaterThan(0);
    expect(countAudit(context.db, 'order.paid')).toBeGreaterThan(0);

    // The order detail exposes the same bill and payment history.
    const detail = await cashier.get(`/api/v1/orders/${order.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.bill.status).toBe('settled');
    expect(detail.body.payments).toHaveLength(2);
    expect(detail.body.paidTotal).toBe(order.total);
  });

  it('accepts several methods and validates the payload', async () => {
    const order = await createServedOrder(1);
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;

    const half = Math.floor(order.total / 2);
    expect(
      (await cashier.post(`/api/v1/orders/${order.id}/payments`).send({ method: 'cash', amount: half })).status,
    ).toBe(201);
    expect(
      (await cashier.post(`/api/v1/orders/${order.id}/payments`).send({ method: 'online', amount: order.total - half }))
        .status,
    ).toBe(201);

    const zero = await cashier.post(`/api/v1/orders/${order.id}/payments`).send({ method: 'cash', amount: 0 });
    expect(zero.status).toBe(400);
    expect(zero.body.error.code).toBe('VALIDATION_FAILED');

    const fractional = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: 10.5 });
    expect(fractional.status).toBe(400);
    expect(fractional.body.error.code).toBe('VALIDATION_FAILED');

    const badMethod = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'crypto', amount: 1000 });
    expect(badMethod.status).toBe(400);
    expect(badMethod.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('payment permissions', () => {
  it('blocks a waiter from reading or writing payments', async () => {
    const order = await createServedOrder(3);
    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;

    expect((await waiter.get(`/api/v1/orders/${order.id}/payments`)).status).toBe(403);
    expect(
      (await waiter.post(`/api/v1/orders/${order.id}/payments`).send({ method: 'cash', amount: 1000 })).status,
    ).toBe(403);
  });

  it('lets the manager settle, since it holds payments.create', async () => {
    const order = await createServedOrder(3);
    const manager = (await login(context.app, 'manager', DEMO_PASSWORD)).agent;

    const response = await manager
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: order.total });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('paid');
  });
});

describe('table closing', () => {
  it('refuses to close a table that still has an unpaid order', async () => {
    const order = await createServedOrder(4);
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const table = tableByIndex(4);

    const blocked = await cashier.post(`/api/v1/tables/${table.id}/close`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('TABLE_HAS_UNPAID_ORDERS');
    expect(blocked.body.error.details[0].code).toBe(order.code);

    expect(
      (await cashier.post(`/api/v1/orders/${order.id}/payments`).send({ method: 'card', amount: order.total })).status,
    ).toBe(201);

    const closed = await cashier.post(`/api/v1/tables/${table.id}/close`);
    expect(closed.status).toBe(200);
    expect(closed.body.code).toBe(table.code);
    expect(closed.body.closedOrders).toBe(1);

    const stored = context.db
      .prepare("SELECT status FROM dining_tables WHERE id = ?")
      .get(table.id) as { status: string };
    expect(stored.status).toBe('available');

    const openSessions = context.db
      .prepare("SELECT COUNT(*) AS n FROM table_sessions WHERE table_id = ? AND status = 'open'")
      .get(table.id) as { n: number };
    expect(openSessions.n).toBe(0);

    expect(countAudit(context.db, 'table.closed')).toBeGreaterThan(0);

    const again = await cashier.post(`/api/v1/tables/${table.id}/close`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('TABLE_NO_OPEN_SESSION');
  });

  it('refuses closing to a role without layout.write or payments.create', async () => {
    await createServedOrder(4);
    const barista = (await login(context.app, 'barista', DEMO_PASSWORD)).agent;

    // The decorator gate (layout.read) already stops the barista here.
    const response = await barista.post(`/api/v1/tables/${tableByIndex(4).id}/close`);
    expect(response.status).toBe(403);
  });

  it('releases the table automatically when its last order is cancelled', async () => {
    const manager = (await login(context.app, 'manager', DEMO_PASSWORD)).agent;
    const table = tableByIndex(5);
    const order = await placeOrder(table, [
      { productId: espresso.id, quantity: 1, optionIds: [], extraIds: [] },
    ]);

    expect(
      (await manager.post(`/api/v1/orders/${order.id}/transition`).send({ to: 'cancelled', reason: 'تست' })).status,
    ).toBe(200);

    const stored = context.db
      .prepare('SELECT status FROM dining_tables WHERE id = ?')
      .get(table.id) as { status: string };
    expect(stored.status).toBe('available');

    // Cancellation closes the session; an explicit close then has nothing to do.
    const close = await manager.post(`/api/v1/tables/${table.id}/close`);
    expect(close.status).toBe(409);
    expect(close.body.error.code).toBe('TABLE_NO_OPEN_SESSION');
  });
});

describe('terminal requests settle the bill', () => {
  it('records a card payment and completes the request', async () => {
    const order = await createServedOrder(6);
    const customer = request.agent(server(context.app));

    const created = await customer
      .post('/api/v1/public/terminal-requests')
      .send({ qrToken: tableByIndex(6).token, orderCode: order.code });
    expect(created.status).toBe(201);

    const terminalId = latestTerminalRequestId();
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;

    const completed = await cashier.post(`/api/v1/terminal-requests/${terminalId}/complete`).send({});
    expect(completed.status).toBe(200);
    expect(completed.body.request.status).toBe('completed');
    expect(completed.body.payment).toBeTruthy();
    expect(completed.body.payment.method).toBe('card');
    expect(completed.body.payment.amount).toBe(order.total);
    expect(completed.body.order.status).toBe('paid');
    expect(completed.body.order.remaining).toBe(0);

    const stored = context.db
      .prepare('SELECT status, order_id, completed_at FROM terminal_requests WHERE id = ?')
      .get(terminalId) as { status: string; order_id: string | null; completed_at: string | null };
    expect(stored.status).toBe('completed');
    expect(stored.order_id).toBe(order.id);
    expect(stored.completed_at).toBeTruthy();

    const again = await cashier.post(`/api/v1/terminal-requests/${terminalId}/complete`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('REQUEST_CLOSED');

    expect(countAudit(context.db, 'terminal_request.completed')).toBeGreaterThan(0);
  });

  it('settles only the requested amount when one is supplied', async () => {
    const order = await createServedOrder(6);
    const customer = request.agent(server(context.app));

    await customer
      .post('/api/v1/public/terminal-requests')
      .send({ qrToken: tableByIndex(6).token, orderCode: order.code });
    const terminalId = latestTerminalRequestId();
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;

    const completed = await cashier
      .post(`/api/v1/terminal-requests/${terminalId}/complete`)
      .send({ amount: 200_000 });
    expect(completed.status).toBe(200);
    expect(completed.body.order.status).toBe('awaiting_payment');
    expect(completed.body.order.remaining).toBe(order.total - 200_000);
  });

  it('completes a request with no unpaid order without inventing a payment', async () => {
    // Table 5 only held an order that was cancelled earlier, so nothing is owed.
    const customer = request.agent(server(context.app));
    const created = await customer.post('/api/v1/public/terminal-requests').send({ qrToken: tableByIndex(5).token });
    expect(created.status).toBe(201);

    const terminalId = latestTerminalRequestId();
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;

    const completed = await cashier.post(`/api/v1/terminal-requests/${terminalId}/complete`).send({});
    expect(completed.status).toBe(200);
    expect(completed.body.payment).toBeNull();
    expect(completed.body.order).toBeNull();
  });

  it('refuses to settle a request whose order has not been served yet', async () => {
    const order = await placeOrder(tableByIndex(7), [
      { productId: espresso.id, quantity: 1, optionIds: [], extraIds: [] },
    ]);
    const customer = request.agent(server(context.app));
    await customer
      .post('/api/v1/public/terminal-requests')
      .send({ qrToken: tableByIndex(7).token, orderCode: order.code });

    const terminalId = latestTerminalRequestId();
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;

    const blocked = await cashier.post(`/api/v1/terminal-requests/${terminalId}/complete`).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ORDER_NOT_PAYABLE');

    const stored = context.db
      .prepare('SELECT status FROM terminal_requests WHERE id = ?')
      .get(terminalId) as { status: string };
    expect(stored.status).toBe('pending');
  });

  it('rejects a terminal completion for a role without payments.create', async () => {
    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;
    const response = await waiter
      .post(`/api/v1/terminal-requests/${latestTerminalRequestId()}/complete`)
      .send({});
    expect(response.status).toBe(403);
  });
});

describe('payment summary endpoint', () => {
  it('returns the bill, remaining amount and history for an order', async () => {
    const order = await createServedOrder(2);
    const admin = (await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD)).agent;

    const before = await admin.get(`/api/v1/orders/${order.id}/payments`);
    expect(before.status).toBe(200);
    expect(before.body.total).toBe(order.total);
    expect(before.body.paidTotal).toBe(0);
    expect(before.body.remaining).toBe(order.total);
    expect(before.body.payable).toBe(true);
    expect(before.body.bill).toBeNull();
    expect(before.body.payments).toEqual([]);

    await admin.post(`/api/v1/orders/${order.id}/payments`).send({ method: 'cash', amount: 100_000 });

    const after = await admin.get(`/api/v1/orders/${order.id}/payments`);
    expect(after.body.bill.status).toBe('open');
    expect(after.body.payments).toHaveLength(1);
    expect(after.body.payments[0].receivedByName).toBeTruthy();

    const missing = await admin.get('/api/v1/orders/does-not-exist/payments');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ORDER_NOT_FOUND');
  });
});

describe('bill splitting', () => {
  it('splits equally, keeps the total and marks shares paid in order', async () => {
    const order = await createServedOrder(1);
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;

    const split = await cashier.post(`/api/v1/orders/${order.id}/splits`).send({ parts: 3 });
    expect(split.status).toBe(201);
    expect(split.body.splits).toHaveLength(3);

    const shares = split.body.splits as { id: string; amount: number; isPaid: boolean }[];
    expect(shares.reduce((sum, share) => sum + share.amount, 0)).toBe(order.total);
    expect(Math.max(...shares.map((share) => share.amount)) - Math.min(...shares.map((share) => share.amount))).toBeLessThanOrEqual(1);
    expect(shares.every((share) => !share.isPaid)).toBe(true);

    const first = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: shares[0]!.amount });
    expect(first.status).toBe(201);
    expect(first.body.splits.map((share: { isPaid: boolean }) => share.isPaid)).toEqual([true, false, false]);

    const second = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'card', amount: shares[1]!.amount });
    expect(second.body.status).not.toBe('paid');
    expect(second.body.splits.map((share: { isPaid: boolean }) => share.isPaid)).toEqual([true, true, false]);

    const last = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: shares[2]!.amount });
    expect(last.body.status).toBe('paid');
    expect(last.body.splits.every((share: { isPaid: boolean }) => share.isPaid)).toBe(true);
  });

  it('refuses splitting once money has been recorded', async () => {
    const order = await createServedOrder(2);
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;

    await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: 1000 });

    const refused = await cashier.post(`/api/v1/orders/${order.id}/splits`).send({ parts: 2 });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('SPLITS_AFTER_PAYMENT');
  });

  it('clears an unused split and blocks a discount while shares exist', async () => {
    const order = await createServedOrder(0);
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;

    const split = await cashier.post(`/api/v1/orders/${order.id}/splits`).send({ parts: 2 });
    expect(split.status).toBe(201);

    const discount = await cashier
      .post(`/api/v1/orders/${order.id}/discount`)
      .send({ amount: 1000, reason: 'آزمون تقسیم فاکتور' });
    expect(discount.status).toBe(409);
    expect(discount.body.error.code).toBe('SPLITS_EXIST');

    const cleared = await cashier.delete(`/api/v1/orders/${order.id}/splits`);
    expect(cleared.status).toBe(200);
    expect(cleared.body.splits).toHaveLength(0);

    const again = await cashier.delete(`/api/v1/orders/${order.id}/splits`);
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe('SPLITS_NOT_FOUND');
  });

  it('validates the number of shares', async () => {
    const order = await createServedOrder(3);
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;

    const one = await cashier.post(`/api/v1/orders/${order.id}/splits`).send({ parts: 1 });
    expect(one.status).toBe(400);

    const tooMany = await cashier.post(`/api/v1/orders/${order.id}/splits`).send({ parts: 21 });
    expect(tooMany.status).toBe(400);
  });

  it('accepts explicit shares that add up to the bill and settles each one on its own', async () => {
    const order = await createServedOrder(4);
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const shared = Math.floor(order.total / 3);

    const wrongSum = await cashier.put(`/api/v1/orders/${order.id}/splits`).send({
      splits: [
        { label: 'میزبان', amount: order.total - shared - 1 },
        { label: 'مهمان', amount: shared },
      ],
    });
    expect(wrongSum.status).toBe(400);
    expect(wrongSum.body.error.code).toBe('SPLIT_TOTAL_MISMATCH');

    const duplicate = await cashier.put(`/api/v1/orders/${order.id}/splits`).send({
      splits: [
        { label: 'نفر', amount: order.total - shared },
        { label: 'نفر', amount: shared },
      ],
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.code).toBe('SPLIT_LABEL_DUPLICATE');

    const explicit = await cashier.put(`/api/v1/orders/${order.id}/splits`).send({
      splits: [
        { label: 'میزبان', amount: order.total - shared },
        { label: 'مهمان', amount: shared },
      ],
    });
    expect(explicit.status).toBe(200);
    const shares = explicit.body.splits as { id: string; label: string; amount: number; isPaid: boolean }[];
    expect(shares.map((share) => share.label)).toEqual(['میزبان', 'مهمان']);
    expect(shares.reduce((sum, share) => sum + share.amount, 0)).toBe(order.total);

    const guest = shares[1]!;
    const wrongAmount = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: guest.amount + 1, splitId: guest.id });
    expect(wrongAmount.status).toBe(400);
    expect(wrongAmount.body.error.code).toBe('SPLIT_AMOUNT_MISMATCH');

    const foreignSplit = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: guest.amount, splitId: 'not-a-share' });
    expect(foreignSplit.status).toBe(400);
    expect(foreignSplit.body.error.code).toBe('SPLIT_NOT_FOUND');

    const paid = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'card', amount: guest.amount, splitId: guest.id });
    expect(paid.status).toBe(201);
    expect(paid.body.status).not.toBe('paid');
    expect(paid.body.splits.map((share: { isPaid: boolean }) => share.isPaid)).toEqual([false, true]);
    expect(paid.body.payments[0].splitLabelFa).toBe(guest.label);

    const again = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: guest.amount, splitId: guest.id });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SPLIT_ALREADY_PAID');

    const rest = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: shares[0]!.amount });
    expect(rest.body.status).toBe('paid');
    expect(rest.body.splits.every((share: { isPaid: boolean }) => share.isPaid)).toBe(true);
    expect(rest.body.payments[0].splitLabelFa).toBe(guest.label);
    expect(rest.body.payments[1].splitLabelFa).toBeNull();
  });
});
