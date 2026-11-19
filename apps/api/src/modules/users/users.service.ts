import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  PERMISSION_GROUP_LABELS_FA,
  type CreateStaffInput,
  type UpdateStaffInput,
} from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';
import { hashPassword } from '../../common/password';
import { badRequest, notFound } from '../../common/errors';
import { AuditService } from '../audit/audit.service';

export interface StaffRow {
  id: string;
  username: string;
  full_name: string;
  is_active: number;
  must_change_password: number;
  last_login_at: string | null;
  created_at: string;
  role_keys: string | null;
  role_names: string | null;
}

export interface StaffMemberDto {
  id: string;
  username: string;
  fullName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: string[];
  roleNamesFa: string[];
}

export interface ActingUser {
  userId: string;
  username: string;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB_SERVICE) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private toMember(row: StaffRow): StaffMemberDto {
    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      isActive: row.is_active === 1,
      mustChangePassword: row.must_change_password === 1,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      roles: row.role_keys ? row.role_keys.split(',') : [],
      roleNamesFa: row.role_names ? row.role_names.split('، ') : [],
    };
  }

  listUsers() {
    const rows = this.database.all<StaffRow>(
      `SELECT u.id, u.username, u.full_name, u.is_active, u.must_change_password,
              u.last_login_at, u.created_at,
              (SELECT group_concat(r.key, ',')
                 FROM roles r JOIN user_roles ur ON ur.role_id = r.id
                WHERE ur.user_id = u.id) AS role_keys,
              (SELECT group_concat(r.name_fa, '، ')
                 FROM roles r JOIN user_roles ur ON ur.role_id = r.id
                WHERE ur.user_id = u.id) AS role_names
         FROM users u
        WHERE u.deleted_at IS NULL
        ORDER BY u.is_active DESC, u.created_at ASC`,
    );

    return {
      items: rows.map((row) => this.toMember(row)),
      total: rows.length,
    };
  }

  listRoles() {
    const rows = this.database.all<{
      id: string;
      key: string;
      name_fa: string;
      description_fa: string | null;
      is_system: number;
      permission_count: number;
      user_count: number;
    }>(
      `SELECT r.id, r.key, r.name_fa, r.description_fa, r.is_system,
              (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
              (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
         FROM roles r
        ORDER BY r.is_system DESC, r.key ASC`,
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        key: row.key,
        nameFa: row.name_fa,
        descriptionFa: row.description_fa,
        isSystem: row.is_system === 1,
        permissionCount: row.permission_count,
        userCount: row.user_count,
      })),
    };
  }

  listPermissions() {
    const rows = this.database.all<{ key: string; name_fa: string; group_key: string }>(
      'SELECT key, name_fa, group_key FROM permissions ORDER BY group_key, key',
    );

    return {
      items: rows.map((row) => ({
        key: row.key,
        nameFa: row.name_fa,
        group: row.group_key,
        groupLabelFa: PERMISSION_GROUP_LABELS_FA[row.group_key] ?? row.group_key,
      })),
    };
  }

  private findMember(id: string): StaffMemberDto {
    const row = this.database.get<StaffRow>(
      `SELECT u.id, u.username, u.full_name, u.is_active, u.must_change_password,
              u.last_login_at, u.created_at,
              (SELECT group_concat(r.key, ',')
                 FROM roles r JOIN user_roles ur ON ur.role_id = r.id
                WHERE ur.user_id = u.id) AS role_keys,
              (SELECT group_concat(r.name_fa, '، ')
                 FROM roles r JOIN user_roles ur ON ur.role_id = r.id
                WHERE ur.user_id = u.id) AS role_names
         FROM users u
        WHERE u.id = ? AND u.deleted_at IS NULL`,
      [id],
    );
    if (!row) throw notFound('کاربر یافت نشد.', 'USER_NOT_FOUND');
    return this.toMember(row);
  }

  private resolveRoles(roleKeys: string[]): Array<{ id: string; key: string }> {
    const unique = [...new Set(roleKeys)];
    const placeholders = unique.map(() => '?').join(', ');
    const rows = this.database.all<{ id: string; key: string }>(
      `SELECT id, key FROM roles WHERE key IN (${placeholders})`,
      unique,
    );

    const missing = unique.filter((key) => !rows.some((row) => row.key === key));
    if (missing.length > 0) {
      throw badRequest(`نقش نامعتبر: ${missing.join('، ')}`, 'ROLE_NOT_FOUND', { missing });
    }
    return rows;
  }

  create(input: CreateStaffInput, actor: ActingUser): StaffMemberDto {
    const username = input.username.trim().toLowerCase();

    const existing = this.database.get<{ id: string }>('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) {
      throw badRequest('این نام کاربری قبلاً ثبت شده است.', 'USERNAME_TAKEN');
    }

    const roles = this.resolveRoles(input.roleKeys);
    const id = randomUUID();
    const passwordHash = hashPassword(input.password);

    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO users (id, username, full_name, password_hash, is_active, must_change_password)
         VALUES (?, ?, ?, ?, 1, 1)`,
        [id, username, input.fullName, passwordHash],
      );
      for (const role of roles) {
        this.database.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [id, role.id]);
      }
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'staff.created',
      entityType: 'user',
      entityId: id,
      after: { username, fullName: input.fullName, roleKeys: roles.map((role) => role.key) },
    });

    return this.findMember(id);
  }

  update(id: string, input: UpdateStaffInput, actor: ActingUser): StaffMemberDto {
    const before = this.findMember(id);

    if (id === actor.userId && input.isActive === false) {
      throw badRequest('نمی‌توانید حساب کاربری خودتان را غیرفعال کنید.', 'CANNOT_DISABLE_SELF');
    }

    const roles = input.roleKeys ? this.resolveRoles(input.roleKeys) : null;

    this.database.transaction(() => {
      if (input.fullName !== undefined) {
        this.database.run('UPDATE users SET full_name = ? WHERE id = ?', [input.fullName, id]);
      }
      if (input.isActive !== undefined) {
        this.database.run('UPDATE users SET is_active = ? WHERE id = ?', [input.isActive ? 1 : 0, id]);
        if (!input.isActive) {
          this.database.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [
            new Date().toISOString(),
            id,
          ]);
        }
      }
      if (roles) {
        this.database.run('DELETE FROM user_roles WHERE user_id = ?', [id]);
        for (const role of roles) {
          this.database.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [id, role.id]);
        }
      }
      if (input.resetMfa) {
        this.database.run(
          'UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_confirmed_at = NULL, updated_at = ? WHERE id = ?',
          [new Date().toISOString(), id],
        );
        this.database.run('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [id]);
      }
      if (input.newPassword) {
        this.database.run('UPDATE users SET password_hash = ?, must_change_password = 1, failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [
          hashPassword(input.newPassword),
          id,
        ]);
        this.database.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [
          new Date().toISOString(),
          id,
        ]);
      }
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'staff.updated',
      entityType: 'user',
      entityId: id,
      before: { fullName: before.fullName, isActive: before.isActive, roles: before.roles },
      after: {
        fullName: input.fullName ?? before.fullName,
        isActive: input.isActive ?? before.isActive,
        roles: roles ? roles.map((role) => role.key) : before.roles,
        passwordReset: input.newPassword !== undefined,
        mfaReset: input.resetMfa === true,
      },
    });

    return this.findMember(id);
  }
}
