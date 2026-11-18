import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import { loadConfig } from '../config/env';
import { ensureDatabaseDirectory, runMigrations } from './migrate';

/**
 * Thin data-access layer over SQLite.
 *
 * Repositories/services use parameterised statements only — no SQL string
 * interpolation — which is what keeps the app safe from SQL injection. All
 * multi-step business writes run through `transaction`.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly db: Database.Database;
  readonly filePath: string;

  constructor() {
    const config = loadConfig();
    this.filePath = config.databasePath;
    ensureDatabaseDirectory(this.filePath);

    this.db = new Database(this.filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = NORMAL');

    const applied = runMigrations(this.db);
    if (applied.length > 0) {
      this.logger.log(`اعمال ${applied.length} مهاجرت پایگاه داده: ${applied.join(', ')}`);
    }
  }

  /** Returns all rows of a parameterised query. */
  all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  /** Returns the first row, or undefined. */
  get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  /** Executes a write statement and returns the change summary. */
  run(sql: string, params: unknown[] = []): Database.RunResult {
    return this.db.prepare(sql).run(...(params as never[]));
  }

  /** Runs a callback atomically; nested calls reuse the same transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  count(sql: string, params: unknown[] = []): number {
    const row = this.get<{ n: number }>(sql, params);
    return row?.n ?? 0;
  }

  /** Health probe used by GET /health. */
  ping(): boolean {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  onModuleDestroy(): void {
    try {
      this.db.close();
    } catch (error) {
      this.logger.warn(`بستن اتصال پایگاه داده با خطا مواجه شد: ${(error as Error).message}`);
    }
  }
}
