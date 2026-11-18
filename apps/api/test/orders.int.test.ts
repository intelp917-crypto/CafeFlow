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

let context: TestContext;
let latte: { id: string };
let latteMilkOption: string;
let espresso: { id: string };
let pasta: { id: string };

interface TableSeed {
  token: string;
  code: string;
  id: string;
}

const tables: TableSeed[] = [];

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
  return response.body as { id: string; code: string; status: string };
}

async function orderDetail(agent: Agent, id: string) {
  const response = await agent.get(`/api/v1/orders/${id}`);
  expect(response.status).toBe(200);
  return response.body;
}

function openSessionsFor(tableId: string): number {
  const row = context.db
    .prepare("SELECT COUNT(*) AS n FROM table_sessions WHERE table_id = ? AND status = 'open'")
    .get(tableId) as { n: number };
  return row.n;
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

  latte = db.prepare("SELECT id FROM products WHERE name_fa = 'لاته'").get() as { id: string };
  espresso = db.prepare("SELECT id FROM products WHERE name_fa = 'اسپرسو'").get() as { id: string };
  pasta = db.prepare("SELECT id FROM products WHERE name_fa = 'پاستا آلفردو'").get() as { id: string };

  const group = db.prepare('SELECT id FROM option_groups WHERE product_id = ? LIMIT 1').get(latte.id) as { id: string };
  latteMilkOption = (
    db.prepare('SELECT id FROM product_options WHERE option_group_id = ? LIMIT 1').get(group.id) as { id: string }
  ).id;
});

afterAll(async () => {
  await context.close();
});

describe('order queue permissions', () => {
  it('requires a session', async () => {
    const response = await request(server(context.app)).get('/api/v1/orders');
    expect(response.status).toBe(401);
  });

  it('lets a waiter list and open an order with items, prep state and legal transitions', async () => {
    const order = await placeOrder(tableByIndex(0), [
      { productId: latte.id, quantity: 1, optionIds: [latteMilkOption], extraIds: [] },
      { productId: pasta.id, quantity: 1, optionIds: [], extraIds: [] },
    ]);
    const { agent } = await login(context.app, 'waiter', DEMO_PASSWORD);

    const list = await agent.get('/api/v1/orders?scope=active');
    expect(list.status).toBe(200);
    const summary = list.body.items.find((row: { id: string }) => row.id === order.id);
    expect(summary).toBeTruthy();
    expect(summary.prep.total).toBe(2);
    expect(summary.prep.queued).toBe(2);

    const detail = await orderDetail(agent, order.id);
    expect(detail.code).toBe(order.code);
    expect(detail.status).toBe('submitted');
    expect(detail.items).toHaveLength(2);
    const coffee = detail.items.find((item: { productNameFa: string }) => item.productNameFa === 'لاته');
    expect(coffee.options.length).toBeGreaterThan(0);
    expect(detail.events[0].toStatus).toBe('submitted');
    expect(detail.allowedTransitions.map((entry: { status: string }) => entry.status).sort()).toEqual([
      'awaiting_confirmation',
      'cancelled',
      'confirmed',
    ]);
  });

  it('blocks a barista from changing order status', async () => {
    const order = await placeOrder(tableByIndex(0), [
      { productId: espresso.id, quantity: 1, optionIds: [], extraIds: [] },
    ]);
    const { agent } = await login(context.app, 'barista', DEMO_PASSWORD);

    const response = await agent.post(`/api/v1/orders/${order.id}/transition`).send({ to: 'confirmed' });
    expect(response.status).toBe(403);
  });
});

