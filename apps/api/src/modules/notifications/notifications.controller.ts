import { Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { CurrentAuth } from '../../common/decorators';
import type { RequestAuth } from '../../common/tokens';
import { NotificationsService } from './notifications.service';

/**
 * No permission decorator: every signed-in user may read their own inbox.
 * The query is scoped to the caller's user id and role keys.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentAuth() auth: RequestAuth, @Query('unread') unread?: string) {
    return this.notifications.list(auth, unread === '1' || unread === 'true');
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentAuth() auth: RequestAuth) {
    return this.notifications.markAllRead(auth);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@Param('id') id: string, @CurrentAuth() auth: RequestAuth) {
    return this.notifications.markRead(id, auth);
  }
}
