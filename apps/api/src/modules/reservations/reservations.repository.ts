import { Inject, Injectable } from '@nestjs/common';
import type { ReservationStatus } from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

export interface ReservationDbRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  guest_count: number;
  reserved_for: string;
  duration_minutes: number;
  table_id: string | null;
  table_code: string | null;
  table_name_fa: string | null;
  table_capacity: number | null;
  status: ReservationStatus;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

const SELECT_RESERVATION = `
  SELECT r.id, r.customer_name, r.customer_phone, r.guest_count, r.reserved_for, r.duration_minutes,
         r.table_id, t.code AS table_code, t.name_fa AS table_name_fa, t.capacity AS table_capacity,
         r.status, r.note, u.full_name AS created_by_name, r.created_at
    FROM reservations r
    LEFT JOIN dining_tables t ON t.id = r.table_id
    LEFT JOIN users u ON u.id = r.created_by_user_id`;

export interface ReservationListFilter {
  fromIso?: string;
  toIso?: string;
  status?: ReservationStatus;
  tableId?: string;
  upcomingOnly: boolean;
}

@Injectable()
export class ReservationsRepository {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  list(filter: ReservationListFilter, limit = 200): ReservationDbRow[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.fromIso) {
      clauses.push('r.reserved_for >= ?');
      params.push(filter.fromIso);
    }
    if (filter.toIso) {
      clauses.push('r.reserved_for < ?');
      params.push(filter.toIso);
    }
    if (filter.status) {
      clauses.push('r.status = ?');
      params.push(filter.status);
    }
    if (filter.tableId) {
      clauses.push('r.table_id = ?');
      params.push(filter.tableId);
    }
    if (filter.upcomingOnly && !filter.fromIso) {
      clauses.push('r.reserved_for >= ?');
      params.push(new Date(Date.now() - 3_600_000).toISOString());
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.database.all<ReservationDbRow>(
      `${SELECT_RESERVATION} ${where} ORDER BY r.reserved_for ASC LIMIT ?`,
      [...params, limit],
    );
  }

  findById(id: string): ReservationDbRow | undefined {
    return this.database.get<ReservationDbRow>(`${SELECT_RESERVATION} WHERE r.id = ?`, [id]);
  }

  /**
   * Returns the first reservation whose time window intersects the requested
   * one. Interval arithmetic runs in SQLite (`julianday`) so a fractional
   * duration can never be rounded differently by the API and the database.
   */
  findOverlap(
    tableId: string,
    startIso: string,
    durationMinutes: number,
    excludeId?: string,
  ): ReservationDbRow | undefined {
    return this.database.get<ReservationDbRow>(
      `${SELECT_RESERVATION}
        WHERE r.table_id = ?
          AND r.status IN ('pending', 'confirmed', 'seated')
          AND julianday(r.reserved_for) < julianday(?) + ? / 1440.0
          AND julianday(?) < julianday(r.reserved_for) + r.duration_minutes / 1440.0
          AND (? IS NULL OR r.id <> ?)
        ORDER BY r.reserved_for ASC
        LIMIT 1`,
      [tableId, startIso, durationMinutes, startIso, excludeId ?? null, excludeId ?? null],
    );
  }

  findTable(tableId: string): { id: string; code: string; name_fa: string; capacity: number; status: string } | undefined {
    return this.database.get<{ id: string; code: string; name_fa: string; capacity: number; status: string }>(
      'SELECT id, code, name_fa, capacity, status FROM dining_tables WHERE id = ?',
      [tableId],
    );
  }

  hasOpenSession(tableId: string): boolean {
    return (
      this.database.count(
        'SELECT COUNT(*) AS n FROM table_sessions WHERE table_id = ? AND closed_at IS NULL',
        [tableId],
      ) > 0
    );
  }

  insert(input: {
    id: string;
    customerName: string;
    customerPhone: string;
    guestCount: number;
    reservedFor: string;
    durationMinutes: number;
    tableId: string | null;
    note: string | null;
    createdByUserId: string;
  }): void {
    this.database.run(
      `INSERT INTO reservations
        (id, customer_name, customer_phone, guest_count, reserved_for, duration_minutes,
         table_id, status, note, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        input.id,
        input.customerName,
        input.customerPhone,
        input.guestCount,
        input.reservedFor,
        input.durationMinutes,
        input.tableId,
        input.note,
        input.createdByUserId,
      ],
    );
  }

  updateStatus(id: string, status: ReservationStatus, decidedByUserId: string): void {
    this.database.run(
      `UPDATE reservations
          SET status = ?, decided_by_user_id = ?, updated_at = ?
        WHERE id = ?`,
      [status, decidedByUserId, new Date().toISOString(), id],
    );
  }

  setTableStatus(tableId: string, status: string): void {
    this.database.run('UPDATE dining_tables SET status = ? WHERE id = ?', [status, tableId]);
  }

  statusCounts(): { pending: number; confirmed: number; seated: number } {
    const rows = this.database.all<{ status: string; n: number }>(
      `SELECT status, COUNT(*) AS n FROM reservations
        WHERE status IN ('pending', 'confirmed', 'seated')
        GROUP BY status`,
    );
    const map = new Map(rows.map((row) => [row.status, row.n]));
    return {
      pending: map.get('pending') ?? 0,
      confirmed: map.get('confirmed') ?? 0,
      seated: map.get('seated') ?? 0,
    };
  }
}
