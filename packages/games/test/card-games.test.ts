import { describe, expect, it } from 'vitest';
import { loadGame, manifest, messageFa, type GameState } from '../src/index';

/**
 * The five card tables are the first games here where the engine has to hide a
 * hand. These tests drive the vendored rules through the same adapter the room
 * uses, and check both the moves and the per-seat projection — a rule bug is
 * cheap to fix, a leaked hand is not.
 */

function fresh(id: string, players: number): GameState {
  const game = loadGame(id);
  const state = game.createState();
  game.initGame?.(state, players);
  return state;
}

describe('رمز داوینچی', () => {
  function guessingState(): GameState {
    const state = fresh('davinci', 2);
    // A hand-built position: the deck is random, the assertion should not be.
    state.phase = 'guess';
    state.currentPlayer = 0;
    state.penaltyPlayer = null;
    state.winner = null;
    state.guessedThisTurn = false;
    state.pool = [];
    state.drawnTile = { color: 'black', num: 3, id: 'b3' };
    state.tiles = [
      [{ color: 'black', num: 0, id: 'b0' }],
      [
        { color: 'white', num: 5, id: 'w5' },
        { color: 'white', num: 7, id: 'w7' },
      ],
    ];
    state.numRevealed = [[false], [false, false]];
    state.eliminated = [false, false];
    state.playerCount = 2;
    return state;
  }

  it('reveals the guessed number and passes the turn', () => {
    const game = loadGame('davinci');
    const state = guessingState();

    expect(game.handleMove({ targetPlayer: 1, tileIndex: 0, guessNum: 5 }, state, 0)).toBeNull();
    expect(state.numRevealed[1][0]).toBe(true);
    expect(state.currentPlayer).toBe(1);
    expect(state.phase).toBe('draw');
    expect(state.drawnTile).toBeNull();
  });

  it('keeps the turn after a correct guess when the guest asks to continue', () => {
    const game = loadGame('davinci');
    const state = guessingState();

    expect(
      game.handleMove({ targetPlayer: 1, tileIndex: 0, guessNum: 5, continueGuess: true }, state, 0),
    ).toBeNull();
    expect(state.currentPlayer).toBe(0);
    expect(state.phase).toBe('guess');
    expect(state.guessedThisTurn).toBe(true);

    // Only now may the seat end its turn, and passing files the drawn tile.
    expect(game.handleMove({ pass: true }, state, 0)).toBeNull();
    expect(state.currentPlayer).toBe(1);
    expect(state.tiles[0]).toHaveLength(2);
  });

  it('sends a wrong guess to the penalty phase', () => {
    const game = loadGame('davinci');
    const state = guessingState();

    expect(game.handleMove({ targetPlayer: 1, tileIndex: 0, guessNum: 4 }, state, 0)).toBeNull();
    expect(state.phase).toBe('penalty');
    expect(state.penaltyPlayer).toBe(0);
    expect(state.tiles[0]).toHaveLength(2);

    expect(game.handleMove({ revealIndex: 0 }, state, 0)).toBeNull();
    expect(state.numRevealed[0][0]).toBe(true);
    expect(state.currentPlayer).toBe(1);
    expect(state.phase).toBe('draw');
  });

  it('refuses to guess its own hand and to pass before guessing', () => {
    const game = loadGame('davinci');
    const state = guessingState();

    expect(game.handleMove({ targetPlayer: 0, tileIndex: 0, guessNum: 0 }, state, 0)).toBe(
      'dv_cannot_guess_own',
    );
    expect(game.handleMove({ pass: true }, state, 0)).toBe('dv_must_guess_first');
  });

  it('shows opponents the colour but never the number', () => {
    const game = loadGame('davinci');
    const state = guessingState();
    state.tiles[1] = [
      { color: 'white', num: 9, id: 'w9' },
      { color: 'white', num: 10, id: 'w10' },
    ];
    state.numRevealed[1] = [false, false];

    type TilesView = { tiles: Array<Array<{ color: string; num: number | null }>> };

    const hidden = game.playerView!(state, 0) as TilesView;
    // The colour is public even before the number is guessed.
    expect(hidden.tiles[1]![0]!.color).toBe('white');
    expect(hidden.tiles[1]![0]!.num).toBeNull();

    state.numRevealed[1] = [true];
    expect((game.playerView!(state, 0) as TilesView).tiles[1]![0]!.num).toBe(9);

    // A seat always sees its own hand in full.
    const own = game.playerView!(state, 1) as TilesView;
    expect(own.tiles[1]![0]!.num).toBe(9);
    expect(own.tiles[0]![0]!.num).toBeNull();
  });
});

