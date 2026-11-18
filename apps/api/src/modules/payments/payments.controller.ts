import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  applyDiscountSchema,
  completeTerminalRequestSchema,
  recordPaymentSchema,
  refundPaymentSchema,
} from '@cafeflow/shared';
import { parseWith } from '../../common/errors';
import { CurrentAuth, Permissions } from '../../common/decorators';
import type { RequestAuth } from '../../common/tokens';
import { PaymentsService } from './payments.service';

@Controller('orders')
export class OrderPaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Get(':id/payments')
  @Permissions('payments.read')
  summary(@Param('id') id: string) {
    return this.payments.summary(id);
  }

  @Post(':id/payments')
  @HttpCode(201)
  @Permissions('payments.create')
  record(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    const input = parseWith(recordPaymentSchema, body);
    return this.payments.record(id, input, auth);
  }

  @Post(':id/discount')
  @HttpCode(200)
  @Permissions('orders.discount')
  discount(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    const input = parseWith(applyDiscountSchema, body);
    return this.payments.applyDiscount(id, input, auth);
  }

  @Post(':id/refunds')
  @HttpCode(201)
  @Permissions('payments.refund')
  refund(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    const input = parseWith(refundPaymentSchema, body);
    return this.payments.refund(id, input, auth);
  }
}

@Controller('terminal-requests')
export class TerminalSettlementController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Post(':id/complete')
  @HttpCode(200)
  @Permissions('payments.create')
  complete(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    const input = parseWith(completeTerminalRequestSchema, body ?? {});
    return this.payments.completeTerminalRequest(id, input, auth);
  }
}
