import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Environment configuration.
 *
 * Nothing here has a production credential; values come from the process
 * environment (see .env.example) and are validated once at boot.
 */

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  /**
   * Interface the HTTP server binds to. `0.0.0.0` keeps the app reachable from
   * the local network (a phone opening the menu or the panel over Wi-Fi); set
   * `127.0.0.1` to serve this machine only.
   */
  host: string;
  apiPrefix: string;
  /**
   * The one folder that holds everything the installation must not lose:
   * the SQLite file and its WAL, backups and (for the print bridge) receipts.
   * On a server this must be an absolute path on persistent storage.
   */
  dataDirectory: string;
  databasePath: string;
  backupDirectory: string;
  sessionCookieName: string;
  sessionTtlHours: number;
  sessionCookieSecure: boolean;
  loginMaxAttempts: number;
  loginLockMinutes: number;
  isProduction: boolean;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`متغیر محیطی ${name} باید عدد باشد.`);
  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

/** Loads `.env` from the API package (or the process cwd) when present. */
export function loadEnvFile(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      process.loadEnvFile(candidate);
      return;
    } catch {
      // A malformed .env must not take the server down silently; boot proceeds
      // with the process environment and the failure is visible in the logs.
      console.warn(`[config] could not read ${candidate}`);
      return;
    }
  }
}

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];

  // A single root for runtime state. Defaults to the repository's `data/` in
  // development; production sets CAFEFLOW_DATA_DIR to a mounted volume so a
  // container restart, rebuild or deploy never touches the database.
  const dataDirectory = resolve(process.env.CAFEFLOW_DATA_DIR ?? '../../data');
  const databasePath = process.env.DATABASE_PATH
    ? resolve(process.cwd(), process.env.DATABASE_PATH)
    : join(dataDirectory, 'cafeflow.db');
  const backupDirectory = resolve(process.env.CAFEFLOW_BACKUP_DIR ?? join(dataDirectory, 'backups'));

  // A port of 0 means "pick a random free port" to Node, which would make the
  // service unreachable for the browser and the reverse proxy. Some shells
  // export PORT=0, so anything outside the valid range falls back to 3000.
  const configuredPort = readNumber('PORT', 3000);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535 ? configuredPort : 3000;

  return {
    nodeEnv,
    port,
    host: process.env.HOST?.trim() || '0.0.0.0',
    apiPrefix: process.env.API_PREFIX ?? '/api/v1',
    dataDirectory,
    databasePath,
    backupDirectory,
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'cafe_session',
    sessionTtlHours: readNumber('SESSION_TTL_HOURS', 168),
    sessionCookieSecure: readBoolean('SESSION_COOKIE_SECURE', nodeEnv === 'production'),
    loginMaxAttempts: readNumber('LOGIN_MAX_ATTEMPTS', 5),
    loginLockMinutes: readNumber('LOGIN_LOCK_MINUTES', 15),
    isProduction: nodeEnv === 'production',
  };
}
