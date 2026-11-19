#!/usr/bin/env node
/**
 * Consistent SQLite backup without stopping the API.
 *
 * `VACUUM INTO` reads the live database through SQLite itself (WAL included),
 * so the copy is a single clean file rather than three files captured at
 * different moments. Old backups are rotated by count.
 *
 *   npm run backup
 *   DATABASE_PATH=... BACKUP_DIR=... BACKUP_KEEP=30 npm run backup
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const sourcePath = resolve(process.env.DATABASE_PATH ?? 'data/cafeflow.db');
const outputDirectory = resolve(process.env.BACKUP_DIR ?? 'backups');
const keep = Math.max(Number(process.env.BACKUP_KEEP ?? 14), 1);

if (!existsSync(sourcePath)) {
  console.error(`پایگاه داده یافت نشد: ${sourcePath}`);
  process.exit(1);
}

mkdirSync(outputDirectory, { recursive: true });

const stamp = new Date().toISOString().replace(/\.\d+Z$/, '').replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
const target = join(outputDirectory, `cafeflow-${stamp}.db`);

const database = new Database(sourcePath, { readonly: true, fileMustExist: true });
try {
  database.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  database.close();
}

const copy = new Database(target, { readonly: true, fileMustExist: true });
try {
  const integrity = copy.pragma('integrity_check', { simple: true });
  const orders = copy.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  const payments = copy.prepare('SELECT COUNT(*) AS n FROM payments').get().n;
  console.log(`پشتیبان ساخته شد: ${target}`);
  console.log(`integrity_check=${integrity} — سفارش‌ها=${orders} — پرداخت‌ها=${payments}`);
  if (integrity !== 'ok') process.exitCode = 1;
} finally {
  copy.close();
}

const backups = readdirSync(outputDirectory)
  .filter((file) => /^cafeflow-.*\.db$/.test(file))
  .sort();

while (backups.length > keep) {
  const oldest = backups.shift();
  if (!oldest) break;
  const path = join(outputDirectory, oldest);
  unlinkSync(path);
  console.log(`پشتیبان قدیمی حذف شد: ${path}`);
}

console.log(`تعداد پشتیبان‌های نگه‌داری‌شده: ${Math.min(backups.length, keep)} (سقف ${keep})`);
