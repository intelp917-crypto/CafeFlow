import { describe, expect, it } from 'vitest';
import { loadGame, manifest, messageFa, type GameState } from '../src/index';

function fresh(id: string, players: number): GameState {
  const game = loadGame(id);
  const state = game.createState();
  game.initGame?.(state, players);
  return state;
}

describe('گو ۹×۹', () => {
  it('places a stone, alternates turns and blocks the occupied point', () => {
    const game = loadGame('go9');
    const state = fresh('go9', 2);

    expect(game.handleMove({ row: 4, col: 4 }, state, 1)).toBe('g_not_your_turn');
    expect(game.handleMove({ row: 4, col: 4 }, state, 0)).toBeNull();
    expect(state.board[4][4]).toBe(1);
    expect(state.currentPlayer).toBe(1);
    expect(game.handleMove({ row: 4, col: 4 }, state, 1)).toBe('go_position_occupied');
  });

  it('opens scoring after two passes and finishes when both accept', () => {
    const game = loadGame('go9');
    const state = fresh('go9', 2);

    expect(game.handleMove({ pass: true }, state, 0)).toBeNull();
    expect(game.handleMove({ pass: true }, state, 1)).toBeNull();
    expect(state.phase).toBe('scoring');

    expect(game.handleMove({ type: 'accept' }, state, 0)).toBeNull();
    expect(state.winner).toBeNull();
    expect(game.handleMove({ type: 'accept' }, state, 1)).toBeNull();
    expect(state.winner).not.toBeNull();
    expect(state.finalScores).toBeTruthy();

    expect(game.handleMove({ row: 0, col: 0 }, state, 0)).toBe('g_game_over');
  });
});

describe('نبرد ناوگان', () => {
  const fleet = (startRow: number) => [
    { size: 5, r: startRow, c: 0 },
    { size: 4, r: startRow + 1, c: 0 },
    { size: 3, r: startRow + 2, c: 0 },
    { size: 3, r: startRow + 3, c: 0 },
    { size: 2, r: startRow + 4, c: 0 },
  ];

  function placeAll(game: ReturnType<typeof loadGame>, state: GameState, seat: number) {
    for (const ship of fleet(seat === 0 ? 0 : 5)) {
      expect(game.handleMove({ r: ship.r, c: ship.c, orientation: 'h', size: ship.size }, state, seat)).toBeNull();
    }
  }

  it('lets both seats lay their fleet before shooting starts', () => {
    const game = loadGame('battleship');
    const state = fresh('battleship', 2);
    expect(state.phase).toBe('placing');

    placeAll(game, state, 0);
    expect(state.placedCount).toEqual([5, 0]);
    expect(state.phase).toBe('placing');

    placeAll(game, state, 1);
    expect(state.phase).toBe('shooting');
    expect(state.currentPlayer).toBe(0);
  });

  it('rejects the wrong ship size', () => {
    const game = loadGame('battleship');
    const state = fresh('battleship', 2);
    expect(game.handleMove({ r: 0, c: 0, orientation: 'h', size: 3 }, state, 0)).toBe('bs_wrong_ship_size');
  });

  it('records hits and hides the enemy hull in the player view', () => {
    const game = loadGame('battleship');
    const state = fresh('battleship', 2);
    placeAll(game, state, 0);
    placeAll(game, state, 1);

    expect(game.handleMove({ r: 6, c: 0 }, state, 0)).toBeNull();
    expect(state.lastShotResult.result).toBe('hit');
    expect(state.shots[0]).toHaveLength(1);
    expect(state.currentPlayer).toBe(1);
    expect(game.handleMove({ r: 6, c: 0 }, state, 0)).toBe('g_not_your_turn');

    const view = game.playerView!(state, 0) as {
      enemyBoard: Array<Array<{ shot: string | null; shipType: string | null }>>;
      myBoard: Array<Array<{ hasShip: boolean }>>;
    };
    expect(view.enemyBoard[6][0].shot).toBe('hit');
    expect(view.enemyBoard[6][0].shipType).toBeNull();
    expect(view.enemyBoard[0][0].shot).toBeNull();
    expect(view.myBoard[0][0].hasShip).toBe(true);
  });
});

