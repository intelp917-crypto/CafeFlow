import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestAuth, RequestWithAuth } from './tokens';

export const IS_PUBLIC_KEY = 'cafeflow:is_public';
export const PERMISSIONS_KEY = 'cafeflow:permissions';
export const MODULE_KEY = 'cafeflow:module';

/** Marks a route as reachable without a session (login, health, customer QR). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Requires every listed permission; the backend is the only authority. */
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Blocks the route entirely while an optional module is disabled. */
export const RequireModule = (key: string) => SetMetadata(MODULE_KEY, key);

export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext): RequestAuth => {
  const request = context.switchToHttp().getRequest<RequestWithAuth>();
  if (!request.auth) {
    throw new Error('CurrentAuth used on a route without a session guard.');
  }
  return request.auth;
});
