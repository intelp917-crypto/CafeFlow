import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  createTestApp,
  countAudit,
  login,
  server,
  type TestContext,
} from './helpers';

let context: TestContext;

beforeAll(async () => {
  context = await createTestApp();
});

afterAll(async () => {
  await context.close();
});

describe('POST /auth/login', () => {
  it('sets an HttpOnly session cookie and returns the user with permissions', async () => {
    const response = await request(server(context.app))
      .post('/api/v1/auth/login')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user.username).toBe(ADMIN_USERNAME);
    expect(response.body.user.permissions).toContain('dashboard.read');
    expect(response.body.user.permissions).toContain('modules.manage');
    expect(response.body.user.passwordHash).toBeUndefined();

    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies.join(';')).toContain('cafe_session=');
    expect(cookies.join(';')).toContain('HttpOnly');
    expect(countAudit(context.db, 'auth.login_success')).toBeGreaterThan(0);
  });

  it('rejects a wrong password with a Persian message', async () => {
    const response = await request(server(context.app))
      .post('/api/v1/auth/login')
      .send({ username: ADMIN_USERNAME, password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(response.body.error.message).toMatch(/نادرست/);
    expect(countAudit(context.db, 'auth.login_failed')).toBeGreaterThan(0);
  });

  it('validates the request body', async () => {
    const response = await request(server(context.app))
      .post('/api/v1/auth/login')
      .send({ username: 'a', password: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('locks the account after repeated failures', async () => {
    const agent = request.agent(server(context.app));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await agent.post('/api/v1/auth/login').send({ username: 'cashier', password: 'bad-password' });
    }

    const locked = await agent.post('/api/v1/auth/login').send({ username: 'cashier', password: 'bad-password' });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('session lifecycle', () => {
  it('returns the current user for an authenticated request', async () => {
    const { agent } = await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD);
    const me = await agent.get('/api/v1/auth/me');

    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe(ADMIN_USERNAME);
    expect(me.body.modules).toContain('ordering');
    expect(me.body.modules).not.toContain('inventory');
  });

  it('blocks unauthenticated access to private endpoints', async () => {
    const response = await request(server(context.app)).get('/api/v1/dashboard/overview');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('serves health without a session', async () => {
    const response = await request(server(context.app)).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.database).toBe('ok');
  });

  it('lists active sessions and revokes the current one on logout', async () => {
    const { agent } = await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD);

    const sessions = await agent.get('/api/v1/auth/sessions');
    expect(sessions.status).toBe(200);
    expect(sessions.body.items.length).toBeGreaterThan(0);
    expect(sessions.body.items[0].current).toBe(true);

    const logout = await agent.post('/api/v1/auth/logout');
    expect(logout.status).toBe(200);

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(401);
  });

  it('changes the password and revokes other sessions', async () => {
    const { agent } = await login(context.app, 'manager', 'CafeFlow@1404');
    const otherSession = await login(context.app, 'manager', 'CafeFlow@1404');

    const change = await agent.post('/api/v1/auth/password').send({
      currentPassword: 'CafeFlow@1404',
      newPassword: 'Manager@1405',
      confirmPassword: 'Manager@1405',
    });
    expect(change.status).toBe(200);

    const stillValid = await agent.get('/api/v1/auth/me');
    expect(stillValid.status).toBe(200);

    const revoked = await otherSession.agent.get('/api/v1/auth/me');
    expect(revoked.status).toBe(401);

    // Restore the demo password so other tests keep their assumptions.
    await agent.post('/api/v1/auth/password').send({
      currentPassword: 'Manager@1405',
      newPassword: 'CafeFlow@1404',
      confirmPassword: 'CafeFlow@1404',
    });
  });
});
