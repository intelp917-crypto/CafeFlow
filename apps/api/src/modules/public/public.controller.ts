import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  publicOrderItemsSchema,
  publicOrderSchema, publicRequestSchema, publicTerminalRequestSchema } from '@cafeflow/shared';
import { Public } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import { parseCookies } from '../../common/cookies';
import { loadConfig } from '../../config/env';
import type { RequestWithAuth } from '../../common/tokens';
import { MediaService } from '../catalog/media.service';
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

  constructor(
    @Inject(PublicService) private readonly publicService: PublicService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

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

  /**
   * The admin-uploaded logo as the installed-app icon. Served same-origin, so
   * the PWA manifest can point at it. Falls back to the bundled icon when none.
   */
  @Public()
  @Get('branding/icon/:size')
  brandingIcon(@Param('size') size: string, @Res() response: Response) {
    const logo = this.publicService.getLogoImage();
    if (!logo) {
      response.redirect(302, `/icon-${size === '512' ? '512' : '192'}.png`);
      return;
    }
    response.setHeader('Content-Type', logo.mime);
    response.setHeader('Cache-Control', 'no-cache');
    response.end(logo.bytes);
  }

  /** Uploaded product photo, served same-origin and cached for good. */
  @Public()
  @Get('product-images/:file')
  productImage(@Param('file') file: string, @Res() response: Response) {
    const image = this.media.read(file);
    response.setHeader('Content-Type', image.mime);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(image.bytes);
  }

  /** The café name as configured in Settings, for the whole UI shell. */
  @Public()
  @Get('branding')
  branding() {
    return this.publicService.getBranding();
  }

  @Public()
  @Get('branding/manifest')
  brandingManifest() {
    const custom = this.publicService.getLogoImage() !== null;
    const iconSrc = (size: number) =>
      custom ? `/api/v1/public/branding/icon/${size}` : `/icon-${size}.png`;
    const branding = this.publicService.getBranding();
    return {
      name: `${branding.nameFa} — مدیریت کافه و رستوران`,
      short_name: branding.nameFa,
      description: 'منوی QR، سفارش، آماده‌سازی، صندوق، رزرو و گزارش‌های کافه و رستوران',
      lang: 'fa-IR',
      dir: 'rtl',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait-primary',
      background_color: '#f8f5f2',
      theme_color: '#aa472b',
      icons: [
        { src: iconSrc(192), sizes: '192x192', purpose: 'any' },
        { src: iconSrc(512), sizes: '512x512', purpose: 'any' },
      ],
    };
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
  orderStatus(
    @Param('code') code: string,
    @Query('token') token: string | undefined,
    @Req() request: RequestWithAuth,
  ) {
    return this.publicService.getOrderStatus(code.trim().toUpperCase(), token, this.clientIp(request));
  }

  @Public()
  @Post('orders/:code/items')
  addItems(@Param('code') code: string, @Query('token') token: string | undefined, @Body() body: unknown) {
    return this.publicService.addOrderItems(
      code.trim().toUpperCase(),
      token,
      parseWith(publicOrderItemsSchema, body),
    );
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
