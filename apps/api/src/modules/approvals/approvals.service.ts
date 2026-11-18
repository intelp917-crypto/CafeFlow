import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';
import { AppError, conflict, notFound } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';

export interface ApprovalRow {
  id: string;
  type: string;
  title_fa: string;
  payload_json: string | null;
  requested_by: string;
  requester_name: string | null;
  status: string;
  decided_by: string | null;
  decider_name: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

/**
 * Central approval queue for sensitive actions (price changes, cancellations,
 * large discounts, financial corrections). Phase 1 ships the queue itself;
 * feature phases create requests through `request`.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(DB_SERVICE) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  list(status?: string) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (status) {
      clauses.push('a.status = ?');
      values.push(status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = this.database.all<ApprovalRow>(
      `SELECT a.*, requester.full_name AS requester_name, decider.full_name AS decider_name
         FROM approval_requests a
         LEFT JOIN users requester ON requester.id = a.requested_by
         LEFT JOIN users decider ON decider.id = a.decided_by
         ${where}
        ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created_at DESC
        LIMIT 100`,
      values,
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        titleFa: row.title_fa,
        payload: row.payload_json ? JSON.parse(row.payload_json) : null,
        status: row.status,
        requesterName: row.requester_name,
        deciderName: row.decider_name,
        decisionNote: row.decision_note,
        createdAt: row.created_at,
        decidedAt: row.decided_at,
      })),
    };
  }

  request(params: {
    type: string;
    titleFa: string;
    payload?: unknown;
    requestedBy: string;
    meta?: RequestMeta;
  }): string {
    const id = randomUUID();
    this.database.run(
      `INSERT INTO approval_requests (id, type, title_fa, payload_json, requested_by)
       VALUES (?, ?, ?, ?, ?)`,
      [id, params.type, params.titleFa, params.payload ? JSON.stringify(params.payload) : null, params.requestedBy],
    );
    this.audit.record({
      actorUserId: params.requestedBy,
      action: 'approval.requested',
      entityType: 'approval_request',
      entityId: id,
      metadata: { type: params.type, titleFa: params.titleFa },
      ip: params.meta?.ip ?? null,
      userAgent: params.meta?.userAgent ?? null,
    });
    return id;
  }

  decide(
    id: string,
    decision: 'approved' | 'rejected',
    note: string | undefined,
    actor: { userId: string; username: string },
    meta: RequestMeta,
  ) {
    const row = this.database.get<{ id: string; status: string; title_fa: string }>(
      'SELECT id, status, title_fa FROM approval_requests WHERE id = ?',
      [id],
    );
    if (!row) throw notFound('درخواست تأیید یافت نشد.');
    if (row.status !== 'pending') {
      throw conflict('این درخواست قبلاً بررسی شده است.', 'APPROVAL_ALREADY_DECIDED');
    }
    if (decision === 'rejected' && !note) {
      throw new AppError('REJECTION_NOTE_REQUIRED', 400, 'برای رد درخواست، ثبت دلیل الزامی است.');
    }

    this.database.transaction(() => {
      this.database.run(
        `UPDATE approval_requests
            SET status = ?, decided_by = ?, decision_note = ?, decided_at = ?
          WHERE id = ? AND status = 'pending'`,
        [decision, actor.userId, note ?? null, new Date().toISOString(), id],
      );
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: `approval.${decision}`,
      entityType: 'approval_request',
      entityId: id,
      before: { status: 'pending' },
      after: { status: decision },
      metadata: { note: note ?? null, titleFa: row.title_fa },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { id, status: decision };
  }
}
