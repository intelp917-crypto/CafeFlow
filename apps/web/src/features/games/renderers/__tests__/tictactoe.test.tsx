import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameSeatView } from '@cafeflow/shared';
import { TicTacToe } from '../TicTacToe';

const seats: GameSeatView[] = [
  { index: 0, nameFa: 'سارا', ready: true, connected: true, isHost: true, isYou: true },
  { index: 1, nameFa: 'رضا', ready: true, connected: true, isHost: false, isYou: false },
];

function state(overrides: Record<string, unknown> = {}) {
  return { board: Array(9).fill(null), currentPlayer: 0, winner: null, ...overrides };
}

describe('TicTacToe', () => {
  it('sends the tapped cell to the table', async () => {
    const onMove = vi.fn();
    render(<TicTacToe state={state()} seats={seats} mySeat={0} phase="playing" deadline={0} canRestart={false} onMove={onMove} onRestart={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('خانهٔ ۵'));
    expect(onMove).toHaveBeenCalledWith({ cell: 4 });
  });

  it('does not resend an occupied cell', async () => {
    const onMove = vi.fn();
    const board = [0, null, null, null, null, null, null, null, null];
    render(<TicTacToe state={state({ board })} seats={seats} mySeat={0} phase="playing" deadline={0} canRestart={false} onMove={onMove} onRestart={vi.fn()} />);

    const taken = screen.getByLabelText('خانهٔ ۱، ضربدر');
    expect((taken as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(taken);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('shows the winner in Persian when the hand is over', () => {
    render(
      <TicTacToe
        state={state({ winner: 1 })}
        seats={seats}
        mySeat={0}
        phase="over"
        deadline={0}
        canRestart
        onMove={vi.fn()}
        onRestart={vi.fn()}
      />,
    );

    expect(screen.getByText('رضا برنده شد')).toBeTruthy();
    expect(screen.getByText('دستِ تازه')).toBeTruthy();
  });

  it('only lets the seat on turn play', async () => {
    const onMove = vi.fn();
    render(<TicTacToe state={state({ currentPlayer: 1 })} seats={seats} mySeat={0} phase="playing" deadline={0} canRestart={false} onMove={onMove} onRestart={vi.fn()} />);

    expect(screen.getByText('نوبت رضا')).toBeTruthy();
    await userEvent.click(screen.getByLabelText('خانهٔ ۲'));
    expect(onMove).not.toHaveBeenCalled();
  });
});
