import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ADMIN_PASSWORD, ADMIN_USERNAME, createTestApp, login, server, type TestContext } from './helpers';

let context: TestContext;
let admin: ReturnType<typeof request.agent>;

beforeAll(async () => {
  context = await createTestApp();
  admin = (await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD)).agent;
});

afterAll(async () => {
  await context.close();
});

describe('branding', () => {
  it('serves the configured café name without a session', async () => {
    const row = context.db
      .prepare("SELECT restaurant_name_fa FROM settings WHERE id = 'singleton'")
      .get() as { restaurant_name_fa: string };

    const response = await request(server(context.app)).get('/api/v1/public/branding');

    expect(response.status).toBe(200);
    expect(response.body.nameFa).toBe(row.restaurant_name_fa);
    expect(typeof response.body.logoUrl).toBe('string');
  });

  it('renames branding, the PWA manifest and the customer menu together', async () => {
    const saved = await admin.patch('/api/v1/settings').send({ restaurantNameFa: 'کافه ماهور' });
    expect(saved.status).toBe(200);

    const branding = await request(server(context.app)).get('/api/v1/public/branding');
    expect(branding.body.nameFa).toBe('کافه ماهور');

    const manifest = await request(server(context.app)).get('/api/v1/public/branding/manifest');
    expect(manifest.status).toBe(200);
    expect(manifest.body.name).toContain('کافه ماهور');
    expect(manifest.body.short_name).toBe('کافه ماهور');

    const menu = await request(server(context.app)).get('/api/v1/public/menu');
    expect(menu.body.restaurant.nameFa).toBe('کافه ماهور');
  });

  it('keeps only the café name editable through settings', async () => {
    const rejected = await admin.patch('/api/v1/settings').send({ restaurantNameFa: '   ' });
    expect(rejected.status).toBe(400);
  });
});
