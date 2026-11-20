import type { ComponentType } from 'react';
import type { GameRendererProps } from '../shared/GamePieces';
import { TicTacToe } from './TicTacToe';
import { ConnectFour } from './ConnectFour';
import { Reversi } from './Reversi';
import { Uno } from './Uno';
import { Realtime2048 } from './Realtime2048';
import { Werewolf } from './Werewolf';

/**
 * Game id → screen. Everything a renderer needs arrives in `GameRendererProps`;
 * adding the next GameNest rule module is one entry here plus one component.
 */
export const RENDERERS: Record<string, ComponentType<GameRendererProps>> = {
  tictactoe: TicTacToe,
  connect4: ConnectFour,
  reversi: Reversi,
  uno: Uno,
  '2048': Realtime2048,
  werewolf: Werewolf,
};
