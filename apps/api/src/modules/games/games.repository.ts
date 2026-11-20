import { Inject, Injectable } from '@nestjs/common';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

export interface GameTableRow {
  table_id: string;
  table_name_fa: string;
  table_code: string;
  table_status: string;
  floor_name_fa: string | null;
  session_id: string | null;
}

/**
 * Table identity for the game rooms.
 *
 * This is deliberately read-only: a game never writes to the ordering tables, so
 * a room can never disturb a bill, a session or a QR that the cashier relies on.
 */
@Injectable()
export class GamesRepository {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  /**
   * Resolves a printed QR token to the table it belongs to. A promo QR, an
   * inactive QR and a table that was deleted all look the same to a guest: the
   * code is not valid any more.
   */
  findTableByQrToken(token: string): GameTableRow | undefined {
    return this.database.get<GameTableRow>(
      `SELECT t.id AS table_id, t.name_fa AS table_name_fa, t.code AS table_code,
              t.status AS table_status, f.name_fa AS floor_name_fa,
              (SELECT s.id FROM table_sessions s
                WHERE s.table_id = t.id AND s.status = 'open'
                ORDER BY s.opened_at DESC LIMIT 1) AS session_id
         FROM qr_codes q
         JOIN dining_tables t
           ON t.id = q.table_id AND t.deleted_at IS NULL AND t.is_active = 1
         LEFT JOIN floors f ON f.id = t.floor_id
        WHERE q.token = ? AND q.kind = 'table' AND q.is_active = 1`,
      [token],
    );
  }
}
