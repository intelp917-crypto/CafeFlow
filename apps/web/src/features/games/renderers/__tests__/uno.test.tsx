import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameSeatView } from '@cafeflow/shared';
import { Uno } from '../Uno';

const seats: GameSeatView[] = [
  { index: 0, nameFa: 'سارا', ready: true, connected: true, isHost: true, isYou: true },
  { index: 1, nameFa: 'رضا', ready: true, connected: true, isHost: false, isYou: false },
];

const myCards = [
  { id: 'red-1', color: 'red', value: '1' },
  { id: 'wild-0', color: 'wild', value: 'wild' },
];

function state(overrides: Record<string, unknown> = {}) {
  return {
    // The server masks other hands with nulls of the same length, never real cards.
    hands: [myCards, [null, null, null]],
    discard: [{ id: 'red-5', color: 'red', value: '5' }],
    currentColor: 'red',
    currentPlayer: 0,
    direction: 1,
    winner: null,
    drawStack: 0,
    unoCalled: [true, true],
    pendingChallenge: null,
    deck: [null, null],
    ...overrides,
  };
}

const props = {
  seats,
  mySeat: 0,
  phase: 'playing' as const,
  deadline: 0,
  canRestart: false,
  onRestart: vi.fn(),
};

describe('Uno', () => {
  it('shows only my cards, in Persian digits', async () => {
    const onMove = vi.fn();
    render(<Uno {...props} state={state()} onMove={onMove} />);

    expect(screen.getByText('دست شما (۲ کارت)')).toBeTruthy();
    expect(screen.getByText('رضا: ۳')).toBeTruthy();

    await userEvent.click(screen.getByLabelText('کارت ۱ قرمز'));
    expect(onMove).toHaveBeenCalledWith({ cardId: 'red-1' });
  });

  it('asks for a colour before playing a wild card', async () => {
    const onMove = vi.fn();
    render(<Uno {...props} state={state()} onMove={onMove} />);

    await userEvent.click(screen.getByLabelText('کارت رنگ'));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByText('رنگ بعدی را انتخاب کنید:')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'سبز' }));
    expect(onMove).toHaveBeenCalledWith({ cardId: 'wild-0', chosenColor: 'green' });
  });

  it('blocks the hand when another seat is on turn', () => {
    render(<Uno {...props} state={state({ currentPlayer: 1 })} onMove={vi.fn()} />);

    const card = screen.getByLabelText('کارت ۱ قرمز') as HTMLButtonElement;
    expect(card.disabled).toBe(true);
    expect(screen.getByText('نوبت رضا')).toBeTruthy();
  });

  it('offers the challenge window to the +4 target only', () => {
    const pending = { by: 1, target: 0, priorColor: 'red', chosenColor: 'blue' };
    render(<Uno {...props} state={state({ pendingChallenge: pending })} onMove={vi.fn()} />);

    expect(screen.getByText('می‌کشم')).toBeTruthy();
    expect(screen.getByText('اعتراض')).toBeTruthy();
  });
});
