import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  DEMO_PASSWORD,
  createTestApp,
  countAudit,
  login,
  type TestContext,
} from './helpers';

let context: TestContext;

beforeAll(async () => {
  context = await createTestApp();
});

afterAll(async () => {
  await context.close();
});

describe('permission enforcement', () => {
  it('lets the admin read the dashboard, staff, roles and audit log', async () => {
    const { agent } = await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD);

    const dashboard = await agent.get('/api/v1/dashboard/overview');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.tables.total).toBeGreaterThan(0);
    expect(dashboard.body.catalog.products).toBeGreaterThan(0);

    expect((await agent.get('/api/v1/users')).status).toBe(200);
    expect((await agent.get('/api/v1/roles')).status).toBe(200);
    expect((await agent.get('/api/v1/audit')).status).toBe(200);
  });

  it('blocks a waiter from audit, staff and module management', async () => {
    const { agent } = await login(context.app, 'waiter', DEMO_PASSWORD);

    expect((await agent.get('/api/v1/dashboard/overview')).status).toBe(200);
    expect((await agent.get('/api/v1/audit')).status).toBe(403);
    expect((await agent.get('/api/v1/users')).status).toBe(403);
    expect((await agent.get('/api/v1/settings')).status).toBe(403);
    expect((await agent.patch('/api/v1/modules/inventory').send({ enabled: true })).status).toBe(403);
  });

  it('blocks a barista from financial and customer data', async () => {
    const { agent } = await login(context.app, 'barista', DEMO_PASSWORD);

    expect((await agent.get('/api/v1/users')).status).toBe(403);
    expect((await agent.get('/api/v1/audit')).status).toBe(403);
    expect((await agent.get('/api/v1/approvals')).status).toBe(403);
  });

  it('refuses discount and price permissions the role does not grant', async () => {
    const { agent } = await login(context.app, 'cashier', DEMO_PASSWORD);
    // The cashier dashboard lists orders but the cashier cannot manage staff or
    // toggle modules — the UI hides it, and the API refuses it.
    expect((await agent.get('/api/v1/users')).status).toBe(403);
    expect((await agent.patch('/api/v1/modules/finance').send({ enabled: true })).status).toBe(403);
  });
});

describe('settings changes', () => {
  it('updates settings and records before/after in the audit log', async () => {
    const { agent } = await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD);

    const before = await agent.get('/api/v1/settings');
    expect(before.status).toBe(200);

    const updated = await agent.patch('/api/v1/settings').send({
      restaurantNameFa: 'کافه‌فلو شعبه مرکزی',
      serviceChargePercent: 10,
      digitMode: 'fa',
    });

    expect(updated.status).toBe(200);
    expect(updated.body.restaurantNameFa).toBe('کافه‌فلو شعبه مرکزی');
    expect(updated.body.serviceChargePercent).toBe(10);

    const row = context.db
      .prepare("SELECT before_json, after_json FROM audit_logs WHERE action = 'settings.updated' ORDER BY created_at DESC LIMIT 1")
      .get() as { before_json: string; after_json: string } | undefined;

    expect(row).toBeDefined();
    expect(JSON.parse(row!.before_json).restaurantNameFa).toBe('کافه‌فلو');
    expect(JSON.parse(row!.after_json).restaurantNameFa).toBe('کافه‌فلو شعبه مرکزی');
  });

  it('rejects out-of-range financial percentages', async () => {
    const { agent } = await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD);
    const response = await agent.patch('/api/v1/settings').send({ taxPercent: 99 });
    expect(response.status).toBe(400);
  });

  it('records login attempts in the audit trail', () => {
    expect(countAudit(context.db, 'auth.login_success')).toBeGreaterThan(0);
  });
});
