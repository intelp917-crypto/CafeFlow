import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { totpCode } from '../src/common/totp';
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
  id: string;
  code: string;
  capacity: number;
  token: string;
}

const tables: TableSeed[] = [];
let context: TestContext;
let admin: Agent;

function tableByCode(code: string): TableSeed {
  const table = tables.find((row) => row.code === code);
  if (!table) throw new Error(`Table ${code} is missing.`);
  return table;
}

async function placeOrder(table: TableSeed, quantity = 1): Promise<{ id: string; code: string }> {
  const agent = request.agent(server(context.app));
  const response = await agent.post('/api/v1/public/orders').send({
    qrToken: table.token,
    clientRequestId: randomUUID(),
    items: [{ productId: productId, quantity, optionIds: [], extraIds: [] }],
  });
  expect(response.status).toBe(201);
  return response.body as { id: string; code: string };
}

let productId = '';

async function servedOrder(table: TableSeed, quantity = 1): Promise<{ id: string; code: string; total: number }> {
  const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;
  const order = await placeOrder(table, quantity);
  for (const to of ['confirmed', 'preparing', 'ready', 'served'] as const) {
    const response = await waiter.post(`/api/v1/orders/${order.id}/transition`).send({ to });
    expect(response.status).toBe(200);
  }
  const detail = await waiter.get(`/api/v1/orders/${order.id}`);
  return { ...order, total: detail.body.total };
}

async function setModule(key: string, enabled: boolean) {
  const response = await admin.patch(`/api/v1/modules/${key}`).send({ enabled });
  expect(response.status).toBe(200);
}

beforeAll(async () => {
  context = await createTestApp();

  const qrRows = context.db
    .prepare(
      `SELECT q.token, t.id, t.code, t.capacity
         FROM qr_codes q JOIN dining_tables t ON t.id = q.table_id
        WHERE q.kind = 'table'
        ORDER BY t.code`,
    )
    .all() as Array<{ token: string; id: string; code: string; capacity: number }>;
  for (const row of qrRows) {
    tables.push({ id: row.id, code: row.code, capacity: row.capacity, token: row.token });
  }

  const product = context.db.prepare("SELECT id FROM products WHERE name_fa = 'اسپرسو'").get() as { id: string };
  productId = product.id;

  admin = (await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD)).agent;
});

afterAll(async () => {
  await context.close();
});

