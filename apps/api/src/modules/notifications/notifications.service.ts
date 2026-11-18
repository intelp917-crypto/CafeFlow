import { Inject, Injectable } from '@nestjs/common';
import type { NotificationsResponse } from '@cafeflow/shared';
import { notFound } from '../../common/errors';
import { NotificationsRepository, type NotificationAudience } from './notifications.repository';

@Injectable()
export class NotificationsService {
  constructor(@Inject(NotificationsRepository) private readonly repository: NotificationsRepository) {}

  list(audience: NotificationAudience, unreadOnly: boolean): NotificationsResponse {
    return {
      items: this.repository.list(audience, unreadOnly),
      unreadCount: this.repository.countUnread(audience),
    };
  }

  markRead(id: string, audience: NotificationAudience): { id: string; isRead: true; unreadCount: number } {
    if (!this.repository.markRead(id, audience)) {
      throw notFound('اعلان یافت نشد یا به شما تعلق ندارد.', 'NOTIFICATION_NOT_FOUND');
    }
    return { id, isRead: true, unreadCount: this.repository.countUnread(audience) };
  }

  markAllRead(audience: NotificationAudience): { updated: number; unreadCount: number } {
    return { updated: this.repository.markAllRead(audience), unreadCount: 0 };
  }
}
