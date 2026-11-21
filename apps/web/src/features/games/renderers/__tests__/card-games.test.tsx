import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameSeatView } from '@cafeflow/shared';
import { Davinci } from '../Davinci';
import { Hearts } from '../Hearts';
import { OldMaid } from '../OldMaid';
import { BigTwo } from '../BigTwo';
import { DouDizhu } from '../DouDizhu';

const seats: GameSeatView[] = [
  { index: 0, nameFa: 'سارا', ready: true, connected: true, isHost: true, isYou: true },
  { index: 1, nameFa: 'رضا', ready: true, connected: true, isHost: false, isYou: false },
  { index: 2, nameFa: 'مینا', ready: true, connected: true, isHost: false, isYou: false },
  { index: 3, nameFa: 'کاوه', ready: true, connected: true, isHost: false, isYou: false },
];

const base = {
  seats,
  mySeat: 0,
  phase: 'playing' as const,
  deadline: 0,
  canRestart: false,
  onRestart: vi.fn(),
};

describe('Davinci', () => {
  function state(overrides: Record<string, unknown> = {}) {
    return {
      phase: 'draw',
      currentPlayer: 0,
      penaltyPlayer: null,
      winner: null,
      tiles: [
        [{ color: 'black', num: 3, id: 'b3' }],
        [{ color: 'white', num: null, numRevealed: false }],
      ],
      numRevealed: [[true], [false]],
      eliminated: [false, false],
      guessCount: [0, 0],
      drawnTile: { color: 'black', num: 4, id: 'b4' },
      pool: [],
      playerCount: 2,
      guessedThisTurn: false,
      lastGuessResult: null,
      ...overrides,
    };
  }

  it('draws a tile when it is my turn', async () => {
    const onMove = vi.fn();
    render(<Davinci {...base} state={state()} onMove={onMove} />);

    expect(screen.getByText('نوبت شماست')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'کارت کشیدن' }));
    expect(onMove).toHaveBeenCalledWith({});
  });

  it('guesses a number on an opponent tile', async () => {
    const onMove = vi.fn();
    render(<Davinci {...base} state={state({ phase: 'guess' })} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: 'حدس مهرهٔ ۱ رضا' }));
    await userEvent.click(screen.getByRole('button', { name: '۷' }));

    expect(onMove).toHaveBeenCalledWith({
      targetPlayer: 1,
      tileIndex: 0,
      guessNum: 7,
      continueGuess: true,
    });
  });

  it('chooses a seat for a drawn joker', async () => {
    const onMove = vi.fn();
    render(<Davinci {...base} state={state({ phase: 'place' })} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: 'جایگاه ۲' }));
    expect(onMove).toHaveBeenCalledWith({ placeIndex: 1 });
  });

  it('reveals one of my tiles in the penalty phase', async () => {
    const onMove = vi.fn();
    render(
      <Davinci
        {...base}
        state={state({ phase: 'penalty', penaltyPlayer: 0, drawnTile: null, numRevealed: [[false], [false]] })}
        onMove={onMove}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'رو کردن مهرهٔ ۱' }));
    expect(onMove).toHaveBeenCalledWith({ revealIndex: 0 });
  });
});

