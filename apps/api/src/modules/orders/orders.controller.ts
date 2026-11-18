import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { listOrdersQuerySchema, orderTransitionSchema, prepTransitionSchema } from '@cafeflow/shared';
import { badRequest } from '../../common/errors';
import { parseWith } from '../../common/errors';
import { CurrentAuth, Permissions } from '../../common/decorators';
import type { RequestAuth } from '../../common/tokens';
import { OrdersService } from './orders.service';

const DEPARTMENT_KINDS = ['barista', 'kitchen', 'bar', 'other'] as const;

@Controller('orders')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get()
  @Permissions('orders.read')
  list(@Query() query: unknown) {
    return this.orders.list(parseWith(listOrdersQuerySchema, query));
  }

  @Get(':id')
  @Permissions('orders.read')
  detail(@Param('id') id: string) {
    return this.orders.detail(id);
  }

  @Post(':id/transition')
  @HttpCode(200)
  @Permissions('orders.write')
  transition(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    const input = parseWith(orderTransitionSchema, body);
    return this.orders.transition(id, input.to, auth, input.reason);
  }
}

@Controller('prep')
export class PrepController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get('queue')
  @Permissions('prep.read')
  queue(@Query('kind') kind?: string, @Query('includeFinished') includeFinished?: string) {
    if (kind !== undefined && kind !== '' && !(DEPARTMENT_KINDS as readonly string[]).includes(kind)) {
      throw badRequest('نوع دپارتمان نامعتبر است.', 'INVALID_DEPARTMENT');
    }
    return this.orders.prepQueue({
      kind: kind === '' ? undefined : kind,
      includeFinished: includeFinished === 'true' || includeFinished === '1',
    });
  }

  @Post(':id/transition')
  @HttpCode(200)
  @Permissions('prep.update')
  transition(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    const input = parseWith(prepTransitionSchema, body);
    return this.orders.transitionPrep(id, input.to, auth);
  }
}
