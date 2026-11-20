import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameSeatView } from '@cafeflow/shared';
import { ConnectFour } from '../ConnectFour';
import { Reversi } from '../Reversi';

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

describe('ConnectFour', () => {
  it('drops into the column the guest taps', async () => {
    const onMove = vi.fn();
    render(
      <ConnectFour
        {...base}
        state={{
          board: Array.from({ length: 6 }, () => Array(7).fill(null)),
          currentPlayer: 0,
          winner: null,
          legalMoves: [0, 1, 2, 3, 4, 5, 6],
          lastMove: null,
        }}
        onMove={onMove}
      />,
    );

    await userEvent.click(screen.getByLabelText('ستون ۲'));
    expect(onMove).toHaveBeenCalledWith({ col: 1 });
  });

  it('keeps a full column untappable and shows the result', () => {
    const board = Array.from({ length: 6 }, () => Array(7).fill(null));
    board[0]![0] = 1;
    render(
      <ConnectFour
        {...base}
        phase="over"
        state={{ board, currentPlayer: 1, winner: 1, legalMoves: [], lastMove: { row: 0, col: 0 } }}
        onMove={vi.fn()}
      />,
    );

    expect((screen.getByLabelText('ستون ۱') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('رضا برنده شد')).toBeTruthy();
  });
});

describe('Reversi', () => {
  const emptyBoard = () => Array.from({ length: 8 }, () => Array(8).fill(null));

  it('only enables the cells the rules call legal', async () => {
    const onMove = vi.fn();
    render(
      <Reversi
        {...base}
        state={{
          board: emptyBoard(),
          boardSize: 8,
          currentPlayer: 0,
          winner: null,
          scores: { 0: 2, 1: 2 },
          legalMoves: [{ row: 2, col: 3 }],
          lastMove: null,
        }}
        onMove={onMove}
      />,
    );

    expect((screen.getByLabelText('ردیف ۳، ستون ۴') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText('ردیف ۱، ستون ۱') as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByLabelText('ردیف ۳، ستون ۴'));
    expect(onMove).toHaveBeenCalledWith({ row: 2, col: 3 });
  });

  it('offers a pass when the seat has no legal move', async () => {
    const onMove = vi.fn();
    render(
      <Reversi
        {...base}
        state={{
          board: emptyBoard(),
          boardSize: 8,
          currentPlayer: 0,
          winner: null,
          scores: { 0: 3, 1: 1 },
          legalMoves: [],
          lastMove: null,
        }}
        onMove={onMove}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'رد کردن نوبت' }));
    expect(onMove).toHaveBeenCalledWith({ pass: true });
  });
});