describe('شطرنج چینی', () => {
  it('moves a red pawn and exposes only the mover’s legal moves', () => {
    const game = loadGame('chinesechess');
    const state = fresh('chinesechess', 2);

    const myView = game.playerView!(state, 0) as { legalMoves: unknown[] };
    expect(myView.legalMoves.length).toBeGreaterThan(0);

    expect(game.handleMove({ from: { row: 6, col: 0 }, to: { row: 5, col: 0 } }, state, 1)).toBe('g_not_your_turn');
    expect(game.handleMove({ from: { row: 6, col: 0 }, to: { row: 5, col: 0 } }, state, 0)).toBeNull();
    expect(state.board[5][0]).toEqual({ type: 'P', side: 0 });
    expect(state.board[6][0]).toBeNull();
    expect(state.currentPlayer).toBe(1);

    expect(game.handleMove({ from: { row: 9, col: 0 }, to: { row: 8, col: 1 } }, state, 1)).toBe('xq_not_your_piece');
  });

  it('refuses an illegal slide', () => {
    const game = loadGame('chinesechess');
    const state = fresh('chinesechess', 2);
    expect(game.handleMove({ from: { row: 9, col: 0 }, to: { row: 8, col: 1 } }, state, 0)).toBe('xq_illegal_move');
  });
});

describe('میخانهٔ دروغگو', () => {
  it('deals five cards and records a claim', () => {
    const game = loadGame('liarsbar');
    const state = fresh('liarsbar', 3);

    expect(state.hands.map((hand: unknown[]) => hand.length)).toEqual([5, 5, 5]);
    expect(state.alive).toEqual([true, true, true]);
    const seat = state.currentPlayer;
    const cardId = state.hands[seat][0].id;

    expect(game.handleMove({ action: 'play', cardIds: [cardId] }, state, (seat + 1) % 3)).toBe('g_not_your_turn');
    expect(game.handleMove({ action: 'play', cardIds: [cardId] }, state, seat)).toBeNull();
    expect(state.pileCards).toHaveLength(1);
    expect(state.lastClaimant).toBe(seat);
    expect(state.currentPlayer).not.toBe(seat);
  });

  it('turns a challenge into a shooting round and then a fresh round', () => {
    const game = loadGame('liarsbar');
    const state = fresh('liarsbar', 2);
    const claimer = state.currentPlayer;
    const other = (claimer + 1) % 2;
    game.handleMove({ action: 'play', cardIds: [state.hands[claimer][0].id] }, state, claimer);

    expect(game.handleMove({ action: 'suspect' }, state, other)).toBeNull();
    expect(state.phase).toBe('shooting');
    expect(state.revealedPile).toHaveLength(1);
    expect(state.shootQueue.length).toBeGreaterThan(0);

    const shooter = state.currentShooter;
    expect(game.handleMove({ action: 'shoot' }, state, other === shooter ? claimer : other)).toBe('lb_not_your_shot');
    expect(game.handleMove({ action: 'shoot' }, state, shooter)).toBeNull();
    expect(state.firedShots[shooter]).toBe(1);
    expect(['playing', 'shooting', 'round_end']).toContain(state.phase);
  });

  it('hides hands and the face-down pile', () => {
    const game = loadGame('liarsbar');
    const state = fresh('liarsbar', 3);
    const view = game.playerView!(state, 0) as {
      hands: Array<Array<unknown> | null>;
      pileCards: Array<unknown>;
    };
    const mySeat = 0;
    const otherSeat = state.hands.findIndex((_: unknown, index: number) => index !== mySeat);
    expect(view.hands[mySeat]).toEqual(state.hands[mySeat]);
    expect(view.hands[otherSeat]!.every((card) => card === null)).toBe(true);
    expect(view.pileCards).toEqual([]);
  });
});

describe('catalogue', () => {
  it('lists the four new tables as playable', () => {
    for (const id of ['go9', 'chinesechess', 'battleship', 'liarsbar']) {
      expect(manifest(id).playable).toBe(true);
    }
  });

  it('translates their refusals', () => {
    for (const key of [
      'go_ko_rule',
      'go_suicide_point',
      'bs_wrong_ship_size',
      'bs_already_shot',
      'xq_illegal_move',
      'lb_cannot_challenge_self',
      'lb_not_your_shot',
    ]) {
      expect(messageFa(key)).not.toBe(key);
    }
  });
});
