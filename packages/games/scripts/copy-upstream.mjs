#!/usr/bin/env node
/**
 * Copies the vendored GameNest rule modules next to the compiled adapter.
 *
 * `tsc` only emits `src/`, but the rules are plain CommonJS files that are
 * `require`d at runtime — both by `tsx` (from `src/`) and by `node dist/`
 * (from `dist/`). Without this copy the production build would boot with an
 * empty registry.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(packageRoot, 'upstream');
const target = resolve(packageRoot, 'dist/upstream');

if (!existsSync(source)) {
  console.error(`[games] upstream rules are missing: ${source}`);
  process.exit(1);
}

mkdirSync(resolve(packageRoot, 'dist'), { recursive: true });
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log('[games] copied upstream rule modules into dist/upstream');
