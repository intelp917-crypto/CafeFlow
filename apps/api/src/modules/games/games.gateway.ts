import { Inject, Injectable, Logger, type INestApplication, type OnModuleDestroy } from '@nestjs/common';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { GameClientMessage, GameServerMessage } from '@cafeflow/shared';
import { AppError } from '../../common/errors';
import { RoomManager, type Room, type RoomSeat } from './room-manager';

/** One socket, one seat: the token in the query string is the whole identity. */
export const GAMES_WS_PATH = '/ws/games';

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MESSAGES_PER_SECOND = 20;
const BURST = 40;
const HEARTBEAT_MS = 30_000;

interface SocketEntry {
  roomId: string;
  seatIndex: number;
  tokens: number;
  lastRefill: number;
}

const attached = new WeakSet<HttpServer>();

@Injectable()
export class GamesGateway implements OnModuleDestroy {
  private readonly logger = new Logger(GamesGateway.name);
  private readonly sockets = new Map<WebSocket, SocketEntry>();
  private wss: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(@Inject(RoomManager) private readonly rooms: RoomManager) {
    // The manager owns the rules; the gateway only translates rooms to frames.
    this.rooms.onUpdate((room) => this.broadcast(room));
  }

  attach(server: HttpServer): void {
    if (this.wss || attached.has(server)) return;
    attached.add(server);

    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
    server.on('upgrade', (request, socket, head) => this.onUpgrade(request, socket, head));

    this.heartbeat = setInterval(() => {
      for (const socket of this.wss?.clients ?? []) {
        const alive = (socket as WebSocket & { isAlive?: boolean }).isAlive;
        if (alive === false) {
          socket.terminate();
          continue;
        }
        (socket as WebSocket & { isAlive?: boolean }).isAlive = false;
        try {
          socket.ping();
        } catch {
          socket.terminate();
        }
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  private onUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== GAMES_WS_PATH) {
      // No other websocket endpoint exists on this server; a clear refusal beats
      // a half-open connection that a proxy would eventually time out.
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const found = this.rooms.findSeatByToken(url.searchParams.get('seat') ?? '');
    if (!found) {
      // Complete the handshake and then close with a game code: a browser cannot
      // read an HTTP status from a failed upgrade, so rejecting here would look
      // exactly like a dead Wi-Fi and the seat would be dropped for no reason.
      this.wss?.handleUpgrade(request, socket, head, (client) => {
        client.close(4401, 'seat-gone');
      });
      return;
    }

    this.wss?.handleUpgrade(request, socket, head, (client) => {
      this.wss?.emit('connection', client, request);
      this.onConnection(client, found.room, found.seat);
    });
  }

  private onConnection(socket: WebSocket, room: Room, seat: RoomSeat): void {
    (socket as WebSocket & { isAlive?: boolean }).isAlive = true;
    socket.on('pong', () => {
      (socket as WebSocket & { isAlive?: boolean }).isAlive = true;
    });

    this.sockets.set(socket, {
      roomId: room.id,
      seatIndex: seat.index,
      tokens: BURST,
      lastRefill: Date.now(),
    });

    this.rooms.markConnected(room, seat, true);
    this.sendRoom(socket, room, seat.index);

    socket.on('message', (raw) => this.onMessage(socket, room, seat, raw));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      this.sockets.delete(socket);
      // The same phone may hold two tabs on one seat; only the last socket to go
      // may mark the seat offline, or the grace timer would evict a live player.
      if (this.hasOtherSocket(room, seat, socket)) return;
      this.rooms.markConnected(room, seat, false);
      this.rooms.scheduleRemoval(room, seat);
    });
  }

  private onMessage(socket: WebSocket, room: Room, seat: RoomSeat, raw: RawData): void {
    const entry = this.sockets.get(socket);
    if (!entry) return;

    const now = Date.now();
    entry.tokens = Math.min(BURST, entry.tokens + ((now - entry.lastRefill) * MESSAGES_PER_SECOND) / 1000);
    entry.lastRefill = now;
    if (entry.tokens < 1) {
      this.send(socket, { type: 'error', code: 'RATE_LIMITED', message: 'کمی آرام‌تر؛ پیام‌ها زیاد شد.' });
      return;
    }
    entry.tokens -= 1;

    let message: GameClientMessage;
    try {
      message = JSON.parse(raw.toString()) as GameClientMessage;
    } catch {
      this.send(socket, { type: 'error', code: 'BAD_MESSAGE', message: 'پیام نامعتبر است.' });
      return;
    }
    if (!message || typeof message !== 'object') return;

    try {
      switch (message.type) {
        case 'ready':
          this.rooms.setReady(room, seat, Boolean(message.ready));
          break;
        case 'start':
          this.rooms.start(room, seat);
          break;
        case 'restart':
          this.rooms.restart(room, seat);
          break;
        case 'leave': {
          // Deliberate exit frees the seat now: waiting out the grace period
          // would keep a friend from taking the empty chair. Every tab of the
          // same seat closes, not just the one that asked.
          this.rooms.markConnected(room, seat, false);
          this.rooms.leave(room, seat);
          for (const [candidate, entry] of this.sockets) {
            if (entry.roomId !== room.id || entry.seatIndex !== seat.index) continue;
            this.sockets.delete(candidate);
            candidate.close(4400, 'left');
          }
          break;
        }
        case 'move': {
          const refused = this.rooms.move(room, seat, message.move ?? {});
          if (refused) this.send(socket, { type: 'error', code: 'MOVE_REFUSED', message: refused });
          break;
        }
        default:
          this.send(socket, { type: 'error', code: 'UNKNOWN_MESSAGE', message: 'این فرمان شناخته نشد.' });
      }
    } catch (error) {
      if (error instanceof AppError) {
        this.send(socket, { type: 'error', code: error.code, message: error.message });
        return;
      }
      this.logger.warn(`game socket error: ${(error as Error).message}`);
      this.send(socket, { type: 'error', code: 'GAME_ERROR', message: 'خطای غیرمنتظره در بازی.' });
    }
  }

  private hasOtherSocket(room: Room, seat: RoomSeat, except: WebSocket): boolean {
    for (const socket of this.sockets.keys()) {
      if (socket === except || socket.readyState !== WebSocket.OPEN) continue;
      const entry = this.sockets.get(socket);
      if (entry?.roomId === room.id && entry.seatIndex === seat.index) return true;
    }
    return false;
  }

  private broadcast(room: Room): void {
    for (const [socket, entry] of this.sockets) {
      if (entry.roomId !== room.id || socket.readyState !== WebSocket.OPEN) continue;
      const seat = room.seats.find((candidate) => candidate.index === entry.seatIndex && !candidate.removed);
      if (!seat) continue;
      this.sendRoom(socket, room, seat.index);
    }
  }

  private sendRoom(socket: WebSocket, room: Room, seatIndex: number): void {
    this.send(socket, { type: 'room', room: this.rooms.view(room, seatIndex) });
    const state = this.rooms.stateFor(room, seatIndex);
    if (state) this.send(socket, { type: 'state', state });
  }

  private send(socket: WebSocket, message: GameServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // A dying socket is cleaned up by its close handler.
    }
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const socket of this.sockets.keys()) socket.terminate();
    this.sockets.clear();
    this.wss?.close();
    this.wss = null;
  }
}

/**
 * Wires the gateway onto the HTTP server Nest already created.
 *
 * Called from `main.ts` after `listen` and from the API tests, which own their
 * own listener; nothing else needs to know that websockets exist.
 */
export function attachGamesGateway(app: INestApplication): void {
  const gateway = app.get(GamesGateway);
  const server = app.getHttpServer() as HttpServer;
  gateway.attach(server);
}
