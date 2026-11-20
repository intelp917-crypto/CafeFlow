/**
 * The Persian game catalogue.
 *
 * This is the single source of truth the API serves and the SPA renders: names,
 * player counts, category and how a room drives the game. Game *rules* live in
 * `../upstream/games` and are untouched upstream code; everything a guest reads
 * is written here in Persian.
 */

export const GAME_IDS = ['tictactoe', 'connect4', 'reversi', 'uno', '2048', 'werewolf'] as const;

export type GameId = (typeof GAME_IDS)[number];

/**
 * How a room drives the game:
 * - `turn`     — one seat acts at a time (`state.currentPlayer`).
 * - `realtime` — every seat acts whenever it likes (a race).
 * - `phase`    — the module owns phases and deadlines (`getPhaseDeadline`).
 */
export type GameMode = 'turn' | 'realtime' | 'phase';

export interface GameManifest {
  id: GameId;
  nameFa: string;
  taglineFa: string;
  descriptionFa: string;
  howToFa: string;
  categoryFa: string;
  minPlayers: number;
  maxPlayers: number;
  mode: GameMode;
}

export const GAMES: readonly GameManifest[] = [
  {
    id: 'tictactoe',
    nameFa: 'دوز',
    taglineFa: 'سه تا در یک ردیف',
    descriptionFa: 'کوتاه‌ترین بازی میز؛ برای گرم‌کردن جمع قبل از سفارش بعدی.',
    howToFa: 'به نوبت یک خانه را انتخاب کنید. هر کس اول سه خانهٔ پشت‌سرهم بگیرد برنده است.',
    categoryFa: 'رومیزی',
    minPlayers: 2,
    maxPlayers: 2,
    mode: 'turn',
  },
  {
    id: 'connect4',
    nameFa: 'چهار در خط',
    taglineFa: 'مهره بینداز، چهارتا ردیف کن',
    descriptionFa: 'هفت ستون و شش ردیف؛ ساده یاد می‌گیرید، سخت می‌برید.',
    howToFa: 'روی یک ستون بزنید تا مهره پایین بیفتد. چهار مهرهٔ هم‌رنگ در هر جهت برنده است.',
    categoryFa: 'رومیزی',
    minPlayers: 2,
    maxPlayers: 2,
    mode: 'turn',
  },
  {
    id: 'reversi',
    nameFa: 'اتللو',
    taglineFa: 'مهره‌ها را برگردان',
    descriptionFa: 'یک حرکت می‌تواند کل صفحه را عوض کند؛ بازی محبوب میزهای دونفره.',
    howToFa: 'مهره‌ها را با محاصره‌کردن برگردانید. وقتی هیچ‌کس حرکتی ندارد، مهرهٔ بیشتر برنده است.',
    categoryFa: 'رومیزی',
    minPlayers: 2,
    maxPlayers: 2,
    mode: 'turn',
  },
  {
    id: 'uno',
    nameFa: 'اونو',
    taglineFa: 'رنگ و عدد را جور کن',
    descriptionFa: 'کارتی و پرسر و صدا؛ تا شش نفر دور یک میز.',
    howToFa: 'کارتی هم‌رنگ یا هم‌عدد بیندازید. قبل از یک کارت ماندن «اونو» بگویید، وگرنه می‌بازید.',
    categoryFa: 'کارتی',
    minPlayers: 2,
    maxPlayers: 6,
    mode: 'turn',
  },
  {
    id: '2048',
    nameFa: '۲۰۴۸',
    taglineFa: 'مسابقهٔ عددسازی',
    descriptionFa: 'همه از یک صفحهٔ شروع می‌کنند؛ هر کس زودتر به ۲۰۴۸ برسد برنده است.',
    howToFa: 'با کشیدن انگشت کاشی‌ها را جابه‌جا کنید تا دوتای مساوی یکی شوند. زودتر از همه به ۲۰۴۸ برسید.',
    categoryFa: 'فکری',
    minPlayers: 1,
    maxPlayers: 4,
    mode: 'realtime',
  },
  {
    id: 'werewolf',
    nameFa: 'گرگینه',
    taglineFa: 'شب بیدار، روز محاکمه',
    descriptionFa: 'بازی اجتماعی میزهای شش‌نفره و بیشتر؛ گوشی نقش شما را مخفی نگه می‌دارد.',
    howToFa: 'هر شب گرگ‌ها یک نفر را انتخاب می‌کنند و پیشگو خبر می‌گیرد؛ روز با صحبت و رأی یک نفر اخراج می‌شود.',
    categoryFa: 'اجتماعی',
    minPlayers: 6,
    maxPlayers: 12,
    mode: 'phase',
  },
];

const BY_ID = new Map<string, GameManifest>(GAMES.map((game) => [game.id, game]));

export function isGameId(value: string): value is GameId {
  return BY_ID.has(value);
}

export function manifest(id: string): GameManifest {
  const game = BY_ID.get(id);
  if (!game) throw new Error(`بازی ناشناس: ${id}`);
  return game;
}
