import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';

/**
 * The table-game path, in two browsers at once:
 *
 *   two guests scan the same table sticker on their own phones → both land in one
 *   waiting room → both get ready → the host starts → a move on one phone shows
 *   up on the other.
 *
 * Separate browser contexts mean separate `cafe_device` cookies, which is exactly
 * how two real phones differ. The suite owns a disposable database, so the QR
 * token is read from it instead of typed in.
 */
const DATABASE_PATH =
  process.env.E2E_DATABASE_PATH ?? path.join(process.cwd(), 'data', 'e2e', 'cafeflow-e2e.db');

function tableQrToken(code: string): string {
  const db = new Database(DATABASE_PATH, { readonly: true, fileMustExist: true });
  try {
    return (db.prepare('SELECT qr_token AS token FROM dining_tables WHERE code = ?').get(code) as { token: string }).token;
  } finally {
    db.close();
  }
}

test('two phones at one table share a room and play a game', async ({ browser }) => {
  const qrToken = tableQrToken('T2');
  const phoneA = await browser.newContext();
  const phoneB = await browser.newContext();

  try {
    const guestA = await phoneA.newPage();
    const guestB = await phoneB.newPage();

    // --- guest A picks a game from the sticker --------------------------------
    await guestA.goto(`/table/${qrToken}/games`);
    await guestA.getByLabel('نام شما روی میز').fill('سارا');
    // Exact heading: other games mention «دوز» in their description.
    await guestA
      .locator('article')
      .filter({ has: guestA.getByRole('heading', { name: 'دوز', exact: true }) })
      .getByRole('button', { name: 'بازی با این میز' })
      .click();
    await expect(guestA.getByRole('heading', { name: 'دوز' })).toBeVisible();
    await expect(guestA.getByText('شما', { exact: true })).toBeVisible();

    // --- guest B joins the same room with the same sticker -------------------
    await guestB.goto(`/table/${qrToken}/games`);
    await guestB.getByLabel('نام شما روی میز').fill('رضا');
    await guestB
      .locator('article')
      .filter({ has: guestB.getByRole('heading', { name: 'دوز', exact: true }) })
      .getByRole('button', { name: 'بازی با این میز' })
      .click();

    await expect(guestB.getByText('سارا')).toBeVisible();
    await expect(guestA.getByText('رضا')).toBeVisible();

    // --- both ready, the host starts -----------------------------------------
    await guestA.getByRole('button', { name: 'آماده‌ام' }).click();
    await guestB.getByRole('button', { name: 'آماده‌ام' }).click();
    await guestA.getByRole('button', { name: 'شروع بازی' }).click();

    await expect(guestA.getByText('نوبت شماست')).toBeVisible();
    await expect(guestB.getByText('نوبت سارا')).toBeVisible();

    // --- a move crosses the table -------------------------------------------
    await guestA.getByLabel('خانهٔ ۱').click();
    await expect(guestB.getByLabel('خانهٔ ۱، ضربدر')).toBeVisible();
    await expect(guestB.getByText('نوبت شماست')).toBeVisible();
    await expect(guestA.getByText('نوبت رضا')).toBeVisible();
  } finally {
    await phoneA.close();
    await phoneB.close();
  }
});
