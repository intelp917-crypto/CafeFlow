import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  loadGame,
  manifest,
  messageFa,
  type GameId,
  type GameModule,
  type GameState,
  type MovePayload,
} from '@cafeflow/games';
import type { GameRoomPhase, GameRoomView } from '@cafeflow/shared';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';

/**
 * Rooms live for one sitting at one table.
 *
 * Everything here is in memory on purpose: a game is a few minutes of fun, not a
 * record. The moment the process restarts, the rooms are gone and nothing in the
 * ordering database was ever touched.
 */
export const LOBBY_GRACE_MS = 5 * 60_000;
export const PLAYING_GRACE_MS = 2 * 60_000;
export const ROOM_IDLE_MS = 60 * 60_000;

export interface RoomSeat {
  index: number;
  deviceId: string;
  nameFa: string;
  ready: boolean;
  connected: boolean;
  /** Stable for the seat's lifetime, so two tabs share one seat instead of two. */
  tokenHash: string;
  removed: boolean;
}

export interface Room {
  id: string;
  tableId: string;
  tableNameFa: string;
  gameId: GameId;
  phase: GameRoomPhase;
  seats: RoomSeat[];
  hostSeat: number;
  state: GameState | null;
  deadline: number;
  timer: NodeJS.Timeout | null;
  lastActivity: number;
}

export interface JoinInput {
  tableId: string;
  tableNameFa: string;
  /** The open table session (or `idle` before staff seats the guests). */
  epoch: string;
  gameId: GameId;
  deviceId: string;
  nameFa?: string;
}

export interface JoinResult {
  room: Room;
  seat: RoomSeat;
  token: string;
}

