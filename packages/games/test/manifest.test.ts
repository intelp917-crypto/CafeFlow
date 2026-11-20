import { describe, expect, it } from 'vitest';
import { GAME_IDS, GAMES, loadGame, manifest, messageFa } from '../src/index';

describe('game registry', () => {
  it('has a playable rules module for every catalogue entry', () => {
    for (const id of GAME_IDS) {
      const game = loadGame(id);
      expect(game.name).toBe(id);
      expect(typeof game.createState).toBe('function');
      expect(typeof game.handleMove).toBe('function');
      expect(game.maxPlayers).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps the catalogue and the loader in step', () => {
    expect(GAMES.map((game) => game.id)).toEqual([...GAME_IDS]);
    for (const game of GAMES) {
      expect(manifest(game.id)).toBe(game);
      expect(game.nameFa).toMatch(/[\u0600-\u06FF]/);
      expect(game.minPlayers).toBeLessThanOrEqual(game.maxPlayers);
    }
  });

  it('only marks a game playable when a room can actually start it', () => {
    for (const game of GAMES) {
      if (!game.playable) continue;
      const module = loadGame(game.id);
      expect(typeof module.createState).toBe('function');
      expect(module.maxPlayers).toBeGreaterThanOrEqual(game.maxPlayers);
    }
  });

  it('refuses a move from the seat that is not on turn, in Persian', () => {
    const tictactoe = loadGame('tictactoe');
    const state = tictactoe.createState();
    expect(tictactoe.handleMove({ cell: 0 }, state, 1)).toBe('g_not_your_turn');
    expect(messageFa('g_not_your_turn')).not.toBe('g_not_your_turn');
    expect(messageFa('g_not_your_turn')).toMatch(/[\u0600-\u06FF]/);
  });

  it('initialises a starting position for every board game', () => {
    for (const id of ['connect4', 'reversi', 'uno'] as const) {
      const game = loadGame(id);
      const state = game.createState();
      expect(typeof game.initGame).toBe('function');
      game.initGame?.(state, 2);
      expect(state.board ?? state.hands).toBeTruthy();
    }
  });
});
