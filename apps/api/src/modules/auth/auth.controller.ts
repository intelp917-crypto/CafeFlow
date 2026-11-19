import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  mfaCodeSchema,
  mfaDisableSchema,
  mfaRecoverySchema,
} from '@cafeflow/shared';
import { CurrentAuth, Public } from '../../common/decorators';
import { AppError, parseWith } from '../../common/errors';
import { buildClearedSessionCookie, buildSessionCookie } from '../../common/cookies';
import { SlidingWindowLimiter } from '../../common/rate-limit';
import { loadConfig } from '../../config/env';
import type { RequestAuth, RequestWithAuth } from '../../common/tokens';
import { AuthService, type RequestMeta } from './auth.service';

function metaFrom(request: Request): RequestMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? request.socket?.remoteAddress ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
  };
}

@Controller('auth')
export class AuthController {
  private readonly config = loadConfig();

  /**
   * Per-IP budget on top of the per-account lockout. A distributed password
   * spray rotates usernames, so the account counter alone would never trigger.
   */
  private readonly loginLimiter = new SlidingWindowLimiter(10 * 60_000, 60);

  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const meta = metaFrom(request);
    if (meta.ip && !this.loginLimiter.hit(`login:${meta.ip}`)) {
      throw new AppError(
        'RATE_LIMITED',
        429,
        'تعداد تلاش‌های ورود از این شبکه زیاد بوده است. چند دقیقه بعد دوباره تلاش کنید.',
      );
    }

    const input = parseWith(loginSchema, body);
    const result = this.auth.login(input.username, input.password, meta, input.code);

    response.setHeader(
      'Set-Cookie',
      buildSessionCookie(result.token, {
        name: this.config.sessionCookieName,
        maxAgeSeconds: result.expiresInSeconds,
        secure: this.config.sessionCookieSecure,
      }),
    );

    return { user: result.user, modules: result.modules };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Req() request: RequestWithAuth, @Res({ passthrough: true }) response: Response) {
    if (request.auth) {
      this.auth.logout(
        request.auth.sessionId,
        { id: request.auth.userId, username: request.auth.username },
        { ip: request.ip ?? null, userAgent: null },
      );
    }
    response.setHeader(
      'Set-Cookie',
      buildClearedSessionCookie(this.config.sessionCookieName, this.config.sessionCookieSecure),
    );
    return { ok: true };
  }

  @Get('me')
  me(@CurrentAuth() auth: RequestAuth) {
    return this.auth.me(auth.userId);
  }

  @Get('mfa')
  mfaStatus(@CurrentAuth() auth: RequestAuth) {
    return this.auth.mfaStatus(auth.userId);
  }

  @Post('mfa/enroll')
  @HttpCode(200)
  enrollMfa(@CurrentAuth() auth: RequestAuth, @Req() request: Request) {
    return this.auth.enrollMfa(auth.userId, metaFrom(request));
  }

  @Post('mfa/activate')
  @HttpCode(200)
  activateMfa(@CurrentAuth() auth: RequestAuth, @Body() body: unknown, @Req() request: Request) {
    const input = parseWith(mfaCodeSchema, body);
    return this.auth.activateMfa(auth.userId, input.code, metaFrom(request));
  }

  @Post('mfa/recovery-codes')
  @HttpCode(200)
  regenerateRecoveryCodes(@CurrentAuth() auth: RequestAuth, @Body() body: unknown, @Req() request: Request) {
    const input = parseWith(mfaRecoverySchema, body);
    return this.auth.regenerateRecoveryCodes(auth.userId, input.password, input.code, metaFrom(request));
  }

  @Post('mfa/disable')
  @HttpCode(200)
  disableMfa(@CurrentAuth() auth: RequestAuth, @Body() body: unknown, @Req() request: Request) {
    const input = parseWith(mfaDisableSchema, body);
    return this.auth.disableMfa(auth.userId, input.password, input.code, metaFrom(request));
  }

  @Get('sessions')
  sessions(@CurrentAuth() auth: RequestAuth) {
    return { items: this.auth.listSessions(auth.userId, auth.sessionId) };
  }

  @Delete('sessions/:id')
  revokeSession(@CurrentAuth() auth: RequestAuth, @Param('id') id: string, @Req() request: Request) {
    this.auth.revokeSession(
      { userId: auth.userId, sessionId: auth.sessionId, permissions: auth.permissions },
      id,
      metaFrom(request),
    );
    return { ok: true };
  }

  @Post('password')
  @HttpCode(200)
  changePassword(
    @CurrentAuth() auth: RequestAuth,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const input = parseWith(changePasswordSchema, body);
    this.auth.changePassword(
      { userId: auth.userId, sessionId: auth.sessionId, username: auth.username },
      input.currentPassword,
      input.newPassword,
      metaFrom(request),
    );
    return { ok: true };
  }
}
