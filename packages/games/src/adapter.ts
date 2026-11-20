/**
 * The only bridge between CafeFlow and the vendored rules.
 *
 * Nothing outside this file may `require` upstream code: the rest of the app
 * speaks the typed contract below, so a future engine swap is a one-file change.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isGameId, type GameId } from './manifest';

/** Opaque game state: owned and mutated by the rules module, never by the UI. */
export type GameState = Record<string, any>;
export type MovePayload = Record<string, unknown>;

export interface GameModule {
  name: string;
  maxPlayers: number;
  minPlayers?: number;
  realtime?: boolean;
  tickMs?: number;
  createState(): GameState;
  /** Required by every game whose board has a starting position. */
  initGame?(state: GameState, playerCount: number): void;
  /** Returns `null` on a legal move, or a stable i18n key on a refused one. */
  handleMove(data: MovePayload, state: GameState, playerIndex: number): string | null;
  /** Per-seat projection: hides other seats' hands, roles and boards. */
  playerView?(state: GameState, playerIndex: number): GameState;
  getCurrentActor?(state: GameState): number;
  setCurrentActor?(state: GameState, index: number): void;
  getPendingActors?(state: GameState): number[];
  /** Absolute epoch-ms deadline for the current phase, or 0 for none. */
  getPhaseDeadline?(state: GameState): number;
  onTimeout?(state: GameState): void;
  tick?(state: GameState): void;
}

/**
 * `dist/` carries its own copy (see `scripts/copy-upstream.mjs`); running from
 * source (`tsx`, vitest) finds the package-root folder instead.
 */
const UPSTREAM_DIRS = [join(__dirname, 'upstream'), join(__dirname, '..', 'upstream')];

const cache = new Map<string, GameModule>();
let resolvedDir: string | null = null;

function upstreamDirectory(): string {
  if (resolvedDir) return resolvedDir;
  for (const candidate of UPSTREAM_DIRS) {
    if (existsSync(join(candidate, 'games'))) {
      resolvedDir = candidate;
      return candidate;
    }
  }
  throw new Error(`پوشهٔ قواعد بازی پیدا نشد: ${UPSTREAM_DIRS.join(' | ')}`);
}

export function loadGame(id: string): GameModule {
  if (!isGameId(id)) throw new Error(`بازی ناشناس: ${id}`);
  const cached = cache.get(id);
  if (cached) return cached;

  // Trimmed upstream modules are CommonJS; the path is built from our own
  // registry id, never from client input.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const module = require(join(upstreamDirectory(), 'games', `${id}.js`)) as GameModule;
  cache.set(id, module);
  return module;
}

/** True when the rules engine can drive this game in a room. */
export function isPlayable(id: string): id is GameId {
  try {
    const game = loadGame(id);
    return typeof game.createState === 'function' && typeof game.handleMove === 'function';
  } catch {
    return false;
  }
}
