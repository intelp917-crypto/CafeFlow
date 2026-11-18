import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators';
import { forbidden } from '../errors';
import type { RequestWithAuth } from '../tokens';

/**
 * Enforces `@Permissions(...)`. Requires every listed permission, and always
 * evaluates the permission set loaded from the database by SessionGuard —
 * never a value supplied by the client.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const granted = request.auth?.permissions ?? [];
    const missing = required.filter((permission) => !granted.includes(permission));

    if (missing.length > 0) {
      throw forbidden('برای انجام این عملیات دسترسی لازم را ندارید.');
    }
    return true;
  }
}
