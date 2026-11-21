import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameSeatView } from '@cafeflow/shared';
import { Paodekuai } from '../Paodekuai';
import { ExplodingKittens } from '../ExplodingKittens';

const seats: GameSeatView[] = [
  { index: 0, nameFa: 'سارا', ready: true, connected: true, isHost: true, isYou: true },
  { index: 1, nameFa: 'رضا', ready: true, connected: true, isHost: false, isYou: false },
  { index: 2, nameFa: 'مینا', ready: true, connected: true, isHost: false, isYou: false },
];

const base = {
  mySeat: 0,
  phase: 'playing' as const,
  deadline: 0,
  canRestart: false,
  onRestart: vi.fn(),
};

describe('Paodekuai', () => {
  const myHand = [
    { rank: '3', suit: 's', id: '3s' },
    { rank: '7', suit: 'c', id: '7c' },
  ];

  function state(overrides: Record<string, unknown> = {}) {
    return {
      phase: 'playing',
      currentPlayer: 0,
      winner: null,
      hands: [myHand, [null, null], [null, null]],
      lastPlay: null,
      lastPlayPlayer: -1,
      passed: [false, false, false],
      oneCard: [false, false, false],
      firstCard: '3s',
      currentRound: 1,
      totalRounds: 3,
      cumulativeScore: [0, 0, 0],
      roundResult: null,
      ...overrides,
    };
  }

  it('tells the opening seat which card the first play needs', async () => {
    const onMove = vi.fn();
    render(<Paodekuai {...base} seats={seats} state={state()} onMove={onMove} />);

    expect(screen.getAllByText(/سه پیک/).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'پاس' }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'کارت ۳ پیک' }));
    await userEvent.click(screen.getByRole('button', { name: 'بازی کارت‌های انتخاب‌شده' }));
    expect(onMove).toHaveBeenCalledWith({ cards: ['3s'] });
  });

  it('lets a seat pass once a play is on the table', async () => {
    const onMove = vi.fn();
    render(
      <Paodekuai
        {...base}
        seats={seats}
        state={state({
          firstCard: null,
          lastPlay: { player: 1, cards: [{ rank: '9', suit: 'd', id: '9d' }], play: { type: 'single' } },
          lastPlayPlayer: 1,
        })}
        onMove={onMove}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'پاس' }));
    expect(onMove).toHaveBeenCalledWith({ cards: [] });
  });

  it('offers the next round once a round is settled', async () => {
    const onMove = vi.fn();
    render(
      <Paodekuai
        {...base}
        seats={seats}
        state={state({
          phase: 'roundEnd',
          firstCard: null,
          hands: [myHand, [null, null], [null]],
          roundResult: {
            winner: 0,
            remaining: [[], [null, null], [null]],
            spring: [false, true, false],
            scores: [4, -4, -2],
            bombs: [0, 0, 0],
          },
        })}
        onMove={onMove}
      />,
    );

    expect(screen.getByText(/دستِ ۱ تمام شد/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'دور بعد' }));
    expect(onMove).toHaveBeenCalledWith({ action: 'next_round' });
  });
});

describe('ExplodingKittens', () => {
  function state(overrides: Record<string, unknown> = {}) {
    return {
      phase: 'play',
      currentPlayer: 0,
      winner: null,
      hands: [
        [
          { type: 'attack', id: 'attack-1' },
          { type: 'skip', id: 'skip-1' },
          { type: 'defuse', id: 'defuse-1' },
        ],
        [null, null],
        [null],
      ],
      deck: [null, null, null, null],
      alive: [true, true, true],
      extraTurns: [0, 0, 0],
      peekedCards: null,
      lastAction: null,
      ...overrides,
    };
  }

  it('asks for a target when an attack is played', async () => {
    const onMove = vi.fn();
    render(<ExplodingKittens {...base} seats={seats} state={state()} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: /حمله/ }));
    expect(screen.getByText(/روی کدام بازیکن/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'رضا' }));
    expect(onMove).toHaveBeenCalledWith({ cardId: 'attack-1', targetPlayer: 1 });
  });

  it('plays a skip straight away and refuses to play a defuse', async () => {
    const onMove = vi.fn();
    render(<ExplodingKittens {...base} seats={seats} state={state()} onMove={onMove} />);

    expect((screen.getByRole('button', { name: /خنثی‌سازی/ }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: /رد کردن/ }));
    expect(onMove).toHaveBeenCalledWith({ cardId: 'skip-1' });
  });

  it('draws a card on my turn', async () => {
    const onMove = vi.fn();
    render(<ExplodingKittens {...base} seats={seats} state={state()} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: 'کارت بکش' }));
    expect(onMove).toHaveBeenCalledWith({ draw: true });
  });

  it('lets a defused player choose where the kitten goes back', async () => {
    const onMove = vi.fn();
    render(
      <ExplodingKittens
        {...base}
        seats={seats}
        state={state({ phase: 'place', hands: [[{ type: 'skip', id: 'skip-1' }], [null, null], [null]] })}
        onMove={onMove}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'بالای دسته' }));
    expect(onMove).toHaveBeenCalledWith({ position: 'top' });
  });

  it('names the last survivor as the winner', () => {
    render(
      <ExplodingKittens
        {...base}
        seats={seats}
        phase="over"
        state={state({ phase: 'over', winner: 1, alive: [false, true, false] })}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByText('رضا برنده شد')).toBeTruthy();
  });
});
