import { createHash } from 'node:crypto';
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { loadConfig } from '../../config/env';
import { AuthRepository } from '../../modules/auth/auth.repository';
import { parseCookies } from '../cookies';
import { IS_PUBLIC_KEY } from '../decorators';
import { unauthorized } from '../errors';
import type { RequestAuth, RequestWithAuth } from '../tokens';

/**
 * Authenticates the request from the HttpOnly session cookie and attaches the
 * resolved user, roles, permissions and enabled modules to `request.auth`.
 *
 * This guard is registered globally: a route is private unless it is marked
 * with `@Public()`.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly config = loadConfig();

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthRepository) private readonly repository: AuthRepository,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const cookies = parseCookies(request.headers.cookie as string | undefined);
    const token = cookies[this.config.sessionCookieName];

    if (!token) {
      if (isPublic) return true;
      throw unauthorized();
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const nowIso = new Date().toISOString();
    const session = this.repository.findActiveSessionByTokenHash(tokenHash, nowIso);

    if (!session) {
      if (isPublic) return true;
      throw unauthorized('نشست شما منقضی شده است. لطفاً دوباره وارد شوید.', 'SESSION_EXPIRED');
    }

    const userId = (session as unknown as { user_id: string }).user_id;
    const sessionId = (session as unknown as { session_id?: string }).session_id ?? session.id;

    const auth: RequestAuth = {
      userId,
      username: session.username,
      fullName: session.full_name,
      sessionId,
      roles: this.repository.getRoles(userId),
      permissions: this.repository.getPermissions(userId),
      mustChangePassword: session.must_change_password === 1,
      enabledModules: this.repository.getEnabledModules(),
    };

    request.auth = auth;

    // Sliding activity timestamp; throttled to once a minute to avoid a write
    // on every request.
    const lastSeen = new Date(session.last_seen_at).getTime();
    if (Date.now() - lastSeen > 60_000) {
      this.repository.touchSession(sessionId, nowIso);
    }

    return true;
  }
}
