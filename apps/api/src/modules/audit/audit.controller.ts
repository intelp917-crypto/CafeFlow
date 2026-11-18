import { Controller, Get, Inject, Query } from '@nestjs/common';
import { paginationSchema, paginate } from '@cafeflow/shared';
import { Permissions } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  @Permissions('audit.read')
  list(@Query() query: Record<string, unknown>) {
    const { page, pageSize } = parseWith(paginationSchema, query);
    const action = typeof query.action === 'string' && query.action.length > 0 ? query.action : undefined;
    const actor = typeof query.actor === 'string' && query.actor.length > 0 ? query.actor : undefined;

    const { items, total } = this.audit.list({ page, pageSize, action, actorUsername: actor });

    return paginate(
      items.map((row) => ({
        id: row.id,
        action: row.action,
        actorUsername: row.actor_username,
        entityType: row.entity_type,
        entityId: row.entity_id,
        before: row.before_json ? JSON.parse(row.before_json) : null,
        after: row.after_json ? JSON.parse(row.after_json) : null,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
        ip: row.ip,
        createdAt: row.created_at,
      })),
      total,
      page,
      pageSize,
    );
  }
}
