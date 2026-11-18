import type { ModuleKey } from '@cafeflow/shared';

/**
 * Injection tokens.
 *
 * Constructors use explicit `@Inject(TOKEN)` instead of emitted decorator
 * metadata, so the API runs identically under tsc, tsx and the test runner.
 */
export const DB_SERVICE = 'CAFEFLOW_DB_SERVICE';

export interface RequestAuth {
  userId: string;
  username: string;
  fullName: string;
  sessionId: string;
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
  enabledModules: ModuleKey[];
}

export interface RequestWithAuth {
  auth?: RequestAuth;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

export function hasPermission(auth: RequestAuth | undefined, permission: string): boolean {
  return Boolean(auth?.permissions.includes(permission));
}
