import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { createStaffSchema, updateStaffSchema } from '@cafeflow/shared';
import { CurrentAuth, Permissions } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import type { RequestAuth } from '../../common/tokens';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get('users')
  @Permissions('users.read')
  listUsers() {
    return this.users.listUsers();
  }

  @Post('users')
  @Permissions('users.write')
  createUser(@Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.users.create(parseWith(createStaffSchema, body), {
      userId: auth.userId,
      username: auth.username,
    });
  }

  @Patch('users/:id')
  @Permissions('users.write')
  updateUser(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.users.update(id, parseWith(updateStaffSchema, body), {
      userId: auth.userId,
      username: auth.username,
    });
  }

  @Get('roles')
  @Permissions('roles.read')
  listRoles() {
    return this.users.listRoles();
  }

  @Get('permissions')
  @Permissions('roles.read')
  listPermissions() {
    return this.users.listPermissions();
  }
}