type UpdateListener = (room: Room) => void;

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function faNum(value: number): string {
  return String(value).replace(/\d/g, (digit) => FA_DIGITS[Number(digit)] ?? digit);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function roomKey(tableId: string, epoch: string, gameId: string): string {
  return `${tableId}:${epoch}:${gameId}`;
}

@Injectable()
export class RoomManager implements OnModuleDestroy {
  private readonly logger = new Logger(RoomManager.name);
  private readonly rooms = new Map<string, Room>();
  private readonly seatsByToken = new Map<string, { roomId: string; seatIndex: number }>();
  private readonly listeners = new Set<UpdateListener>();
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  /* ------------------------------- lifecycle ------------------------------- */

  /** The gateway subscribes once; the manager never touches sockets itself. */
  onUpdate(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(room: Room): void {
    room.lastActivity = Date.now();
    for (const listener of this.listeners) {
      try {
        listener(room);
      } catch (error) {
        this.logger.warn(`room listener failed: ${(error as Error).message}`);
      }
    }
  }

  join(input: JoinInput): JoinResult {
    const id = roomKey(input.tableId, input.epoch, input.gameId);
    let room = this.rooms.get(id);
    if (!room) {
      room = {
        id,
        tableId: input.tableId,
        tableNameFa: input.tableNameFa,
        gameId: input.gameId,
        phase: 'lobby',
        seats: [],
        hostSeat: 0,
        state: null,
        deadline: 0,
        timer: null,
        lastActivity: Date.now(),
      };
      this.rooms.set(id, room);
    }

    // The same phone (cookie) keeps its seat, so a refresh or a second tab is
    // not a second player.
    const existing = room.seats.find((seat) => seat.deviceId === input.deviceId && !seat.removed);
    if (existing) {
      const token = randomBytes(24).toString('base64url');
      this.seatsByToken.delete(existing.tokenHash);
      existing.tokenHash = hashToken(token);
      this.seatsByToken.set(existing.tokenHash, { roomId: room.id, seatIndex: existing.index });
      this.notify(room);
      return { room, seat: existing, token };
    }

    if (room.phase !== 'lobby') {
      throw conflict('این دست شروع شده است؛ برای بازی بعدی صبر کنید.', 'GAME_IN_PROGRESS');
    }

    const gameManifest = manifest(room.gameId);
    const taken = new Set(room.seats.filter((seat) => !seat.removed).map((seat) => seat.index));
    if (taken.size >= gameManifest.maxPlayers) {
      throw conflict('صندلی‌های این بازی پر شده است.', 'GAME_FULL');
    }

    let index = 0;
    while (taken.has(index)) index += 1;

    const token = randomBytes(24).toString('base64url');
    const seat: RoomSeat = {
      index,
      deviceId: input.deviceId,
      nameFa: input.nameFa?.trim() || `بازیکن ${faNum(index + 1)}`,
      ready: false,
      connected: false,
      tokenHash: hashToken(token),
      removed: false,
    };
    room.seats.push(seat);
    room.seats.sort((a, b) => a.index - b.index);
    if (room.seats.length === 1) room.hostSeat = seat.index;

    this.seatsByToken.set(seat.tokenHash, { roomId: room.id, seatIndex: seat.index });
    this.notify(room);
    return { room, seat, token };
  }

  findSeatByToken(token: string): { room: Room; seat: RoomSeat } | undefined {
    if (!token) return undefined;
    const entry = this.seatsByToken.get(hashToken(token));
    if (!entry) return undefined;
    const room = this.rooms.get(entry.roomId);
    if (!room) return undefined;
    const seat = room.seats.find((candidate) => candidate.index === entry.seatIndex && !candidate.removed);
    return seat ? { room, seat } : undefined;
  }

  roomById(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /* ------------------------------- connection ------------------------------ */

  markConnected(room: Room, seat: RoomSeat, connected: boolean): void {
    seat.connected = connected;
    room.lastActivity = Date.now();
    this.notify(room);
  }

  /** A closed socket keeps its seat for a short grace period, then frees it. */
  scheduleRemoval(room: Room, seat: RoomSeat): void {
    const grace = room.phase === 'playing' ? PLAYING_GRACE_MS : LOBBY_GRACE_MS;
    const timer = setTimeout(() => this.removeSeat(room, seat), grace);
    timer.unref?.();
  }

  leave(room: Room, seat: RoomSeat): void {
    this.removeSeat(room, seat);
  }

  private removeSeat(room: Room, seat: RoomSeat): void {
    if (seat.removed) return;
    if (seat.connected) return;

    if (room.phase === 'playing') {
      // The board keeps its seat index: the rules already own those indices and
      // renumbering would hand one player's cards to another.
      seat.removed = true;
      this.seatsByToken.delete(seat.tokenHash);
      const game = loadGame(room.gameId);
      game.setCurrentActor?.(room.state as GameState, this.nextActiveSeat(room, seat.index));
      this.armTimer(room);
      this.notify(room);
      return;
    }

    seat.removed = true;
    this.seatsByToken.delete(seat.tokenHash);
    const remaining = room.seats.filter((candidate) => !candidate.removed);
    room.seats = remaining;
    remaining.forEach((candidate, position) => {
      if (candidate.index === position) return;
      this.seatsByToken.delete(candidate.tokenHash);
      candidate.index = position;
      this.seatsByToken.set(candidate.tokenHash, { roomId: room.id, seatIndex: position });
    });

    if (remaining.length === 0) {
      this.dropRoom(room);
      return;
    }
    if (!remaining.some((candidate) => candidate.index === room.hostSeat)) {
      room.hostSeat = remaining[0]!.index;
    }
    this.notify(room);
  }

  private nextActiveSeat(room: Room, from: number): number {
    const active = room.seats.filter((seat) => !seat.removed);
    if (active.length === 0) return from;
    const after = active.find((seat) => seat.index > from);
    return (after ?? active[0]!).index;
  }

  private dropRoom(room: Room): void {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    for (const seat of room.seats) this.seatsByToken.delete(seat.tokenHash);
    if (this.rooms.get(room.id) === room) this.rooms.delete(room.id);
  }

  /* --------------------------------- lobby --------------------------------- */

  setReady(room: Room, seat: RoomSeat, ready: boolean): void {
    if (room.phase !== 'lobby') throw conflict('این دست شروع شده است.', 'GAME_IN_PROGRESS');
    seat.ready = ready;
    this.notify(room);
  }

  start(room: Room, seat: RoomSeat): void {
    const gameManifest = manifest(room.gameId);
    if (room.phase !== 'lobby') throw conflict('این دست قبلاً شروع شده است.', 'GAME_ALREADY_STARTED');
    if (seat.index !== room.hostSeat) throw forbidden('فقط میزبان می‌تواند بازی را شروع کند.', 'HOST_ONLY');

    const players = room.seats.filter((candidate) => !candidate.removed);
    if (players.length < gameManifest.minPlayers) {
      throw conflict(
        `این بازی دست‌کم ${faNum(gameManifest.minPlayers)} بازیکن می‌خواهد.`,
        'GAME_NEEDS_PLAYERS',
      );
    }
    if (!players.every((candidate) => candidate.ready)) {
      throw conflict('همهٔ بازیکنان باید آماده باشند.', 'GAME_NOT_READY');
    }

    const game = loadGame(room.gameId);
    const state = game.createState();
    game.initGame?.(state, players.length);

    room.state = state;
    room.phase = 'playing';
    room.deadline = 0;
    this.armTimer(room);
    this.notify(room);
  }

  /** Back to the waiting room after a finished hand, keeping the same seats. */
  restart(room: Room, seat: RoomSeat): void {
    if (seat.index !== room.hostSeat) throw forbidden('فقط میزبان می‌تواند دست تازه بدهد.', 'HOST_ONLY');
    if (room.phase === 'playing') throw conflict('این دست هنوز تمام نشده است.', 'GAME_IN_PROGRESS');
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.state = null;
    room.phase = 'lobby';
    room.deadline = 0;
    for (const candidate of room.seats) candidate.ready = false;
    this.notify(room);
  }

  /* --------------------------------- play ---------------------------------- */

  /** Returns a Persian message on a refused move, or null when it was applied. */
  move(room: Room, seat: RoomSeat, payload: MovePayload): string | null {
    if (room.phase !== 'playing' || !room.state) return 'این دست شروع نشده است.';
    if (seat.removed) return 'شما در این دست نیستید.';
    const game = loadGame(room.gameId);
    const state = room.state;

    const error = game.handleMove(payload ?? {}, state, seat.index);
    if (error) return messageFa(error);

    if (state.winner !== null && state.winner !== undefined) {
      room.phase = 'over';
      room.deadline = 0;
      if (room.timer) clearTimeout(room.timer);
      room.timer = null;
    } else {
      this.armTimer(room);
    }
    this.notify(room);
    return null;
  }

  /**
   * One timer drives both timed games and the realtime race:
   * - `phase` games (werewolf) schedule the module's own deadline and call `onTimeout`;
   * - `realtime` games (2048) tick so bots and the shared clock keep moving.
   */
  private armTimer(room: Room): void {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.deadline = 0;
    if (!room.state || room.phase !== 'playing') return;

    const game = loadGame(room.gameId);
    if (game.realtime && typeof game.tick === 'function') {
      const interval = Math.max(200, game.tickMs ?? 600);
      const timer = setTimeout(() => {
        if (room.phase !== 'playing' || !room.state) return;
        try {
          game.tick?.(room.state);
        } catch (error) {
          this.logger.warn(`tick failed for ${room.id}: ${(error as Error).message}`);
        }
        if (room.state.winner !== null && room.state.winner !== undefined) {
          room.phase = 'over';
          room.timer = null;
          this.notify(room);
          return;
        }
        this.armTimer(room);
        this.notify(room);
      }, interval);
      timer.unref?.();
      room.timer = timer;
      return;
    }

    if (typeof game.getPhaseDeadline !== 'function' || typeof game.onTimeout !== 'function') return;
    const deadline = game.getPhaseDeadline(room.state) || 0;
    if (!deadline) return;
    room.deadline = deadline;
    const delay = Math.max(250, deadline - Date.now());
    const timer = setTimeout(() => {
      if (room.phase !== 'playing' || !room.state) return;
      try {
        game.onTimeout?.(room.state);
      } catch (error) {
        this.logger.warn(`phase timeout failed for ${room.id}: ${(error as Error).message}`);
      }
      if (room.state.winner !== null && room.state.winner !== undefined) {
        room.phase = 'over';
        room.deadline = 0;
        room.timer = null;
        this.notify(room);
        return;
      }
      this.armTimer(room);
      this.notify(room);
    }, delay);
    timer.unref?.();
    room.timer = timer;
  }

  /* --------------------------------- views --------------------------------- */

  view(room: Room, viewerSeat: number): GameRoomView {
    const gameManifest = manifest(room.gameId);
    return {
      roomId: room.id,
      tableNameFa: room.tableNameFa,
      gameId: room.gameId,
      gameNameFa: gameManifest.nameFa,
      phase: room.phase,
      hostSeat: room.hostSeat,
      minPlayers: gameManifest.minPlayers,
      maxPlayers: gameManifest.maxPlayers,
      deadline: room.deadline,
      seats: room.seats
        .filter((seat) => !seat.removed)
        .map((seat) => ({
          index: seat.index,
          nameFa: seat.nameFa,
          ready: seat.ready,
          connected: seat.connected,
          isHost: seat.index === room.hostSeat,
          isYou: seat.index === viewerSeat,
        })),
    };
  }

  /** The rules' own per-seat projection; nothing else may be sent to a client. */
  stateFor(room: Room, seatIndex: number): GameState | null {
    if (!room.state) return null;
    const game: GameModule = loadGame(room.gameId);
    if (typeof game.playerView !== 'function') return room.state;
    return game.playerView(room.state, seatIndex);
  }

  /* -------------------------------- housekeeping --------------------------- */

  sweep(): void {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      const hasPeople = room.seats.some((seat) => !seat.removed && seat.connected);
      if (hasPeople) continue;
      if (now - room.lastActivity < ROOM_IDLE_MS) continue;
      this.dropRoom(room);
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
    for (const room of [...this.rooms.values()]) this.dropRoom(room);
    this.listeners.clear();
  }

  /** Test helper: a room that does not exist cannot be joined by a stale token. */
  removeRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) throw notFound('اتاق بازی پیدا نشد.', 'GAME_ROOM_NOT_FOUND');
    this.dropRoom(room);
  }

  /** Test/fixture helper: validates a seat index belongs to a live room. */
  requireSeat(roomId: string, seatIndex: number): RoomSeat {
    const room = this.rooms.get(roomId);
    const seat = room?.seats.find((candidate) => candidate.index === seatIndex && !candidate.removed);
    if (!room || !seat) throw badRequest('صندلی بازی پیدا نشد.', 'GAME_SEAT_NOT_FOUND');
    return seat;
  }
}
