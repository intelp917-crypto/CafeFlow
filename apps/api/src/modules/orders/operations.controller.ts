import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { serviceRequestStatusSchema } from '@cafeflow/shared';
import { parseWith } from '../../common/errors';
import { CurrentAuth, Permissions } from '../../common/decorators';
import type { RequestAuth } from '../../common/tokens';
import { OrdersService } from './orders.service';

function parseStatusQuery(value: string | undefined): 'pending' | 'all' {
  return value === 'all' ? 'all' : 'pending';
}

@Controller('tables')
export class TablesController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get()
  @Permissions('layout.read')
  list() {
    return this.orders.tables();
  }

  /**
   * The handler only asks for read access; the service additionally requires
   * `layout.write` or `payments.create`, so the rule lives with the business
   * check instead of a decorator that cannot express "either" permission.
   */
  @Post(':id/close')
  @HttpCode(200)
  @Permissions('layout.read')
  close(@Param('id') id: string, @CurrentAuth() auth: RequestAuth) {
    return this.orders.closeTable(id, auth);
  }
}

@Controller('service-requests')
export class ServiceRequestsController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get()
  @Permissions('orders.read')
  list(@Query('status') status?: string) {
    return this.orders.serviceRequests(parseStatusQuery(status));
  }

  @Post(':id/status')
  @HttpCode(200)
  @Permissions('orders.write')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    const input = parseWith(serviceRequestStatusSchema, body);
    return this.orders.updateServiceRequest(id, input.status, auth);
  }
}

@Controller('terminal-requests')
export class TerminalRequestsController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get()
  @Permissions('payments.read')
  list(@Query('status') status?: string) {
    return this.orders.terminalRequests(parseStatusQuery(status));
  }
  // Settlement of a terminal request lives in the payments module: completing
  // it records the card payment (or explains why it cannot).
}
