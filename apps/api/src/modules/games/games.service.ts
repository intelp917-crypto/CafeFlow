import { Inject, Injectable } from '@nestjs/common';
import { isGameId, manifest } from '@cafeflow/games';
import type { GameJoinResponse } from '@cafeflow/shared';
import { GamesRepository } from './games.repository';
import { RoomManager } from './room-manager';
import { badRequest, conflict, notFound } from '../../common/errors';

export interface JoinRequest {
  qrToken: string;
  gameId: string;
  nameFa?: string;
  deviceId: string;
}

/**
 * Joining a table game is a two-step decision the server makes alone:
 *
 * 1. the QR token *is* the table — a client can never name another table;
 * 2. one room per table and game for the current sitting, so everyone who scans
 *    the same sticker ends up at the same table.
 */
@Injectable()
export class GamesService {
  constructor(
    @Inject(GamesRepository) private readonly repository: GamesRepository,
    @Inject(RoomManager) private readonly rooms: RoomManager,
  ) {}

  join(input: JoinRequest): GameJoinResponse {
    if (!isGameId(input.gameId)) {
      throw badRequest('این بازی در دسترس نیست.', 'GAME_UNKNOWN');
    }
    // Listed but not yet rendered: a room with no screen would strand the table.
    if (!manifest(input.gameId).playable) {
      throw badRequest('این بازی هنوز روی این نسخه آماده نیست.', 'GAME_NOT_READY');
    }

    const table = this.repository.findTableByQrToken(input.qrToken);
    if (!table) {
      throw notFound('این کد QR معتبر نیست یا غیرفعال شده است.', 'QR_NOT_FOUND');
    }
    if (table.table_status === 'cleaning' || table.table_status === 'unavailable') {
      throw conflict('این میز الان آمادهٔ بازی نیست.', 'TABLE_NOT_READY');
    }

    const { room, seat, token } = this.rooms.join({
      tableId: table.table_id,
      tableNameFa: table.table_name_fa,
      epoch: table.session_id ?? 'idle',
      gameId: input.gameId,
      deviceId: input.deviceId,
      nameFa: input.nameFa,
    });

    return {
      seatToken: token,
      seat: seat.index,
      room: this.rooms.view(room, seat.index),
      state: this.rooms.stateFor(room, seat.index) as Record<string, unknown> | null,
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    };
  }
}
