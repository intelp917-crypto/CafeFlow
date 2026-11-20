import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import {
  addStaffOrderItemsSchema,
  createStaffOrderSchema,
  listOrdersQuerySchema,
  orderTransitionSchema,
  prepTransitionSchema,
  updateOrderItemSchema,
} from '@cafeflow/shared';
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

  /** Waiter-entered order; the server prices every line from the live menu. */
  @Post()
  @Permissions('orders.write')
  create(@Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.orders.createStaffOrder(parseWith(createStaffOrderSchema, body), auth);
  }

  @Get(':id')
  @Permissions('orders.read')
  detail(@Param('id') id: string) {
    return this.orders.detail(id);
  }

  /** Extra round on an open order: keeps one bill and one prep stream. */
  @Post(':id/items')
  @HttpCode(200)
  @Permissions('orders.write')
  addItems(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.orders.addStaffItems(id, parseWith(addStaffOrderItemsSchema, body), auth);
  }

  /** Shrink or remove a line until the order is served. */
  @Patch(':id/items/:itemId')
  @HttpCode(200)
  @Permissions('orders.write')
  updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: RequestAuth,
  ) {
    return this.orders.updateItem(id, itemId, parseWith(updateOrderItemSchema, body), auth);
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
