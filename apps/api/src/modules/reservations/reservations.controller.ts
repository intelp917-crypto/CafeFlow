import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { listReservationsQuerySchema, createReservationSchema, reservationStatusSchema } from '@cafeflow/shared';
import { CurrentAuth, Permissions, RequireModule } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import type { RequestAuth } from '../../common/tokens';
import { ReservationsService } from './reservations.service';

@Controller('reservations')
@RequireModule('reservations')
export class ReservationsController {
  constructor(@Inject(ReservationsService) private readonly reservations: ReservationsService) {}

  @Get()
  @Permissions('reservations.read')
  list(@Query() query: unknown) {
    return this.reservations.list(parseWith(listReservationsQuerySchema, query));
  }

  @Post()
  @Permissions('reservations.write')
  create(@Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.reservations.create(parseWith(createReservationSchema, body), {
      userId: auth.userId,
      username: auth.username,
      permissions: auth.permissions,
    });
  }

  @Post(':id/status')
  @HttpCode(200)
  @Permissions('reservations.write')
  changeStatus(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.reservations.changeStatus(id, parseWith(reservationStatusSchema, body), {
      userId: auth.userId,
      username: auth.username,
      permissions: auth.permissions,
    });
  }
}
