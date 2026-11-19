import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { createEmployeeSchema, createShiftSchema, updateEmployeeSchema } from '@cafeflow/shared';
import { CurrentAuth, Permissions, RequireModule } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import type { RequestAuth } from '../../common/tokens';
import { EmployeesService } from './employees.service';

/**
 * Employees are an optional module and OFF by default. Shift scheduling and
 * attendance live here; account creation and role bundles stay in the users
 * module so credentials are never touched by scheduling screens.
 */
@Controller()
@RequireModule('employees')
export class EmployeesController {
  constructor(@Inject(EmployeesService) private readonly employees: EmployeesService) {}

  @Get('employees')
  @Permissions('users.read')
  list() {
    return this.employees.employees();
  }

  @Post('employees')
  @Permissions('users.write')
  create(@Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.employees.create(parseWith(createEmployeeSchema, body), {
      userId: auth.userId,
      username: auth.username,
    });
  }

  @Patch('employees/:id')
  @Permissions('users.write')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.employees.update(id, parseWith(updateEmployeeSchema, body), {
      userId: auth.userId,
      username: auth.username,
    });
  }

  @Get('employees/performance')
  @Permissions('shifts.read')
  performance(@Query('from') from?: string, @Query('to') to?: string) {
    return this.employees.performance(from, to);
  }

  @Get('shifts')
  @Permissions('shifts.read')
  shifts(@Query('from') from?: string, @Query('to') to?: string) {
    return this.employees.shifts(from, to);
  }

  @Post('shifts')
  @Permissions('shifts.write')
  createShift(@Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.employees.createShift(parseWith(createShiftSchema, body), {
      userId: auth.userId,
      username: auth.username,
    });
  }

  @Post('shifts/:id/check-in')
  @HttpCode(200)
  @Permissions('shifts.write')
  checkIn(@Param('id') id: string, @CurrentAuth() auth: RequestAuth) {
    return this.employees.checkIn(id, { userId: auth.userId, username: auth.username });
  }

  @Post('shifts/:id/check-out')
  @HttpCode(200)
  @Permissions('shifts.write')
  checkOut(@Param('id') id: string, @CurrentAuth() auth: RequestAuth) {
    return this.employees.checkOut(id, { userId: auth.userId, username: auth.username });
  }

  @Post('shifts/:id/cancel')
  @HttpCode(200)
  @Permissions('shifts.write')
  cancel(@Param('id') id: string, @CurrentAuth() auth: RequestAuth) {
    return this.employees.cancelShift(id, { userId: auth.userId, username: auth.username });
  }
}
