import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { adjustLoyaltySchema, createCustomerSchema } from '@cafeflow/shared';
import { CurrentAuth, Permissions, RequireModule } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import type { RequestAuth } from '../../common/tokens';
import { CrmService } from './crm.service';

@Controller('customers')
@RequireModule('crm')
export class CrmController {
  constructor(@Inject(CrmService) private readonly crm: CrmService) {}

  @Get()
  @Permissions('crm.read')
  list(@Query('q') q?: string, @Query('limit') limit?: string) {
    const parsed = Number(limit);
    const safe = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 100) : 50;
    return this.crm.list(q, safe);
  }

  @Post()
  @Permissions('crm.write')
  create(@Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.crm.create(parseWith(createCustomerSchema, body), {
      userId: auth.userId,
      username: auth.username,
    });
  }

  @Get(':id')
  @Permissions('crm.read')
  detail(@Param('id') id: string) {
    return this.crm.detail(id);
  }

  @Post(':id/loyalty')
  @HttpCode(200)
  @Permissions('crm.write')
  adjust(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.crm.adjust(id, parseWith(adjustLoyaltySchema, body), {
      userId: auth.userId,
      username: auth.username,
    });
  }
}
