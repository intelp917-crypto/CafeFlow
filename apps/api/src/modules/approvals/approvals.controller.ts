import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { approvalDecisionSchema } from '@cafeflow/shared';
import { CurrentAuth, Permissions } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import type { RequestAuth } from '../../common/tokens';
import { ApprovalsService } from './approvals.service';

@Controller('approvals')
export class ApprovalsController {
  constructor(@Inject(ApprovalsService) private readonly approvals: ApprovalsService) {}

  @Get()
  @Permissions('approvals.read')
  list(@Query('status') status?: string) {
    const allowed = ['pending', 'approved', 'rejected', 'cancelled'];
    return this.approvals.list(status && allowed.includes(status) ? status : undefined);
  }

  @Post(':id/decision')
  @Permissions('approvals.decide')
  decide(
    @CurrentAuth() auth: RequestAuth,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const input = parseWith(approvalDecisionSchema, body);
    const userAgent = request.headers['user-agent'];
    return this.approvals.decide(
      id,
      input.decision,
      input.note,
      { userId: auth.userId, username: auth.username },
      {
        ip: request.ip ?? request.socket?.remoteAddress ?? null,
        userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
      },
    );
  }
}
