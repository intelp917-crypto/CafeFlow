import { Controller, Get, Header, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { parseWith } from '../../common/errors';
import { Permissions } from '../../common/decorators';
import { ReportsService, resolveRange } from './reports.service';

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ شروع باید به شکل YYYY-MM-DD باشد.').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ پایان باید به شکل YYYY-MM-DD باشد.').optional(),
});

@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Get('summary')
  @Permissions('reports.read')
  summary(@Query() query: unknown) {
    const range = parseWith(rangeSchema, query);
    return this.reports.summary(resolveRange(range.from, range.to));
  }

  @Get('payments.xlsx')
  @Permissions('reports.read')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  xlsx(@Query() query: unknown, @Res({ passthrough: true }) response: Response) {
    const range = parseWith(rangeSchema, query);
    const resolved = resolveRange(range.from, range.to);
    response.setHeader('Content-Disposition', `attachment; filename="payments-${resolved.from}-${resolved.to}.xlsx"`);
    return this.reports.paymentsXlsx(resolved);
  }

  @Get('payments.csv')
  @Permissions('reports.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  csv(@Query() query: unknown, @Res({ passthrough: true }) response: Response) {
    const range = parseWith(rangeSchema, query);
    const resolved = resolveRange(range.from, range.to);
    response.setHeader('Content-Disposition', `attachment; filename="payments-${resolved.from}-${resolved.to}.csv"`);
    return this.reports.paymentsCsv(resolved);
  }
}
