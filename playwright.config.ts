import { defineConfig } from '@playwright/test';

/**
 * End-to-end suite.
 *
 * It drives the real API + real SPA with the installed Microsoft Edge
 * (channel `msedge`, no browser download needed). The suite is fully isolated:
 *
 *   - the API runs on port 3100 with `data/e2e/cafeflow-e2e.db`, recreated from
 *     migrations + seed on every run (see `scripts/e2e-api.mjs`),
 *   - the SPA runs on port 5174 and proxies `/api` to that API,
 *   - `reuseExistingServer` is off, so a stray dev server is never reused and
 *     the developer's database is never written to.
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? 3100);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174);
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

// Exported for the specs; workers inherit the config process environment.
process.env.E2E_API_ORIGIN ??= API_ORIGIN;

export default defineConfig({
  testDir: './apps/web/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: WEB_ORIGIN,
    channel: 'msedge',
    locale: 'fa-IR',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/e2e-api.mjs',
      url: `${API_ORIGIN}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: `npm run dev -w @cafeflow/web -- --port ${WEB_PORT} --strictPort`,
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 90_000,
      env: { CAFEFLOW_API_TARGET: API_ORIGIN },
    },
  ],
});
