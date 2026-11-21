import { describe, expect, it, vi } from 'vitest';
import { loadGame, manifest, messageFa, type GameState } from '../src/index';

function fresh(id: string, players: number): GameState {
  const game = loadGame(id);
  const state = game.createState();
  game.initGame?.(state, players);
  return state;
}

describe('بیست‌وچهار', () => {
  function puzzle(state: GameState) {
    Object.assign(state, {
      numbers: [6, 6, 6, 6],
      phase: 'playing',
      winner: null,
      roundWinner: null,
      roundsWon: [0, 0],
      currentRound: 1,
      maxRounds: 5,
      solutions: [],
      playerSubmissions: {},
      roundTime: 0,
      roundEndsAt: 0,
    });
  }

  it('ends a round on a correct expression', () => {
    const game = loadGame('twentyfour');
    const state = fresh('twentyfour', 2);
    puzzle(state);

    expect(game.handleMove({ expression: '6+6+6+6' }, state, 0)).toBeNull();
    expect(state.phase).toBe('round_end');
    expect(state.roundWinner).toBe(0);
    expect(state.roundsWon).toEqual([1, 0]);
  });

  it('moves to a fresh round and keeps the score', () => {
    const game = loadGame('twentyfour');
    const state = fresh('twentyfour', 2);
    puzzle(state);
    game.handleMove({ expression: '6+6+6+6' }, state, 0);

    expect(game.handleMove({ action: 'next_round' }, state, 1)).toBeNull();
    expect(state.phase).toBe('playing');
    expect(state.currentRound).toBe(2);
    expect(state.roundsWon).toEqual([1, 0]);
    expect(state.numbers).toHaveLength(4);
    expect(state.roundWinner).toBeNull();
  });

  it('names the match winner after the last round', () => {
    const game = loadGame('twentyfour');
    const state = fresh('twentyfour', 2);
    puzzle(state);
    Object.assign(state, { currentRound: 5, roundsWon: [3, 1], phase: 'round_end' });

    expect(game.handleMove({ action: 'next_round' }, state, 0)).toBeNull();
    expect(state.phase).toBe('over');
    expect(state.winner).toBe(0);
  });
});

describe('شطرنج پروازی', () => {
  it('rolls, refuses a launch without a six and launches on a six', () => {
    const game = loadGame('flightchess');
    const state = fresh('flightchess', 2);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.4); // dice = 3

    expect(game.handleMove({ action: 'roll' }, state, 0)).toBeNull();
    expect(state.dice).toBe(3);
    // No plane can move without a six, so the engine auto-passes the turn.
    expect(state.hasRolled).toBe(false);
    expect(state.currentPlayer).toBe(1);

    random.mockReturnValue(0.99); // dice = 6
    Object.assign(state, { currentPlayer: 0, hasRolled: false, dice: 1 });
    expect(game.handleMove({ action: 'roll' }, state, 0)).toBeNull();
    expect(state.dice).toBe(6);
    expect(game.handleMove({ action: 'move', planeIndex: 0 }, state, 0)).toBeNull();
    expect(state.players[0].planes[0]).toBeGreaterThanOrEqual(0);
    random.mockRestore();
  });

  it('keeps the turn on a six and rejects another seat', () => {
    const game = loadGame('flightchess');
    const state = fresh('flightchess', 2);
    Object.assign(state, { currentPlayer: 0, dice: 6, hasRolled: true, consecutiveSixes: 1 });

    expect(game.handleMove({ action: 'move', planeIndex: 0 }, state, 1)).toBe('g_not_your_turn');
    expect(game.handleMove({ action: 'move', planeIndex: 0 }, state, 0)).toBeNull();
    expect(state.currentPlayer).toBe(0);
    expect(state.hasRolled).toBe(false);
  });
});

describe('تگزاس هولدم', () => {
  it('deals two private cards and posts the blinds', () => {
    const game = loadGame('texas');
    const state = fresh('texas', 3);
    expect([...state.chips].sort((a, b) => a - b)).toEqual([980, 990, 1000]);
    expect(state.phase).toBe('preflop');
    expect(state.pot).toBeGreaterThan(0);

    const mine = game.playerView!(state, 0) as {
      holeCards: unknown[];
      opponentHoleCounts: number[];
      currentPlayer: number;
    };
    expect(mine.holeCards).toHaveLength(2);
    expect(mine.opponentHoleCounts[1]).toBe(2);
  });

  it('ends the hand when everyone folds', () => {
    const game = loadGame('texas');
    const state = fresh('texas', 2);
    const view = game.playerView!(state, 0) as { currentPlayer: number };
    const seat = view.currentPlayer;
    expect(game.handleMove({ action: 'fold' }, state, seat)).toBeNull();
    expect(state.winner).toBe(1 - seat);
    expect(game.handleMove({ action: 'fold' }, state, 0)).toBe('g_game_over');
  });
});

describe('نبرد مارها', () => {
  it('moves the snakes and refuses a reverse turn', () => {
    const game = loadGame('snakebattle');
    const state = fresh('snakebattle', 2);
    expect(state.snakes).toHaveLength(2);
    expect(state.snakes[0].body).toHaveLength(3);
    expect(state.snakes[0].alive).toBe(true);

    expect(game.handleMove({ direction: 'up' }, state, 0)).toBeNull();
    expect(state.snakes[0].nextDirection).toBe('up');
    expect(game.handleMove({ direction: 'left' }, state, 0)).toBe('sb_cannot_reverse');

    const before = JSON.stringify(state.snakes[0].body);
    game.tick?.(state);
    expect(JSON.stringify(state.snakes[0].body)).not.toBe(before);
    expect(state.tick).toBe(1);
  });
});

describe('catalogue', () => {
  it('marks the new tables playable', () => {
    for (const id of ['twentyfour', 'flightchess', 'texas']) {
      expect(manifest(id).playable).toBe(true);
    }
  });

  it('translates their refusals', () => {
    for (const key of ['fc_must_roll_6_to_launch', 'tx_raise_too_low', 'tx_you_folded', 'tf_not_24']) {
      expect(messageFa(key)).not.toBe(key);
    }
  });
});
