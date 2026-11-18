import { Controller, Get, Inject } from '@nestjs/common';
import { Permissions } from '../../common/decorators';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get('users')
  @Permissions('users.read')
  listUsers() {
    return this.users.listUsers();
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
