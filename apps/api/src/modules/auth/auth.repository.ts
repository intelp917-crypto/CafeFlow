import { randomUUID } from 'node:crypto';
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
  totp_secret: string | null;
  totp_enabled: number;
  totp_confirmed_at: string | null;
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

  setTotpSecret(userId: string, secret: string): void {
    this.database.run(
      'UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_confirmed_at = NULL, updated_at = ? WHERE id = ?',
      [secret, new Date().toISOString(), userId],
    );
  }

  activateTotp(userId: string, confirmedAt: string): void {
    this.database.run(
      'UPDATE users SET totp_enabled = 1, totp_confirmed_at = ?, updated_at = ? WHERE id = ?',
      [confirmedAt, confirmedAt, userId],
    );
  }

  disableTotp(userId: string): void {
    this.database.run(
      'UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_confirmed_at = NULL, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), userId],
    );
    this.database.run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
  }

  replaceRecoveryCodes(userId: string, hashes: string[]): void {
    this.database.transaction(() => {
      this.database.run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
      for (const hash of hashes) {
        this.database.run('INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)', [
          randomUUID(),
          userId,
          hash,
        ]);
      }
    });
  }

  /** Consumes an unused recovery code; false when it is unknown or already used. */
  useRecoveryCode(userId: string, hash: string, nowIso: string): boolean {
    const row = this.database.get<{ id: string }>(
      'SELECT id FROM mfa_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
      [userId, hash],
    );
    if (!row) return false;
    this.database.run('UPDATE mfa_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL', [nowIso, row.id]);
    return true;
  }

  countUnusedRecoveryCodes(userId: string): number {
    return this.database.count(
      'SELECT COUNT(*) AS n FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL',
      [userId],
    );
  }

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