describe('دل', () => {
  it('deals thirteen cards to each of four seats and starts with the two of clubs', () => {
    const state = fresh('hearts', 4);
    expect(state.hands.map((hand: unknown[]) => hand.length)).toEqual([13, 13, 13, 13]);
    expect(state.phase).toBe('passing');
    expect(state.passDirection).toBe('left');
    expect(state.hands[state.currentPlayer].some((card: { id: string }) => card.id === '2c')).toBe(
      true,
    );
  });

  it('accepts a pass from every seat and moves on to play', () => {
    const game = loadGame('hearts');
    const state = fresh('hearts', 4);

    for (const seat of [0, 1, 2, 3]) {
      expect(game.handleMove({ pass: true }, state, seat)).toBeNull();
    }
    expect(state.phase).toBe('playing');
    expect(state.hands.map((hand: unknown[]) => hand.length)).toEqual([13, 13, 13, 13]);
    expect(Object.keys(state.passSubmissions)).toHaveLength(0);
  });

  it('forces the two of clubs on the first trick and follows suit', () => {
    const game = loadGame('hearts');
    const state = fresh('hearts', 4);
    state.phase = 'playing';
    state.passSubmissions = {};
    state.trickCount = 0;
    state.currentTrick = [];
    state.heartsBroken = false;
    state.currentPlayer = 0;
    state.hands = [
      [
        { rank: '2', suit: 'c', id: '2c' },
        { rank: '5', suit: 'h', id: '5h' },
      ],
      [
        { rank: '9', suit: 'c', id: '9c' },
        { rank: '3', suit: 'd', id: '3d' },
      ],
      [
        { rank: 'K', suit: 'c', id: 'Kc' },
        { rank: '4', suit: 's', id: '4s' },
      ],
      [
        { rank: '7', suit: 'c', id: '7c' },
        { rank: '6', suit: 'd', id: '6d' },
      ],
    ];

    // The opener must lead the two of clubs.
    expect(game.handleMove({ card: '5h' }, state, 0)).toBe('ht_illegal_card');
    expect(game.handleMove({ card: '2c' }, state, 0)).toBeNull();

    // Seat 1 holds a club, so it may not discard its diamond.
    expect(game.handleMove({ card: '3d' }, state, 1)).toBe('ht_illegal_card');
    expect(game.handleMove({ card: '9c' }, state, 1)).toBeNull();
    expect(game.handleMove({ card: 'Kc' }, state, 2)).toBeNull();
    expect(game.handleMove({ card: '7c' }, state, 3)).toBeNull();

    // The king of clubs takes the trick and leads next.
    expect(state.trickCount).toBe(1);
    expect(state.currentPlayer).toBe(2);
    expect(state.roundScores[2]).toBe(0);
  });

  it('scores a heart to the trick winner', () => {
    const game = loadGame('hearts');
    const state = fresh('hearts', 4);
    state.phase = 'playing';
    state.passSubmissions = {};
    state.trickCount = 1;
    state.currentTrick = [];
    state.heartsBroken = true;
    state.currentPlayer = 0;
    state.hands = [
      [{ rank: '2', suit: 'h', id: '2h' }],
      [{ rank: '3', suit: 'h', id: '3h' }],
      [{ rank: 'K', suit: 'h', id: 'Kh' }],
      [{ rank: '4', suit: 'h', id: '4h' }],
    ];

    expect(game.handleMove({ card: '2h' }, state, 0)).toBeNull();
    expect(game.handleMove({ card: '3h' }, state, 1)).toBeNull();
    expect(game.handleMove({ card: 'Kh' }, state, 2)).toBeNull();
    expect(game.handleMove({ card: '4h' }, state, 3)).toBeNull();

    expect(state.roundScores[2]).toBe(4);
    expect(state.currentPlayer).toBe(2);
  });

  it('never shows another seat its own hand', () => {
    const game = loadGame('hearts');
    const state = fresh('hearts', 4);
    const view = game.playerView!(state, 1) as { myHand: unknown[]; handSizes: number[] };
    expect(view.myHand).toEqual(state.hands[1]);
    expect(view.handSizes).toEqual([13, 13, 13, 13]);
  });
});

