import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  RESERVATION_STATUS_LABELS_FA,
  RESERVATION_TRANSITIONS,
  normalizePhone,
  type CreateReservationInput,
  type ListReservationsQuery,
  type ReservationRow,
  type ReservationStatus,
  type ReservationStatusInput,
  type ReservationsResponse,
} from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';
import { AuditService } from '../audit/audit.service';
import { badRequest, conflict, notFound } from '../../common/errors';
import { ReservationsRepository, type ReservationDbRow } from './reservations.repository';
import type { ActingUser } from '../orders/orders.service';

/** Reservations accept times up to a year ahead and no more than an hour back. */
const MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
const GRACE_MS = 60 * 60 * 1000;

function toRow(row: ReservationDbRow): ReservationRow {
  return {
    id: row.id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    guestCount: row.guest_count,
    reservedFor: row.reserved_for,
    durationMinutes: row.duration_minutes,
    tableId: row.table_id,
    tableCode: row.table_code,
    tableNameFa: row.table_name_fa,
    tableCapacity: row.table_capacity,
    status: row.status,
    statusLabelFa: RESERVATION_STATUS_LABELS_FA[row.status] ?? row.status,
    note: row.note,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    allowedStatuses: RESERVATION_TRANSITIONS[row.status].map((status) => ({
      status,
      labelFa: RESERVATION_STATUS_LABELS_FA[status],
    })),
  };
}

@Injectable()
export class ReservationsService {
  constructor(
    @Inject(DB_SERVICE) private readonly database: DatabaseService,
    @Inject(ReservationsRepository) private readonly repository: ReservationsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  list(query: ListReservationsQuery): ReservationsResponse {
    let fromIso: string | undefined;
    let toIso: string | undefined;

    if (query.date) {
      // A Tehran calendar day starts at 00:00 +03:30, so shift the UTC parse.
      const start = Date.parse(`${query.date}T00:00:00Z`) - 210 * 60_000;
      if (Number.isNaN(start)) throw badRequest('تاریخ انتخابی معتبر نیست.', 'INVALID_DATE');
      fromIso = new Date(start).toISOString();
      toIso = new Date(start + 86_400_000).toISOString();
    }

    const items = this.repository
      .list({
        fromIso,
        toIso,
        status: query.status as ReservationStatus | undefined,
        tableId: query.tableId,
        upcomingOnly: query.scope === 'upcoming',
      })
      .map(toRow);

    return { items, summary: this.repository.statusCounts() };
  }

  create(input: CreateReservationInput, actor: ActingUser): ReservationRow {
    const reservedFor = new Date(input.reservedFor);
    const timestamp = reservedFor.getTime();
    const now = Date.now();

    if (timestamp < now - GRACE_MS) {
      throw badRequest('زمان رزرو نمی‌تواند در گذشته باشد.', 'RESERVATION_IN_PAST');
    }
    if (timestamp > now + MAX_AHEAD_MS) {
      throw badRequest('رزرو بیش از یک سال آینده ممکن نیست.', 'RESERVATION_TOO_FAR');
    }

    const table = input.tableId ? this.repository.findTable(input.tableId) : undefined;
    if (input.tableId && !table) {
      throw notFound('میز انتخابی یافت نشد.', 'TABLE_NOT_FOUND');
    }

    if (table && input.guestCount > table.capacity) {
      throw badRequest(
        `ظرفیت ${table.name_fa} برابر ${table.capacity} نفر است و برای ${input.guestCount} مهمان کافی نیست.`,
        'CAPACITY_EXCEEDED',
        { tableId: table.id, capacity: table.capacity, guestCount: input.guestCount },
      );
    }

    if (table) {
      const overlap = this.repository.findOverlap(table.id, reservedFor.toISOString(), input.durationMinutes);
      if (overlap) {
        throw conflict(
          `این میز در بازه ${new Date(overlap.reserved_for).toLocaleTimeString('fa-IR', {
            hour: '2-digit',
            minute: '2-digit',
          })} تا ${new Date(
            Date.parse(overlap.reserved_for) + overlap.duration_minutes * 60_000,
          ).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })} رزرو دیگری دارد.`,
          'RESERVATION_CONFLICT',
          { conflictId: overlap.id, reservedFor: overlap.reserved_for, durationMinutes: overlap.duration_minutes },
        );
      }
    }

    const id = randomUUID();
    const phone = normalizePhone(input.customerPhone);

    this.database.transaction(() => {
      this.repository.insert({
        id,
        customerName: input.customerName,
        customerPhone: phone,
        guestCount: input.guestCount,
        reservedFor: reservedFor.toISOString(),
        durationMinutes: input.durationMinutes,
        tableId: table?.id ?? null,
        note: input.note ?? null,
        createdByUserId: actor.userId,
      });
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'reservation.created',
      entityType: 'reservation',
      entityId: id,
      after: {
        customerName: input.customerName,
        guestCount: input.guestCount,
        reservedFor: reservedFor.toISOString(),
        tableId: table?.id ?? null,
      },
    });

    const created = this.repository.findById(id);
    if (!created) throw notFound('رزرو ثبت نشد.', 'RESERVATION_NOT_CREATED');
    return toRow(created);
  }

  changeStatus(id: string, input: ReservationStatusInput, actor: ActingUser): ReservationRow {
    const reservation = this.repository.findById(id);
    if (!reservation) throw notFound('رزرو یافت نشد.', 'RESERVATION_NOT_FOUND');

    if (reservation.status === input.status) {
      return toRow(reservation);
    }

    if (!RESERVATION_TRANSITIONS[reservation.status].includes(input.status)) {
      throw conflict(
        `تغییر وضعیت از «${RESERVATION_STATUS_LABELS_FA[reservation.status]}» به «${RESERVATION_STATUS_LABELS_FA[input.status]}» مجاز نیست.`,
        'RESERVATION_TRANSITION_INVALID',
      );
    }

    if (input.status === 'seated' && reservation.table_id && this.repository.hasOpenSession(reservation.table_id)) {
      throw conflict('این میز هم‌اکنون نشست باز دارد.', 'TABLE_OCCUPIED');
    }

    this.database.transaction(() => {
      this.repository.updateStatus(id, input.status, actor.userId);

      if (reservation.table_id) {
        const table = this.repository.findTable(reservation.table_id);
        if (table) {
          if (input.status === 'confirmed' && table.status === 'available') {
            this.repository.setTableStatus(table.id, 'reserved');
          } else if (input.status === 'seated') {
            this.repository.setTableStatus(table.id, 'occupied');
          } else if (
            (input.status === 'cancelled' || input.status === 'no_show') &&
            table.status === 'reserved' &&
            !this.repository.hasOpenSession(table.id)
          ) {
            this.repository.setTableStatus(table.id, 'available');
          }
        }
      }
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'reservation.status_changed',
      entityType: 'reservation',
      entityId: id,
      before: { status: reservation.status },
      after: { status: input.status, reason: input.reason ?? null },
    });

    const updated = this.repository.findById(id);
    if (!updated) throw notFound('رزرو یافت نشد.', 'RESERVATION_NOT_FOUND');
    return toRow(updated);
  }
}
