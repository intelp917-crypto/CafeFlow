import { Inject, Injectable } from '@nestjs/common';
import { PERMISSION_GROUP_LABELS_FA } from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

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

@Injectable()
export class UsersService {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

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
      items: rows.map((row) => ({
        id: row.id,
        username: row.username,
        fullName: row.full_name,
        isActive: row.is_active === 1,
        mustChangePassword: row.must_change_password === 1,
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
        roles: row.role_keys ? row.role_keys.split(',') : [],
        roleNamesFa: row.role_names ? row.role_names.split('، ') : [],
      })),
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
}
