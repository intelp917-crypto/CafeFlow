import { describe, expect, it } from 'vitest';
import { loadGame, manifest, messageFa, type GameState } from '../src/index';

function fresh(id: string, players: number): GameState {
  const game = loadGame(id);
  const state = game.createState();
  game.initGame?.(state, players);
  return state;
}

const tile = (color: string, num: number) => ({ color, num, id: `${color}-${num}-a` });

describe('رامیکاب', () => {
  function table(state: GameState) {
    Object.assign(state, {
      phase: 'play',
      currentPlayer: 0,
      winner: null,
      table: [],
      pool: [{ id: 'pool' }],
      hands: [
        [tile('red', 1), tile('red', 2), tile('red', 3), tile('blue', 5)],
        [tile('black', 9)],
      ],
      hasBroken: [true, true],
      playedThisTurn: [false, false],
      meldPending: null,
      workspace: [],
      savedTable: null,
      savedHand: null,
      savedHandIds: null,
      requireBreak: true,
    });
  }

  it('deals fourteen tiles and lays a new run', () => {
    const game = loadGame('rummikub');
    const state = fresh('rummikub', 2);
    expect(state.hands.map((hand: unknown[]) => hand.length)).toEqual([14, 14]);
    table(state);

    expect(game.handleMove({ tileIds: ['red-1-a', 'red-2-a', 'red-3-a'] }, state, 0)).toBeNull();
    expect(state.table).toHaveLength(1);
    expect(state.hands[0].map((t: { id: string }) => t.id)).toEqual(['blue-5-a']);
    expect(state.playedThisTurn[0]).toBe(true);
  });

  it('rebuilds the table in manipulate mode without losing tiles', () => {
    const game = loadGame('rummikub');
    const state = fresh('rummikub', 2);
    table(state);
    game.handleMove({ tileIds: ['red-1-a', 'red-2-a', 'red-3-a'] }, state, 0);

    expect(game.handleMove({ action: 'start_manipulate' }, state, 0)).toBeNull();
    expect(state.phase).toBe('manipulate');
    expect(state.workspace).toHaveLength(4);

    const groups = [['red-1-a', 'red-2-a', 'red-3-a', 'blue-5-a']];
    // blue-5 cannot extend a red run: the engine must refuse the arrangement.
    expect(game.handleMove({ action: 'submit', groups }, state, 0)).toBe('rk_illegal_sets');

    expect(game.handleMove({ action: 'cancel' }, state, 0)).toBeNull();
    expect(state.phase).toBe('play');
    expect(state.hands[0]).toHaveLength(1);
    expect(state.table).toHaveLength(1);
  });
});

describe('ماهیونگ', () => {
  it('hides the opponents’ hands in both variants', () => {
    for (const id of ['mahjong-sichuan', 'mahjong-cantonese']) {
      const game = loadGame(id);
      const state = fresh(id, 2);
      const view = game.playerView!(state, 0) as { hands: Array<Array<{ k?: string }> | number> };
      expect(Array.isArray(view.hands[0])).toBe(true);
      const hidden = view.hands[1];
      if (typeof hidden === 'number') expect(hidden).toBeGreaterThan(0);
      else expect(hidden.every((card) => card.k === undefined)).toBe(true);
    }
  });

  it('discards a tile in the Sichuan ruleset', () => {
    const game = loadGame('mahjong-sichuan');
    const state = fresh('mahjong-sichuan', 2);
    const hand = [
      { k: 'wan', n: 1, id: 'wan-1' },
      { k: 'wan', n: 2, id: 'wan-2' },
      { k: 'wan', n: 3, id: 'wan-3' },
    ];
    Object.assign(state, {
      phase: 'play',
      currentPlayer: 0,
      winner: null,
      hands: [hand, []],
      melds: [[], []],
      discards: [[], []],
      deck: [{ k: 'tong', n: 5, id: 'tong-5' }],
      claim: null,
      voidSuit: ['tong', 'tiao'],
      _noDraw: false,
      _gangDraw: -1,
      winners: [],
      _lastDiscardFrom: -1,
      lastDiscard: null,
    });

    expect(game.handleMove({ type: 'discard', tileId: 'wan-2' }, state, 0)).toBeNull();
    expect(state.discards[0].map((t: { id: string }) => t.id)).toEqual(['wan-2']);
    expect(state.hands[0]).toHaveLength(2);
  });

  it('serves Persian content for the party games', () => {
    const td = loadGame('truthdare');
    const tdState = fresh('truthdare', 3);
    expect(Object.keys(tdState.decks)).toEqual(['persian']);
    expect(td.handleMove({ action: 'draw', kind: 'truth' }, tdState, 0)).toBeNull();
    expect(tdState.currentCard.text).toMatch(/[؀-ۿ]/);

    const uc = loadGame('undercover');
    const ucState = fresh('undercover', 4);
    expect(ucState.civWord).toMatch(/[؀-ۿ]/);
    expect(ucState.ucWord).toMatch(/[؀-ۿ]/);
    const ucView = uc.playerView!(ucState, 0) as { myWord: string };
    expect(ucView.myWord).toMatch(/[؀-ۿ]|^$/);

    const quiz = loadGame('quizrace');
    const quizState = fresh('quizrace', 2);
    expect(quizState.phase).toBe('question');
    expect(quizState.question.en.q).toMatch(/[؀-ۿ]/);
    expect(quizState.question.en.opts).toHaveLength(4);
    expect(quizState.answer).toBeGreaterThanOrEqual(0);
    expect(quizState.deadline).toBeGreaterThan(0);

    const dg = loadGame('drawguess');
    const dgState = fresh('drawguess', 2);
    expect(dgState._wordPool.every((word: string) => /[؀-ۿ]/.test(word))).toBe(true);
    expect([...(dgState.wordOptions ?? []), dgState.word ?? ''].some((word: string) => /[؀-ۿ]/.test(word))).toBe(true);
  });

  it('serves the Persian labels', () => {
    for (const key of ['rk_need_break_ice', 'mj_bad_swap', 'mj_cannot_chow']) {
      expect(messageFa(key)).not.toBe(key);
    }
    expect(manifest('rummikub').playable).toBe(true);
    expect(manifest('mahjong-sichuan').playable).toBe(true);
    expect(manifest('mahjong-cantonese').playable).toBe(true);
  });
});
