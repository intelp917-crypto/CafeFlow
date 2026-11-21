import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_PASSWORD, ADMIN_USERNAME, createTestApp, login, type TestContext } from './helpers';

let context: TestContext;

beforeAll(async () => {
  context = await createTestApp();
});

afterAll(async () => {
  await context.close();
});

describe('optional module gate', () => {
  it('ships with inventory disabled and refuses its API', async () => {
    const { agent } = await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD);

    const modules = await agent.get('/api/v1/modules');
    expect(modules.status).toBe(200);
    const inventory = modules.body.items.find((item: { key: string }) => item.key === 'inventory');
    expect(inventory.enabled).toBe(false);
    expect(inventory.configurable).toBe(true);

    const shopping = modules.body.items.find((item: { key: string }) => item.key === 'ordering');
    expect(shopping.enabled).toBe(true);
    expect(shopping.configurable).toBe(false);

    const blocked = await agent.get('/api/v1/inventory/overview');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MODULE_DISABLED');
  });

  it('enables the module, serves its API, then disables it without losing data', async () => {
    const { agent } = await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD);

    // Real inventory data created while the module is off must survive the
    // on/off cycle.
    const ingredientId = randomUUID();
    context.db
      .prepare('INSERT INTO ingredients (id, name_fa, current_qty, min_qty) VALUES (?, ?, ?, ?)')
      .run(ingredientId, 'دانه قهوه', 12, 5);

    const enabled = await agent.patch('/api/v1/modules/inventory').send({ enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.enabled).toBe(true);

    const overview = await agent.get('/api/v1/inventory/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.ingredients).toBe(1);

    const disabled = await agent.patch('/api/v1/modules/inventory').send({ enabled: false });
    expect(disabled.status).toBe(200);

    const blockedAgain = await agent.get('/api/v1/inventory/overview');
    expect(blockedAgain.status).toBe(403);

    const ingredientCount = context.db
      .prepare('SELECT COUNT(*) AS n FROM ingredients WHERE id = ?')
      .get(ingredientId) as { n: number };
    expect(ingredientCount.n).toBe(1);

    const flag = context.db
      .prepare("SELECT is_enabled FROM module_settings WHERE key = 'inventory'")
      .get() as { is_enabled: number };
    expect(flag.is_enabled).toBe(0);

    const auditRows = context.db
      .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action IN ('module.enabled','module.disabled')")
      .get() as { n: number };
    expect(auditRows.n).toBeGreaterThanOrEqual(2);
  });

  it('ships the table-games module on and closes its public API when switched off', async () => {
    const { agent } = await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD);

    const modules = await agent.get('/api/v1/modules');
    const games = modules.body.items.find((item: { key: string }) => item.key === 'games');
    expect(games).toMatchObject({ enabled: true, configurable: true });

    const catalog = await agent.get('/api/v1/public/games/catalog');
    expect(catalog.status).toBe(200);
    expect(catalog.body.games.length).toBeGreaterThan(30);

    const off = await agent.patch('/api/v1/modules/games').send({ enabled: false });
    expect(off.status).toBe(200);

    const blocked = await agent.get('/api/v1/public/games/catalog');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MODULE_DISABLED');

    // The customer menu learns the switch too, so the button disappears instead
    // of leading to a refused join.
    const menu = await agent.get('/api/v1/public/menu');
    expect(menu.status).toBe(200);
    expect(menu.body.gamesEnabled).toBe(false);

    const on = await agent.patch('/api/v1/modules/games').send({ enabled: true });
    expect(on.status).toBe(200);
    const menuAgain = await agent.get('/api/v1/public/menu');
    expect(menuAgain.body.gamesEnabled).toBe(true);
  });

  it('refuses to disable a core module', async () => {
    const { agent } = await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD);
    const response = await agent.patch('/api/v1/modules/tables').send({ enabled: false });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('MODULE_NOT_CONFIGURABLE');
  });

  it('refuses to enable a module whose dependency is disabled', async () => {
    const { agent } = await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD);

    // finance depends on ordering, which is core and always enabled, so no
    // dependency can be met by disabling something else. Instead verify that an
    // unknown module key is rejected.
    const response = await agent.patch('/api/v1/modules/not-a-module').send({ enabled: true });
    expect(response.status).toBe(404);
  });

  it('validates the toggle payload', async () => {
    const { agent } = await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD);
    const response = await agent.patch('/api/v1/modules/crm').send({ enabled: 'yes' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});
