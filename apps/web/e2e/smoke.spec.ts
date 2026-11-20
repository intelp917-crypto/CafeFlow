import { expect, test, type Page } from '@playwright/test';

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'CafeFlow@1404';
// The suite runs its own API instance (see playwright.config.ts).
const API_ORIGIN = process.env.E2E_API_ORIGIN ?? 'http://127.0.0.1:3100';

async function loginAsAdmin(page: Page) {
  await page.goto('/staff/login');
  await page.getByLabel('نام کاربری').fill(ADMIN_USERNAME);
  await page.getByLabel('گذرواژه').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'ورود' }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test('customer menu renders products from the live API', async ({ page }) => {
  await page.goto('/menu');

  await expect(page.getByRole('heading', { name: 'نوشیدنی گرم' }).first()).toBeVisible();
  await expect(page.getByText('اسپرسو').first()).toBeVisible();
  // Prices come from the database, so the rial suffix proves the real payload.
  await expect(page.getByText(/ریال/).first()).toBeVisible();
  // Without a table QR the cart is visible but adding is disabled.
  await expect(page.getByRole('button', { name: /سبد/ }).first()).toBeVisible();
});

test('staff can sign in, see the dashboard and open reports', async ({ page }) => {
  await loginAsAdmin(page);

  await expect(page.getByRole('heading', { name: 'داشبورد عملیات' })).toBeVisible();
  await page.getByRole('link', { name: 'گزارش‌ها' }).click();
  await expect(page).toHaveURL(/\/admin\/reports/);
  await expect(page.getByRole('heading', { name: 'گزارش‌ها' })).toBeVisible();
  await expect(page.getByText('به تفکیک روش پرداخت')).toBeVisible();
});

test('reservations page is reachable for a manager role account', async ({ page }) => {
  await loginAsAdmin(page);

  await page.getByRole('link', { name: 'رزروها' }).click();
  await expect(page).toHaveURL(/\/admin\/reservations/);
  await expect(page.getByRole('heading', { name: 'رزرو میز' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'رزرو جدید' })).toBeVisible();
});

test('security page exposes MFA status', async ({ page }) => {
  await loginAsAdmin(page);

  await page.getByRole('button', { name: 'امنیت' }).click();
  await expect(page).toHaveURL(/\/admin\/security/);
  await expect(page.getByRole('heading', { name: 'امنیت حساب' })).toBeVisible();
  await expect(page.getByText(/تأیید دو مرحله‌ای/).first()).toBeVisible();
});

test('PWA shell and hardened API headers are served', async ({ request }) => {
  // The installed-app manifest is generated from the café settings, so the
  // name follows whatever the operator saved instead of a build-time constant.
  const manifest = await request.get('/api/v1/public/branding/manifest');
  expect(manifest.status()).toBe(200);
  const branding = (await manifest.json()) as { name: string; short_name: string };
  expect(branding.short_name).toBeTruthy();
  expect(branding.name).toContain(branding.short_name);

  const worker = await request.get('/sw.js');
  expect(worker.status()).toBe(200);
  expect(await worker.text()).toContain('cafeflow-v1');

  const offline = await request.get('/offline.html');
  expect(offline.status()).toBe(200);

  const health = await request.get(`${API_ORIGIN}/api/v1/health`);
  expect(health.status()).toBe(200);
  const headers = health.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-request-id']).toBeTruthy();
});
