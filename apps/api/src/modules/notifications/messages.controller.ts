import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { createTemplateSchema, sendMessageSchema, updateTemplateSchema } from '@cafeflow/shared';
import { z } from 'zod';
import { CurrentAuth, Permissions, RequireModule } from '../../common/decorators';
import { parseWith } from '../../common/errors';
import type { RequestAuth } from '../../common/tokens';
import { MessagesService } from './messages.service';

const failedSchema = z.object({
  error: z.string({ error: 'متن خطا الزامی است.' }).trim().min(2, 'متن خطا الزامی است.').max(300),
});

/**
 * Templates and the outbound queue. Queuing a message is not proof of delivery;
 * a bridge confirms each row with `sent` or `failed`.
 */
@Controller('messages')
@RequireModule('notifications')
export class MessagesController {
  constructor(@Inject(MessagesService) private readonly messages: MessagesService) {}

  @Get()
  @Permissions('messages.read')
  overview(@Query('status') status?: string, @Query('limit') limit?: string) {
    const parsed = Number(limit);
    const safe = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 200) : 60;
    return this.messages.overview(status, safe);
  }

  @Post('templates')
  @Permissions('messages.write')
  createTemplate(@Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.messages.createTemplate(parseWith(createTemplateSchema, body), {
      userId: auth.userId,
      username: auth.username,
    });
  }

  @Patch('templates/:id')
  @Permissions('messages.write')
  updateTemplate(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.messages.updateTemplate(id, parseWith(updateTemplateSchema, body), {
      userId: auth.userId,
      username: auth.username,
    });
  }

  @Post('send')
  @Permissions('messages.write')
  send(@Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.messages.send(parseWith(sendMessageSchema, body), {
      userId: auth.userId,
      username: auth.username,
    });
  }

  @Post(':id/sent')
  @HttpCode(200)
  @Permissions('messages.write')
  markSent(@Param('id') id: string, @CurrentAuth() auth: RequestAuth) {
    return this.messages.markSent(id, { userId: auth.userId, username: auth.username });
  }

  @Post(':id/failed')
  @HttpCode(200)
  @Permissions('messages.write')
  markFailed(@Param('id') id: string, @Body() body: unknown, @CurrentAuth() auth: RequestAuth) {
    return this.messages.markFailed(id, parseWith(failedSchema, body).error, {
      userId: auth.userId,
      username: auth.username,
    });
  }
}
