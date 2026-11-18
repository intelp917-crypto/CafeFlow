import { Inject, Injectable } from '@nestjs/common';
import type { ModuleKey } from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

export interface UserRow {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  is_active: number;
  must_change_password: number;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  deleted_at: string | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
}

/**
 * Every session/auth SQL statement lives here so that the guards, the login
 * service and the tests all use the same access paths.
 */
@Injectable()
export class AuthRepository {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  findUserByUsername(username: string): UserRow | undefined {
    return this.database.get<UserRow>('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username]);
  }

  findUserById(id: string): UserRow | undefined {
    return this.database.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  }

  getRoles(userId: string): string[] {
    return this.database
      .all<{ key: string }>(
        `SELECT DISTINCT r.key
           FROM roles r
           JOIN user_roles ur ON ur.role_id = r.id
          WHERE ur.user_id = ?
          ORDER BY r.key`,
        [userId],
      )
      .map((row) => row.key);
  }

  getPermissions(userId: string): string[] {
    return this.database
      .all<{ key: string }>(
        `SELECT DISTINCT p.key
           FROM permissions p
           JOIN role_permissions rp ON rp.permission_id = p.id
           JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = ?
          ORDER BY p.key`,
        [userId],
      )
      .map((row) => row.key);
  }

  getEnabledModules(): ModuleKey[] {
    return this.database
      .all<{ key: string }>('SELECT key FROM module_settings WHERE is_enabled = 1 ORDER BY key')
      .map((row) => row.key as ModuleKey);
  }

  createSession(params: {
    id: string;
    userId: string;
    tokenHash: string;
    ip: string | null;
    userAgent: string | null;
    expiresAt: string;
  }): void {
    this.database.run(
      `INSERT INTO sessions (id, user_id, token_hash, ip, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [params.id, params.userId, params.tokenHash, params.ip, params.userAgent, params.expiresAt],
    );
  }

  findActiveSessionByTokenHash(tokenHash: string, nowIso: string): (SessionRow & UserRow) | undefined {
    return this.database.get<SessionRow & UserRow>(
      `SELECT s.id AS session_id, s.*, u.*
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > ?
          AND u.is_active = 1
          AND u.deleted_at IS NULL`,
      [tokenHash, nowIso],
    );
  }

  touchSession(sessionId: string, nowIso: string): void {
    this.database.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [nowIso, sessionId]);
  }

  revokeSession(sessionId: string, nowIso: string): void {
    this.database.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [nowIso, sessionId]);
  }

  revokeAllSessionsForUser(userId: string, nowIso: string, exceptSessionId?: string): void {
    if (exceptSessionId) {
      this.database.run(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
        [nowIso, userId, exceptSessionId],
      );
      return;
    }
    this.database.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [
      nowIso,
      userId,
    ]);
  }

  listSessionsForUser(userId: string): SessionRow[] {
    return this.database.all<SessionRow>(
      `SELECT id, user_id, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at
         FROM sessions
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
        ORDER BY last_seen_at DESC`,
      [userId, new Date().toISOString()],
    );
  }

  findSessionById(sessionId: string): SessionRow | undefined {
    return this.database.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  }

  registerFailedLogin(userId: string, maxAttempts: number, lockMinutes: number): void {
    const user = this.findUserById(userId);
    const attempts = (user?.failed_login_attempts ?? 0) + 1;
    const lockedUntil =
      attempts >= maxAttempts ? new Date(Date.now() + lockMinutes * 60_000).toISOString() : null;
    this.database.run(
      'UPDATE users SET failed_login_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?',
      [lockedUntil ? 0 : attempts, lockedUntil, new Date().toISOString(), userId],
    );
  }

  registerSuccessfulLogin(userId: string, nowIso: string): void {
    this.database.run(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
      [nowIso, nowIso, userId],
    );
  }

  updatePasswordHash(userId: string, passwordHash: string, nowIso: string): void {
    this.database.run(
      'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?',
      [passwordHash, nowIso, userId],
    );
  }
}
