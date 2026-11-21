import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameSeatView } from '@cafeflow/shared';
import { Go9 } from '../Go9';
import { Battleship } from '../Battleship';
import { ChineseChess } from '../ChineseChess';
import { LiarsBar } from '../LiarsBar';

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

describe('Go9', () => {
  function state(overrides: Record<string, unknown> = {}) {
    return {
      board: Array.from({ length: 9 }, () => Array(9).fill(0)),
      currentPlayer: 0,
      winner: null,
      captures: [0, 0],
      koPoint: null,
      consecutivePasses: 0,
      phase: 'playing',
      deadMarks: [],
      accepted: [false, false],
      moveHistory: [],
      ...overrides,
    };
  }

  it('places a stone on the board and can pass', async () => {
    const onMove = vi.fn();
    render(<Go9 {...base} state={state()} onMove={onMove} />);

    const board = screen.getByRole('grid', { name: 'صفحهٔ گو' });
    await userEvent.click(within(board).getAllByRole('gridcell')[40]);
    expect(onMove).toHaveBeenCalledWith({ row: 4, col: 4 });

    await userEvent.click(screen.getByRole('button', { name: 'رد کردن نوبت' }));
    expect(onMove).toHaveBeenCalledWith({ pass: true });
  });

  it('marks dead stones and accepts the score', async () => {
    const onMove = vi.fn();
    const board = Array.from({ length: 9 }, () => Array(9).fill(0));
    board[2][2] = 1;
    render(
      <Go9
        {...base}
        state={state({ phase: 'scoring', board, consecutivePasses: 2, deadMarks: [] })}
        onMove={onMove}
      />,
    );

    const grid = screen.getByRole('grid', { name: 'صفحهٔ گو' });
    await userEvent.click(within(grid).getAllByRole('gridcell')[20]);
    expect(onMove).toHaveBeenCalledWith({ type: 'mark', row: 2, col: 2 });

    await userEvent.click(screen.getByRole('button', { name: 'تأیید نتیجه' }));
    expect(onMove).toHaveBeenCalledWith({ type: 'accept' });
  });
});

describe('Battleship', () => {
  const emptyBoard = () => Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({})));
  const shipSizes = [5, 4, 3, 3, 2];

  function state(overrides: Record<string, unknown> = {}) {
    return {
      phase: 'placing',
      currentPlayer: 0,
      winner: null,
      myBoard: emptyBoard(),
      enemyBoard: emptyBoard(),
      shipSizes,
      placedCount: [0, 0],
      myShips: [],
      lastShotResult: null,
      ...overrides,
    };
  }

  it('places the next ship with the chosen orientation', async () => {
    const onMove = vi.fn();
    render(<Battleship {...base} state={state()} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: 'عمودی' }));
    const mine = screen.getByRole('grid', { name: 'ناوگان من' });
    await userEvent.click(within(mine).getAllByRole('gridcell')[0]);
    expect(onMove).toHaveBeenCalledWith({ r: 0, c: 0, orientation: 'v', size: 5 });
  });

  it('fires at a fresh enemy cell only on my turn', async () => {
    const onMove = vi.fn();
    const { rerender } = render(
      <Battleship {...base} state={state({ phase: 'shooting', placedCount: [5, 5] })} onMove={onMove} />,
    );

    const enemy = screen.getByRole('grid', { name: 'ناوگان حریف' });
    await userEvent.click(within(enemy).getAllByRole('gridcell')[11]);
    expect(onMove).toHaveBeenCalledWith({ r: 1, c: 1 });

    rerender(
      <Battleship
        {...base}
        state={state({ phase: 'shooting', placedCount: [5, 5], currentPlayer: 1 })}
        onMove={onMove}
      />,
    );
    const enemyAfter = screen.getByRole('grid', { name: 'ناوگان حریف' });
    expect((within(enemyAfter).getAllByRole('gridcell')[12] as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ChineseChess', () => {
  function state(overrides: Record<string, unknown> = {}) {
    const board = Array.from({ length: 10 }, () => Array(9).fill(null));
    board[6][0] = { type: 'P', side: 0 };
    board[9][4] = { type: 'K', side: 0 };
    board[0][4] = { type: 'K', side: 1 };
    return {
      board,
      currentPlayer: 0,
      winner: null,
      legalMoves: [{ fromRow: 6, fromCol: 0, toRow: 5, toCol: 0 }],
      moveHistory: [],
      ...overrides,
    };
  }

  it('selects a piece and moves it to a highlighted destination', async () => {
    const onMove = vi.fn();
    render(<ChineseChess {...base} state={state()} onMove={onMove} />);

    const grid = screen.getByRole('grid', { name: 'صفحهٔ شطرنج چینی' });
    const cells = within(grid).getAllByRole('gridcell');
    await userEvent.click(cells[6 * 9 + 0]);
    await userEvent.click(cells[5 * 9 + 0]);

    expect(onMove).toHaveBeenCalledWith({
      from: { row: 6, col: 0 },
      to: { row: 5, col: 0 },
    });
  });
});

describe('LiarsBar', () => {
  const cards = [
    { rank: 'J', suit: 's', id: 'js' },
    { rank: 'K', suit: 'h', id: 'kh' },
    { rank: 'Q', suit: 'd', id: 'qd' },
  ];

  function state(overrides: Record<string, unknown> = {}) {
    return {
      phase: 'playing',
      currentPlayer: 0,
      winner: null,
      hands: [[...cards], [null, null, null]],
      themeRank: 'K',
      alive: [true, true],
      pileCards: [],
      pileClaims: [],
      lastClaimant: -1,
      revealedPile: null,
      shootQueue: [],
      currentShooter: -1,
      lastShotResults: [],
      firedShots: [0, 0],
      ...overrides,
    };
  }

  it('plays the selected cards as the round rank', async () => {
    const onMove = vi.fn();
    render(<LiarsBar {...base} state={state()} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: 'شاه دل' }));
    await userEvent.click(screen.getByRole('button', { name: 'بازی به‌عنوان شاه' }));
    expect(onMove).toHaveBeenCalledWith({ action: 'play', cardIds: ['kh'] });
  });

  it('challenges a claim and fires when the queue reaches me', async () => {
    const onMove = vi.fn();
    const { rerender } = render(
      <LiarsBar
        {...base}
        mySeat={1}
        state={state({
          hands: [[...cards], [...cards]],
          lastClaimant: 0,
          pileCards: [null],
          currentPlayer: 0,
        })}
        onMove={onMove}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'دروغ می‌گوید!' }));
    expect(onMove).toHaveBeenCalledWith({ action: 'suspect' });

    rerender(
      <LiarsBar
        {...base}
        mySeat={1}
        state={state({
          hands: [[...cards], [...cards]],
          phase: 'shooting',
          shootQueue: [1],
          currentShooter: 1,
          lastClaimant: 0,
          revealedPile: [{ rank: 'J', suit: 's', id: 'js' }],
        })}
        onMove={onMove}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'ماشه را بکش' }));
    expect(onMove).toHaveBeenCalledWith({ action: 'shoot' });
  });
});
