import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameSeatView } from '@cafeflow/shared';
import { TruthDare } from '../TruthDare';
import { Undercover } from '../Undercover';
import { QuizRace } from '../QuizRace';
import { DrawGuess } from '../DrawGuess';

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

describe('TruthDare', () => {
  it('draws a truth card', async () => {
    const onMove = vi.fn();
    render(<TruthDare {...base} state={{ currentCard: null, history: [], drawCount: 0 }} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: 'حقیقت' }));
    expect(onMove).toHaveBeenCalledWith({ action: 'draw', kind: 'truth' });
  });
});

describe('Undercover', () => {
  function state(overrides: Record<string, unknown> = {}) {
    return {
      phase: 'speech',
      winner: null,
      alive: [true, true, true, true],
      revealed: [false, false, false, false],
      roles: [null, null, null, null],
      myWord: 'قهوه',
      isBlank: false,
      speakers: [0],
      speakerPos: 0,
      round: 1,
      voteCandidates: [],
      votedSeats: [],
      votes: {},
      speeches: [],
      lastExiled: null,
      ...overrides,
    };
  }

  it('speaks when it is my turn', async () => {
    const onMove = vi.fn();
    render(<Undercover {...base} state={state()} onMove={onMove} />);

    expect(screen.getByText('قهوه')).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/نوبت شماست/), 'چیزی گرم و تلخ');
    await userEvent.click(screen.getByRole('button', { name: 'بگو' }));
    expect(onMove).toHaveBeenCalledWith({ type: 'speak', text: 'چیزی گرم و تلخ' });
  });

  it('votes for a candidate', async () => {
    const onMove = vi.fn();
    render(
      <Undercover
        {...base}
        state={state({ phase: 'vote', voteCandidates: [1, 2, 3] })}
        onMove={onMove}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'رضا' }));
    await userEvent.click(screen.getByRole('button', { name: 'ثبت رأی' }));
    expect(onMove).toHaveBeenCalledWith({ type: 'vote', target: 1 });
  });
});

describe('QuizRace', () => {
  function state(overrides: Record<string, unknown> = {}) {
    return {
      phase: 'question',
      question: { en: { q: 'قهوهٔ اسپرسو از کدام کشور است؟', opts: ['ایتالیا', 'فرانسه', 'ترکیه', 'برزیل'] } },
      choices: [null, null, null, null],
      answered: [false, false, false, false],
      answer: null,
      scores: [0, 0, 0, 0],
      ranking: [],
      winner: null,
      currentQuestion: 1,
      totalQuestions: 12,
      ...overrides,
    };
  }

  it('answers with one of the four options', async () => {
    const onMove = vi.fn();
    render(<QuizRace {...base} state={state()} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: /ایتالیا/ }));
    expect(onMove).toHaveBeenCalledWith({ answer: 0 });
  });
});

describe('DrawGuess', () => {
  it('lets the drawer choose a Persian word', async () => {
    const onMove = vi.fn();
    render(
      <DrawGuess
        {...base}
        state={{
          phase: 'choosing',
          drawerIndex: 0,
          word: null,
          wordOptions: ['قهوه', 'کیک', 'گربه'],
          strokes: [],
          scores: [0, 0, 0, 0],
          correct: {},
          winner: null,
        }}
        onMove={onMove}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'کیک' }));
    expect(onMove).toHaveBeenCalledWith({ type: 'choose_word', index: 1 });
  });
});