describe('دوشیزهٔ پیر', () => {
  it('draws from the next seat that still holds cards', () => {
    const game = loadGame('oldmaid');
    const state = fresh('oldmaid', 4);
    const seat = state.currentPlayer;
    const gameModule = loadGame('oldmaid') as unknown as {
      drawTarget: (state: GameState, seat: number) => number;
    };
    const target = gameModule.drawTarget(state, seat);
    expect(target).toBeGreaterThanOrEqual(0);
    expect(state.hands[target].length).toBeGreaterThan(0);

    const before = state.hands[seat].length + state.hands[target].length;
    expect(game.handleMove({ cardIndex: 0 }, state, seat)).toBeNull();
    const after = state.hands[seat].length + state.hands[target].length;
    // The draw itself only moves a card between hands; a completed pair takes
    // two cards off the table.
    expect(after === before || after === before - 2).toBe(true);
    expect(state.currentPlayer).not.toBe(seat);
  });

  it('names the guest who draws the ghost as the loser', () => {
    const game = loadGame('oldmaid');
    const state = fresh('oldmaid', 2);
    state.hands = [
      [
        { rank: 'A', suit: 's', id: 'As' },
        { rank: 'A', suit: 'h', id: 'Ah' },
      ],
      [{ rank: '👻', suit: '', id: 'J1' }],
    ];
    state.currentPlayer = 0;
    state.messages = [];
    state.lastDraw = null;
    state.lastDiscards = null;
    state.handSizes = [2, 1];
    state.winner = null;
    state.loser = null;

    expect(game.handleMove({ cardIndex: 0 }, state, 0)).toBeNull();
    // The pair of aces is discarded and the guest keeps the ghost alone.
    expect(state.loser).toBe(0);
    expect(state.winner).toBe(-1);
  });

  it('hides the other hands but keeps their size', () => {
    const game = loadGame('oldmaid');
    const state = fresh('oldmaid', 3);
    const view = game.playerView!(state, 0) as { hands: Array<Array<unknown> | null> };
    expect(view.hands[0]).toEqual(state.hands[0]);
    expect(view.hands[1]!.every((card) => card === null)).toBe(true);
    expect(view.hands[1]).toHaveLength(state.hands[1].length);
  });
});

