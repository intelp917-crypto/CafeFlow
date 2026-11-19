#!/usr/bin/env node
/**
 * Verifies the production PWA shell for real:
 *   1. the service worker registers and activates,
 *   2. with the network emulated as offline, a reload is answered by the
 *      service worker with the Persian offline page,
 *   3. the manifest is linked and parsed by the browser.
 *
 * Requires the production build to be served, e.g.:
 *   npm run build -w @cafeflow/web
 *   npx vite preview --port 4173 --strictPort      (cwd: apps/web)
 *   npm run verify:pwa
 */
import { chromium } from '@playwright/test';

const baseUrl = process.env.PWA_BASE_URL ?? 'http://localhost:4173';
const browser = await chromium.launch({ channel: process.env.PWA_CHANNEL ?? 'msedge' });
const context = await browser.newContext({ baseURL: baseUrl });
const page = await context.newPage();

let failed = false;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
};

try {
  await page.goto(`${baseUrl}/`, { waitUntil: 'load' });

  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  check(Boolean(manifestHref), 'manifest linked', manifestHref ?? 'missing');
  const manifest = await page.evaluate(async (href) => {
    const response = await fetch(href);
    return response.ok ? response.json() : null;
  }, manifestHref ?? '/manifest.webmanifest');
  check(Boolean(manifest?.short_name), 'manifest parses', manifest?.short_name ?? 'unreadable');

  await page.waitForFunction(
    async () => {
      if (!('serviceWorker' in navigator)) return false;
      const registration = await navigator.serviceWorker.getRegistration();
      return Boolean(registration?.active);
    },
    null,
    { timeout: 20_000 },
  );

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope ?? null);
  check(Boolean(scope), 'service worker active', scope ?? 'no scope');

  // The worker takes control of this client (clients.claim), then must answer a
  // navigation while the network is down with the offline page.
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 20_000 });
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  const body = (await page.textContent('body')) ?? '';
  check(body.includes('اتصال اینترنت قطع است'), 'offline navigation served by the worker');
  await context.setOffline(false);
} catch (error) {
  failed = true;
  console.error('✗ PWA verification failed:', error instanceof Error ? error.message : error);
} finally {
  await context.close();
  await browser.close();
}

process.exit(failed ? 1 : 0);
