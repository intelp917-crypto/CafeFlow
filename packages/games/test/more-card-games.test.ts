import { describe, expect, it } from 'vitest';
import { loadGame, manifest, messageFa, type GameState } from '../src/index';

function fresh(id: string, players: number): GameState {
  const game = loadGame(id);
  const state = game.createState();
  game.initGame?.(state, players);
  return state;
}

describe('پائو دِه‌کوآی', () => {
  it('deals sixteen cards to each seat and opens with the three of spades', () => {
    const state = fresh('paodekuai', 3);
    expect(state.hands.map((hand: unknown[]) => hand.length)).toEqual([16, 16, 16]);
    expect(state.phase).toBe('playing');
    expect(state.firstCard).toBe('3s');
    expect(state.currentPlayer).toBe(
      state.hands.findIndex((hand: Array<{ id: string }>) => hand.some((card) => card.id === '3s')),
    );
  });

  it('refuses an opening that leaves the three of spades out', () => {
    const game = loadGame('paodekuai');
    const state = fresh('paodekuai', 3);
    const seat = state.currentPlayer;
    const other = state.hands[seat].find((card: { id: string }) => card.id !== '3s');

    expect(game.handleMove({ cards: [other.id] }, state, seat)).toBe('pdk_first_must_have_s3');
    expect(game.handleMove({ cards: ['3s'] }, state, seat)).toBeNull();
    expect(state.firstCard).toBeNull();
    expect(state.lastPlay.player).toBe(seat);
    expect(state.currentPlayer).toBe((seat + 1) % 3);
  });

  it('cannot pass while leading', () => {
    const game = loadGame('paodekuai');
    const state = fresh('paodekuai', 3);
    state.currentPlayer = 0;
    state.lastPlay = null;
    state.lastPlayPlayer = -1;
    state.firstCard = null;

    expect(game.handleMove({ cards: [] }, state, 0)).toBe('pdk_must_lead');
  });

  it('settles a round and starts the next one on demand', () => {
    const game = loadGame('paodekuai');
    const state = fresh('paodekuai', 3);
    Object.assign(state, {
      phase: 'playing',
      currentRound: 1,
      totalRounds: 3,
      hands: [
        [{ rank: '3', suit: 's', id: '3s' }],
        [
          { rank: '4', suit: 's', id: '4s' },
          { rank: '5', suit: 's', id: '5s' },
        ],
        [],
      ],
      currentPlayer: 0,
      lastPlay: null,
      lastPlayPlayer: -1,
      firstCard: null,
      passed: [false, false, false],
      played: [true, false, false],
      bombs: [0, 0, 0],
      roundScores: [0, 0, 0],
      cumulativeScore: [0, 0, 0],
      winner: null,
      roundResult: null,
      roundHistory: [],
    });

    expect(game.handleMove({ cards: ['3s'] }, state, 0)).toBeNull();
    expect(state.phase).toBe('roundEnd');
    expect(state.roundResult.winner).toBe(0);
    // Seat 1 never played, so its two cards count double.
    expect(state.roundScores).toEqual([4, -4, 0]);
    expect(state.winner).toBeNull();

    expect(game.handleMove({ action: 'next_round' }, state, 1)).toBeNull();
    expect(state.phase).toBe('playing');
    expect(state.currentRound).toBe(2);
    expect(state.hands.map((hand: unknown[]) => hand.length)).toEqual([16, 16, 16]);
  });

  it('crowns a match winner only after the last round', () => {
    const game = loadGame('paodekuai');
    const state = fresh('paodekuai', 3);
    Object.assign(state, {
      phase: 'playing',
      currentRound: 3,
      totalRounds: 3,
      hands: [
        [{ rank: '3', suit: 's', id: '3s' }],
        [
          { rank: '4', suit: 's', id: '4s' },
          { rank: '5', suit: 's', id: '5s' },
        ],
        [{ rank: '6', suit: 's', id: '6s' }],
      ],
      currentPlayer: 0,
      lastPlay: null,
      lastPlayPlayer: -1,
      firstCard: null,
      passed: [false, false, false],
      played: [true, true, true],
      bombs: [0, 0, 0],
      roundScores: [0, 0, 0],
      cumulativeScore: [5, -2, -3],
      winner: null,
      roundResult: null,
      roundHistory: [],
    });

    expect(game.handleMove({ cards: ['3s'] }, state, 0)).toBeNull();
    expect(state.phase).toBe('matchEnd');
    expect(state.winner).toBe(0);
    expect(state.cumulativeScore).toEqual([8, -4, -4]);
  });

  it('hides the other hands while the round is live', () => {
    const game = loadGame('paodekuai');
    const state = fresh('paodekuai', 3);
    const view = game.playerView!(state, 2) as { hands: Array<Array<unknown> | null> };

    expect(view.hands[2]).toEqual(state.hands[2]);
    expect(view.hands[0]!.every((card) => card === null)).toBe(true);
    expect(view.hands[0]).toHaveLength(16);
  });
});

