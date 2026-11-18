import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, server, type TestContext } from './helpers';

let context: TestContext;
let tableQrToken: string;
let latte: { id: string; base_price: number };
let milkOption: { id: string; price_delta: number };
let extra: { id: string; price: number };
let anotherProduct: { id: string; base_price: number };

function freshDeviceCookie(): string {
  return `cafe_device=${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
}

beforeAll(async () => {
  context = await createTestApp();
  const db = context.db;

  tableQrToken = (db.prepare("SELECT token FROM qr_codes WHERE kind = 'table' LIMIT 1").get() as { token: string }).token;

  latte = db.prepare("SELECT id, base_price FROM products WHERE name_fa = 'لاته'").get() as {
    id: string;
    base_price: number;
  };
  const group = db
    .prepare('SELECT id FROM option_groups WHERE product_id = ? LIMIT 1')
    .get(latte.id) as { id: string };
  milkOption = db
    .prepare("SELECT id, price_delta FROM product_options WHERE option_group_id = ? AND name_fa = 'شیر بادام'")
    .get(group.id) as { id: string; price_delta: number };
  extra = db
    .prepare(
      'SELECT e.id, e.price FROM extras e JOIN product_extras pe ON pe.extra_id = e.id WHERE pe.product_id = ? LIMIT 1',
    )
    .get(latte.id) as { id: string; price: number };
  anotherProduct = db
    .prepare("SELECT id, base_price FROM products WHERE name_fa = 'اسپرسو'")
    .get() as { id: string; base_price: number };

  // Financial percentages are configuration, not hardcoded values.
  db.prepare("UPDATE settings SET service_charge_percent = 10, tax_percent = 9 WHERE id = 'singleton'").run();
});

afterAll(async () => {
  await context.close();
});

describe('GET /public/menu', () => {
  it('serves the Persian menu without a session and issues a device cookie', async () => {
    const response = await request(server(context.app)).get('/api/v1/public/menu');

    expect(response.status).toBe(200);
    expect(response.body.restaurant.nameFa).toBeTruthy();
    expect(response.body.table).toBeNull();
    expect(response.body.categories.length).toBeGreaterThan(0);

    const latteCard = response.body.categories
      .flatMap((category: { products: Array<{ nameFa: string; optionGroups: unknown[]; extras: unknown[] }> }) => category.products)
      .find((product: { nameFa: string }) => product.nameFa === 'لاته');

    expect(latteCard).toBeDefined();
    expect(latteCard.optionGroups.length).toBeGreaterThan(0);
    expect(latteCard.extras.length).toBeGreaterThan(0);

    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies.join(';')).toContain('cafe_device=');
    expect(cookies.join(';')).toContain('HttpOnly');
  });

  it('resolves a table QR token to the table', async () => {
    const response = await request(server(context.app)).get(`/api/v1/public/menu?qr=${tableQrToken}`);

    expect(response.status).toBe(200);
    expect(response.body.qr.kind).toBe('table');
    expect(response.body.table.code).toMatch(/^T\d+$/);
  });

  it('rejects an unknown QR token with a Persian message', async () => {
    const response = await request(server(context.app)).get('/api/v1/public/menu?qr=not-a-real-token');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('QR_NOT_FOUND');
    expect(response.body.error.message).toMatch(/QR/);
  });
});

describe('POST /public/orders', () => {
  it('computes the price server-side from snapshots, options and extras', async () => {
    const agent = request.agent(server(context.app));
    const response = await agent.post('/api/v1/public/orders').send({
      qrToken: tableQrToken,
      clientRequestId: randomUUID(),
      note: 'بدون شکر',
      items: [
        {
          productId: latte.id,
          quantity: 2,
          optionIds: [milkOption.id],
          extraIds: [extra.id],
          note: 'شیر گرم‌تر',
        },
      ],
    });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('submitted');
    expect(response.body.itemCount).toBe(2);

    const unit = latte.base_price + milkOption.price_delta + extra.price;
    const subtotal = unit * 2;
    const serviceCharge = Math.round((subtotal * 10) / 100);
    const tax = Math.round(((subtotal + serviceCharge) * 9) / 100);

    expect(response.body.total).toBe(subtotal + serviceCharge + tax);

    const status = await agent.get(`/api/v1/public/orders/${response.body.code}`);
    expect(status.status).toBe(200);
    expect(status.body.subtotal).toBe(subtotal);
    expect(status.body.serviceCharge).toBe(serviceCharge);
    expect(status.body.taxTotal).toBe(tax);
    expect(status.body.source ?? 'qr').toBe('qr');

    const itemRow = context.db
      .prepare('SELECT unit_price_snapshot, quantity, department_id, total FROM order_items WHERE order_id = ?')
      .get(response.body.id) as { unit_price_snapshot: number; quantity: number; department_id: string; total: number };
    expect(itemRow.unit_price_snapshot).toBe(unit);
    expect(itemRow.quantity).toBe(2);
    expect(itemRow.department_id).toBeTruthy();

    const prepTask = context.db
      .prepare('SELECT status FROM prep_tasks WHERE order_id = ?')
      .get(response.body.id) as { status: string };
    expect(prepTask.status).toBe('queued');

    const notification = context.db
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'order.created'")
      .get() as { n: number };
    expect(notification.n).toBeGreaterThan(0);
  });

  it('opens a table session and marks the table occupied', async () => {
    const table = context.db
      .prepare('SELECT id, status FROM dining_tables WHERE qr_token = ?')
      .get(tableQrToken) as { id: string; status: string };

    expect(table.status).toBe('occupied');

    const session = context.db
      .prepare("SELECT COUNT(*) AS n FROM table_sessions WHERE table_id = ? AND status = 'open'")
      .get(table.id) as { n: number };
    expect(session.n).toBe(1);
  });

  it('is idempotent for a repeated client request id', async () => {
    const agent = request.agent(server(context.app));
    const clientRequestId = randomUUID();
    const payload = {
      qrToken: tableQrToken,
      clientRequestId,
      items: [{ productId: anotherProduct.id, quantity: 1, optionIds: [], extraIds: [] }],
    };

    const first = await agent.post('/api/v1/public/orders').send(payload);
    const second = await agent.post('/api/v1/public/orders').send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.code).toBe(first.body.code);
    expect(second.body.replayed).toBe(true);

    const count = context.db
      .prepare('SELECT COUNT(*) AS n FROM orders WHERE code = ?')
      .get(first.body.code) as { n: number };
    expect(count.n).toBe(1);
  });

  it('rejects a missing required option', async () => {
    const response = await request(server(context.app))
      .post('/api/v1/public/orders')
      .set('Cookie', freshDeviceCookie())
      .send({
        qrToken: tableQrToken,
        clientRequestId: randomUUID(),
        items: [{ productId: latte.id, quantity: 1, optionIds: [], extraIds: [] }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OPTION_REQUIRED');
    expect(response.body.error.message).toMatch(/الزامی/);
  });

  it('rejects an option that belongs to another product', async () => {
    const otherGroup = context.db
      .prepare('SELECT id FROM option_groups WHERE product_id = ? LIMIT 1')
      .get(latte.id) as { id: string };
    const foreignOption = context.db
      .prepare('SELECT id FROM product_options WHERE option_group_id = ? LIMIT 1')
      .get(otherGroup.id) as { id: string };

    const response = await request(server(context.app))
      .post('/api/v1/public/orders')
      .set('Cookie', freshDeviceCookie())
      .send({
        qrToken: tableQrToken,
        clientRequestId: randomUUID(),
        items: [{ productId: anotherProduct.id, quantity: 1, optionIds: [foreignOption.id], extraIds: [] }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OPTION_INVALID');
  });

  it('rejects an unavailable product', async () => {
    context.db.prepare('UPDATE products SET is_available = 0 WHERE id = ?').run(anotherProduct.id);
    try {
      const response = await request(server(context.app))
        .post('/api/v1/public/orders')
        .set('Cookie', freshDeviceCookie())
        .send({
          qrToken: tableQrToken,
          clientRequestId: randomUUID(),
          items: [{ productId: anotherProduct.id, quantity: 1, optionIds: [], extraIds: [] }],
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('PRODUCT_UNAVAILABLE');
    } finally {
      context.db.prepare('UPDATE products SET is_available = 1 WHERE id = ?').run(anotherProduct.id);
    }
  });

  it('validates the payload shape', async () => {
    const response = await request(server(context.app))
      .post('/api/v1/public/orders')
      .set('Cookie', freshDeviceCookie())
      .send({ qrToken: tableQrToken, clientRequestId: randomUUID(), items: [] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rate limits a device that submits too many orders', async () => {
    // A cookie jar keeps the server-issued device identity stable across the
    // attempts; a client-chosen token is never trusted.
    const agent = request.agent(server(context.app));
    let blocked = false;

    for (let attempt = 0; attempt < 9; attempt += 1) {
      const response = await agent.post('/api/v1/public/orders').send({
        qrToken: tableQrToken,
        clientRequestId: randomUUID(),
        items: [{ productId: anotherProduct.id, quantity: 1, optionIds: [], extraIds: [] }],
      });
      if (response.status === 429) {
        blocked = true;
        expect(response.body.error.code).toBe('RATE_LIMITED');
        break;
      }
      expect(response.status).toBe(201);
    }

    expect(blocked).toBe(true);
  });
});

describe('customer service requests', () => {
  it('records a waiter request and notifies staff', async () => {
    const response = await request(server(context.app))
      .post('/api/v1/public/requests')
      .set('Cookie', freshDeviceCookie())
      .send({ qrToken: tableQrToken, type: 'waiter', note: 'لطفاً به میز بیایید' });

    expect(response.status).toBe(201);
    expect(response.body.type).toBe('waiter');

    const row = context.db
      .prepare('SELECT table_id, status, note FROM customer_requests WHERE id = ?')
      .get(response.body.id) as { table_id: string; status: string; note: string };
    expect(row.status).toBe('pending');
    expect(row.table_id).toBeTruthy();
    expect(row.note).toBe('لطفاً به میز بیایید');

    const notification = context.db
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'customer_request.waiter'")
      .get() as { n: number };
    expect(notification.n).toBeGreaterThan(0);
  });

  it('creates a terminal request for the cashier', async () => {
    const response = await request(server(context.app))
      .post('/api/v1/public/terminal-requests')
      .set('Cookie', freshDeviceCookie())
      .send({ qrToken: tableQrToken, note: 'برای پرداخت' });

    expect(response.status).toBe(201);

    const terminal = context.db
      .prepare("SELECT COUNT(*) AS n FROM terminal_requests WHERE status = 'pending'")
      .get() as { n: number };
    expect(terminal.n).toBeGreaterThan(0);

    const cashierNotification = context.db
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE role_key = 'cashier'")
      .get() as { n: number };
    expect(cashierNotification.n).toBeGreaterThan(0);
  });

  it('rejects an invalid request type', async () => {
    const response = await request(server(context.app))
      .post('/api/v1/public/requests')
      .set('Cookie', freshDeviceCookie())
      .send({ qrToken: tableQrToken, type: 'free-food' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});
