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

    const status = await agent.get(
      `/api/v1/public/orders/${response.body.code}?token=${response.body.statusToken}`,
    );
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

function createCampaign(
  options: {
    type?: 'percent' | 'fixed';
    value?: number;
    scope?: 'all' | 'products' | 'categories';
    endsAt?: string | null;
    maxUses?: number | null;
    maxUsesPerDevice?: number | null;
    usedCount?: number;
    isActive?: 0 | 1;
    targetProductId?: string;
  } = {},
): { id: string; token: string } {
  const id = randomUUID();
  context.db
    .prepare(
      `INSERT INTO campaigns
         (id, name_fa, type, value, scope, starts_at, ends_at, max_uses, max_uses_per_device, used_count, is_active)
       VALUES (?, 'کمپین آزمون', ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      options.type ?? 'percent',
      options.value ?? 20,
      options.scope ?? 'all',
      options.endsAt ?? null,
      options.maxUses ?? null,
      options.maxUsesPerDevice ?? null,
      options.usedCount ?? 0,
      options.isActive ?? 1,
    );

  if (options.targetProductId) {
    context.db
      .prepare("INSERT INTO campaign_targets (campaign_id, target_type, target_id) VALUES (?, 'product', ?)")
      .run(id, options.targetProductId);
  }

  const token = `promo-${id}`;
  context.db
    .prepare("INSERT INTO qr_codes (id, kind, token, campaign_id, label) VALUES (?, 'promo', ?, ?, 'آزمون')")
    .run(randomUUID(), token, id);

  return { id, token };
}

async function placeWithPromo(
  qrToken: string,
  items: unknown[],
  agent = request.agent(server(context.app)),
) {
  const response = await agent.post('/api/v1/public/orders').send({
    qrToken,
    clientRequestId: randomUUID(),
    items,
  });
  expect(response.status).toBe(201);
  return response;
}

function orderMoney(orderId: string) {
  return context.db
    .prepare('SELECT subtotal, discount_total, service_charge, tax_total, total FROM orders WHERE id = ?')
    .get(orderId) as {
    subtotal: number;
    discount_total: number;
    service_charge: number;
    tax_total: number;
    total: number;
  };
}

describe('order status token', () => {
  it('serves the status only to the guest holding the token', async () => {
    const agent = request.agent(server(context.app));
    const created = await agent.post('/api/v1/public/orders').send({
      qrToken: tableQrToken,
      clientRequestId: randomUUID(),
      items: [{ productId: anotherProduct.id, quantity: 1, optionIds: [], extraIds: [] }],
    });
    expect(created.status).toBe(201);
    expect(typeof created.body.statusToken).toBe('string');

    const withToken = await agent.get(
      `/api/v1/public/orders/${created.body.code}?token=${created.body.statusToken}`,
    );
    expect(withToken.status).toBe(200);
    expect(withToken.body.code).toBe(created.body.code);

    const withoutToken = await agent.get(`/api/v1/public/orders/${created.body.code}`);
    expect(withoutToken.status).toBe(404);
    expect(withoutToken.body.error.code).toBe('ORDER_NOT_FOUND');

    const wrongToken = await agent.get(`/api/v1/public/orders/${created.body.code}?token=${randomUUID()}`);
    expect(wrongToken.status).toBe(404);
  });

  it('keeps orders created before the token readable by code', async () => {
    const created = await request(server(context.app))
      .post('/api/v1/public/orders')
      .set('Cookie', freshDeviceCookie())
      .send({
        qrToken: tableQrToken,
        clientRequestId: randomUUID(),
        items: [{ productId: anotherProduct.id, quantity: 1, optionIds: [], extraIds: [] }],
      });
    expect(created.status).toBe(201);

    context.db.prepare('UPDATE orders SET status_token_hash = NULL WHERE id = ?').run(created.body.id);

    const legacy = await request(server(context.app)).get(`/api/v1/public/orders/${created.body.code}`);
    expect(legacy.status).toBe(200);
    expect(legacy.body.code).toBe(created.body.code);
  });
});

describe('promo QR campaigns', () => {
  it('applies a percent campaign and charges service/tax on the net subtotal', async () => {
    const { id, token } = createCampaign({ value: 20 });
    const response = await placeWithPromo(token, [
      { productId: anotherProduct.id, quantity: 1, optionIds: [], extraIds: [] },
    ]);

    const subtotal = anotherProduct.base_price;
    const discount = Math.round((subtotal * 20) / 100);
    const net = subtotal - discount;
    const service = Math.round((net * 10) / 100);
    const tax = Math.round(((net + service) * 9) / 100);

    const money = orderMoney(response.body.id as string);
    expect(money.discount_total).toBe(discount);
    expect(money.service_charge).toBe(service);
    expect(money.tax_total).toBe(tax);
    expect(money.total).toBe(net + service + tax);

    const campaign = context.db.prepare('SELECT used_count FROM campaigns WHERE id = ?').get(id) as {
      used_count: number;
    };
    expect(campaign.used_count).toBe(1);

    const redemption = context.db
      .prepare('SELECT amount FROM campaign_redemptions WHERE order_id = ?')
      .get(response.body.id) as { amount: number };
    expect(redemption.amount).toBe(discount);
  });

  it('ignores an expired campaign instead of failing the order', async () => {
    const { id, token } = createCampaign({ endsAt: new Date(Date.now() - 3_600_000).toISOString() });
    const response = await placeWithPromo(token, [
      { productId: anotherProduct.id, quantity: 1, optionIds: [], extraIds: [] },
    ]);

    const money = orderMoney(response.body.id as string);
    expect(money.discount_total).toBe(0);
    expect(money.total).toBe(money.subtotal + money.service_charge + money.tax_total);

    const campaign = context.db.prepare('SELECT used_count FROM campaigns WHERE id = ?').get(id) as {
      used_count: number;
    };
    expect(campaign.used_count).toBe(0);
  });

  it('honours the per-device use limit', async () => {
    const { token } = createCampaign({ value: 10, maxUsesPerDevice: 1 });
    const agent = request.agent(server(context.app));

    const first = await placeWithPromo(
      token,
      [{ productId: anotherProduct.id, quantity: 1, optionIds: [], extraIds: [] }],
      agent,
    );
    const second = await placeWithPromo(
      token,
      [{ productId: anotherProduct.id, quantity: 1, optionIds: [], extraIds: [] }],
      agent,
    );

    expect(orderMoney(first.body.id as string).discount_total).toBeGreaterThan(0);
    expect(orderMoney(second.body.id as string).discount_total).toBe(0);
  });

  it('discounts only the targeted products of a scoped campaign', async () => {
    const { token } = createCampaign({ value: 50, scope: 'products', targetProductId: anotherProduct.id });

    const targeted = await placeWithPromo(token, [
      { productId: anotherProduct.id, quantity: 1, optionIds: [], extraIds: [] },
    ]);
    const untargeted = await placeWithPromo(token, [
      { productId: latte.id, quantity: 1, optionIds: [milkOption.id], extraIds: [] },
    ]);

    expect(orderMoney(targeted.body.id as string).discount_total).toBe(
      Math.round((anotherProduct.base_price * 50) / 100),
    );
    expect(orderMoney(untargeted.body.id as string).discount_total).toBe(0);
  });
});

describe('order status abuse protection', () => {
  it('throttles repeated failed lookups from one address but keeps a valid code open', async () => {
    // A guest polls their own order every 15 seconds and never misses, so the
    // miss budget is spent only by guessing. This runs last on purpose: it
    // exhausts the per-IP budget shared by the whole file.
    const agent = request.agent(server(context.app));
    const created = await agent.post('/api/v1/public/orders').send({
      qrToken: tableQrToken,
      clientRequestId: randomUUID(),
      items: [{ productId: anotherProduct.id, quantity: 1, optionIds: [], extraIds: [] }],
    });
    expect(created.status).toBe(201);

    let blocked = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const response = await request(server(context.app)).get(`/api/v1/public/orders/CF-ZZ${attempt}`);
      if (response.status === 429) {
        expect(response.body.error.code).toBe('RATE_LIMITED');
        blocked = true;
        break;
      }
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('ORDER_NOT_FOUND');
    }
    expect(blocked).toBe(true);

    // The real guest holds the token and is not part of the guessing traffic.
    const own = await agent.get(
      `/api/v1/public/orders/${created.body.code}?token=${created.body.statusToken}`,
    );
    expect(own.status).toBe(200);
    expect(own.body.code).toBe(created.body.code);
  });
});

describe('guest adds another round', () => {
  it('appends items, updates totals and is idempotent with the status token', async () => {
    const agent = request.agent(server(context.app));
    const created = await agent.post('/api/v1/public/orders').send({
      qrToken: tableQrToken,
      clientRequestId: randomUUID(),
      items: [{ productId: anotherProduct.id, quantity: 1, optionIds: [], extraIds: [] }],
    });
    expect(created.status).toBe(201);

    const payload = {
      clientRequestId: randomUUID(),
      items: [{ productId: anotherProduct.id, quantity: 2, optionIds: [], extraIds: [] }],
    };

    const added = await agent
      .post(`/api/v1/public/orders/${created.body.code}/items?token=${created.body.statusToken}`)
      .send(payload);
    expect(added.status).toBe(201);
    expect(added.body.replayed).toBe(false);
    expect(added.body.itemCount).toBe(1);
    expect(added.body.total).toBeGreaterThan(created.body.total);

    const status = await agent.get(
      `/api/v1/public/orders/${created.body.code}?token=${created.body.statusToken}`,
    );
    expect(status.body.items).toHaveLength(2);

    const again = await agent
      .post(`/api/v1/public/orders/${created.body.code}/items?token=${created.body.statusToken}`)
      .send(payload);
    expect(again.body.replayed).toBe(true);
    expect(again.body.total).toBe(added.body.total);

    const count = context.db
      .prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?')
      .get(created.body.id) as { n: number };
    expect(count.n).toBe(2);
  });

  it('requires the status token and refuses an order that is already ready', async () => {
    const created = await request(server(context.app))
      .post('/api/v1/public/orders')
      .set('Cookie', freshDeviceCookie())
      .send({
        qrToken: tableQrToken,
        clientRequestId: randomUUID(),
        items: [{ productId: anotherProduct.id, quantity: 1, optionIds: [], extraIds: [] }],
      });
    expect(created.status).toBe(201);

    const payload = {
      clientRequestId: randomUUID(),
      items: [{ productId: anotherProduct.id, quantity: 1, optionIds: [], extraIds: [] }],
    };

    const noToken = await request(server(context.app))
      .post(`/api/v1/public/orders/${created.body.code}/items`)
      .send(payload);
    expect(noToken.status).toBe(404);

    context.db.prepare("UPDATE orders SET status = 'ready' WHERE id = ?").run(created.body.id);

    const refused = await request(server(context.app))
      .post(`/api/v1/public/orders/${created.body.code}/items?token=${created.body.statusToken}`)
      .send(payload);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('ORDER_NOT_EDITABLE');
  });
});