describe('بچه‌گربه‌های انفجاری', () => {
  it('deals four cards plus a defuse to every seat', () => {
    const state = fresh('exploding-kittens', 3);
    expect(state.hands.map((hand: unknown[]) => hand.length)).toEqual([5, 5, 5]);
    expect(state.alive).toEqual([true, true, true]);
    expect(state.phase).toBe('play');
    expect(state.currentPlayer).toBe(0);
  });

  it('draws a card and passes the turn', () => {
    const game = loadGame('exploding-kittens');
    const state = fresh('exploding-kittens', 2);
    Object.assign(state, {
      phase: 'draw',
      currentPlayer: 0,
      winner: null,
      hands: [[], []],
      alive: [true, true],
      extraTurns: [0, 0],
      deck: [{ type: 'skip', id: 'skip-test' }],
      peekedCards: null,
      lastAction: null,
      actionSeq: 0,
    });

    expect(game.handleMove({}, state, 0)).toBeNull();
    expect(state.hands[0]).toEqual([{ type: 'skip', id: 'skip-test' }]);
    expect(state.phase).toBe('play');
    expect(state.currentPlayer).toBe(1);
    expect(state.lastAction.type).toBe('draw');
  });

  it('eliminates a seat that draws an exploding kitten without a defuse', () => {
    const game = loadGame('exploding-kittens');
    const state = fresh('exploding-kittens', 3);
    Object.assign(state, {
      phase: 'draw',
      currentPlayer: 0,
      winner: null,
      hands: [[{ type: 'skip', id: 'skip-a' }], [{ type: 'skip', id: 'skip-b' }], []],
      alive: [true, true, true],
      extraTurns: [0, 0, 0],
      deck: [{ type: 'explode', id: 'explode-test' }],
      peekedCards: null,
    });

    expect(game.handleMove({}, state, 0)).toBeNull();
    expect(state.alive[0]).toBe(false);
    expect(state.hands[0]).toEqual([]);
    expect(state.currentPlayer).toBe(1);
    expect(state.phase).toBe('play');
    expect(state.winner).toBeNull();
  });

  it('declares the last survivor the winner', () => {
    const game = loadGame('exploding-kittens');
    const state = fresh('exploding-kittens', 3);
    Object.assign(state, {
      phase: 'draw',
      currentPlayer: 2,
      winner: null,
      hands: [[], [], []],
      alive: [false, true, true],
      extraTurns: [0, 0, 0],
      deck: [{ type: 'explode', id: 'explode-last' }],
      peekedCards: null,
    });

    expect(game.handleMove({}, state, 2)).toBeNull();
    expect(state.alive[2]).toBe(false);
    expect(state.winner).toBe(1);
    expect(state.phase).toBe('over');
  });

  it('sends a defused player to choose where the kitten goes back', () => {
    const game = loadGame('exploding-kittens');
    const state = fresh('exploding-kittens', 2);
    Object.assign(state, {
      phase: 'draw',
      currentPlayer: 0,
      winner: null,
      hands: [
        [{ type: 'defuse', id: 'defuse-mine' }],
        [],
      ],
      alive: [true, true],
      extraTurns: [0, 0],
      deck: [
        { type: 'skip', id: 'skip-deck' },
        { type: 'explode', id: 'explode-deck' },
      ],
      peekedCards: null,
      pendingBomb: null,
    });

    expect(game.handleMove({}, state, 0)).toBeNull();
    expect(state.phase).toBe('place');
    expect(state.hands[0]).toEqual([]);
    expect(state.pendingBomb.id).toBe('explode-deck');

    expect(game.handleMove({ position: 'top' }, state, 0)).toBeNull();
    expect(state.phase).toBe('play');
    expect(state.deck).toHaveLength(2);
    expect(state.deck[state.deck.length - 1].type).toBe('explode');
    expect(state.currentPlayer).toBe(1);
  });

  it('refuses to play a defuse and demands a target for a steal', () => {
    const game = loadGame('exploding-kittens');
    const state = fresh('exploding-kittens', 2);
    Object.assign(state, {
      phase: 'play',
      currentPlayer: 0,
      winner: null,
      hands: [
        [
          { type: 'defuse', id: 'defuse-play' },
          { type: 'steal', id: 'steal-play' },
        ],
        [{ type: 'skip', id: 'skip-victim' }],
      ],
      alive: [true, true],
      extraTurns: [0, 0],
      deck: [],
    });

    expect(game.handleMove({ cardId: 'defuse-play' }, state, 0)).toBe('ek_card_no_effect');
    expect(game.handleMove({ cardId: 'steal-play' }, state, 0)).toBe('ek_must_target_player');
  });

  it('keeps other hands, the deck and the peek private', () => {
    const game = loadGame('exploding-kittens');
    const state = fresh('exploding-kittens', 3);
    state.currentPlayer = 1;
    state.peekedCards = [{ type: 'explode', id: 'peek-1' }];

    const other = game.playerView!(state, 0) as {
      hands: Array<Array<unknown> | null>;
      deck: Array<unknown>;
      peekedCards: unknown;
    };
    expect(other.hands[1]!.every((card) => card === null)).toBe(true);
    expect(other.deck.every((card) => card === null)).toBe(true);
    expect(other.peekedCards).toBeNull();

    const current = game.playerView!(state, 1) as { peekedCards: unknown };
    expect(current.peekedCards).toEqual([{ type: 'explode', id: 'peek-1' }]);
  });
});

describe('catalogue of the new card tables', () => {
  it('marks both playable', () => {
    for (const id of ['paodekuai', 'exploding-kittens']) {
      expect(manifest(id).playable).toBe(true);
      expect(manifest(id).categoryFa).toBe('کارتی');
    }
    expect(manifest('paodekuai').minPlayers).toBe(2);
    expect(manifest('paodekuai').maxPlayers).toBe(3);
    expect(manifest('exploding-kittens').maxPlayers).toBe(6);
  });

  it('translates every refusal of the two engines', () => {
    const keys = [
      'pdk_click_next_round',
      'pdk_invalid_format',
      'pdk_must_lead',
      'pdk_must_beat',
      'pdk_card_not_in_hand',
      'pdk_invalid_play',
      'pdk_doesnt_beat',
      'pdk_first_must_have_s3',
      'pdk_must_play_highest_single',
      'ek_you_are_out',
      'ek_deck_empty',
      'ek_card_not_in_hand',
      'ek_card_no_effect',
      'ek_invalid_target',
      'ek_must_target_player',
      'ek_target_out',
    ];
    for (const key of keys) {
      expect(messageFa(key)).not.toBe(key);
      expect(messageFa(key)).toMatch(/[\u0600-\u06FF]/);
    }
  });
});