describe('reservations', () => {
  const reservedFor = '2026-12-01T18:00:00.000Z';
  let createdId = '';

  it('creates a reservation and normalises the phone number', async () => {
    const table = tableByCode('T1');
    const response = await admin.post('/api/v1/reservations').send({
      customerName: 'سارا محمدی',
      customerPhone: '۰۹۱۲۳۴۵۶۷۸۹',
      guestCount: 2,
      reservedFor,
      durationMinutes: 90,
      tableId: table.id,
      note: 'کنار پنجره',
    });

    expect(response.status).toBe(201);
    expect(response.body.customerPhone).toBe('09123456789');
    expect(response.body.status).toBe('pending');
    expect(response.body.tableCode).toBe('T1');
    expect(countAudit(context.db, 'reservation.created')).toBeGreaterThan(0);
    createdId = response.body.id;
  });

  it('rejects an overlapping reservation for the same table', async () => {
    const response = await admin.post('/api/v1/reservations').send({
      customerName: 'رضا',
      customerPhone: '09120000001',
      guestCount: 2,
      reservedFor: '2026-12-01T18:30:00.000Z',
      durationMinutes: 60,
      tableId: tableByCode('T1').id,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('RESERVATION_CONFLICT');
  });

  it('allows a back-to-back reservation that starts exactly when the first ends', async () => {
    const response = await admin.post('/api/v1/reservations').send({
      customerName: 'مینا',
      customerPhone: '09120000002',
      guestCount: 1,
      reservedFor: '2026-12-01T19:30:00.000Z',
      durationMinutes: 60,
      tableId: tableByCode('T1').id,
    });

    expect(response.status).toBe(201);
  });

  it('refuses more guests than the table capacity', async () => {
    const response = await admin.post('/api/v1/reservations').send({
      customerName: 'علی',
      customerPhone: '09120000003',
      guestCount: 3,
      reservedFor: '2026-12-02T18:00:00.000Z',
      tableId: tableByCode('T1').id,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CAPACITY_EXCEEDED');
  });

  it('confirms a reservation and marks the table reserved', async () => {
    const response = await admin.post(`/api/v1/reservations/${createdId}/status`).send({ status: 'confirmed' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('confirmed');

    const table = context.db.prepare('SELECT status FROM dining_tables WHERE id = ?').get(tableByCode('T1').id) as {
      status: string;
    };
    expect(table.status).toBe('reserved');
  });

  it('rejects an invalid status transition', async () => {
    const response = await admin.post(`/api/v1/reservations/${createdId}/status`).send({ status: 'pending' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('RESERVATION_TRANSITION_INVALID');
  });

  it('denies reservation creation to a role without reservations.write', async () => {
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const response = await cashier.post('/api/v1/reservations').send({
      customerName: 'ناشناس',
      customerPhone: '09120000004',
      guestCount: 1,
      reservedFor: '2026-12-03T18:00:00.000Z',
    });
    expect(response.status).toBe(403);
  });

  it('preserves reservation rows while the module is disabled', async () => {
    await setModule('reservations', false);
    const blocked = await admin.get('/api/v1/reservations');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MODULE_DISABLED');

    const count = context.db.prepare('SELECT COUNT(*) AS n FROM reservations').get() as { n: number };
    expect(count.n).toBeGreaterThanOrEqual(2);

    await setModule('reservations', true);
    const restored = await admin.get('/api/v1/reservations');
    expect(restored.status).toBe(200);
    expect(restored.body.items.length).toBe(count.n);
  });
});

describe('inventory', () => {
  let ingredientId = '';

  it('is unreachable while the module is disabled', async () => {
    const response = await admin.get('/api/v1/inventory/ingredients');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('MODULE_DISABLED');
  });

  it('creates an ingredient and a recipe', async () => {
    await setModule('inventory', true);

    const ingredient = await admin.post('/api/v1/inventory/ingredients').send({
      nameFa: 'دانه قهوه',
      unitSymbol: 'گرم',
      currentQty: 1000,
      minQty: 100,
      costPerUnit: 1200,
    });
    expect(ingredient.status).toBe(201);
    expect(ingredient.body.currentQty).toBe(1000);
    ingredientId = ingredient.body.id;

    const recipe = await admin.post(`/api/v1/inventory/recipes/${productId}`).send({
      yieldQty: 2,
      items: [{ ingredientId, qty: 36 }],
    });
    expect(recipe.status).toBe(200);
    expect(recipe.body.yieldQty).toBe(2);
    expect(recipe.body.items).toHaveLength(1);
    expect(recipe.body.items[0].qty).toBe(36);
  });

  it('deducts recipe ingredients when an order is placed', async () => {
    const order = await placeOrder(tableByCode('T3'), 2);

    const after = await admin.get('/api/v1/inventory/ingredients');
    const row = after.body.items.find((item: { id: string }) => item.id === ingredientId);
    expect(row.currentQty).toBe(964);

    const movements = await admin.get('/api/v1/inventory/movements');
    const deduction = movements.body.items.find(
      (item: { type: string; orderCode: string | null }) => item.type === 'sale_deduction' && item.orderCode === order.code,
    );
    expect(deduction).toBeDefined();
    expect(deduction.qty).toBe(-36);
  });

  it('restores stock once when the order is cancelled', async () => {
    const order = await placeOrder(tableByCode('T3'), 1);
    const cancelled = await admin
      .post(`/api/v1/orders/${order.id}/transition`)
      .send({ to: 'cancelled', reason: 'اشتباه ثبت شد' });
    expect(cancelled.status).toBe(200);

    const after = await admin.get('/api/v1/inventory/ingredients');
    const row = after.body.items.find((item: { id: string }) => item.id === ingredientId);
    expect(row.currentQty).toBe(964);

    const restores = context.db
      .prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE type = 'restore' AND ref_id = ?")
      .get(order.id) as { n: number };
    expect(restores.n).toBe(1);
  });

  it('refuses an adjustment below zero and records a manual adjustment', async () => {
    const tooMuch = await admin.post(`/api/v1/inventory/ingredients/${ingredientId}/adjustments`).send({
      delta: -5000,
      reason: 'شمارش انبار',
    });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_STOCK');

    const ok = await admin.post(`/api/v1/inventory/ingredients/${ingredientId}/adjustments`).send({
      delta: 18,
      reason: 'خرید روزانه',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.currentQty).toBe(982);
  });

  it('keeps stock data when the module is switched off', async () => {
    await setModule('inventory', false);
    const blocked = await admin.get('/api/v1/inventory/ingredients');
    expect(blocked.status).toBe(403);

    const row = context.db
      .prepare('SELECT current_qty FROM ingredients WHERE id = ?')
      .get(ingredientId) as { current_qty: number };
    expect(row.current_qty).toBe(982);

    await setModule('inventory', true);
  });
});

describe('staff administration', () => {
  let staffId = '';

  it('creates a staff account with a role', async () => {
    const response = await admin.post('/api/v1/users').send({
      username: 'newbarista',
      fullName: 'نیما تست',
      password: 'Staff@12345',
      roleKeys: ['barista'],
    });

    expect(response.status).toBe(201);
    expect(response.body.roles).toEqual(['barista']);
    expect(response.body.mustChangePassword).toBe(true);
    staffId = response.body.id;

    const loginAttempt = await login(context.app, 'newbarista', 'Staff@12345');
    expect(loginAttempt.response.status).toBe(200);
    expect(loginAttempt.response.body.user.mustChangePassword).toBe(true);
    expect(countAudit(context.db, 'staff.created')).toBe(1);
  });

  it('rejects a duplicate username and an unknown role', async () => {
    const duplicate = await admin.post('/api/v1/users').send({
      username: 'newbarista',
      fullName: 'تکراری',
      password: 'Staff@12345',
      roleKeys: ['barista'],
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.code).toBe('USERNAME_TAKEN');

    const badRole = await admin.post('/api/v1/users').send({
      username: 'ghostrole',
      fullName: 'نقش نامعتبر',
      password: 'Staff@12345',
      roleKeys: ['not-a-role'],
    });
    expect(badRole.status).toBe(400);
    expect(badRole.body.error.code).toBe('ROLE_NOT_FOUND');
  });

  it('denies staff creation to a role without users.write', async () => {
    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;
    const response = await waiter.post('/api/v1/users').send({
      username: 'waiter-created',
      fullName: 'غیرمجاز',
      password: 'Staff@12345',
      roleKeys: ['waiter'],
    });
    expect(response.status).toBe(403);
  });

  it('replaces roles and deactivates the account', async () => {
    const updated = await admin.patch(`/api/v1/users/${staffId}`).send({ roleKeys: ['cashier'] });
    expect(updated.status).toBe(200);
    expect(updated.body.roles).toEqual(['cashier']);

    const disabled = await admin.patch(`/api/v1/users/${staffId}`).send({ isActive: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.isActive).toBe(false);

    const blockedLogin = await login(context.app, 'newbarista', 'Staff@12345');
    expect(blockedLogin.response.status).toBe(403);
  });

  it('resets a password and revokes the existing session', async () => {
    const created = await admin.post('/api/v1/users').send({
      username: 'resetme',
      fullName: 'کاربر بازنشانی',
      password: 'Staff@12345',
      roleKeys: ['barista'],
    });
    expect(created.status).toBe(201);

    const firstSession = await login(context.app, 'resetme', 'Staff@12345');
    expect(firstSession.response.status).toBe(200);

    const patched = await admin.patch(`/api/v1/users/${created.body.id}`).send({ newPassword: 'Reset@54321' });
    expect(patched.status).toBe(200);
    expect(patched.body.mustChangePassword).toBe(true);

    const revoked = await firstSession.agent.get('/api/v1/auth/me');
    expect(revoked.status).toBe(401);

    const relogin = await login(context.app, 'resetme', 'Reset@54321');
    expect(relogin.response.status).toBe(200);
  });

  it('lets an administrator reset a lost authenticator', async () => {
    const created = await admin.post('/api/v1/users').send({
      username: 'lostdevice',
      fullName: 'دستگاه گمشده',
      password: 'Staff@12345',
      roleKeys: ['waiter'],
    });
    expect(created.status).toBe(201);

    const member = (await login(context.app, 'lostdevice', 'Staff@12345')).agent;
    const enrollment = await member.post('/api/v1/auth/mfa/enroll');
    const activation = await member
      .post('/api/v1/auth/mfa/activate')
      .send({ code: totpCode(enrollment.body.secret) });
    expect(activation.status).toBe(200);

    const blocked = await login(context.app, 'lostdevice', 'Staff@12345');
    expect(blocked.response.status).toBe(401);
    expect(blocked.response.body.error.code).toBe('MFA_REQUIRED');

    const reset = await admin.patch(`/api/v1/users/${created.body.id}`).send({ resetMfa: true });
    expect(reset.status).toBe(200);

    const recovered = await login(context.app, 'lostdevice', 'Staff@12345');
    expect(recovered.response.status).toBe(200);
    expect(recovered.response.body.user.mfaEnabled).toBe(false);
  });

  it('refuses to let an administrator disable their own account', async () => {
    const me = await admin.get('/api/v1/auth/me');
    const response = await admin.patch(`/api/v1/users/${me.body.user.id}`).send({ isActive: false });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CANNOT_DISABLE_SELF');
  });
});

describe('cash sessions', () => {
  let sessionId = '';
  let orderTotal = 0;

  it('opens a session with the seeded register', async () => {
    await setModule('finance', true);
    const overview = await admin.get('/api/v1/cash-sessions');
    expect(overview.status).toBe(200);
    expect(overview.body.registers.length).toBeGreaterThan(0);

    const registerId = overview.body.registers[0].id;
    const opened = await admin.post('/api/v1/cash-sessions/open').send({ registerId, openingFloat: 500_000 });
    expect(opened.status).toBe(201);
    expect(opened.body.status).toBe('open');
    expect(opened.body.expectedAmount).toBe(500_000);
    sessionId = opened.body.id;

    const again = await admin.post('/api/v1/cash-sessions/open').send({ registerId, openingFloat: 1000 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CASH_SESSION_ALREADY_OPEN');
  });

  it('derives the expected amount from the cash payment', async () => {
    const order = await servedOrder(tableByCode('T4'));
    orderTotal = order.total;

    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
    const payment = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ method: 'cash', amount: order.total });
    expect(payment.status).toBe(201);

    const overview = await admin.get('/api/v1/cash-sessions');
    expect(overview.body.current.cashTotal).toBe(order.total);
    expect(overview.body.current.expectedAmount).toBe(500_000 + order.total);
  });

  it('closes the session with a recorded difference', async () => {
    const expected = 500_000 + orderTotal;
    const closed = await admin
      .post(`/api/v1/cash-sessions/${sessionId}/close`)
      .send({ closingAmount: expected + 5_000 });

    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('closed');
    expect(closed.body.expectedAmount).toBe(expected);
    expect(closed.body.difference).toBe(5_000);

    const overview = await admin.get('/api/v1/cash-sessions');
    expect(overview.body.current).toBeNull();
    expect(overview.body.history.length).toBeGreaterThan(0);

    const reopen = await admin.post(`/api/v1/cash-sessions/${sessionId}/close`).send({ closingAmount: 1 });
    expect(reopen.status).toBe(409);
  });

  it('is blocked while the finance module is disabled', async () => {
    await setModule('finance', false);
    const blocked = await admin.get('/api/v1/cash-sessions');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MODULE_DISABLED');
  });
});

describe('customer club', () => {
  let customerId = '';

  it('is unreachable while the module is disabled', async () => {
    const response = await admin.get('/api/v1/customers');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('MODULE_DISABLED');
  });

  it('creates a customer and refuses a duplicate number', async () => {
    await setModule('crm', true);

    const created = await admin.post('/api/v1/customers').send({
      name: 'مشتری تست',
      phone: '۰۹۱۲۰۰۰۰۰۰۰',
      consentMarketing: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.phone).toBe('09120000000');
    expect(created.body.tier).toBe('regular');
    customerId = created.body.id;

    const duplicate = await admin.post('/api/v1/customers').send({ phone: '09120000000' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CUSTOMER_EXISTS');
  });

  it('adjusts points, derives the tier and keeps a ledger', async () => {
    const points = await admin.post(`/api/v1/customers/${customerId}/loyalty`).send({
      points: 250,
      reason: 'خرید اول',
    });
    expect(points.status).toBe(200);
    expect(points.body.points).toBe(250);
    expect(points.body.tier).toBe('silver');

    const wallet = await admin.post(`/api/v1/customers/${customerId}/loyalty`).send({
      wallet: 100_000,
      reason: 'شارژ هدیه',
    });
    expect(wallet.status).toBe(200);
    expect(wallet.body.walletBalance).toBe(100_000);
    expect(wallet.body.ledger).toHaveLength(2);

    const overdraft = await admin.post(`/api/v1/customers/${customerId}/loyalty`).send({
      wallet: -500_000,
      reason: 'برداشت',
    });
    expect(overdraft.status).toBe(400);
    expect(overdraft.body.error.code).toBe('INSUFFICIENT_WALLET');
  });

  it('keeps customer rows when the module is switched off', async () => {
    await setModule('crm', false);
    const blocked = await admin.get('/api/v1/customers');
    expect(blocked.status).toBe(403);

    const row = context.db.prepare('SELECT phone FROM customers WHERE id = ?').get(customerId) as { phone: string };
    expect(row.phone).toBe('09120000000');
  });
});
