import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MessagesController } from './messages.controller';
import { MessagesRepository } from './messages.repository';
import { MessagesService } from './messages.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [AuditModule],
  controllers: [NotificationsController, MessagesController],
  providers: [NotificationsRepository, NotificationsService, MessagesRepository, MessagesService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
