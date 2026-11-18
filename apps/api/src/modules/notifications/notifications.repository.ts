import { Inject, Injectable } from '@nestjs/common';
import type { NotificationItem } from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

interface NotificationRow {
  id: string;
  type: string;
  title_fa: string;
  body_fa: string | null;
  role_key: string | null;
  is_read: number;
  created_at: string;
}

export interface NotificationAudience {
  userId: string;
  roles: string[];
}

function audienceClause(audience: NotificationAudience): { sql: string; params: unknown[] } {
  const placeholders = audience.roles.map(() => '?').join(', ');
  return {
    sql: placeholders ? `(n.user_id = ? OR n.role_key IN (${placeholders}))` : 'n.user_id = ?',
    params: placeholders ? [audience.userId, ...audience.roles] : [audience.userId],
  };
}

/**
 * Personal and role-addressed notifications. A role row is shared by everyone
 * holding that role, so marking it read marks it for the whole role — see the
 * documented limitation in PROGRESS.
 */
@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  list(audience: NotificationAudience, unreadOnly: boolean, limit = 50): NotificationItem[] {
    const scope = audienceClause(audience);
    const rows = this.database.all<NotificationRow>(
      `SELECT n.id, n.type, n.title_fa, n.body_fa, n.role_key, n.is_read, n.created_at
         FROM notifications n
        WHERE ${scope.sql}${unreadOnly ? ' AND n.is_read = 0' : ''}
        ORDER BY n.created_at DESC
        LIMIT ?`,
      [...scope.params, limit],
    );

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      titleFa: row.title_fa,
      bodyFa: row.body_fa,
      roleKey: row.role_key,
      isRead: row.is_read === 1,
      createdAt: row.created_at,
    }));
  }

  countUnread(audience: NotificationAudience): number {
    const scope = audienceClause(audience);
    return this.database.count(
      `SELECT COUNT(*) AS n FROM notifications n WHERE ${scope.sql} AND n.is_read = 0`,
      scope.params,
    );
  }

  markRead(id: string, audience: NotificationAudience): boolean {
    const scope = audienceClause(audience);
    const result = this.database.run(
      `UPDATE notifications SET is_read = 1 WHERE id = ? AND ${scope.sql.replace(/n\./g, '')}`,
      [id, ...scope.params],
    );
    return result.changes > 0;
  }

  markAllRead(audience: NotificationAudience): number {
    const scope = audienceClause(audience);
    const result = this.database.run(
      `UPDATE notifications SET is_read = 1 WHERE ${scope.sql.replace(/n\./g, '')} AND is_read = 0`,
      scope.params,
    );
    return result.changes;
  }
}
