import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  MESSAGE_CHANNEL_LABELS_FA,
  MESSAGE_STATUS_LABELS_FA,
  type CreateTemplateInput,
  type MessageChannel,
  type MessageStatus,
  type MessageTemplateRow,
  type MessagesResponse,
  type OutboxRow,
  type SendMessageInput,
  type SendMessageResponse,
  type UpdateTemplateInput,
} from '@cafeflow/shared';
import { badRequest, conflict, notFound } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { MessagesRepository, type OutboxDbRow, type TemplateDbRow } from './messages.repository';

export interface ActingUser {
  userId: string;
  username: string;
}

function renderTemplate(body: string, variables: Record<string, string> | undefined): string {
  if (!variables) return body;
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key]! : match,
  );
}

/**
 * Message centre: reusable templates plus an outbound queue.
 *
 * Nothing is reported as delivered here. A row is queued with the rendered
 * text, and a local bridge (or an operator) confirms it through the
 * `sent`/`failed` endpoints — the same pattern as the print bridge. That keeps
 * the delivery claim honest when no SMS gateway is configured.
 */
@Injectable()
export class MessagesService {
  constructor(
    @Inject(MessagesRepository) private readonly repository: MessagesRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private toTemplate(row: TemplateDbRow): MessageTemplateRow {
    return {
      id: row.id,
      key: row.key,
      channel: row.channel,
      channelLabelFa: MESSAGE_CHANNEL_LABELS_FA[row.channel] ?? row.channel,
      titleFa: row.title_fa,
      bodyFa: row.body_fa,
      isActive: row.is_active === 1,
    };
  }

  private payload(row: OutboxDbRow): { titleFa: string | null; bodyFa: string | null } {
    if (!row.payload_json) return { titleFa: null, bodyFa: null };
    try {
      const parsed = JSON.parse(row.payload_json) as { titleFa?: string; bodyFa?: string };
      return { titleFa: parsed.titleFa ?? null, bodyFa: parsed.bodyFa ?? null };
    } catch {
      return { titleFa: null, bodyFa: null };
    }
  }

  private toOutbox(row: OutboxDbRow): OutboxRow {
    const content = this.payload(row);
    return {
      id: row.id,
      channel: row.channel,
      channelLabelFa: MESSAGE_CHANNEL_LABELS_FA[row.channel] ?? row.channel,
      templateKey: row.template_key,
      recipient: row.recipient,
      titleFa: content.titleFa,
      bodyFa: content.bodyFa,
      status: row.status as MessageStatus,
      statusLabelFa: MESSAGE_STATUS_LABELS_FA[row.status as MessageStatus] ?? row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      scheduledAt: row.scheduled_at,
      sentAt: row.sent_at,
    };
  }

  overview(status: string | undefined, limit: number): MessagesResponse {
    return {
      items: this.repository.outbox(status, limit).map((row) => this.toOutbox(row)),
      templates: this.repository.templates().map((row) => this.toTemplate(row)),
      summary: this.repository.statusCounts(),
    };
  }

  createTemplate(input: CreateTemplateInput, actor: ActingUser): MessageTemplateRow {
    if (this.repository.findTemplate(input.key)) {
      throw conflict('قالبی با این کلید از قبل وجود دارد.', 'TEMPLATE_EXISTS');
    }

    const id = randomUUID();
    this.repository.insertTemplate({ id, ...input });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'message.template_created',
      entityType: 'notification_template',
      entityId: id,
      after: { key: input.key, channel: input.channel },
    });

    const created = this.repository.findTemplateById(id);
    if (!created) throw notFound('قالب ساخته نشد.', 'TEMPLATE_NOT_CREATED');
    return this.toTemplate(created);
  }

  updateTemplate(id: string, input: UpdateTemplateInput, actor: ActingUser): MessageTemplateRow {
    const before = this.repository.findTemplateById(id);
    if (!before) throw notFound('قالب یافت نشد.', 'TEMPLATE_NOT_FOUND');

    this.repository.updateTemplate(id, input);

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'message.template_updated',
      entityType: 'notification_template',
      entityId: id,
      before: { titleFa: before.title_fa, isActive: before.is_active === 1 },
      after: input,
    });

    const updated = this.repository.findTemplateById(id);
    if (!updated) throw notFound('قالب یافت نشد.', 'TEMPLATE_NOT_FOUND');
    return this.toTemplate(updated);
  }

  send(input: SendMessageInput, actor: ActingUser): SendMessageResponse {
    let titleFa = input.titleFa ?? '';
    let bodyFa = input.bodyFa ?? '';
    let templateKey: string | null = null;

    if (input.templateKey) {
      const template = this.repository.findTemplate(input.templateKey);
      if (!template) throw notFound('قالب پیام یافت نشد.', 'TEMPLATE_NOT_FOUND');
      if (template.is_active !== 1) throw badRequest('این قالب غیرفعال است.', 'TEMPLATE_INACTIVE');
      if (template.channel !== (input.channel as MessageChannel)) {
        throw badRequest('کانال ارسال با کانال قالب هم‌خوان نیست.', 'TEMPLATE_CHANNEL_MISMATCH');
      }
      templateKey = template.key;
      titleFa = renderTemplate(template.title_fa, input.variables);
      bodyFa = renderTemplate(template.body_fa, input.variables);
    }

    const recipients = [...new Set(input.recipients.map((value) => value.trim()).filter(Boolean))];
    if (recipients.length === 0) throw badRequest('حداقل یک گیرنده لازم است.', 'NO_RECIPIENTS');

    const scheduledAt = new Date().toISOString();
    const ids: string[] = [];

    for (const recipient of recipients) {
      const id = randomUUID();
      this.repository.insertOutbox({
        id,
        channel: input.channel,
        templateKey,
        recipient,
        titleFa,
        bodyFa,
        scheduledAt,
      });
      ids.push(id);
    }

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'message.queued',
      entityType: 'notification_outbox',
      entityId: ids[0]!,
      after: { channel: input.channel, recipients: recipients.length, templateKey },
    });

    const items = ids
      .map((id) => this.repository.findOutbox(id))
      .filter((row): row is OutboxDbRow => Boolean(row))
      .map((row) => this.toOutbox(row));

    return { queued: items.length, items };
  }

  markSent(id: string, actor: ActingUser): OutboxRow {
    const row = this.repository.findOutbox(id);
    if (!row) throw notFound('پیام یافت نشد.', 'MESSAGE_NOT_FOUND');
    if (row.status === 'sent') throw conflict('این پیام قبلاً ارسال‌شده ثبت شده است.', 'MESSAGE_ALREADY_SENT');

    this.repository.markSent(id, new Date().toISOString());

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'message.sent',
      entityType: 'notification_outbox',
      entityId: id,
    });

    const updated = this.repository.findOutbox(id);
    if (!updated) throw notFound('پیام یافت نشد.', 'MESSAGE_NOT_FOUND');
    return this.toOutbox(updated);
  }

  markFailed(id: string, error: string, actor: ActingUser): OutboxRow {
    const row = this.repository.findOutbox(id);
    if (!row) throw notFound('پیام یافت نشد.', 'MESSAGE_NOT_FOUND');

    this.repository.markFailed(id, error.slice(0, 300));

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'message.failed',
      entityType: 'notification_outbox',
      entityId: id,
      after: { error: error.slice(0, 300) },
    });

    const updated = this.repository.findOutbox(id);
    if (!updated) throw notFound('پیام یافت نشد.', 'MESSAGE_NOT_FOUND');
    return this.toOutbox(updated);
  }
}
