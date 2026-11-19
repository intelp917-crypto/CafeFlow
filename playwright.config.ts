import { defineConfig } from '@playwright/test';

/**
 * End-to-end smoke suite.
 *
 * It drives the real API + real SPA against the local SQLite database using the
 * installed Microsoft Edge (channel `msedge`, no browser download needed).
 * Writes are limited to login sessions: the specs assert that the shell, menu
 * and staff pages render from live data without polluting business tables.
 */
export default defineConfig({
  testDir: './apps/web/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'msedge',
    locale: 'fa-IR',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://127.0.0.1:3000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -w @cafeflow/web',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
