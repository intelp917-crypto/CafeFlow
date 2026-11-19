import { Inject, Injectable } from '@nestjs/common';
import type { MessageChannel, MessageStatus } from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

export interface TemplateDbRow {
  id: string;
  key: string;
  channel: MessageChannel;
  title_fa: string;
  body_fa: string;
  is_active: number;
}

export interface OutboxDbRow {
  id: string;
  channel: MessageChannel;
  template_key: string | null;
  recipient: string | null;
  payload_json: string | null;
  status: MessageStatus;
  attempts: number;
  last_error: string | null;
  scheduled_at: string;
  created_at: string;
  sent_at: string | null;
}

/** Data access for message templates and the outbound queue. */
@Injectable()
export class MessagesRepository {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  templates(): TemplateDbRow[] {
    return this.database.all<TemplateDbRow>(
      'SELECT id, key, channel, title_fa, body_fa, is_active FROM notification_templates ORDER BY key ASC',
    );
  }

  findTemplate(key: string): TemplateDbRow | undefined {
    return this.database.get<TemplateDbRow>(
      'SELECT id, key, channel, title_fa, body_fa, is_active FROM notification_templates WHERE key = ?',
      [key],
    );
  }

  findTemplateById(id: string): TemplateDbRow | undefined {
    return this.database.get<TemplateDbRow>(
      'SELECT id, key, channel, title_fa, body_fa, is_active FROM notification_templates WHERE id = ?',
      [id],
    );
  }

  insertTemplate(input: {
    id: string;
    key: string;
    channel: MessageChannel;
    titleFa: string;
    bodyFa: string;
    isActive: boolean;
  }): void {
    this.database.run(
      `INSERT INTO notification_templates (id, key, channel, title_fa, body_fa, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.id, input.key, input.channel, input.titleFa, input.bodyFa, input.isActive ? 1 : 0],
    );
  }

  updateTemplate(
    id: string,
    input: { titleFa?: string; bodyFa?: string; isActive?: boolean },
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.titleFa !== undefined) {
      sets.push('title_fa = ?');
      params.push(input.titleFa);
    }
    if (input.bodyFa !== undefined) {
      sets.push('body_fa = ?');
      params.push(input.bodyFa);
    }
    if (input.isActive !== undefined) {
      sets.push('is_active = ?');
      params.push(input.isActive ? 1 : 0);
    }
    if (sets.length === 0) return;
    params.push(id);
    this.database.run(`UPDATE notification_templates SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  outbox(status: string | undefined, limit: number): OutboxDbRow[] {
    return this.database.all<OutboxDbRow>(
      `SELECT id, channel, template_key, recipient, payload_json, status, attempts,
              last_error, scheduled_at, created_at, sent_at
         FROM notification_outbox
        WHERE (? IS NULL OR status = ?)
        ORDER BY created_at DESC
        LIMIT ?`,
      [status ?? null, status ?? null, limit],
    );
  }

  findOutbox(id: string): OutboxDbRow | undefined {
    return this.database.get<OutboxDbRow>(
      `SELECT id, channel, template_key, recipient, payload_json, status, attempts,
              last_error, scheduled_at, created_at, sent_at
         FROM notification_outbox WHERE id = ?`,
      [id],
    );
  }

  insertOutbox(input: {
    id: string;
    channel: MessageChannel;
    templateKey: string | null;
    recipient: string;
    titleFa: string;
    bodyFa: string;
    scheduledAt: string;
  }): void {
    this.database.run(
      `INSERT INTO notification_outbox (id, channel, template_key, recipient, payload_json, status, scheduled_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
      [
        input.id,
        input.channel,
        input.templateKey,
        input.recipient,
        JSON.stringify({ titleFa: input.titleFa, bodyFa: input.bodyFa }),
        input.scheduledAt,
      ],
    );
  }

  markSent(id: string, atIso: string): void {
    this.database.run(
      "UPDATE notification_outbox SET status = 'sent', sent_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?",
      [atIso, id],
    );
  }

  markFailed(id: string, error: string): void {
    this.database.run(
      "UPDATE notification_outbox SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?",
      [error, id],
    );
  }

  statusCounts(): { queued: number; sent: number; failed: number } {
    const row = this.database.get<{ queued: number; sent: number; failed: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN status IN ('queued', 'sending') THEN 1 ELSE 0 END), 0) AS queued,
         COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
         COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
       FROM notification_outbox`,
    );
    return row ?? { queued: 0, sent: 0, failed: 0 };
  }
}
