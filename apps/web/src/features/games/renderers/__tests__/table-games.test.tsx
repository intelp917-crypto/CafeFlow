import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameSeatView } from '@cafeflow/shared';
import { Rummikub } from '../Rummikub';
import { Mahjong } from '../Mahjong';

const seats: GameSeatView[] = [
  { index: 0, nameFa: 'سارا', ready: true, connected: true, isHost: true, isYou: true },
  { index: 1, nameFa: 'رضا', ready: true, connected: true, isHost: false, isYou: false },
];

const base = {
  seats,
  mySeat: 0,
  phase: 'playing' as const,
  deadline: 0,
  canRestart: false,
  onRestart: vi.fn(),
};

const tile = (color: string, num: number, suffix = 'a') => ({ color, num, id: `${color}-${num}-${suffix}` });

describe('Rummikub', () => {
  function state(overrides: Record<string, unknown> = {}) {
    return {
      phase: 'play',
      currentPlayer: 0,
      winner: null,
      hands: [
        [tile('red', 1), tile('red', 2), tile('red', 3), tile('blue', 5)],
        [tile('black', 9)],
      ],
      table: [],
      pool: [{ id: 'p1' }],
      hasBroken: [true, true],
      playedThisTurn: [false, false],
      meldPending: null,
      workspace: [],
      ...overrides,
    };
  }

  it('lays a new run from the selected tiles', async () => {
    const onMove = vi.fn();
    render(<Rummikub {...base} state={state()} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: '۱ قرمز' }));
    await userEvent.click(screen.getByRole('button', { name: '۲ قرمز' }));
    await userEvent.click(screen.getByRole('button', { name: '۳ قرمز' }));
    await userEvent.click(screen.getByRole('button', { name: /چیدن سری تازه/ }));

    expect(onMove).toHaveBeenCalledWith({ tileIds: ['red-1-a', 'red-2-a', 'red-3-a'] });
  });

  it('draws when nothing fits', async () => {
    const onMove = vi.fn();
    render(<Rummikub {...base} state={state()} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: /کارت بکش و پایان نوبت/ }));
    expect(onMove).toHaveBeenCalledWith({ pass: true });
  });
});

describe('Mahjong', () => {
  const hand = [
    { k: 'wan', n: 1, id: 'wan-1' },
    { k: 'wan', n: 2, id: 'wan-2' },
    { k: 'tong', n: 5, id: 'tong-5' },
    { k: 'feng', n: 1, id: 'feng-1' },
  ];

  function state(overrides: Record<string, unknown> = {}) {
    return {
      phase: 'play',
      currentPlayer: 0,
      winner: null,
      hands: [hand, 13],
      melds: [[], []],
      discards: [[], []],
      deckCount: 60,
      voidSuit: [],
      claim: null,
      lastDiscard: null,
      drawn: null,
      _variants: 'sichuan',
      ...overrides,
    };
  }

  it('discards the tapped tile on my turn', async () => {
    const onMove = vi.fn();
    render(<Mahjong {...base} state={state()} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: '۲ کاراکتر' }));
    expect(onMove).toHaveBeenCalledWith({ type: 'discard', tileId: 'wan-2' });
  });

  it('offers the claim actions when it is my claim turn', async () => {
    const onMove = vi.fn();
    render(
      <Mahjong
        {...base}
        state={state({
          phase: 'claim',
          claim: { tile: { k: 'tong', n: 5, id: 'tong-5' }, discarder: 1, order: [0], idx: 0 },
        })}
        onMove={onMove}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'پنگ' }));
    expect(onMove).toHaveBeenCalledWith({ type: 'pung' });
  });
});
