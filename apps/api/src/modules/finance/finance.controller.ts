import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { closeCashSessionSchema, openCashSessionSchema } from '@cafeflow/shared';
import { CurrentAuth, Permissions, RequireModule } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import type { RequestAuth } from '../../common/tokens';
import { FinanceService } from './finance.service';

@Controller('cash-sessions')
@RequireModule('finance')
export class CashSessionsController {
  constructor(@Inject(FinanceService) private readonly finance: FinanceService) {}

  @Get()
  @Permissions('finance.read')
  overview(@Query('registerId') registerId?: string) {
    return this.finance.overview(registerId);
  }

  @Post('open')
  @Permissions('finance.write')
  open(@Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.finance.open(parseWith(openCashSessionSchema, body), {
      userId: auth.userId,
      username: auth.username,
    });
  }

  @Post(':id/close')
  @HttpCode(200)
  @Permissions('finance.write')
  close(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.finance.close(id, parseWith(closeCashSessionSchema, body), {
      userId: auth.userId,
      username: auth.username,
    });
  }
}
