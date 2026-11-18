import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Environment configuration.
 *
 * Nothing here has a production credential; values come from the process
 * environment (see .env.example) and are validated once at boot.
 */

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  apiPrefix: string;
  databasePath: string;
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
  const databasePath = resolve(process.cwd(), process.env.DATABASE_PATH ?? '../../data/cafeflow.db');

  // A port of 0 means "pick a random free port" to Node, which would make the
  // service unreachable for the browser and the reverse proxy. Some shells
  // export PORT=0, so anything outside the valid range falls back to 3000.
  const configuredPort = readNumber('PORT', 3000);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535 ? configuredPort : 3000;

  return {
    nodeEnv,
    port,
    apiPrefix: process.env.API_PREFIX ?? '/api/v1',
    databasePath,
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'cafe_session',
    sessionTtlHours: readNumber('SESSION_TTL_HOURS', 168),
    sessionCookieSecure: readBoolean('SESSION_COOKIE_SECURE', nodeEnv === 'production'),
    loginMaxAttempts: readNumber('LOGIN_MAX_ATTEMPTS', 5),
    loginLockMinutes: readNumber('LOGIN_LOCK_MINUTES', 15),
    isProduction: nodeEnv === 'production',
  };
}
