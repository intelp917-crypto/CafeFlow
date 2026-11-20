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

async function placeOrder(index: number, quantity = 1) {
  const agent = request.agent(server(context.app));
  const response = await agent
    .post('/api/v1/public/orders')
    .send({
      qrToken: tableByIndex(index).token,
      clientRequestId: randomUUID(),
      items: [{ productId: espresso.id, quantity, optionIds: [], extraIds: [] }],
    });
  expect(response.status).toBe(201);
  return response.body as { id: string; code: string };
}

async function serve(agent: Agent, orderId: string) {
  for (const to of ['confirmed', 'preparing', 'ready', 'served'] as const) {
    const response = await agent.post(`/api/v1/orders/${orderId}/transition`).send({ to });
    expect(response.status).toBe(200);
  }
}

async function servedOrder(index: number): Promise<{ id: string; code: string; subtotal: number }> {
  const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;
  const order = await placeOrder(index);
  await serve(waiter, order.id);
  const detail = await waiter.get(`/api/v1/orders/${order.id}`);
  return { ...order, subtotal: detail.body.subtotal };
}

async function paidOrder(index: number, agent: Agent): Promise<{ id: string; code: string; total: number; subtotal: number }> {
  const order = await servedOrder(index);
  const payment = await agent
    .post(`/api/v1/orders/${order.id}/payments`)
    .send({ method: 'cash', amount: order.subtotal });
  expect(payment.status).toBe(201);
  return { ...order, total: payment.body.total };
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

describe('discounts', () => {
  it('applies a percentage discount before payment and reduces the total', async () => {
    const manager = (await login(context.app, 'manager', DEMO_PASSWORD)).agent;
    const order = await servedOrder(0);

    const response = await manager
      .post(`/api/v1/orders/${order.id}/discount`)
      .send({ percent: 10, reason: 'مشتری ثابت' });
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(order.subtotal - Math.round(order.subtotal * 0.1));

    const detail = await manager.get(`/api/v1/orders/${order.id}`);
    expect(detail.body.discountTotal).toBe(Math.round(order.subtotal * 0.1));
    expect(detail.body.total).toBe(order.subtotal - Math.round(order.subtotal * 0.1));

    expect(countAudit(context.db, 'order.discount_applied')).toBeGreaterThan(0);

    const event = context.db
      .prepare("SELECT COUNT(*) AS n FROM order_events WHERE order_id = ? AND type = 'order.discount_applied'")
      .get(order.id) as { n: number };
    expect(event.n).toBe(1);

    const paid = await manager
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: detail.body.total });
    expect(paid.status).toBe(201);
    expect(paid.body.status).toBe('paid');
  });

  it('blocks a large discount from a role without approval rights', async () => {
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const manager = (await login(context.app, 'manager', DEMO_PASSWORD)).agent;
    const order = await servedOrder(0);

    const blocked = await cashier
      .post(`/api/v1/orders/${order.id}/discount`)
      .send({ percent: 50, reason: 'تخفیف ویژه' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('APPROVAL_REQUIRED');

    const allowed = await manager
      .post(`/api/v1/orders/${order.id}/discount`)
      .send({ percent: 50, reason: 'تخفیف ویژه' });
    expect(allowed.status).toBe(200);
    expect(allowed.body.discountTotal).toBe(Math.round(order.subtotal / 2));
    expect(allowed.body.total).toBeLessThan(order.subtotal);
  });

  it('validates the discount amount, payload and order state', async () => {
    const manager = (await login(context.app, 'manager', DEMO_PASSWORD)).agent;
    const order = await servedOrder(0);

    const tooMuch = await manager
      .post(`/api/v1/orders/${order.id}/discount`)
      .send({ amount: order.subtotal + 1000, reason: 'بیش از جمع' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('DISCOUNT_EXCEEDS_SUBTOTAL');

    const noReason = await manager.post(`/api/v1/orders/${order.id}/discount`).send({ percent: 5 });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.code).toBe('VALIDATION_FAILED');

    const both = await manager
      .post(`/api/v1/orders/${order.id}/discount`)
      .send({ percent: 5, amount: 1000, reason: 'دوتایی' });
    expect(both.status).toBe(400);

    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;
    const forbidden = await waiter
      .post(`/api/v1/orders/${order.id}/discount`)
      .send({ percent: 5, reason: 'بدون مجوز' });
    expect(forbidden.status).toBe(403);
  });

  it('refuses a discount after payment or on a settled order', async () => {
    const manager = (await login(context.app, 'manager', DEMO_PASSWORD)).agent;
    const order = await servedOrder(0);

    await manager.post(`/api/v1/orders/${order.id}/payments`).send({ method: 'cash', amount: 100_000 });

    const afterPayment = await manager
      .post(`/api/v1/orders/${order.id}/discount`)
      .send({ percent: 5, reason: 'دیرهنگام' });
    expect(afterPayment.status).toBe(409);
    expect(afterPayment.body.error.code).toBe('DISCOUNT_AFTER_PAYMENT');

    const settled = await paidOrder(0, manager);
    const closed = await manager
      .post(`/api/v1/orders/${settled.id}/discount`)
      .send({ percent: 5, reason: 'بعد از تسویه' });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('ORDER_CLOSED');
  });
});

describe('refunds', () => {
  it('refunds part of a settled order without reopening it', async () => {
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const order = await paidOrder(1, cashier);

    const before = countAudit(context.db, 'payment.refunded');
    const response = await cashier
      .post(`/api/v1/orders/${order.id}/refunds`)
      .send({ amount: 200_000, reason: 'نقص سرویس' });
    expect(response.status).toBe(201);
    expect(response.body.amount).toBe(200_000);
    expect(response.body.paidTotal).toBe(order.total - 200_000);
    expect(response.body.remaining).toBe(200_000);
    expect(response.body.status).toBe('paid');
    expect(countAudit(context.db, 'payment.refunded')).toBe(before + 1);

    const summary = await cashier.get(`/api/v1/orders/${order.id}/payments`);
    expect(summary.status).toBe(200);
    expect(summary.body.paidTotal).toBe(order.total - 200_000);
    expect(summary.body.payments.some((payment: { status: string }) => payment.status === 'refunded')).toBe(true);

    const stored = context.db
      .prepare('SELECT paid_total, status FROM orders WHERE id = ?')
      .get(order.id) as { paid_total: number; status: string };
    expect(stored.paid_total).toBe(order.total - 200_000);
    expect(stored.status).toBe('paid');
  });

  it('rejects refunds above the paid amount or on unpaid orders', async () => {
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const paid = await paidOrder(1, cashier);

    const tooMuch = await cashier
      .post(`/api/v1/orders/${paid.id}/refunds`)
      .send({ amount: paid.total + 1, reason: 'بیش از پرداخت' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('REFUND_EXCEEDS_PAID');

    const served = await servedOrder(1);
    const unpaid = await cashier
      .post(`/api/v1/orders/${served.id}/refunds`)
      .send({ amount: 1000, reason: 'پرداخت نشده' });
    expect(unpaid.status).toBe(409);
    expect(unpaid.body.error.code).toBe('ORDER_NOT_PAID');
  });

  it('restricts refunds to payments.refund holders', async () => {
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const order = await paidOrder(1, cashier);
    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;
    const manager = (await login(context.app, 'manager', DEMO_PASSWORD)).agent;

    const waiterAttempt = await waiter
      .post(`/api/v1/orders/${order.id}/refunds`)
      .send({ amount: 1000, reason: 'بدون مجوز' });
    expect(waiterAttempt.status).toBe(403);

    const managerAttempt = await manager
      .post(`/api/v1/orders/${order.id}/refunds`)
      .send({ amount: 1000, reason: 'مدیر بدون مجوز بازپرداخت' });
    expect(managerAttempt.status).toBe(403);
  });
});

describe('notifications', () => {
  it('shows an order notification only to the addressed role', async () => {
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;
    const manager = (await login(context.app, 'manager', DEMO_PASSWORD)).agent;
    const order = await servedOrder(2);

    await manager.post(`/api/v1/orders/${order.id}/payments`).send({ method: 'cash', amount: 100_000 });

    const cashierInbox = await cashier.get('/api/v1/notifications');
    expect(cashierInbox.status).toBe(200);
    expect(cashierInbox.body.items.some((item: { type: string }) => item.type === 'order.awaiting_payment')).toBe(true);
    expect(cashierInbox.body.unreadCount).toBeGreaterThan(0);

    const waiterInbox = await waiter.get('/api/v1/notifications');
    expect(waiterInbox.body.items.some((item: { type: string }) => item.type === 'order.awaiting_payment')).toBe(false);

    const unreadOnly = await cashier.get('/api/v1/notifications?unread=1');
    expect(unreadOnly.body.items.every((item: { isRead: boolean }) => item.isRead === false)).toBe(true);
  });

  it('marks a notification read once and only for its audience', async () => {
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;

    const inbox = await cashier.get('/api/v1/notifications');
    const target = inbox.body.items.find((item: { isRead: boolean }) => !item.isRead);
    expect(target).toBeTruthy();

    const foreign = await waiter.post(`/api/v1/notifications/${target.id}/read`);
    expect(foreign.status).toBe(404);

    const read = await cashier.post(`/api/v1/notifications/${target.id}/read`);
    expect(read.status).toBe(200);
    expect(read.body.isRead).toBe(true);

    const all = await cashier.post('/api/v1/notifications/read-all');
    expect(all.status).toBe(200);
    expect(all.body.unreadCount).toBe(0);

    const after = await cashier.get('/api/v1/notifications?unread=1');
    expect(after.body.items).toHaveLength(0);
  });

  it('requires a session', async () => {
    const response = await request(server(context.app)).get('/api/v1/notifications');
    expect(response.status).toBe(401);
  });
});

describe('receipt printing queue', () => {
  it('queues a receipt once and renders the order lines', async () => {
    const admin = (await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD)).agent;
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const order = await paidOrder(3, cashier);

    const first = await admin.post(`/api/v1/orders/${order.id}/receipt`);
    expect(first.status).toBe(201);
    expect(first.body.existed).toBe(false);
    expect(first.body.job.status).toBe('queued');
    expect(first.body.job.receipt.join('\n')).toContain(order.code);
    expect(first.body.job.receipt.join('\n')).toContain('مبلغ کل');

    const second = await admin.post(`/api/v1/orders/${order.id}/receipt`);
    expect(second.status).toBe(201);
    expect(second.body.existed).toBe(true);
    expect(second.body.job.id).toBe(first.body.job.id);

    const jobs = context.db
      .prepare('SELECT COUNT(*) AS n FROM print_jobs WHERE order_id = ?')
      .get(order.id) as { n: number };
    expect(jobs.n).toBe(1);

    const queue = await admin.get('/api/v1/print/jobs?status=queued');
    expect(queue.status).toBe(200);
    expect(queue.body.items.some((job: { id: string }) => job.id === first.body.job.id)).toBe(true);

    const printed = await admin.post(`/api/v1/print/jobs/${first.body.job.id}/printed`);
    expect(printed.status).toBe(200);
    expect(printed.body.status).toBe('printed');
    expect(printed.body.attempts).toBe(1);
    expect(printed.body.printedAt).toBeTruthy();

    const failedJob = await admin.post(`/api/v1/orders/${order.id}/receipt`);
    expect(failedJob.status).toBe(201);
    const failed = await admin
      .post(`/api/v1/print/jobs/${first.body.job.id}/failed`)
      .send({ error: 'printer offline' });
    expect(failed.body.status).toBe('failed');
    expect(failed.body.error).toBe('printer offline');
  });

  it('claims a queued job so two bridges never print the same receipt twice', async () => {
    const admin = (await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD)).agent;
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const order = await paidOrder(3, cashier);

    const queued = await admin.post(`/api/v1/orders/${order.id}/receipt`);
    expect(queued.status).toBe(201);
    const jobId = queued.body.job.id as string;

    const claimed = await admin.post(`/api/v1/print/jobs/${jobId}/sent`);
    expect(claimed.status).toBe(200);
    expect(claimed.body.status).toBe('sent');
    // Claiming is not an attempt: only a printed/failed result counts one.
    expect(claimed.body.attempts).toBe(0);

    // Pollers ask for queued jobs, so the claimed job is invisible to a second bridge.
    const queue = await admin.get('/api/v1/print/jobs?status=queued');
    expect(queue.body.items.some((job: { id: string }) => job.id === jobId)).toBe(false);

    const again = await admin.post(`/api/v1/print/jobs/${jobId}/sent`);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('sent');

    const printed = await admin.post(`/api/v1/print/jobs/${jobId}/printed`);
    expect(printed.body.status).toBe('printed');
    expect(printed.body.attempts).toBe(1);

    const afterPrint = await admin.post(`/api/v1/print/jobs/${jobId}/sent`);
    expect(afterPrint.status).toBe(409);
    expect(afterPrint.body.error.code).toBe('PRINT_JOB_ALREADY_PRINTED');
  });

  it('refuses a receipt before the order is served', async () => {
    const admin = (await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD)).agent;
    const order = await placeOrder(3);

    const response = await admin.post(`/api/v1/orders/${order.id}/receipt`);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('RECEIPT_NOT_AVAILABLE');
  });

  it('requires authentication for the print queue', async () => {
    const response = await request(server(context.app)).get('/api/v1/print/jobs');
    expect(response.status).toBe(401);

    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;
    expect((await waiter.get('/api/v1/print/jobs')).status).toBe(200);
  });
});

describe('reports', () => {
  it('summarises sales, refunds, methods and top products', async () => {
    const admin = (await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD)).agent;

    const response = await admin.get('/api/v1/reports/summary');
    expect(response.status).toBe(200);
    expect(response.body.totals.sales).toBeGreaterThan(0);
    expect(response.body.totals.refunds).toBeGreaterThan(0);
    expect(response.body.totals.net).toBe(response.body.totals.sales - response.body.totals.refunds);
    expect(response.body.totals.orders).toBeGreaterThan(0);
    expect(response.body.byMethod.length).toBeGreaterThan(0);
    expect(response.body.daily.length).toBeGreaterThan(0);
    expect(response.body.topProducts.length).toBeGreaterThan(0);

    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    expect((await cashier.get('/api/v1/reports/summary')).status).toBe(200);

    const barista = (await login(context.app, 'barista', DEMO_PASSWORD)).agent;
    expect((await barista.get('/api/v1/reports/summary')).status).toBe(403);
  });

  it('exports payments as CSV', async () => {
    const admin = (await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD)).agent;

    const response = await admin.get('/api/v1/reports/payments.csv');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text.startsWith('\uFEFF')).toBe(true);
    expect(response.text).toContain('کد سفارش');
    expect(response.text).toContain('CF-');
  });

  it('validates the date range', async () => {
    const admin = (await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD)).agent;

    const reversed = await admin.get('/api/v1/reports/summary?from=2026-11-20&to=2026-11-10');
    expect(reversed.status).toBe(400);
    expect(reversed.body.error.code).toBe('INVALID_DATE_RANGE');

    const malformed = await admin.get('/api/v1/reports/summary?from=2026-13-45');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_DATE_RANGE');

    const future = await admin.get('/api/v1/reports/summary?from=2030-01-01&to=2030-01-02');
    expect(future.status).toBe(200);
    expect(future.body.totals.sales).toBe(0);

    const empty = await admin.get('/api/v1/reports/summary?from=2020-01-01&to=2020-01-02');
    expect(empty.status).toBe(200);
    expect(empty.body.totals.sales).toBe(0);
  });
});
