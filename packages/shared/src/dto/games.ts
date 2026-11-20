import { z } from 'zod';

/**
 * Contracts for the table game rooms.
 *
 * A room is scoped to one table and one game: a guest never sends a table id,
 * only the QR token printed on the table. The seat token is what the socket
 * handshake carries, so the room view in HTTP and WS payloads is identical.
 */

export const GAME_MODES = ['turn', 'realtime', 'phase'] as const;
export type GameMode = (typeof GAME_MODES)[number];

export interface GameCatalogItem {
  id: string;
  nameFa: string;
  taglineFa: string;
  descriptionFa: string;
  howToFa: string;
  categoryFa: string;
  minPlayers: number;
  maxPlayers: number;
  mode: GameMode;
  /** The rules exist and a Persian screen is ready, so a table may start it. */
  playable: boolean;
}

export interface GameCatalogResponse {
  games: GameCatalogItem[];
}

export interface GameSeatView {
  index: number;
  nameFa: string;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  isYou: boolean;
}

export type GameRoomPhase = 'lobby' | 'playing' | 'over';

export interface GameRoomView {
  roomId: string;
  tableNameFa: string;
  gameId: string;
  gameNameFa: string;
  phase: GameRoomPhase;
  hostSeat: number;
  minPlayers: number;
  maxPlayers: number;
  seats: GameSeatView[];
  /** Absolute epoch-ms the current phase ends, or 0 when nothing is timed. */
  deadline: number;
}

export interface GameJoinResponse {
  seatToken: string;
  seat: number;
  room: GameRoomView;
  state: Record<string, unknown> | null;
  expiresAt: string;
}

/** The device name is optional; the server generates «بازیکن ۱» when absent. */
export const gamesJoinSchema = z.object({
  qrToken: z.string().min(1, 'کد QR الزامی است.'),
  gameId: z.string().min(1, 'انتخاب بازی الزامی است.'),
  nameFa: z.string().trim().max(24, 'نام حداکثر ۲۴ نویسه است.').optional(),
});

export type GamesJoinInput = z.infer<typeof gamesJoinSchema>;

export type GameClientMessage =
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'restart' }
  | { type: 'leave' }
  | { type: 'move'; move: Record<string, unknown> };

export type GameServerMessage =
  | { type: 'room'; room: GameRoomView }
  | { type: 'state'; state: Record<string, unknown> }
  | { type: 'error'; code: string; message: string };
