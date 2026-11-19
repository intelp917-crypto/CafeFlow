import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { MODULES, type ModuleStatusDto } from '@cafeflow/shared';
import { hashPassword, verifyPassword } from '../../common/password';
import { AppError, badRequest, forbidden, unauthorized } from '../../common/errors';
import { generateTotpSecret, totpUri, verifyTotp } from '../../common/totp';

const RECOVERY_CODE_COUNT = 10;

function normalizeRecoveryCode(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function hashRecoveryCode(value: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(value)).digest('hex');
}

/** One-time codes are shown as `XXXX-XXXX` but stored only as SHA-256 hashes. */
function createRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const plain = new Set<string>();
  while (plain.size < RECOVERY_CODE_COUNT) {
    const raw = generateTotpSecret(5);
    plain.add(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  const codes = [...plain];
  return { plain: codes, hashes: codes.map(hashRecoveryCode) };
}
import { loadConfig } from '../../config/env';
import { AuditService } from '../audit/audit.service';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';
import { AuthRepository, type UserRow } from './auth.repository';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  token: string;
  expiresInSeconds: number;
  user: {
    id: string;
    username: string;
    fullName: string;
    roles: string[];
    permissions: string[];
    mustChangePassword: boolean;
  };
  modules: string[];
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly config = loadConfig();

  constructor(
    @Inject(AuthRepository) private readonly repository: AuthRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DB_SERVICE) private readonly database: DatabaseService,
  ) {}

  login(username: string, password: string, meta: RequestMeta, code?: string): LoginResult {
    const normalizedUsername = username.trim();
    const user = this.repository.findUserByUsername(normalizedUsername);

    if (!user || user.deleted_at) {
      this.audit.record({
        action: 'auth.login_failed',
        actorUsername: normalizedUsername,
        entityType: 'user',
        entityId: null,
        metadata: { reason: 'unknown_user' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw unauthorized('نام کاربری یا گذرواژه نادرست است.', 'INVALID_CREDENTIALS');
    }

    if (user.is_active !== 1) {
      throw forbidden('حساب کاربری شما غیرفعال شده است. با مدیر سیستم تماس بگیرید.', 'ACCOUNT_DISABLED');
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      throw new AppError(
        'ACCOUNT_LOCKED',
        429,
        'حساب شما به دلیل تلاش‌های ناموفق متعدد موقتاً قفل شده است. چند دقیقه دیگر دوباره تلاش کنید.',
      );
    }

    if (!verifyPassword(password, user.password_hash)) {
      this.repository.registerFailedLogin(user.id, this.config.loginMaxAttempts, this.config.loginLockMinutes);
      this.audit.record({
        actorUserId: user.id,
        actorUsername: user.username,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        metadata: { reason: 'bad_password' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw unauthorized('نام کاربری یا گذرواژه نادرست است.', 'INVALID_CREDENTIALS');
    }

    if (user.totp_enabled === 1 && user.totp_secret) {
      if (!code) {
        throw new AppError('MFA_REQUIRED', 401, 'این حساب تأیید دو مرحله‌ای دارد؛ کد شش‌رقمی را وارد کنید.');
      }

      const submitted = code.trim();
      const isTotpCode = /^\d{6}$/.test(submitted);
      const valid = isTotpCode
        ? verifyTotp(user.totp_secret, submitted)
        : this.repository.useRecoveryCode(user.id, hashRecoveryCode(submitted), new Date().toISOString());

      if (!valid) {
        this.audit.record({
          actorUserId: user.id,
          actorUsername: user.username,
          action: 'auth.mfa_failed',
          entityType: 'user',
          entityId: user.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        throw unauthorized('کد تأیید دو مرحله‌ای نادرست یا منقضی است.', 'MFA_INVALID');
      }

      if (!isTotpCode) {
        this.audit.record({
          actorUserId: user.id,
          actorUsername: user.username,
          action: 'auth.mfa_recovery_used',
          entityType: 'user',
          entityId: user.id,
          metadata: { remaining: this.repository.countUnusedRecoveryCodes(user.id) },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
    }

    const nowIso = new Date().toISOString();
    this.repository.registerSuccessfulLogin(user.id, nowIso);

    const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 3_600_000).toISOString();
    const sessionId = randomUUID();

    this.repository.createSession({
      id: sessionId,
      userId: user.id,
      tokenHash: hashToken(token),
      ip: meta.ip,
      userAgent: meta.userAgent,
      expiresAt,
    });

    this.audit.record({
      actorUserId: user.id,
      actorUsername: user.username,
      action: 'auth.login_success',
      entityType: 'session',
      entityId: sessionId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      token,
      expiresInSeconds: this.config.sessionTtlHours * 3600,
      user: this.toUserDto(user),
      modules: this.repository.getEnabledModules(),
    };
  }

  logout(sessionId: string, user: UserRow | { id: string; username: string }, meta: RequestMeta): void {
    this.repository.revokeSession(sessionId, new Date().toISOString());
    this.audit.record({
      actorUserId: user.id,
      actorUsername: user.username,
      action: 'auth.logout',
      entityType: 'session',
      entityId: sessionId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  me(userId: string) {
    const user = this.repository.findUserById(userId);
    if (!user || user.deleted_at || user.is_active !== 1) throw unauthorized();

    return {
      user: this.toUserDto(user),
      modules: this.repository.getEnabledModules(),
      moduleCatalog: this.moduleCatalog(),
    };
  }

  listSessions(userId: string, currentSessionId: string) {
    return this.repository.listSessionsForUser(userId).map((session) => ({
      id: session.id,
      ip: session.ip,
      userAgent: session.user_agent,
      createdAt: session.created_at,
      lastSeenAt: session.last_seen_at,
      expiresAt: session.expires_at,
      current: session.id === currentSessionId,
    }));
  }

  revokeSession(actor: { userId: string; sessionId: string; permissions: string[] }, targetId: string, meta: RequestMeta): void {
    const target = this.repository.findSessionById(targetId);
    if (!target) throw new AppError('NOT_FOUND', 404, 'نشست مورد نظر یافت نشد.');

    const isOwn = target.user_id === actor.userId;
    const canManageOthers = actor.permissions.includes('sessions.manage');
    if (!isOwn && !canManageOthers) {
      throw forbidden('اجازه بستن نشست سایر کاربران را ندارید.');
    }

    this.repository.revokeSession(targetId, new Date().toISOString());
    this.audit.record({
      actorUserId: actor.userId,
      action: 'auth.session_revoked',
      entityType: 'session',
      entityId: targetId,
      metadata: { ownerUserId: target.user_id, self: isOwn },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  changePassword(
    actor: { userId: string; sessionId: string; username: string },
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): void {
    const user = this.repository.findUserById(actor.userId);
    if (!user) throw unauthorized();

    if (!verifyPassword(currentPassword, user.password_hash)) {
      throw new AppError('INVALID_CURRENT_PASSWORD', 400, 'گذرواژه فعلی نادرست است.');
    }
    if (verifyPassword(newPassword, user.password_hash)) {
      throw new AppError('PASSWORD_REUSED', 400, 'گذرواژه جدید نباید با گذرواژه فعلی یکسان باشد.');
    }

    const nowIso = new Date().toISOString();
    this.repository.updatePasswordHash(actor.userId, hashPassword(newPassword), nowIso);
    // Any other active session must be re-authenticated after a password change.
    this.repository.revokeAllSessionsForUser(actor.userId, nowIso, actor.sessionId);

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'auth.password_changed',
      entityType: 'user',
      entityId: actor.userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /* --------------------------------- MFA --------------------------------- */

  mfaStatus(userId: string): { enabled: boolean; confirmedAt: string | null } {
    const user = this.repository.findUserById(userId);
    if (!user || user.deleted_at) throw unauthorized();
    return { enabled: user.totp_enabled === 1, confirmedAt: user.totp_confirmed_at ?? null };
  }

  /**
   * Starts enrollment: a fresh secret is written but login keeps working with
   * the password alone until a valid code proves the authenticator works. A
   * second call simply replaces an unconfirmed secret.
   */
  enrollMfa(userId: string, meta: RequestMeta): { secret: string; otpauthUrl: string } {
    const user = this.repository.findUserById(userId);
    if (!user || user.deleted_at) throw unauthorized();
    if (user.totp_enabled === 1) {
      throw new AppError('MFA_ALREADY_ENABLED', 409, 'تأیید دو مرحله‌ای قبلاً برای این حساب فعال شده است.');
    }

    const secret = generateTotpSecret();
    this.repository.setTotpSecret(user.id, secret);

    this.audit.record({
      actorUserId: user.id,
      actorUsername: user.username,
      action: 'auth.mfa_enrollment_started',
      entityType: 'user',
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { secret, otpauthUrl: totpUri(secret, user.username) };
  }

  activateMfa(
    userId: string,
    code: string,
    meta: RequestMeta,
  ): { enabled: true; confirmedAt: string; recoveryCodes: string[] } {
    const user = this.repository.findUserById(userId);
    if (!user || user.deleted_at) throw unauthorized();
    if (!user.totp_secret) {
      throw badRequest('ابتدا ثبت‌نام تأیید دو مرحله‌ای را شروع کنید.', 'MFA_NOT_ENROLLED');
    }
    if (!verifyTotp(user.totp_secret, code)) {
      throw unauthorized('کد تأیید نادرست یا منقضی است.', 'MFA_INVALID');
    }

    const confirmedAt = new Date().toISOString();
    const { plain, hashes } = createRecoveryCodes();

    this.database.transaction(() => {
      this.repository.activateTotp(user.id, confirmedAt);
      this.repository.replaceRecoveryCodes(user.id, hashes);
    });

    this.audit.record({
      actorUserId: user.id,
      actorUsername: user.username,
      action: 'auth.mfa_enabled',
      entityType: 'user',
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { enabled: true, confirmedAt, recoveryCodes: plain };
  }

  /** Issues a fresh set of codes; requires the password and a live TOTP code. */
  regenerateRecoveryCodes(
    userId: string,
    password: string,
    code: string,
    meta: RequestMeta,
  ): { recoveryCodes: string[] } {
    const user = this.repository.findUserById(userId);
    if (!user || user.deleted_at) throw unauthorized();
    if (user.totp_enabled !== 1 || !user.totp_secret) {
      throw badRequest('تأیید دو مرحله‌ای فعال نیست.', 'MFA_NOT_ENABLED');
    }
    if (!verifyPassword(password, user.password_hash)) {
      throw unauthorized('گذرواژه نادرست است.', 'INVALID_CREDENTIALS');
    }
    if (!verifyTotp(user.totp_secret, code)) {
      throw unauthorized('کد تأیید نادرست یا منقضی است.', 'MFA_INVALID');
    }

    const { plain, hashes } = createRecoveryCodes();
    this.repository.replaceRecoveryCodes(user.id, hashes);

    this.audit.record({
      actorUserId: user.id,
      actorUsername: user.username,
      action: 'auth.mfa_recovery_regenerated',
      entityType: 'user',
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { recoveryCodes: plain };
  }

  /** Turning MFA off needs the password *and* a live code while it is active. */
  disableMfa(
    userId: string,
    password: string,
    code: string | undefined,
    meta: RequestMeta,
  ): { enabled: false } {
    const user = this.repository.findUserById(userId);
    if (!user || user.deleted_at) throw unauthorized();

    if (!verifyPassword(password, user.password_hash)) {
      throw unauthorized('گذرواژه نادرست است.', 'INVALID_CREDENTIALS');
    }
    if (user.totp_enabled === 1 && (!code || !user.totp_secret || !verifyTotp(user.totp_secret, code))) {
      throw unauthorized('برای غیرفعال‌سازی، کد تأیید معتبر لازم است.', 'MFA_INVALID');
    }

    this.repository.disableTotp(user.id);
    this.audit.record({
      actorUserId: user.id,
      actorUsername: user.username,
      action: 'auth.mfa_disabled',
      entityType: 'user',
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { enabled: false };
  }

  private toUserDto(user: UserRow) {
    return {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      roles: this.repository.getRoles(user.id),
      permissions: this.repository.getPermissions(user.id),
      mustChangePassword: user.must_change_password === 1,
      mfaEnabled: user.totp_enabled === 1,
    };
  }

  private moduleCatalog(): ModuleStatusDto[] {
    return MODULES.map((module) => ({
      key: module.key,
      nameFa: module.nameFa,
      descriptionFa: module.descriptionFa,
      enabled: false,
      configurable: module.configurable,
      phase: module.phase,
    }));
  }
}
