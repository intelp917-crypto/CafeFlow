import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpCode } from '../src/common/totp';
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
let admin: Awaited<ReturnType<typeof login>>['agent'];
let secret = '';
let recoveryCodes: string[] = [];

beforeAll(async () => {
  context = await createTestApp();
  admin = (await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD)).agent;
});

afterAll(async () => {
  await context.close();
});

describe('two-factor authentication', () => {
  it('requires a session for every MFA endpoint', async () => {
    const app = context.app;
    const request = (await import('supertest')).default(app.getHttpServer());
    const response = await request.get('/api/v1/auth/mfa');
    expect(response.status).toBe(401);
  });

  it('starts enrollment with a base32 secret and otpauth URI', async () => {
    const response = await admin.post('/api/v1/auth/mfa/enroll');
    expect(response.status).toBe(200);
    expect(response.body.secret).toMatch(/^[A-Z2-7]{16,}$/);
    expect(response.body.otpauthUrl).toContain('otpauth://totp/');
    expect(response.body.otpauthUrl).toContain(response.body.secret);
    secret = response.body.secret;

    // Unconfirmed enrollment must not block the password-only login yet.
    const status = await admin.get('/api/v1/auth/mfa');
    expect(status.body).toEqual({ enabled: false, confirmedAt: null });
  });

  it('refuses an invalid activation code', async () => {
    const response = await admin.post('/api/v1/auth/mfa/activate').send({ code: '000000' });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('MFA_INVALID');
  });

  it('activates with a real code', async () => {
    const response = await admin.post('/api/v1/auth/mfa/activate').send({ code: totpCode(secret) });
    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(true);
    expect(response.body.recoveryCodes).toHaveLength(10);
    for (const code of response.body.recoveryCodes) {
      expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    }
    recoveryCodes = response.body.recoveryCodes;
    expect(countAudit(context.db, 'auth.mfa_enabled')).toBe(1);
  });

  it('demands the code on the next login', async () => {
    const withoutCode = await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD);
    expect(withoutCode.response.status).toBe(401);
    expect(withoutCode.response.body.error.code).toBe('MFA_REQUIRED');

    // the helper never sends a code, so a wrong one must be sent explicitly
    const request = (await import('supertest')).default(context.app.getHttpServer());
    const wrongCode = await request
      .post('/api/v1/auth/login')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, code: '000000' });
    expect(wrongCode.status).toBe(401);
    expect(wrongCode.body.error.code).toBe('MFA_INVALID');

    const withCode = await request
      .post('/api/v1/auth/login')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, code: totpCode(secret) });
    expect(withCode.status).toBe(200);
    expect(withCode.body.user.mfaEnabled).toBe(true);
  });

  it('accepts a recovery code exactly once', async () => {
    const request = (await import('supertest')).default(context.app.getHttpServer());

    const first = await request
      .post('/api/v1/auth/login')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, code: recoveryCodes[0] });
    expect(first.status).toBe(200);
    expect(countAudit(context.db, 'auth.mfa_recovery_used')).toBe(1);

    const reused = await request
      .post('/api/v1/auth/login')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, code: recoveryCodes[0] });
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe('MFA_INVALID');
  });

  it('regenerates recovery codes and invalidates the old set', async () => {
    const wrongPassword = await admin
      .post('/api/v1/auth/mfa/recovery-codes')
      .send({ password: 'nope', code: totpCode(secret) });
    expect(wrongPassword.status).toBe(401);

    const regenerated = await admin
      .post('/api/v1/auth/mfa/recovery-codes')
      .send({ password: ADMIN_PASSWORD, code: totpCode(secret) });
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.recoveryCodes).toHaveLength(10);

    const request = (await import('supertest')).default(context.app.getHttpServer());
    const oldCode = await request
      .post('/api/v1/auth/login')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, code: recoveryCodes[1] });
    expect(oldCode.status).toBe(401);

    recoveryCodes = regenerated.body.recoveryCodes;
  });

  it('refuses a second enrollment while enabled', async () => {
    const response = await admin.post('/api/v1/auth/mfa/enroll');
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('MFA_ALREADY_ENABLED');
  });

  it('refuses activation without a pending secret', async () => {
    const waiter = (await login(context.app, 'waiter', DEMO_PASSWORD)).agent;
    const response = await waiter.post('/api/v1/auth/mfa/activate').send({ code: '123456' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MFA_NOT_ENROLLED');
  });

  it('disables only with the password and a valid code', async () => {
    const wrongPassword = await admin
      .post('/api/v1/auth/mfa/disable')
      .send({ password: 'not-my-password', code: totpCode(secret) });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');

    const missingCode = await admin.post('/api/v1/auth/mfa/disable').send({ password: ADMIN_PASSWORD });
    expect(missingCode.status).toBe(401);
    expect(missingCode.body.error.code).toBe('MFA_INVALID');

    const disabled = await admin
      .post('/api/v1/auth/mfa/disable')
      .send({ password: ADMIN_PASSWORD, code: totpCode(secret) });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);

    const passwordOnly = await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD);
    expect(passwordOnly.response.status).toBe(200);
    expect(passwordOnly.response.body.user.mfaEnabled).toBe(false);
  });
});
