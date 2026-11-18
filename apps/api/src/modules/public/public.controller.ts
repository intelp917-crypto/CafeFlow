import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { publicOrderSchema, publicRequestSchema, publicTerminalRequestSchema } from '@cafeflow/shared';
import { Public } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import { parseCookies } from '../../common/cookies';
import { loadConfig } from '../../config/env';
import type { RequestWithAuth } from '../../common/tokens';
import { PublicService } from './public.service';

const DEVICE_COOKIE = 'cafe_device';
const DEVICE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * The customer surface. Nothing here trusts the client for prices, discounts or
 * table identity: the QR token resolves the table server-side, and the device
 * cookie is only a pseudonymous identifier for rate limiting and tracking.
 */
@Controller('public')
export class PublicController {
  private readonly config = loadConfig();

  constructor(@Inject(PublicService) private readonly publicService: PublicService) {}

  @Public()
  @Get('menu')
  getMenu(
    @Query('qr') qr: string | undefined,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: Response,
  ) {
    const device = this.ensureDevice(request);
    this.applyDeviceCookie(response, device.token, device.isNew);
    return this.publicService.getMenu(typeof qr === 'string' && qr.length > 0 ? qr : undefined);
  }

  @Public()
  @Post('orders')
  @HttpCode(201)
  createOrder(
    @Body() body: unknown,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseWith(publicOrderSchema, body);
    const device = this.ensureDevice(request);
    this.applyDeviceCookie(response, device.token, device.isNew);
    return this.publicService.createOrder(input, device, this.clientIp(request));
  }

  @Public()
  @Get('orders/:code')
  orderStatus(@Param('code') code: string) {
    return this.publicService.getOrderStatus(code.trim().toUpperCase());
  }

  @Public()
  @Post('requests')
  @HttpCode(201)
  createRequest(
    @Body() body: unknown,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseWith(publicRequestSchema, body);
    const device = this.ensureDevice(request);
    this.applyDeviceCookie(response, device.token, device.isNew);
    return this.publicService.createRequest(input, device, this.clientIp(request));
  }

  @Public()
  @Post('terminal-requests')
  @HttpCode(201)
  createTerminalRequest(
    @Body() body: unknown,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseWith(publicTerminalRequestSchema, body);
    const device = this.ensureDevice(request);
    this.applyDeviceCookie(response, device.token, device.isNew);
    return this.publicService.createRequest(
      {
        qrToken: input.qrToken,
        type: 'terminal',
        note: input.note,
        orderCode: input.orderCode,
      },
      device,
      this.clientIp(request),
    );
  }

  private clientIp(request: RequestWithAuth): string | undefined {
    const ip = request.ip ?? request.socket?.remoteAddress;
    return typeof ip === 'string' && ip.length > 0 ? ip : undefined;
  }

  private ensureDevice(request: RequestWithAuth) {
    const cookies = parseCookies(request.headers.cookie as string | undefined);
    return this.publicService.resolveDevice(cookies[DEVICE_COOKIE]);
  }

  private applyDeviceCookie(response: Response, token: string, isNew: boolean): void {
    if (!isNew) return;
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
