export {
  GAME_IDS,
  GAMES,
  isGameId,
  manifest,
  type GameId,
  type GameManifest,
  type GameMode,
} from './manifest';
export { hasMessageFa, messageFa } from './i18n/fa';
export { isPlayable, loadGame, type GameModule, type GameState, type MovePayload } from './adapter';