describe('manual order transitions', () => {
  it('accepts an order and refuses settlement until phase 4', async () => {
    const order = await placeOrder(tableByIndex(1), [
      { productId: espresso.id, quantity: 1, optionIds: [], extraIds: [] },
    ]);
    const { agent } = await login(context.app, 'waiter', DEMO_PASSWORD);

    expect((await agent.post(`/api/v1/orders/${order.id}/transition`).send({ to: 'confirmed' })).status).toBe(200);

    const paid = await agent.post(`/api/v1/orders/${order.id}/transition`).send({ to: 'paid' });
    expect(paid.status).toBe(409);
    expect(paid.body.error.code).toBe('PAYMENT_REQUIRED');

    const derived = await agent.post(`/api/v1/orders/${order.id}/transition`).send({ to: 'partially_ready' });
    expect(derived.status).toBe(400);
    expect(derived.body.error.code).toBe('DERIVED_STATUS');

    const illegal = await agent.post(`/api/v1/orders/${order.id}/transition`).send({ to: 'served' });
    expect(illegal.status).toBe(409);
    expect(illegal.body.error.code).toBe('ORDER_TRANSITION_INVALID');

    const detail = await orderDetail(agent, order.id);
    expect(detail.status).toBe('confirmed');
    expect(detail.events.map((event: { type: string }) => event.type)).toContain('order.status_changed');
  });

  it('does not let a waiter cancel without the cancel permission', async () => {
    const order = await placeOrder(tableByIndex(1), [
      { productId: espresso.id, quantity: 1, optionIds: [], extraIds: [] },
    ]);
    const { agent } = await login(context.app, 'waiter', DEMO_PASSWORD);

    const response = await agent
      .post(`/api/v1/orders/${order.id}/transition`)
      .send({ to: 'cancelled', reason: 'مشتری منصرف شد' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('cancels with a mandatory reason, releases the table and records an audit entry', async () => {
    const table = tableByIndex(2);
    const order = await placeOrder(table, [{ productId: espresso.id, quantity: 1, optionIds: [], extraIds: [] }]);
    const { agent } = await login(context.app, 'manager', DEMO_PASSWORD);

    const missingReason = await agent.post(`/api/v1/orders/${order.id}/transition`).send({ to: 'cancelled' });
    expect(missingReason.status).toBe(400);
    expect(missingReason.body.error.code).toBe('CANCEL_REASON_REQUIRED');

    const before = countAudit(context.db, 'order.cancelled');
    const response = await agent
      .post(`/api/v1/orders/${order.id}/transition`)
      .send({ to: 'cancelled', reason: 'اشتباه مشتری' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('cancelled');
    expect(response.body.cancelReason).toBe('اشتباه مشتری');
    expect(countAudit(context.db, 'order.cancelled')).toBe(before + 1);

    const itemStatuses = context.db
      .prepare('SELECT status FROM order_items WHERE order_id = ?')
      .all(order.id) as Array<{ status: string }>;
    expect(itemStatuses.every((row) => row.status === 'cancelled')).toBe(true);

    const prepStatuses = context.db
      .prepare('SELECT status FROM prep_tasks WHERE order_id = ?')
      .all(order.id) as Array<{ status: string }>;
    expect(prepStatuses.every((row) => row.status === 'cancelled')).toBe(true);

    const storedTable = context.db
      .prepare('SELECT status FROM dining_tables WHERE id = ?')
      .get(table.id) as { status: string };
    expect(storedTable.status).toBe('available');
    expect(openSessionsFor(table.id)).toBe(0);

    const closedAgain = await agent.post(`/api/v1/orders/${order.id}/transition`).send({ to: 'confirmed' });
    expect(closedAgain.status).toBe(409);
    expect(closedAgain.body.error.code).toBe('ORDER_CLOSED');
  });
});

describe('preparation queue', () => {
  it('derives order status from prep progress and walks legal transitions', async () => {
    const table = tableByIndex(3);
    const order = await placeOrder(table, [
      { productId: latte.id, quantity: 1, optionIds: [latteMilkOption], extraIds: [] },
      { productId: pasta.id, quantity: 1, optionIds: [], extraIds: [] },
    ]);

    const barista = (await login(context.app, 'barista', DEMO_PASSWORD)).agent;
    const kitchen = (await login(context.app, 'kitchen', DEMO_PASSWORD)).agent;
    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;

    const baristaQueue = await barista.get('/api/v1/prep/queue?kind=barista');
    expect(baristaQueue.status).toBe(200);
    const baristaTask = baristaQueue.body.items.find((row: { orderId: string }) => row.orderId === order.id);
    expect(baristaTask).toBeTruthy();
    expect(baristaTask.departmentKind).toBe('barista');

    const kitchenQueue = await kitchen.get('/api/v1/prep/queue?kind=kitchen');
    const kitchenTask = kitchenQueue.body.items.find((row: { orderId: string }) => row.orderId === order.id);
    expect(kitchenTask).toBeTruthy();

    // Starting one unit moves the order submitted -> confirmed -> preparing.
    const started = await barista.post(`/api/v1/prep/${baristaTask.id}/transition`).send({ to: 'in_progress' });
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('preparing');

    // First unit ready: partially ready.
    const readyOne = await barista.post(`/api/v1/prep/${baristaTask.id}/transition`).send({ to: 'ready' });
    expect(readyOne.status).toBe(200);
    expect(readyOne.body.status).toBe('partially_ready');
    expect(readyOne.body.events.map((event: { type: string }) => event.type)).toContain('order.status_auto');

    // Second unit ready: the order becomes ready and the waiter is notified.
    const readyTwo = await kitchen.post(`/api/v1/prep/${kitchenTask.id}/transition`).send({ to: 'ready' });
    expect(readyTwo.status).toBe(200);
    expect(readyTwo.body.status).toBe('ready');

    const notification = context.db
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'order.ready' AND role_key = 'waiter'")
      .get() as { n: number };
    expect(notification.n).toBeGreaterThan(0);

    // A ready unit cannot go back into progress.
    const backwards = await kitchen.post(`/api/v1/prep/${kitchenTask.id}/transition`).send({ to: 'in_progress' });
    expect(backwards.status).toBe(409);
    expect(backwards.body.error.code).toBe('PREP_TRANSITION_INVALID');

    const served = await waiter.post(`/api/v1/orders/${order.id}/transition`).send({ to: 'served' });
    expect(served.status).toBe(200);

    const awaiting = await waiter.post(`/api/v1/orders/${order.id}/transition`).send({ to: 'awaiting_payment' });
    expect(awaiting.status).toBe(200);
    expect(awaiting.body.status).toBe('awaiting_payment');

    const cashierNotice = context.db
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'order.awaiting_payment' AND role_key = 'cashier'")
      .get() as { n: number };
    expect(cashierNotice.n).toBeGreaterThan(0);

    const storedTable = context.db
      .prepare('SELECT status FROM dining_tables WHERE id = ?')
      .get(table.id) as { status: string };
    expect(storedTable.status).toBe('waiting_payment');
  });

  it('refuses prep updates from a role without prep.update', async () => {
    const order = await placeOrder(tableByIndex(4), [
      { productId: espresso.id, quantity: 1, optionIds: [], extraIds: [] },
    ]);
    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;

    const queue = await waiter.get('/api/v1/prep/queue');
    const task = queue.body.items.find((row: { orderId: string }) => row.orderId === order.id);
    expect(task).toBeTruthy();

    const response = await waiter.post(`/api/v1/prep/${task.id}/transition`).send({ to: 'in_progress' });
    expect(response.status).toBe(403);
  });
});

describe('tables and customer requests', () => {
  it('lists live tables with open totals and pending requests', async () => {
    const table = tableByIndex(5);
    const order = await placeOrder(table, [{ productId: espresso.id, quantity: 1, optionIds: [], extraIds: [] }]);
    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;

    const customer = request.agent(server(context.app));
    const created = await customer
      .post('/api/v1/public/requests')
      .send({ qrToken: table.token, type: 'water', note: 'یک لیوان آب' });
    expect(created.status).toBe(201);

    const response = await waiter.get('/api/v1/tables');
    expect(response.status).toBe(200);
    const row = response.body.items.find((entry: { id: string }) => entry.id === table.id);
    expect(row.status).toBe('occupied');
    expect(row.activeOrders).toBeGreaterThan(0);
    expect(row.openTotal).toBeGreaterThan(0);
    expect(row.pendingRequests).toBeGreaterThan(0);
    expect(row.sessionId).toBeTruthy();
    expect(response.body.summary.total).toBe(tables.length);

    const ordersForTable = await waiter.get(`/api/v1/orders?tableId=${table.id}`);
    expect(ordersForTable.body.items.some((entry: { id: string }) => entry.id === order.id)).toBe(true);
  });

  it('hides tables from a barista who lacks layout.read', async () => {
    const barista = (await login(context.app, 'barista', DEMO_PASSWORD)).agent;
    expect((await barista.get('/api/v1/tables')).status).toBe(403);
  });

  it('lets a waiter resolve a customer request only once', async () => {
    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;

    const list = await waiter.get('/api/v1/service-requests');
    expect(list.status).toBe(200);
    const pending = list.body.items.find((row: { status: string }) => row.status === 'pending');
    expect(pending).toBeTruthy();

    const accepted = await waiter.post(`/api/v1/service-requests/${pending.id}/status`).send({ status: 'accepted' });
    expect(accepted.status).toBe(200);

    const done = await waiter.post(`/api/v1/service-requests/${pending.id}/status`).send({ status: 'done' });
    expect(done.status).toBe(200);

    const resolved = context.db
      .prepare('SELECT status, handled_by_user_id, resolved_at FROM customer_requests WHERE id = ?')
      .get(pending.id) as { status: string; handled_by_user_id: string | null; resolved_at: string | null };
    expect(resolved.status).toBe('done');
    expect(resolved.handled_by_user_id).toBeTruthy();
    expect(resolved.resolved_at).toBeTruthy();

    const again = await waiter.post(`/api/v1/service-requests/${pending.id}/status`).send({ status: 'done' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('REQUEST_CLOSED');
  });

  it('routes terminal requests to the cashier only', async () => {
    const customer = request.agent(server(context.app));
    const created = await customer.post('/api/v1/public/terminal-requests').send({ qrToken: tableByIndex(6).token });
    expect(created.status).toBe(201);

    // The customer response carries the service-request id; the cashier works
    // with the terminal_requests row created alongside it.
    const terminalRow = context.db
      .prepare("SELECT id FROM terminal_requests WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1")
      .get() as { id: string };
    expect(terminalRow?.id).toBeTruthy();

    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const pending = await cashier.get('/api/v1/terminal-requests');
    expect(pending.status).toBe(200);
    const row = pending.body.items.find((entry: { id: string }) => entry.id === terminalRow.id);
    expect(row).toBeTruthy();
    expect(row.tableCode).toBe(tableByIndex(6).code);

    const completed = await cashier.post(`/api/v1/terminal-requests/${terminalRow.id}/complete`);
    expect(completed.status).toBe(200);

    const stored = context.db
      .prepare('SELECT status, completed_at FROM terminal_requests WHERE id = ?')
      .get(terminalRow.id) as { status: string; completed_at: string | null };
    expect(stored.status).toBe('completed');
    expect(stored.completed_at).toBeTruthy();

    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;
    expect((await waiter.get('/api/v1/terminal-requests')).status).toBe(403);
  });
});

describe('order listing filters', () => {
  it('filters by department kind, status and code, and paginates', async () => {
    const order = await placeOrder(tableByIndex(7), [
      { productId: pasta.id, quantity: 1, optionIds: [], extraIds: [] },
    ]);
    const admin = (await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD)).agent;

    const byKind = await admin.get('/api/v1/orders?scope=all&kind=kitchen&pageSize=5');
    expect(byKind.status).toBe(200);
    expect(byKind.body.items.length).toBeGreaterThan(0);
    expect(byKind.body.pageSize).toBe(5);
    expect(byKind.body.items.every((row: { prep: { total: number } }) => row.prep.total > 0)).toBe(true);

    const byCode = await admin.get(`/api/v1/orders?scope=all&q=${order.code}`);
    expect(byCode.body.items).toHaveLength(1);
    expect(byCode.body.items[0].id).toBe(order.id);

    const byStatus = await admin.get('/api/v1/orders?scope=all&status=submitted');
    expect(byStatus.body.items.every((row: { status: string }) => row.status === 'submitted')).toBe(true);

    const missing = await admin.get('/api/v1/orders/does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ORDER_NOT_FOUND');
  });
});