describe('بیگ‌تو', () => {
  it('deals the whole deck and opens with the three of diamonds', () => {
    const state = fresh('bigtwo', 4);
    expect(state.hands.map((hand: unknown[]) => hand.length)).toEqual([13, 13, 13, 13]);
    expect(state.currentPlayer).toBe(
      state.hands.findIndex((hand: Array<{ id: string }>) => hand.some((card) => card.id === '3d')),
    );
  });

  it('refuses an opening that leaves the three of diamonds out', () => {
    const game = loadGame('bigtwo');
    const state = fresh('bigtwo', 3);
    const seat = state.currentPlayer;
    const other = state.hands[seat].find((card: { id: string }) => card.id !== '3d');

    expect(game.handleMove({ cards: [other.id] }, state, seat)).toBe('bt_first_must_have_d3');
  });

  it('beats a single, then resets the round after everyone passes', () => {
    const game = loadGame('bigtwo');
    const state = fresh('bigtwo', 3);
    state.hands = [
      [
        { rank: '3', suit: 'd', id: '3d' },
        { rank: '5', suit: 's', id: '5s' },
      ],
      [
        { rank: '9', suit: 'd', id: '9d' },
        { rank: '6', suit: 's', id: '6s' },
      ],
      [{ rank: '4', suit: 'c', id: '4c' }],
    ];
    state.currentPlayer = 0;
    state.lastPlay = null;
    state.lastPlayPlayer = -1;
    state._opened = false;
    state.passed = [false, false, false];
    state.winner = null;

    expect(game.handleMove({ cards: ['3d'] }, state, 0)).toBeNull();
    expect(game.handleMove({ pass: true }, state, 1)).toBeNull();
    expect(game.handleMove({ pass: true }, state, 2)).toBeNull();
    // Two passes bring the lead back to the last player, who may start again.
    expect(state.lastPlay).toBeNull();
    expect(state.currentPlayer).toBe(0);
    expect(game.handleMove({ cards: ['5s'] }, state, 0)).toBeNull();
  });

  it('hides the hands of the other seats while the hand is live', () => {
    const game = loadGame('bigtwo');
    const state = fresh('bigtwo', 3);
    state.hands = [
      [
        { rank: '3', suit: 'd', id: '3d' },
        { rank: '5', suit: 's', id: '5s' },
      ],
      [
        { rank: '9', suit: 'd', id: '9d' },
        { rank: '6', suit: 's', id: '6s' },
      ],
      [
        { rank: '4', suit: 'c', id: '4c' },
        { rank: '7', suit: 's', id: '7s' },
      ],
    ];
    state.currentPlayer = 0;
    state.lastPlay = null;
    state.lastPlayPlayer = -1;
    state._opened = false;
    expect(game.handleMove({ cards: ['3d'] }, state, 0)).toBeNull();

    const view = game.playerView!(state, 1) as { hands: Array<Array<unknown> | null> };
    expect(view.hands[0]!.every((card) => card === null)).toBe(true);
    expect(view.hands[1]!.some((card) => card !== null)).toBe(true);
    expect(state.winner).toBeNull();
  });
});

