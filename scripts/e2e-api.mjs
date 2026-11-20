#!/usr/bin/env node
/**
 * Boots the compiled API for Playwright against a disposable database.
 *
 * The end-to-end suite must never touch `data/cafeflow.db` (the developer's
 * working database) and must never depend on whatever server happens to be
 * running on the default port. This launcher therefore:
 *
 *   1. deletes `data/e2e/cafeflow-e2e.db` (plus WAL/SHM side files),
 *   2. runs `dist/db/cli.js setup` so every migration and the seed data exist,
 *   3. starts `dist/main.js` on its own port with an absolute DATABASE_PATH.
 *
 * Playwright owns this process through its `webServer` block, so stopping the
 * run stops the server too.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'apps', 'api');
const databasePath = path.join(root, 'data', 'e2e', 'cafeflow-e2e.db');
const port = process.env.E2E_API_PORT ?? '3100';

mkdirSync(path.dirname(databasePath), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${databasePath}${suffix}`, { force: true });
}

// Explicit absolute paths: the API resolves DATABASE_PATH against its cwd, and
// the E2E runner starts it from the repository root.
process.env.DATABASE_PATH = databasePath;
process.env.NODE_ENV = 'test';
process.env.PORT = port;
process.env.SESSION_COOKIE_SECURE = 'false';
process.env.SEED_ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
process.env.SEED_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'CafeFlow@1404';
process.env.SEED_DEMO_STAFF = 'true';

const setup = spawnSync(process.execPath, [path.join(apiDir, 'dist', 'db', 'cli.js'), 'setup'], {
  cwd: apiDir,
  env: process.env,
  stdio: 'inherit',
});

if (setup.status !== 0) {
  console.error('[e2e] preparing the disposable database failed; aborting the API start.');
  process.exit(setup.status ?? 1);
}

console.log(`[e2e] disposable database: ${databasePath}`);
console.log(`[e2e] API listening on http://127.0.0.1:${port}`);

await import(pathToFileURL(path.join(apiDir, 'dist', 'main.js')).href);
