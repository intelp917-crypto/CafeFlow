import { expect, test } from '@playwright/test';
import { enableOptionalModules, login, tableQrToken } from './helpers';

/**
 * Every page in App.tsx gets one automated visit. This is deliberately a
 * route smoke, not a visual review: it proves the SPA mounts, the protected
 * shell does not bounce back to login, and the page does not throw.
 */
const ADMIN_ROUTES = [
  ['/admin', 'داشبورد عملیات'],
  ['/admin/orders', 'سفارش‌ها'],
  ['/admin/catalog', 'منو و محصولات'],
  ['/admin/cashier', 'صندوق'],
  ['/admin/prep', 'صف آماده‌سازی'],
  ['/admin/tables', 'میزها'],
  ['/admin/layout', 'طراحی سالن'],
  ['/admin/reservations', 'رزرو میز'],
  ['/admin/requests', 'درخواست‌های مشتری'],
  ['/admin/notifications', 'اعلان‌ها'],
  ['/admin/print', 'صف چاپ'],
  ['/admin/reports', 'گزارش‌ها'],
  ['/admin/inventory', 'انبار و مواد اولیه'],
  ['/admin/cash', 'صندوق و جلسات نقدی'],
  ['/admin/finance', 'مالی و سود و زیان'],
  ['/admin/employees', 'کارکنان، شیفت و عملکرد'],
  ['/admin/messages', 'مرکز پیام'],
  ['/admin/customers', 'باشگاه مشتریان'],
  ['/admin/modules', 'ماژول‌ها و ویژگی‌ها'],
  ['/admin/staff', 'کارکنان و نقش‌ها'],
  ['/admin/approvals', 'صف تأیید'],
  ['/admin/audit', 'گزارش رویدادها'],
  ['/admin/settings', 'تنظیمات و برند'],
  ['/admin/security', 'امنیت حساب'],
] as const;

test.beforeAll(() => {
  enableOptionalModules();
});

test('public routes render without an uncaught error', async ({ page }) => {
  const token = tableQrToken('T2');
  const routes = ['/intro', '/menu', `/menu/${token}`, `/table/${token}/games`, '/order/TEST-NOT-FOUND', '/staff/login', '/no-such-page'];

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator('main'), `${route} must render a main landmark`).toBeVisible();
  }

  // `/` hands a first visit to the intro scene once per session; mark it seen
  // and reload so the actual HomePage is exercised, not just the redirect.
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('cafeflow:intro-seen', '1'));
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: /سفارش آرام/ })).toBeVisible();
  await expect(page.locator('main')).toBeVisible();

  expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('every admin page mounts for an authorized administrator', async ({ page }) => {
  await login(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  for (const [route, title] of ADMIN_ROUTES) {
    await page.goto(route);
    await expect(page.locator('main'), `${route} must render`).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole('heading', { level: 1, name: title, exact: true }),
      `${route} must render its own page, not just the admin shell`,
    ).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).pathname, `${route} must not bounce to login`).not.toBe('/staff/login');
  }

  await page.goto('/staff/password');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'تغییر گذرواژه' })).toBeVisible();

  expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('key screens do not overflow a 360px phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await login(page);

  // Same one-time entrance redirect as above: make `/` mean HomePage here too.
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('cafeflow:intro-seen', '1'));

  const token = tableQrToken('T2');
  const routes = ['/', '/menu', `/table/${token}/games`, '/admin', '/admin/orders', '/admin/cashier', '/admin/tables', '/admin/catalog'];

  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    if (route === '/') {
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { name: /سفارش آرام/ })).toBeVisible();
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${route} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
  }
});