describe('زمیندار', () => {
  it('deals seventeen cards and three bottom cards', () => {
    const state = fresh('doudizhu', 3);
    expect(state.hands.map((hand: unknown[]) => hand.length)).toEqual([17, 17, 17]);
    expect(state.bottomCards).toHaveLength(3);
    expect(state.phase).toBe('bidding');
  });

  it('re-deals when nobody calls for the landlord', () => {
    const game = loadGame('doudizhu');
    const state = fresh('doudizhu', 3);
    state.currentBidder = 0;
    state.currentPlayer = 0;
    state.callPhase = 'call';
    state.passCount = 0;
    state.passedCall = [false, false, false];

    expect(game.handleMove({ pass: true }, state, 0)).toBeNull();
    state.currentBidder = 1;
    state.currentPlayer = 1;
    expect(game.handleMove({ pass: true }, state, 1)).toBeNull();
    state.currentBidder = 2;
    state.currentPlayer = 2;
    expect(game.handleMove({ pass: true }, state, 2)).toBeNull();

    expect(state.phase).toBe('bidding');
    expect(state.hands.map((hand: unknown[]) => hand.length)).toEqual([17, 17, 17]);
  });

  it('gives the landlord the bottom cards and lets them open', () => {
    const game = loadGame('doudizhu');
    const state = fresh('doudizhu', 3);
    state.currentBidder = 0;
    state.currentPlayer = 0;
    state.callPhase = 'call';
    state.passCount = 0;
    state.passedCall = [false, false, false];
    state.robAttempts = [];
    state.eligibleForRob = [true, true, true];

    expect(game.handleMove({ call: true }, state, 0)).toBeNull();
    expect(state.callPhase).toBe('rob');

    // The two other seats decline the rob, so seat 0 keeps the role.
    state.currentBidder = 1;
    state.currentPlayer = 1;
    expect(game.handleMove({ passRob: true }, state, 1)).toBeNull();
    state.currentBidder = 2;
    state.currentPlayer = 2;
    expect(game.handleMove({ passRob: true }, state, 2)).toBeNull();

    expect(state.landlord).toBe(0);
    expect(state.phase).toBe('playing');
    expect(state.currentPlayer).toBe(0);
    expect(state.hands[0]).toHaveLength(20);
  });

  it('ends the round with the landlord winning', () => {
    const game = loadGame('doudizhu');
    const state = fresh('doudizhu', 3);
    state.phase = 'playing';
    state.landlord = 0;
    state.currentPlayer = 0;
    state.lastPlay = null;
    state.passStreak = 0;
    state.hands = [[{ rank: '3', suit: 's', id: '3s' }], [{ rank: '4', suit: 's', id: '4s' }], []];
    state.winner = null;
    state.totalRounds = 1;
    state.cumulativeScore = [0, 0, 0];
    state.roundHistory = [];
    state.gameMultiplier = 1;

    expect(game.handleMove({ cards: ['3s'] }, state, 0)).toBeNull();
    expect(state.winner).toBe(-2);
    expect(state.roundWinner).toBe(-2);
    expect(state.cumulativeScore[0]).toBe(200);
    expect(state.cumulativeScore[1]).toBe(-100);
  });

  it('masks the hands inside the published board copy', () => {
    const game = loadGame('doudizhu');
    const state = fresh('doudizhu', 3);
    const view = game.playerView!(state, 1) as {
      hands: Array<Array<unknown> | null>;
      board: { hands: Array<Array<unknown> | null> };
    };

    expect(view.hands[1]!.length).toBe(17);
    expect(view.hands[1]![0]).not.toBeNull();
    expect(view.hands[0]!.every((card) => card === null)).toBe(true);
    // The engine keeps a full copy in `board`; it must be masked too or every
    // hand would leak through it.
    expect(view.board.hands[0]!.every((card) => card === null)).toBe(true);
  });
});

describe('card-game catalogue', () => {
  it('marks the five card tables playable', () => {
    for (const id of ['davinci', 'hearts', 'oldmaid', 'doudizhu', 'bigtwo']) {
      expect(manifest(id).playable).toBe(true);
      expect(manifest(id).categoryFa).toBe('کارتی');
      expect(typeof loadGame(id).playerView).toBe('function');
    }
  });

  it('translates every refusal the card engines can return', () => {
    const keys = [
      'dv_cannot_guess_own',
      'dv_card_already_revealed',
      'dv_choose_joker_position',
      'dv_invalid_guess',
      'dv_invalid_position',
      'dv_invalid_target',
      'dv_must_guess_first',
      'dv_no_card_there',
      'dv_player_out',
      'ht_already_passed',
      'ht_card_not_in_hand',
      'ht_illegal_card',
      'ht_no_duplicate_selection',
      'ht_no_hand',
      'ht_select_3_to_pass',
      'ht_select_a_card',
      'ht_wrong_phase',
      'om_invalid_draw_position',
      'om_no_hand',
      'om_player_no_cards',
      'bt_card_not_in_hand',
      'bt_doesnt_beat',
      'bt_first_must_have_d3',
      'bt_invalid_format',
      'bt_invalid_play',
      'bt_must_lead',
      'bt_must_play_highest_single',
      'bt_no_hand',
      'ddz_already_robbed',
      'ddz_bid_must_be_0_3',
      'ddz_card_not_in_hand',
      'ddz_doesnt_beat',
      'ddz_invalid_bid_action',
      'ddz_invalid_format',
      'ddz_invalid_play',
      'ddz_must_lead',
      'ddz_not_eligible_to_rob',
      'ddz_not_your_bid',
    ];

    for (const key of keys) {
      const message = messageFa(key);
      expect(message).not.toBe(key);
      expect(message).toMatch(/[\u0600-\u06FF]/);
    }
  });
});
