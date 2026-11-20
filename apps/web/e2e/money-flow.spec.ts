import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Full money path, in the browser:
 *
 *   customer scans the table QR → sends an order → staff move it to «سرو شد»
 *   → cashier settles it in the cashier page → receipt is queued for printing
 *   → the table is closed and released.
 *
 * The suite owns a disposable database (`data/e2e/cafeflow-e2e.db`), so the
 * assertions can read the same rows the API just wrote without touching the
 * developer's working data.
 */
const API_ORIGIN = process.env.E2E_API_ORIGIN ?? 'http://127.0.0.1:3100';
const DEMO_PASSWORD = 'CafeFlow@1404';
const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? DEMO_PASSWORD;
const DATABASE_PATH =
  process.env.E2E_DATABASE_PATH ?? path.join(process.cwd(), 'data', 'e2e', 'cafeflow-e2e.db');

function readDatabase<T>(run: (db: Database.Database) => T): T {
  const db = new Database(DATABASE_PATH, { readonly: true, fileMustExist: true });
  try {
    return run(db);
  } finally {
    db.close();
  }
}

async function login(page: Page, username: string, password: string) {
  await page.goto('/staff/login');
  await page.getByLabel('نام کاربری').fill(username);
  await page.getByLabel('گذرواژه').fill(password);
  await page.getByRole('button', { name: 'ورود' }).click();
  await expect(page).toHaveURL(/\/admin/);
}

/** Staff sign-in for the API context that advances the order through the kitchen. */
async function signInForApi(request: APIRequestContext, username: string, password: string) {
  const response = await request.post(`${API_ORIGIN}/api/v1/auth/login`, { data: { username, password } });
  expect(response.ok(), `login as ${username}: ${await response.text()}`).toBeTruthy();
}

test('table order is settled at the cashier, queued for print, and the table is released', async ({
  page,
  request,
}) => {
  const qrToken = readDatabase(
    (db) => (db.prepare('SELECT qr_token AS token FROM dining_tables WHERE code = ?').get('T2') as { token: string }).token,
  );

  // --- 1. customer: scan the table QR and submit the order -----------------
  await page.goto(`/menu/${qrToken}`);
  await expect(page.getByRole('heading', { name: 'نوشیدنی گرم' }).first()).toBeVisible();

  await page
    .locator('article')
    .filter({ hasText: 'اسپرسو' })
    .first()
    .getByRole('button', { name: 'افزودن' })
    .click();
  await page.getByRole('button', { name: /مشاهده سبد/ }).click();
  await page.getByRole('button', { name: 'ثبت سفارش' }).click();

  await expect(page).toHaveURL(/\/order\//);
  const code = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() ?? '');
  expect(code).toMatch(/^CF-/);

  const order = readDatabase(
    (db) =>
      db.prepare('SELECT id, status, total FROM orders WHERE code = ?').get(code) as
        | { id: string; status: string; total: number }
        | undefined,
  );
  expect(order, `order ${code} must exist in the database`).toBeTruthy();
  expect(order!.status).toBe('submitted');
  expect(order!.total).toBeGreaterThan(0);

  // --- 2. staff: advance the order to «سرو شد» ----------------------------
  await signInForApi(request, ADMIN_USERNAME, ADMIN_PASSWORD);
  for (const to of ['confirmed', 'preparing', 'ready', 'served']) {
    const response = await request.post(`${API_ORIGIN}/api/v1/orders/${order!.id}/transition`, { data: { to } });
    expect(response.ok(), `transition to ${to}: ${await response.text()}`).toBeTruthy();
  }

  // --- 3. cashier: settle the served order -------------------------------
  await login(page, 'cashier', DEMO_PASSWORD);
  await page.getByRole('link', { name: 'صندوق' }).click();
  await expect(page).toHaveURL(/\/admin\/cashier/);

  const payableRow = page.getByRole('row').filter({ hasText: code });
  await expect(payableRow).toBeVisible();
  await payableRow.getByRole('button', { name: 'ثبت پرداخت' }).click();

  const settlement = page.getByRole('dialog');
  await expect(settlement).toBeVisible();
  await expect(settlement).toContainText(code);
  // The amount field is prefilled with the outstanding balance, so submitting
  // without editing pays the order in full.
  await settlement.getByRole('button', { name: 'ثبت پرداخت' }).click();
  await expect(page.getByText(`سفارش ${code} کامل تسویه شد.`)).toBeVisible();
  await settlement.getByRole('button', { name: 'بستن' }).click();
  await expect(settlement).toBeHidden();

  // --- 4. cashier: queue the receipt for the printer -----------------------
  const paidRow = page.getByRole('row').filter({ hasText: code });
  await paidRow.getByRole('button', { name: 'رسید' }).click();
  await expect(page.getByText(new RegExp(`رسید سفارش ${code} (در صف چاپ قرار گرفت|قبلاً در صف چاپ است)`))).toBeVisible();

  const settlementState = readDatabase((db) => {
    const paid = db.prepare('SELECT status, total FROM orders WHERE id = ?').get(order!.id) as {
      status: string;
      total: number;
    };
    const payments = db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE order_id = ? AND status = 'confirmed'")
      .get(order!.id) as { paid: number };
    const receipt = db
      .prepare("SELECT status FROM print_jobs WHERE order_id = ? AND kind = 'receipt'")
      .get(order!.id) as { status: string } | undefined;
    return { paid, payments, receipt };
  });

  expect(settlementState.paid.status).toBe('paid');
  expect(settlementState.payments.paid).toBe(settlementState.paid.total);
  expect(settlementState.receipt?.status).toBe('queued');

  // --- 5. manager: close the released table --------------------------------
  await page.context().clearCookies();
  await login(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  await page.getByRole('link', { name: 'میزها' }).click();
  await expect(page).toHaveURL(/\/admin\/tables/);

  // T2 is the only table with a live session and nothing left to settle, so it
  // is the only card that offers the close action.
  const closeButton = page.getByRole('button', { name: 'بستن میز' });
  await expect(closeButton).toHaveCount(1);
  await closeButton.click();
  await expect(page.getByRole('button', { name: 'بستن میز' })).toHaveCount(0);

  const sessionOpen = readDatabase(
    (db) =>
      db
        .prepare("SELECT COUNT(*) AS n FROM table_sessions s JOIN dining_tables t ON t.id = s.table_id WHERE t.code = 'T2' AND s.status = 'open'")
        .get() as { n: number },
  );
  expect(sessionOpen.n).toBe(0);
});
