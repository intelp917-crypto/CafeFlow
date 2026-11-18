import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

export interface AuditEntryInput {
  actorUserId?: string | null;
  actorUsername?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  actor_username: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  metadata_json: string | null;
  ip: string | null;
  created_at: string;
}

/**
 * Append-only audit trail. Sensitive operations must call `record` inside the
 * same request that performs the change, so a failed write cannot be logged as
 * a success.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  record(entry: AuditEntryInput): void {
    this.database.run(
      `INSERT INTO audit_logs
        (id, actor_user_id, actor_username, action, entity_type, entity_id,
         before_json, after_json, metadata_json, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        entry.actorUserId ?? null,
        entry.actorUsername ?? null,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
        entry.ip ?? null,
        entry.userAgent ?? null,
      ],
    );
  }

  list(params: { page: number; pageSize: number; action?: string; actorUsername?: string }): {
    items: AuditLogRow[];
    total: number;
  } {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (params.action) {
      clauses.push('action LIKE ?');
      values.push(`${params.action}%`);
    }
    if (params.actorUsername) {
      clauses.push('actor_username LIKE ?');
      values.push(`%${params.actorUsername}%`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = this.database.count(`SELECT COUNT(*) AS n FROM audit_logs ${where}`, values);
    const items = this.database.all<AuditLogRow>(
      `SELECT * FROM audit_logs ${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
      [...values, params.pageSize, (params.page - 1) * params.pageSize],
    );

    return { items, total };
  }
}
