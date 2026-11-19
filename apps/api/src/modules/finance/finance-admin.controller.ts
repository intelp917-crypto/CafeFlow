import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { createExpenseSchema } from '@cafeflow/shared';
import { CurrentAuth, Permissions, RequireModule } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import type { RequestAuth } from '../../common/tokens';
import { FinanceService } from './finance.service';

/** Expenses and the profit/loss view of the optional finance module. */
@Controller('finance')
@RequireModule('finance')
export class FinanceAdminController {
  constructor(@Inject(FinanceService) private readonly finance: FinanceService) {}

  @Get('summary')
  @Permissions('finance.read')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.finance.summary(from, to);
  }

  @Get('expenses')
  @Permissions('finance.read')
  expenses(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    const safe = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 200) : 60;
    return this.finance.expenses(safe);
  }

  @Post('expenses')
  @Permissions('finance.write')
  createExpense(@Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.finance.createExpense(parseWith(createExpenseSchema, body), {
      userId: auth.userId,
      username: auth.username,
    });
  }
}
