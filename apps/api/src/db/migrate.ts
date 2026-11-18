import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Database } from 'better-sqlite3';

export const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

/**
 * Applies pending `*.sql` migrations in filename order, each inside its own
 * transaction, and records them in `schema_migrations`.
 */
export function runMigrations(db: Database, migrationsDir: string = MIGRATIONS_DIR): string[] {
  if (!existsSync(migrationsDir)) {
    throw new Error(`پوشه مهاجرت‌ها یافت نشد: ${migrationsDir}`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((row) => (row as { name: string }).name),
  );

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const newlyApplied: string[] = [];
  const record = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      record.run(file, new Date().toISOString());
    })();
    newlyApplied.push(file);
  }

  return newlyApplied;
}

/** Ensures the directory that will hold the SQLite file exists. */
export function ensureDatabaseDirectory(filePath: string): void {
  const directory = dirname(resolve(filePath));
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
}
