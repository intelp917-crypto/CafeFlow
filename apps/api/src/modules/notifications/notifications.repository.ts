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
 * holding that role, but read state is per user (`notification_reads`), so one
 * cashier opening the inbox does not clear it for the next shift.
 */
@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  list(audience: NotificationAudience, unreadOnly: boolean, limit = 50): NotificationItem[] {
    const scope = audienceClause(audience);
    const rows = this.database.all<NotificationRow>(
      `SELECT n.id, n.type, n.title_fa, n.body_fa, n.role_key,
              CASE WHEN n.is_read = 1 OR r.notification_id IS NOT NULL THEN 1 ELSE 0 END AS is_read,
              n.created_at
         FROM notifications n
         LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
        WHERE ${scope.sql}${unreadOnly ? ' AND n.is_read = 0 AND r.notification_id IS NULL' : ''}
        ORDER BY n.created_at DESC
        LIMIT ?`,
      [audience.userId, ...scope.params, limit],
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
      `SELECT COUNT(*) AS n
         FROM notifications n
         LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
        WHERE ${scope.sql} AND n.is_read = 0 AND r.notification_id IS NULL`,
      [audience.userId, ...scope.params],
    );
  }

  markRead(id: string, audience: NotificationAudience): boolean {
    const scope = audienceClause(audience);
    const row = this.database.get<{ user_id: string | null }>(
      `SELECT n.user_id FROM notifications n WHERE n.id = ? AND ${scope.sql}`,
      [id, ...scope.params],
    );
    if (!row) return false;

    this.database.run(
      `INSERT INTO notification_reads (notification_id, user_id) VALUES (?, ?)
       ON CONFLICT (notification_id, user_id) DO NOTHING`,
      [id, audience.userId],
    );
    // The legacy column stays meaningful for rows addressed to one person.
    if (row.user_id) {
      this.database.run('UPDATE notifications SET is_read = 1 WHERE id = ?', [id]);
    }
    return true;
  }

  markAllRead(audience: NotificationAudience): number {
    const scope = audienceClause(audience);
    const before = this.countUnread(audience);
    if (before === 0) return 0;

    this.database.run(
      `INSERT INTO notification_reads (notification_id, user_id)
       SELECT n.id, ? FROM notifications n
         LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
        WHERE ${scope.sql} AND n.is_read = 0 AND r.notification_id IS NULL
       ON CONFLICT (notification_id, user_id) DO NOTHING`,
      [audience.userId, audience.userId, ...scope.params],
    );
    this.database.run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [
      audience.userId,
    ]);
    return before;
  }
}