describe('Hearts', () => {
  const myHand = [
    { rank: '2', suit: 'c', id: '2c' },
    { rank: '5', suit: 'h', id: '5h' },
    { rank: 'K', suit: 's', id: 'Ks' },
  ];

  function state(overrides: Record<string, unknown> = {}) {
    return {
      phase: 'passing',
      currentPlayer: 0,
      winner: null,
      myHand,
      handSizes: [3, 13, 13, 13],
      currentTrick: [],
      lastTrick: null,
      scores: [0, 0, 0, 0],
      roundScores: [0, 0, 0, 0],
      myPassCards: null,
      passDirection: 'left',
      passRound: 0,
      round: 1,
      targetScore: 100,
      heartsBroken: false,
      trickCount: 0,
      ...overrides,
    };
  }

  it('sends exactly three selected cards in the passing phase', async () => {
    const onMove = vi.fn();
    render(<Hearts {...base} state={state()} onMove={onMove} />);

    const submit = screen.getByRole('button', { name: 'رد کردن این سه کارت' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'کارت ۲ گشنیز' }));
    await userEvent.click(screen.getByRole('button', { name: 'کارت ۵ دل' }));
    await userEvent.click(screen.getByRole('button', { name: 'کارت K پیک' }));
    await userEvent.click(submit);

    expect(onMove).toHaveBeenCalledWith({ cards: ['2c', '5h', 'Ks'] });
  });

  it('plays a card on my turn and blocks it otherwise', async () => {
    const onMove = vi.fn();
    const { rerender } = render(
      <Hearts {...base} state={state({ phase: 'playing', heartsBroken: true })} onMove={onMove} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'کارت ۵ دل' }));
    expect(onMove).toHaveBeenCalledWith({ card: '5h' });

    rerender(
      <Hearts
        {...base}
        state={state({ phase: 'playing', currentPlayer: 1, heartsBroken: true })}
        onMove={onMove}
      />,
    );
    expect((screen.getByRole('button', { name: 'کارت ۵ دل' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('OldMaid', () => {
  function state(overrides: Record<string, unknown> = {}) {
    return {
      currentPlayer: 0,
      winner: null,
      loser: null,
      hands: [
        [
          { rank: 'A', suit: 's', id: 'As' },
          { rank: '👻', suit: '', id: 'J1' },
        ],
        [null, null, null],
      ],
      handSizes: [2, 3],
      lastDraw: null,
      lastDiscards: null,
      ...overrides,
    };
  }

  it('draws the chosen face-down card from the next seat', async () => {
    const onMove = vi.fn();
    render(<OldMaid {...base} state={state()} onMove={onMove} />);

    expect(screen.getByText('دست شما (۲ کارت)')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'کارت ۲ رضا' }));
    expect(onMove).toHaveBeenCalledWith({ cardIndex: 1 });
  });

  it('names the guest left with the ghost', () => {
    render(<OldMaid {...base} phase="over" state={state({ winner: -1, loser: 1 })} onMove={vi.fn()} />);

    expect(screen.getByText('رضا با کارت تنها ماند')).toBeTruthy();
  });
});

describe('BigTwo', () => {
  const myHand = [
    { rank: '3', suit: 'd', id: '3d' },
    { rank: '3', suit: 's', id: '3s' },
    { rank: '7', suit: 'c', id: '7c' },
  ];

  function state(overrides: Record<string, unknown> = {}) {
    return {
      hands: [myHand, [null, null], [null, null]],
      currentPlayer: 0,
      lastPlay: null,
      lastPlayPlayer: -1,
      passed: [false, false, false],
      winner: null,
      scores: [0, 0, 0],
      cumulativeScore: [0, 0, 0],
      roundResult: null,
      _opened: true,
      oneCardRule: true,
      ...overrides,
    };
  }

  it('plays the selected cards and cannot pass while leading', async () => {
    const onMove = vi.fn();
    render(<BigTwo {...base} state={state()} onMove={onMove} />);

    expect((screen.getByRole('button', { name: 'پاس' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'کارت ۳ خشت' }));
    await userEvent.click(screen.getByRole('button', { name: 'کارت ۳ پیک' }));
    await userEvent.click(screen.getByRole('button', { name: 'بازی کارت‌های انتخاب‌شده' }));

    expect(onMove).toHaveBeenCalledWith({ cards: ['3d', '3s'] });
  });

  it('lets a seat pass once someone has played', async () => {
    const onMove = vi.fn();
    render(
      <BigTwo
        {...base}
        state={state({
          lastPlay: { player: 1, cards: [{ rank: '5', suit: 'd', id: '5d' }], play: { type: 'single' } },
          lastPlayPlayer: 1,
        })}
        onMove={onMove}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'پاس' }));
    expect(onMove).toHaveBeenCalledWith({ pass: true });
  });
});

describe('DouDizhu', () => {
  const myHand = [
    { rank: '3', suit: 'c', id: '3c' },
    { rank: '10', suit: 'h', id: '10h' },
  ];

  function bidding(overrides: Record<string, unknown> = {}) {
    return {
      phase: 'bidding',
      callPhase: 'call',
      currentBidder: 0,
      currentPlayer: 0,
      landlord: null,
      winner: null,
      hands: [myHand, [null], [null]],
      bottomCards: [null, null, null],
      lastPlay: null,
      passed: [false, false, false],
      cumulativeScore: [0, 0, 0],
      gameMultiplier: 1,
      currentBid: 0,
      eligibleForRob: [true, true, true],
      ...overrides,
    };
  }

  it('calls for the landlord and later fights for the role', async () => {
    const onMove = vi.fn();
    const { rerender } = render(<DouDizhu {...base} seats={seats.slice(0, 3)} state={bidding()} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: 'زمیندار می‌شوم' }));
    expect(onMove).toHaveBeenCalledWith({ call: true });

    rerender(
      <DouDizhu
        {...base}
        seats={seats.slice(0, 3)}
        state={bidding({ callPhase: 'rob' })}
        onMove={onMove}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'می‌زنم' }));
    expect(onMove).toHaveBeenCalledWith({ rob: true });
  });

  it('plays a combination on my turn and blocks passing while leading', async () => {
    const onMove = vi.fn();
    render(
      <DouDizhu
        {...base}
        seats={seats.slice(0, 3)}
        state={bidding({ phase: 'playing', landlord: 0, callPhase: 'decided' })}
        onMove={onMove}
      />,
    );

    expect((screen.getByRole('button', { name: 'پاس' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'کارت ۳ گشنیز' }));
    await userEvent.click(screen.getByRole('button', { name: 'بازی کارت‌های انتخاب‌شده' }));

    expect(onMove).toHaveBeenCalledWith({ cards: ['3c'] });
  });

  it('tells the table who won the round', () => {
    render(
      <DouDizhu
        {...base}
        seats={seats.slice(0, 3)}
        phase="over"
        state={bidding({ phase: 'over', landlord: 0, callPhase: 'decided', winner: -2 })}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByText('زمیندار برد')).toBeTruthy();
  });
});
