import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameSeatView } from '@cafeflow/shared';
import { Werewolf } from '../Werewolf';

const names = ['سارا', 'رضا', 'مینا', 'کاوه', 'نیلوفر', 'بهنام'];
const seats: GameSeatView[] = names.map((nameFa, index) => ({
  index,
  nameFa,
  ready: true,
  connected: true,
  isHost: index === 0,
  isYou: index === 0,
}));

function state(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'night_wolf',
    winner: null,
    n: 6,
    // The server sends your role in `myRole`; other seats arrive as null.
    myRole: 'seer',
    roles: ['seer', null, null, null, null, null],
    alive: Array(6).fill(true),
    deathCause: Array(6).fill(null),
    day: 0,
    night: 1,
    seerDone: false,
    log: [],
    chat: [],
    deadline: Date.now() + 30_000,
    ...overrides,
  };
}

const props = {
  seats,
  mySeat: 0,
  phase: 'playing' as const,
  deadline: 0,
  canRestart: false,
  onMove: vi.fn(),
  onRestart: vi.fn(),
};

describe('Werewolf', () => {
  it('shows my own role and never the roles of other seats', () => {
    render(<Werewolf {...props} state={state()} />);

    expect(screen.getByText('پیشگو')).toBeTruthy();
    expect(screen.queryByText('گرگ')).toBeNull();
  });

  it('lets the seer check one other player', async () => {
    const onMove = vi.fn();
    render(<Werewolf {...props} state={state()} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: 'مینا' }));
    expect(onMove).toHaveBeenCalledWith({ type: 'check', target: 2 });
  });

  it('tells a dead seat it is watching, not playing', () => {
    const alive = Array(6).fill(true);
    alive[0] = false;
    render(<Werewolf {...props} state={state({ alive, deathCause: ['knife', null, null, null, null, null] })} />);

    expect(screen.getByText('شما از بازی خارج شده‌اید؛ می‌توانید تماشا کنید.')).toBeTruthy();
  });

  it('shows the result with every role revealed at the end', () => {
    render(
      <Werewolf
        {...props}
        phase="over"
        state={state({ phase: 'over', winner: -3, roles: ['seer', 'wolf', 'villager', 'wolf', 'villager', 'hunter'] })}
      />,
    );

    expect(screen.getByText('روستا برد')).toBeTruthy();
    expect(screen.getAllByText(/گرگ/).length).toBeGreaterThan(0);
  });
});
