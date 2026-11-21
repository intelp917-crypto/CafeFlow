import { describe, expect, it } from 'vitest';
import { loadGame, type GameState } from '../src/index';

function fresh(id: string, players: number): GameState {
  const game = loadGame(id);
  const state = game.createState();
  game.initGame?.(state, players);
  return state;
}

describe('بازی‌های تازه', () => {
  it('monopoly rolls on a Persian board', () => {
    const game = loadGame('monopoly');
    const state = fresh('monopoly', 2);
    expect(state.board[1].name).toBe('خانهٔ ارزان');
    expect(state.cash).toEqual([1500, 1500]);
    expect(game.handleMove({ type: 'roll' }, state, 0)).toBeNull();
    expect(state.dice[0]).toBeGreaterThan(0);
    expect(state.phase === 'waiting' || state.phase === 'landed' || state.phase === 'end_turn').toBe(true);
  });

  it('sheeptile lays a solvable pile and picks an exposed tile', () => {
    const game = loadGame('sheeptile');
    const state = fresh('sheeptile', 2);
    const level1 = state.layout.filter((tile: { level: number }) => tile.level === 1);
    expect(level1.length).toBeGreaterThan(0);
    const exposed = level1.find(
      (tile: { id: number; x: number; y: number; z: number }) =>
        !level1.some(
          (other: { id: number; x: number; y: number; z: number }) =>
            other.id !== tile.id &&
            other.z > tile.z &&
            Math.abs(other.x - tile.x) < 1 &&
            Math.abs(other.y - tile.y) < 1,
        ),
    );
    expect(exposed).toBeTruthy();
    expect(game.handleMove({ type: 'pick', tileId: exposed.id }, state, 0)).toBeNull();
    expect(state.players[0].removed[exposed.id]).toBe(true);
  });

  it('sanguo deals four cards and asks the lord to play', () => {
    const game = loadGame('sanguo');
    const state = fresh('sanguo', 4);
    expect(state.players).toHaveLength(4);
    expect(state.players.every((player: { hand: unknown[] }) => player.hand.length >= 4)).toBe(true);
    expect(state.ask).toBeTruthy();
    expect(state.ask.type).toBe('play');
    const lord = state.lord;
    expect(game.handleMove({ type: 'end' }, state, lord)).toBeNull();
    expect(state.ask === null || state.ask.to !== lord || state.ask.type !== 'play').toBe(true);
  });

  it('suikabattle advances the fruit and scores a merge', () => {
    const game = loadGame('suikabattle');
    const state = fresh('suikabattle', 2);
    expect(state.current).toHaveLength(2);
    expect(game.handleMove({ type: 'drop' }, state, 0)).toBeNull();
    expect(state.drops[0]).toBe(1);
    expect(game.handleMove({ type: 'merge', fruitType: 0 }, state, 0)).toBeNull();
    expect(state.scores[0]).toBe(1);
  });
});
