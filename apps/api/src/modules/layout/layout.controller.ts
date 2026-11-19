import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import QRCode from 'qrcode';
import {
  createAreaSchema,
  createFloorSchema,
  createLayoutTableSchema,
  saveFloorplanSchema,
  updateAreaSchema,
  updateFloorSchema,
  updateLayoutTableSchema,
} from '@cafeflow/shared';
import { CurrentAuth, Permissions } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import type { RequestAuth } from '../../common/tokens';
import { LayoutService } from './layout.service';

function actorOf(auth: RequestAuth) {
  return { userId: auth.userId, username: auth.username };
}

/** The browser origin is a safe fallback for building customer QR links. */
function baseOf(request: Request, queryBase?: string): string | undefined {
  return queryBase ?? (typeof request.headers.origin === 'string' ? request.headers.origin : undefined);
}

@Controller('layout')
export class LayoutController {
  constructor(@Inject(LayoutService) private readonly layout: LayoutService) {}

  @Get()
  @Permissions('layout.read')
  overview() {
    return this.layout.overview();
  }

  /* --------------------------------- floors -------------------------------- */

  @Post('floors')
  @Permissions('layout.write')
  createFloor(@Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.layout.createFloor(parseWith(createFloorSchema, body), actorOf(auth));
  }

  @Patch('floors/:floorId')
  @Permissions('layout.write')
  updateFloor(@Param('floorId') floorId: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.layout.updateFloor(floorId, parseWith(updateFloorSchema, body), actorOf(auth));
  }

  @Delete('floors/:floorId')
  @Permissions('layout.write')
  deleteFloor(@Param('floorId') floorId: string, @CurrentAuth() auth: RequestAuth) {
    return this.layout.deleteFloor(floorId, actorOf(auth));
  }

  @Post('floors/:floorId/areas')
  @Permissions('layout.write')
  createArea(@Param('floorId') floorId: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    const { nameFa } = parseWith(createAreaSchema, body);
    return this.layout.createArea(floorId, nameFa, actorOf(auth));
  }

  @Patch('areas/:areaId')
  @Permissions('layout.write')
  updateArea(@Param('areaId') areaId: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.layout.updateArea(areaId, parseWith(updateAreaSchema, body), actorOf(auth));
  }

  @Delete('areas/:areaId')
  @Permissions('layout.write')
  deleteArea(@Param('areaId') areaId: string, @CurrentAuth() auth: RequestAuth) {
    return this.layout.deleteArea(areaId, actorOf(auth));
  }

  /* ---------------------------------- plan --------------------------------- */

  @Put('floors/:floorId/plan')
  @HttpCode(200)
  @Permissions('layout.write')
  savePlan(@Param('floorId') floorId: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.layout.savePlan(floorId, parseWith(saveFloorplanSchema, body), actorOf(auth));
  }

  @Get('floors/:floorId/versions')
  @Permissions('layout.read')
  versions(@Param('floorId') floorId: string) {
    return this.layout.versions(floorId);
  }

  @Post('floors/:floorId/versions/:versionId/restore')
  @HttpCode(200)
  @Permissions('layout.write')
  restore(@Param('floorId') floorId: string, @Param('versionId') versionId: string, @CurrentAuth() auth: RequestAuth) {
    return this.layout.restoreVersion(floorId, versionId, actorOf(auth));
  }

  /* --------------------------------- tables -------------------------------- */

  @Post('tables')
  @Permissions('layout.write')
  createTable(@Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.layout.createTable(parseWith(createLayoutTableSchema, body), actorOf(auth));
  }

  @Patch('tables/:tableId')
  @Permissions('layout.write')
  updateTable(@Param('tableId') tableId: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.layout.updateTable(tableId, parseWith(updateLayoutTableSchema, body), actorOf(auth));
  }

  @Delete('tables/:tableId')
  @Permissions('layout.write')
  deleteTable(@Param('tableId') tableId: string, @CurrentAuth() auth: RequestAuth) {
    return this.layout.deleteTable(tableId, actorOf(auth));
  }

  /* ----------------------------------- QR ---------------------------------- */

  @Get('tables/:tableId/qr')
  @Permissions('layout.read')
  qr(@Param('tableId') tableId: string, @Req() request: Request, @Query('base') base?: string) {
    return this.layout.tableQr(tableId, baseOf(request, base));
  }

  @Post('tables/:tableId/qr')
  @HttpCode(200)
  @Permissions('layout.write')
  regenerateQr(@Param('tableId') tableId: string, @CurrentAuth() auth: RequestAuth) {
    return this.layout.regenerateQr(tableId, actorOf(auth));
  }

  /**
   * The raster/link QR endpoints are images, not JSON: the admin page shows
   * them in an <img> and downloads the same bytes, so no second library is
   * needed in the browser.
   */
  @Get('tables/:tableId/qr.png')
  @Permissions('layout.read')
  async qrPng(
    @Param('tableId') tableId: string,
    @Req() request: Request,
    @Res() response: Response,
    @Query('size') size?: string,
    @Query('base') base?: string,
  ): Promise<void> {
    const qr = this.layout.tableQr(tableId, baseOf(request, base));
    const width = Math.min(Math.max(Number(size) || 512, 128), 1200);
    const buffer = await QRCode.toBuffer(qr.menuUrl, {
      type: 'png',
      width,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#241611ff', light: '#fffcf6ff' },
    });

    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Content-Disposition', `inline; filename="qr-${qr.tableId}.png"`);
    response.setHeader('Cache-Control', 'private, max-age=0, no-store');
    response.send(buffer);
  }

  @Get('tables/:tableId/qr.svg')
  @Permissions('layout.read')
  async qrSvg(
    @Param('tableId') tableId: string,
    @Req() request: Request,
    @Res() response: Response,
    @Query('size') size?: string,
    @Query('base') base?: string,
  ): Promise<void> {
    const qr = this.layout.tableQr(tableId, baseOf(request, base));
    const width = Math.min(Math.max(Number(size) || 512, 128), 1200);
    const svg = await QRCode.toString(qr.menuUrl, {
      type: 'svg',
      width,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#241611', light: '#fffcf6' },
    });

    response.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    response.setHeader('Cache-Control', 'private, max-age=0, no-store');
    response.send(svg);
  }
}
