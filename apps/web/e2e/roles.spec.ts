import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, login } from './helpers';

/**
 * Role-aware navigation and direct API denial. The API's own RBAC suite is
 * deeper; this proves the built SPA hides the right doors and the server does
 * not rely on that hiding.
 */
const ROLE_CASES = [
  {
    username: 'cashier',
    visible: ['صندوق'],
    hidden: ['کارکنان و نقش‌ها', 'صف آماده‌سازی'],
  },
  {
    username: 'waiter',
    visible: ['میزها', 'درخواست‌ها'],
    hidden: ['کارکنان و نقش‌ها', 'صندوق'],
  },
  {
    username: 'barista',
    visible: ['صف آماده‌سازی'],
    hidden: ['کارکنان و نقش‌ها', 'صندوق'],
  },
  {
    username: 'kitchen',
    visible: ['صف آماده‌سازی'],
    hidden: ['کارکنان و نقش‌ها', 'صندوق'],
  },
];

for (const role of ROLE_CASES) {
  test(`${role.username} sees only the navigation their role allows`, async ({ page }) => {
    await login(page, role.username, DEMO_PASSWORD);
    const nav = page.getByRole('navigation', { name: 'ناوبری اصلی' });

    for (const label of role.visible) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    for (const label of role.hidden) {
      await expect(nav.getByRole('link', { name: label })).toHaveCount(0);
    }
  });
}

test('cashier is denied staff management by the API, not just the menu', async ({ request }) => {
  const loginResponse = await request.post('/api/v1/auth/login', {
    data: { username: 'cashier', password: DEMO_PASSWORD },
  });
  expect(loginResponse.ok()).toBeTruthy();

  const users = await request.get('/api/v1/users');
  expect(users.status()).toBe(403);
});
