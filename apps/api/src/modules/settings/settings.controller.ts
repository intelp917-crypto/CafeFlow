import { Body, Controller, Get, Inject, Param, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import { toggleModuleSchema, updateSettingsSchema } from '@cafeflow/shared';
import { CurrentAuth, Permissions } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import type { RequestAuth } from '../../common/tokens';
import { SettingsService } from './settings.service';

function meta(request: Request) {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? request.socket?.remoteAddress ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
  };
}

@Controller()
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get('settings')
  @Permissions('settings.read')
  getSettings() {
    return this.settings.getSettings();
  }

  @Patch('settings')
  @Permissions('settings.write')
  updateSettings(@CurrentAuth() auth: RequestAuth, @Body() body: unknown, @Req() request: Request) {
    const input = parseWith(updateSettingsSchema, body);
    return this.settings.updateSettings(
      input,
      { userId: auth.userId, username: auth.username },
      meta(request),
    );
  }

  @Get('modules')
  @Permissions('modules.read')
  listModules() {
    return { items: this.settings.listModules() };
  }

  @Patch('modules/:key')
  @Permissions('modules.manage')
  setModule(
    @CurrentAuth() auth: RequestAuth,
    @Param('key') key: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const { enabled } = parseWith(toggleModuleSchema, body);

    return this.settings.setModuleEnabled(
      key,
      enabled,
      { userId: auth.userId, username: auth.username },
      meta(request),
    );
  }
}
