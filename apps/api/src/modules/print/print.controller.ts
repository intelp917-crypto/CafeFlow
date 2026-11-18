import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { badRequest } from '../../common/errors';
import { CurrentAuth, Permissions } from '../../common/decorators';
import type { RequestAuth } from '../../common/tokens';
import { PrintService } from './print.service';

const PRINT_STATUSES = ['queued', 'sent', 'printed', 'failed', 'cancelled'] as const;

@Controller('orders')
export class OrderReceiptController {
  constructor(@Inject(PrintService) private readonly print: PrintService) {}

  /** Queues (or returns) the receipt job for an order; safe to click twice. */
  @Post(':id/receipt')
  @HttpCode(201)
  @Permissions('orders.read')
  receipt(@Param('id') id: string, @CurrentAuth() auth: RequestAuth) {
    return this.print.queueReceipt(id, auth);
  }
}

@Controller('print')
export class PrintJobsController {
  constructor(@Inject(PrintService) private readonly print: PrintService) {}

  @Get('jobs')
  @Permissions('orders.read')
  list(@Query('status') status?: string) {
    if (status !== undefined && status !== '') {
      if (!(PRINT_STATUSES as readonly string[]).includes(status)) {
        throw badRequest('وضعیت کار چاپ نامعتبر است.', 'INVALID_PRINT_STATUS');
      }
      return this.print.list(status as (typeof PRINT_STATUSES)[number]);
    }
    return this.print.list();
  }

  @Post('jobs/:id/printed')
  @HttpCode(200)
  @Permissions('orders.read')
  printed(@Param('id') id: string) {
    return this.print.markPrinted(id);
  }

  @Post('jobs/:id/failed')
  @HttpCode(200)
  @Permissions('orders.read')
  failed(@Param('id') id: string, @Body() body: { error?: string }) {
    const message = typeof body?.error === 'string' && body.error.trim().length > 0 ? body.error.trim() : 'unknown error';
    return this.print.markFailed(id, message);
  }
}
