import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, type Page } from '@playwright/test';

export const DEMO_PASSWORD = 'CafeFlow@1404';
export const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? DEMO_PASSWORD;

export const DATABASE_PATH =
  process.env.E2E_DATABASE_PATH ?? path.join(process.cwd(), 'data', 'e2e', 'cafeflow-e2e.db');

export async function login(page: Page, username = ADMIN_USERNAME, password = ADMIN_PASSWORD) {
  await page.goto('/staff/login');
  await page.getByLabel('نام کاربری').fill(username);
  await page.getByLabel('گذرواژه').fill(password);
  await page.getByRole('button', { name: 'ورود' }).click();
  await expect(page).toHaveURL(/\/admin/);
}

/** The QR sticker token is data, not a build constant: read it from the disposable e2e DB. */
export function tableQrToken(code = 'T2'): string {
  const db = new Database(DATABASE_PATH, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare('SELECT qr_token AS token FROM dining_tables WHERE code = ?').get(code) as
      | { token: string }
      | undefined;
    if (!row) throw new Error(`table ${code} is missing from the e2e database`);
    return row.token;
  } finally {
    db.close();
  }
}

/**
 * Optional modules are off in a fresh seed. Turn them on in the disposable e2e
 * database so their real pages can be exercised; this never touches a café DB.
 */
export function enableOptionalModules(keys = ['reservations', 'inventory', 'finance', 'employees', 'notifications', 'crm']) {
  const db = new Database(DATABASE_PATH, { fileMustExist: true });
  try {
    const update = db.prepare('UPDATE module_settings SET is_enabled = 1, updated_at = ? WHERE key = ?');
    const now = new Date().toISOString();
    const run = db.transaction(() => {
      for (const key of keys) update.run(now, key);
    });
    run();
  } finally {
    db.close();
  }
}
