import type { ComponentType } from 'react';
import type { GameRendererProps } from '../shared/GamePieces';
import { TicTacToe } from './TicTacToe';
import { ConnectFour } from './ConnectFour';
import { Reversi } from './Reversi';
import { Uno } from './Uno';
import { Realtime2048 } from './Realtime2048';
import { Werewolf } from './Werewolf';
import { Gomoku } from './Gomoku';
import { Chess } from './Chess';
import { Checkers } from './Checkers';
import { Sudoku } from './Sudoku';
import { Minesweeper } from './Minesweeper';
import { NumberBomb } from './NumberBomb';
import { Davinci } from './Davinci';
import { Hearts } from './Hearts';
import { OldMaid } from './OldMaid';
import { BigTwo } from './BigTwo';
import { DouDizhu } from './DouDizhu';
import { Paodekuai } from './Paodekuai';
import { ExplodingKittens } from './ExplodingKittens';
import { Go9 } from './Go9';
import { ChineseChess } from './ChineseChess';
import { Battleship } from './Battleship';
import { LiarsBar } from './LiarsBar';
import { TwentyFour } from './TwentyFour';
import { FlightChess } from './FlightChess';
import { Texas } from './Texas';
import { SnakeBattle } from './SnakeBattle';
import { Rummikub } from './Rummikub';
import { Mahjong } from './Mahjong';
import { TruthDare } from './TruthDare';
import { Undercover } from './Undercover';
import { QuizRace } from './QuizRace';
import { DrawGuess } from './DrawGuess';
import { Monopoly } from './Monopoly';
import { SheepTile } from './SheepTile';
import { Sanguo } from './Sanguo';
import { SuikaBattle } from './SuikaBattle';

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
  gomoku: Gomoku,
  chess: Chess,
  checkers: Checkers,
  sudoku: Sudoku,
  minesweeper: Minesweeper,
  numberbomb: NumberBomb,
  davinci: Davinci,
  hearts: Hearts,
  oldmaid: OldMaid,
  bigtwo: BigTwo,
  doudizhu: DouDizhu,
  paodekuai: Paodekuai,
  'exploding-kittens': ExplodingKittens,
  go9: Go9,
  chinesechess: ChineseChess,
  battleship: Battleship,
  liarsbar: LiarsBar,
  twentyfour: TwentyFour,
  flightchess: FlightChess,
  texas: Texas,
  snakebattle: SnakeBattle,
  rummikub: Rummikub,
  'mahjong-sichuan': Mahjong,
  'mahjong-cantonese': Mahjong,
  truthdare: TruthDare,
  undercover: Undercover,
  quizrace: QuizRace,
  drawguess: DrawGuess,
  monopoly: Monopoly,
  sheeptile: SheepTile,
  sanguo: Sanguo,
  suikabattle: SuikaBattle,
};
