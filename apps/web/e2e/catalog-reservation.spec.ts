import { expect, test } from '@playwright/test';
import { enableOptionalModules, login } from './helpers';

/**
 * Real mutations through the staff UI: a menu category, an inventory
 * ingredient, and the reservation dialog. Optional modules are enabled only
 * in the disposable e2e database.
 */
test.beforeAll(() => {
  enableOptionalModules();
});

test('catalog creates a category that survives a reload', async ({ page }) => {
  await login(page);
  await page.goto('/admin/catalog');
  await expect(page.getByRole('heading', { name: 'منو و محصولات' })).toBeVisible();

  const name = `دسته تست ${Date.now()}`;
  await page.getByRole('button', { name: 'دستهٔ جدید' }).click();
  const dialog = page.getByRole('dialog', { name: 'دستهٔ جدید' });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('مثلاً: نوشیدنی گرم').fill(name);
  await dialog.getByRole('button', { name: 'ذخیره' }).click();

  await expect(page.getByText('انجام شد').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(name).first()).toBeVisible();
});

test('inventory creates an ingredient in the real module page', async ({ page }) => {
  await login(page);
  await page.goto('/admin/inventory');
  await expect(page.getByRole('heading', { name: 'انبار و مواد اولیه' })).toBeVisible();

  const name = `ماده تست ${Date.now()}`;
  await page.getByRole('button', { name: 'ماده اولیه جدید' }).click();
  const dialog = page.getByRole('dialog', { name: 'ماده اولیه جدید' });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('مثلاً دانه قهوه').fill(name);
  await dialog.getByRole('button', { name: 'ثبت' }).click();

  await expect(page.getByText('ماده اولیه ثبت شد.')).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();
});

test('reservation dialog opens with the server-backed form', async ({ page }) => {
  await login(page);
  await page.goto('/admin/reservations');
  await expect(page.getByRole('heading', { name: 'رزرو میز' })).toBeVisible();

  await page.getByRole('button', { name: 'رزرو جدید' }).click();
  const dialog = page.getByRole('dialog', { name: 'رزرو جدید' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder('مثلاً سارا محمدی')).toBeVisible();
  await expect(dialog.getByPlaceholder('09120000000')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'ثبت رزرو' })).toBeVisible();
  await dialog.getByRole('button', { name: 'انصراف' }).click();
  await expect(dialog).toBeHidden();
});
