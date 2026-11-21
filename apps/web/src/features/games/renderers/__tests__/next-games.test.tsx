import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameSeatView } from '@cafeflow/shared';
import { Monopoly } from '../Monopoly';
import { SheepTile } from '../SheepTile';
import { Sanguo } from '../Sanguo';
import { SuikaBattle } from '../SuikaBattle';

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

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

function board() {
  return Array.from({ length: 28 }, (_, index) => ({
    type: index === 0 ? 'go' : 'property',
    name: `خانهٔ ${index + 1}`,
    price: 100,
    rent: [2, 10, 30],
    color: '#8B5A2B',
    group: 0,
  }));
}

describe('Monopoly', () => {
  it('rolls the dice', async () => {
    const onMove = vi.fn();
    render(
      <Monopoly
        {...base}
        state={{
          board: board(),
          positions: [0, 0],
          cash: [1500, 1500],
          properties: {},
          eliminated: [false, false],
          inJail: [false, false],
          currentPlayer: 0,
          phase: 'waiting',
          dice: [0, 0],
          winner: null,
          round: 1,
          roundLimit: 50,
        }}
        onMove={onMove}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'تاس بریز' }));
    expect(onMove).toHaveBeenCalledWith({ type: 'roll' });
  });
});

describe('SheepTile', () => {
  it('picks an exposed tile', async () => {
    const onMove = vi.fn();
    render(
      <SheepTile
        {...base}
        state={{
          phase: 'playing',
          winner: null,
          sameBoard: true,
          layout: [{ id: 5, x: 0, y: 0, z: 0, level: 1, faceDown: false }],
          patterns: [{ 5: 0 }],
          players: [
            { level: 1, removed: {}, slot: [], score: 0, eliminated: false, powers: { undo: 1, shuffle: 1, pop3: 1 }, shuffleOverride: {} },
            { level: 1, removed: {}, slot: [], score: 0, eliminated: false, powers: { undo: 1, shuffle: 1, pop3: 1 }, shuffleOverride: {} },
          ],
          slotSize: 7,
        }}
        onMove={onMove}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'کاشی ۱' }));
    expect(onMove).toHaveBeenCalledWith({ type: 'pick', tileId: 5 });
  });
});

describe('Sanguo', () => {
  it('selects a hand card and shows the ask', async () => {
    const onMove = vi.fn();
    const players = [
      {
        role: 'lord', general: 'liubei', gender: 'm', kingdom: 'shu', hp: 5, maxHp: 5, alive: true,
        hand: [{ id: 11, name: 'sha', suit: 'S', rank: 7 }], handCount: 1, equip: {}, judge: [],
      },
      {
        role: 'rebel', general: 'lvbu', gender: 'm', kingdom: 'qun', hp: 4, maxHp: 4, alive: true,
        hand: [], handCount: 0, equip: {}, judge: [],
      },
    ];
    render(
      <Sanguo
        {...base}
        state={{
          players,
          ask: { type: 'play', to: 0, deadline: Date.now() + 30_000 },
          winner: null,
          winners: [],
          log: [{ t: 'turn', p: 0 }],
          lord: 0,
          current: 0,
          deckCount: 40,
        }}
        onMove={onMove}
      />,
    );

    expect(screen.getByText(/کارت بازی کنید یا نوبت را تمام کنید/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /حمله/ }));
    await userEvent.click(screen.getByRole('button', { name: 'پایان نوبت' }));
    expect(onMove).toHaveBeenCalledWith({ type: 'end' });
  });
});

describe('SuikaBattle', () => {
  it('shows the scoreboard and next fruit', () => {
    render(
      <SuikaBattle
        {...base}
        state={{
          phase: 'playing',
          scores: [12, 5],
          current: [2, 1],
          next: [3, 0],
          eliminated: [false, false],
          winner: null,
        }}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByText(/جدول امتیاز/)).toBeTruthy();
    expect(screen.getByText(/در دست: پرتقال/)).toBeTruthy();
    fireEvent.pointerDown(screen.getByLabelText('زمین بازی نبرد میوه‌ها'), { clientX: 100, clientY: 100 });
  });
});
