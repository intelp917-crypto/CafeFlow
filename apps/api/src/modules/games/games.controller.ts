import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GAMES } from '@cafeflow/games';
import { gamesJoinSchema, type GameCatalogResponse } from '@cafeflow/shared';
import { Public } from '../../common/decorators';
import { AppError, parseWith } from '../../common/errors';
import { parseCookies } from '../../common/cookies';
import { SlidingWindowLimiter } from '../../common/rate-limit';
import { loadConfig } from '../../config/env';
import type { RequestWithAuth } from '../../common/tokens';
import { PublicService } from '../public/public.service';
import { GamesService } from './games.service';

const DEVICE_COOKIE = 'cafe_device';
const DEVICE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * The unauthenticated game surface.
 *
 * A guest proves where they are with the QR sticker on the table and nothing
 * else; there is no staff session, no phone number and no account. Joining only
 * hands back a seat token — the seat is claimed on the socket, not here.
 */
@Controller('public/games')
export class GamesController {
  private readonly config = loadConfig();
  private readonly deviceLimiter = new SlidingWindowLimiter(60_000, 30);
  private readonly ipLimiter = new SlidingWindowLimiter(60_000, 120);

  constructor(
    @Inject(GamesService) private readonly games: GamesService,
    @Inject(PublicService) private readonly publicService: PublicService,
  ) {}

  @Public()
  @Get('catalog')
  catalog(): GameCatalogResponse {
    return { games: GAMES.map((game) => ({ ...game })) };
  }

  @Public()
  @Post('join')
  @HttpCode(201)
  join(
    @Body() body: unknown,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseWith(gamesJoinSchema, body);
    const device = this.publicService.resolveDevice(
      parseCookies(request.headers.cookie as string | undefined)[DEVICE_COOKIE],
    );
    if (device.isNew) this.applyDeviceCookie(response, device.token);

    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    if (!this.deviceLimiter.hit(device.deviceId) || !this.ipLimiter.hit(ip)) {
      throw new AppError('RATE_LIMITED', 429, 'تعداد تلاش‌ها زیاد بود؛ کمی بعد دوباره امتحان کنید.');
    }

    return this.games.join({
      qrToken: input.qrToken,
      gameId: input.gameId,
      nameFa: input.nameFa,
      deviceId: device.deviceId,
    });
  }

  private applyDeviceCookie(response: Response, token: string): void {
    const parts = [
      `${DEVICE_COOKIE}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${DEVICE_COOKIE_MAX_AGE}`,
    ];
    if (this.config.sessionCookieSecure) parts.push('Secure');
    response.setHeader('Set-Cookie', parts.join('; '));
  }
}
