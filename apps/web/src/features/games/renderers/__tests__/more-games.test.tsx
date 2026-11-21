import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameSeatView } from '@cafeflow/shared';
import { TwentyFour } from '../TwentyFour';
import { FlightChess } from '../FlightChess';
import { Texas } from '../Texas';
import { SnakeBattle } from '../SnakeBattle';

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

describe('TwentyFour', () => {
  function state(overrides: Record<string, unknown> = {}) {
    return {
      numbers: [6, 6, 6, 6],
      phase: 'playing',
      winner: null,
      roundWinner: null,
      roundsWon: [0, 0],
      currentRound: 2,
      maxRounds: 5,
      solutions: [],
      playerSubmissions: {},
      ...overrides,
    };
  }

  it('submits an expression in Latin digits', async () => {
    const onMove = vi.fn();
    render(<TwentyFour {...base} state={state()} onMove={onMove} />);

    await userEvent.type(screen.getByLabelText(/عبارت شما/), '6+6+6+6');
    await userEvent.click(screen.getByRole('button', { name: 'ثبت پاسخ' }));
    expect(onMove).toHaveBeenCalledWith({ expression: '6+6+6+6' });
  });

  it('offers the next round and shows who won', async () => {
    const onMove = vi.fn();
    render(
      <TwentyFour
        {...base}
        state={state({ phase: 'round_end', roundWinner: 0, solutions: [{ player: 0, expression: '6+6+6+6' }] })}
        onMove={onMove}
      />,
    );

    expect(screen.getByText(/این دور را برد/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'دور بعد' }));
    expect(onMove).toHaveBeenCalledWith({ action: 'next_round' });
  });
});

describe('FlightChess', () => {
  function state(overrides: Record<string, unknown> = {}) {
    return {
      currentPlayer: 0,
      winner: null,
      dice: 6,
      hasRolled: true,
      consecutiveSixes: 1,
      players: [
        { planes: [-1, -1, -1, -1], finished: 0 },
        { planes: [3, -1, -1, -1], finished: 0 },
      ],
      ...overrides,
    };
  }

  it('rolls and then moves a plane', async () => {
    const onMove = vi.fn();
    const { rerender } = render(<FlightChess {...base} state={state({ hasRolled: false, dice: 1 })} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: /تاس بریز/ }));
    expect(onMove).toHaveBeenCalledWith({ action: 'roll' });

    rerender(<FlightChess {...base} state={state()} onMove={onMove} />);
    await userEvent.click(screen.getByRole('button', { name: /هواپیمای ۱/ }));
    expect(onMove).toHaveBeenCalledWith({ action: 'move', planeIndex: 0 });
  });

  it('keeps planes in the hangar without a six', () => {
    render(<FlightChess {...base} state={state({ dice: 3 })} onMove={vi.fn()} />);
    expect((screen.getByRole('button', { name: /هواپیمای ۲/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('SnakeBattle', () => {
  function state(overrides: Record<string, unknown> = {}) {
    return {
      width: 28,
      height: 20,
      tick: 12,
      food: { x: 10, y: 10 },
      winner: null,
      snakes: [
        { player: 0, body: [{ x: 1, y: 1 }, { x: 0, y: 1 }], alive: true, score: 1 },
        { player: 1, body: [{ x: 20, y: 10 }, { x: 21, y: 10 }], alive: false, score: 0 },
      ],
      ...overrides,
    };
  }

  it('turns with the arrow buttons', async () => {
    const onMove = vi.fn();
    render(<SnakeBattle {...base} state={state()} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: 'بالا' }));
    expect(onMove).toHaveBeenCalledWith({ direction: 'up' });
    expect(screen.getByRole('img', { name: 'زمین بازی نبرد مارها' })).toBeTruthy();
  });

  it('locks the controls after the snake is out', () => {
    render(
      <SnakeBattle
        {...base}
        state={state({ snakes: [{ player: 0, body: [{ x: 1, y: 1 }], alive: false, score: 0 }, ...state().snakes.slice(1)] })}
        onMove={vi.fn()}
      />,
    );
    expect((screen.getByRole('button', { name: 'بالا' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Texas', () => {
  function state(overrides: Record<string, unknown> = {}) {
    return {
      phase: 'preflop',
      currentPlayer: 0,
      winner: null,
      communityCards: [],
      holeCards: [
        { rank: 'A', suit: 's', id: 'As' },
        { rank: 'K', suit: 'h', id: 'Kh' },
      ],
      chips: [1000, 1000],
      bets: [0, 0],
      folded: [false, false],
      allIn: [false, false],
      opponentHoleCounts: [0, 2],
      dealer: 0,
      pot: 30,
      currentBet: 0,
      lastRaise: 20,
      smallBlind: 10,
      bigBlind: 20,
      showdownHands: [],
      handNumber: 1,
      ...overrides,
    };
  }

  it('checks when there is nothing to call', async () => {
    const onMove = vi.fn();
    render(<Texas {...base} state={state()} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: 'چک' }));
    expect(onMove).toHaveBeenCalledWith({ action: 'check' });
  });

  it('calls the outstanding bet and folds', async () => {
    const onMove = vi.fn();
    const { rerender } = render(<Texas {...base} state={state({ currentBet: 60 })} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: /کال/ }));
    expect(onMove).toHaveBeenCalledWith({ action: 'call' });

    rerender(<Texas {...base} state={state({ currentBet: 60 })} onMove={onMove} />);
    await userEvent.click(screen.getByRole('button', { name: 'فولد' }));
    expect(onMove).toHaveBeenCalledWith({ action: 'fold' });
  });
});
