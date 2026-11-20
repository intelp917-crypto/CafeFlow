# بازی میزی چندنفره با QR میز — طرح اجرا

> **For agentic workers:** از `superpowers:executing-plans` استفاده شود. گام‌ها: `- [ ]`.

**Goal:** مهمان‌های هر میز با همان QR فعلی میز، هر کدام روی گوشی خودشان، وارد یک اتاق بازی مشترک شوند — کاملاً فارسی و RTL.

**Architecture:** فقط ماژول‌های *قواعد* GameNest (`games/`, `bots/`، Apache-2.0) به `packages/games` منتقل می‌شوند. `server.js`، رندررهایش و پک‌های چینی/انگلیسی استفاده نمی‌شوند. اتاق، صندلی و WebSocket داخل همان پروسه NestJS هستند؛ هویت میز فقط از QR سرورساید حل می‌شود و دستگاه مهمان با کوکی `cafe_device` شناخته می‌شود. رابط کاربری از صفر در React نوشته می‌شود.

**Tech Stack:** NestJS 11 + `ws` (upgrade روی همان http server)، React 19، Tailwind، vitest/supertest، Playwright.

**Spec:** همین سند + GameNest@master (v2.2.0) `docs/ARCHITECTURE.md` و `games/*.js`.

## Global Constraints
- RTL، Vazirmatn، توکن‌های `#aa472b`/`#96a09f`، اعداد فارسی (`formatCountFa`)، آیکون lucide (بدون emoji)، هدف لمس ≥۴۴px، احترام به `prefers-reduced-motion`.
- بازی عمومی است: بدون نشست کارکنان؛ `tableId` از کلاینت هرگز پذیرفته نمی‌شود.
- نما per-seat: دست/نقش مخفی یک صندلی هرگز برای صندلی دیگر سریالایز نشود.
- وضعیت بازی فقط در حافظه؛ اتاق با بسته‌شدن نشست میز یا ۶۰ دقیقه بی‌فعالیتی می‌میرد. بدون مهاجرت DB در v1.
- سقف‌ها: ۶۴KB پیام، ۲۰ پیام/ثانیه/صندلی، `maxPlayers` ماژول (پیش‌فرض ۸).
- بازگشت: توکن صندلی در `sessionStorage`؛ ۲ دقیقه مهلت در بازی، ۵ دقیقه در لابی.
- میزبانی همان استک Docker فعلی؛ Sites/Workers مناسب نیست (Node + WebSocket + SQLite).

## Review Focus
1. دو میز مختلف با QR یکسان/جابه‌جا نباید هم‌اتاق شوند.
2. QR قدیمیِ میزی که نشستش بسته یا توکنش عوض شده باید رد شود، نه اتاق مرده.
3. رفرش/دو تب روی یک گوشی باید همان صندلی را بگیرد، نه صندلی دوم.
4. نشت اطلاعات مخفی بین صندلی‌ها (UNO/گرگینه).
5. خروج میزبان در لابی: میزبانی منتقل شود؛ اتاق خالی حذف شود.

## File Structure
```
packages/games/{upstream,src/manifest.ts,src/adapter.ts,src/i18n/fa.ts,LICENSE,NOTICE}
apps/api/src/modules/games/{games.module,games.controller,games.repository,room-manager,games.gateway}.ts
apps/api/test/games.{unit,ws}.test.ts
apps/web/src/features/games/{shell,shared,renderers/*}
apps/web/src/pages/TableGamesPage.tsx
```
دامنهٔ این طرح: ۶ بازی که همهٔ الگوها را پوشش می‌دهند (دوز، چهار در خط، اتللو، UNO، ۲۰۴۸، گرگینه). ۳۱ بازی دیگر در طرح بعدی با همین قالب دوگامی (ورودی manifest + رندرر) اضافه می‌شوند.

---

### Task 1: بستهٔ قواعد `packages/games`
**Files:** `packages/games/package.json`, `upstream/**` (کپی verbatim + سرصفحهٔ «modified»)، `src/manifest.ts`, `src/adapter.ts`, `src/i18n/fa.ts`, `LICENSE`, `NOTICE`, `apps/api/package.json`, تست `packages/games/test/manifest.test.ts`.
**Interfaces:** `GAME_IDS`, `manifest(id): { id; nameFa; minPlayers; maxPlayers; modes }`، `loadGame(id): { createState; handleMove; playerView?; tick? }`، `messageFa(key)`.
- [ ] تست: هر `GAME_IDS` ماژول دارد؛ `handleMove` غیرمجاز خطا می‌دهد.
- [ ] `npm test -w @cafeflow/games` → FAIL.
- [ ] کپی ماژول‌ها + manifest فارسی ۶ بازی + `LICENSE`/`NOTICE` GameNest.
- [ ] همان تست → PASS؛ commit: `feat(games): vendor GameNest rule modules with Persian manifest`.

### Task 2: ورود با QR میز
**Files:** `games.repository.ts`, `games.controller.ts`, `games.module.ts`, `app.module.ts`, تست `apps/api/test/games.join.test.ts`.
**Interfaces:** `POST /api/v1/public/games/join { qrToken, gameId }` → `{ seatToken, roomId, seat, expiresAt }`؛ `GET /public/games/catalog` → manifest فارسی.
- [ ] تست: QR نامعتبر/غیرفعال → ۴۰۴ `QR_NOT_FOUND`؛ QR معتبر دو دستگاه → یک `roomId`؛ `gameId` ناشناس → ۴۰۰.
- [ ] `npm run test:api -w @cafeflow/api -- games.join` → FAIL.
- [ ] پیاده‌سازی با `findQrByToken` موجود + `customer_devices` و `rate-limit` موجود.
- [ ] PASS؛ commit.

### Task 3: مدیر اتاق
**Files:** `room-manager.ts`, تست `apps/api/test/games.unit.test.ts`.
**Interfaces:** `join(roomId, deviceId, gameId)`، `seatFor(roomId, deviceId)`، `setReady`، `start`، `apply(seat, move)`، `leave`، `snapshot(seat)`، `seats`.
- [ ] تست: صندلی تکراری برای همان دستگاه؛ شروع با یک بازیکن رد؛ دو `start` هم‌زمان فقط یک‌بار؛ انتقال میزبانی؛ حذف اتاق خالی؛ نما per-seat دست دیگری را ندارد.
- [ ] تست → FAIL؛ پیاده‌سازی با تایمرهای grace؛ PASS؛ commit.

### Task 4: Gateway و پروتکل
**Files:** `games.gateway.ts`, `main.ts`، تست `apps/api/test/games.ws.test.ts`.
**Interfaces:** `WS /ws/games?seat=<seatToken>`؛ پیام‌ها `room`, `seats`, `state`, `move`, `error`؛ خطاها با کد ماشینی + متن فارسی.
- [ ] تست دو کلاینت: هر دو `state` می‌گیرند، پیام نوبت‌نبودن رد می‌شود، فیلد مخفی صندلی دیگر غایب است، توکن نامعتبر بسته می‌شود (۴۴۰۱).
- [ ] تست → FAIL؛ `WebSocketServer({noServer:true})` + `server.on('upgrade')` با فیلتر مسیر؛ heartbeat ۳۰s؛ PASS؛ commit.

### Task 5: پوستهٔ React
**Files:** `App.tsx` (روت `/table/:qrToken/games`)، `pages/TableGamesPage.tsx`، `features/games/shell/{JoinGate,Lobby,WaitingRoom,GameView}.tsx`، `lib/games.ts` (کلاینت WS + reconnect).
- [ ] اتصال: فهرست بازی‌ها، ساخت/پیوستن به اتاق میز، صندلی‌ها، آماده، شروع (میزبان)، بنر «اتصال دوباره…».
- [ ] `npm run build -w @cafeflow/web` → PASS؛ commit.
- [ ] Playwright: دو context با دو کوکی دستگاه، همان QR، هر دو در waiting room دیده شوند.

### Task 6: قرارداد رندرر + دوز
**Files:** `features/games/shared/{TurnBar,SeatList,ResultOverlay,Timer}.tsx`, `renderers/TicTacToe.tsx`, تست `apps/web/src/features/games/renderers/__tests__/tictactoe.test.tsx`.
- [ ] تست: کلیک خانه → `move` با ایندکس؛ خانهٔ اشغال رد؛ برد → `ResultOverlay` با نام فارسی برنده.
- [ ] FAIL؛ پیاده‌سازی؛ PASS؛ commit.

### Task 7: UNO (دست مخفی)
**Files:** `renderers/Uno.tsx`, `shared/Card.tsx`.
- [ ] تست: دست من فقط کارت‌های خودم؛ بازی کارت غیرمجاز رد؛ رنگ/عدد با اعداد فارسی.
- [ ] FAIL؛ پیاده‌سازی RTL با کارت‌های گرادیانی برند؛ PASS؛ commit.

### Task 8: چهار در خط + اتللو
**Files:** `shared/Grid.tsx`, `renderers/ConnectFour.tsx`, `renderers/Reversi.tsx`.
- [ ] تست هر دو: حرکت مجاز اعمال، نوبت حفظ، پایان بازی نتیجه می‌دهد.
- [ ] FAIL؛ پیاده‌سازی روی `Grid` مشترک؛ PASS؛ commit.

### Task 9: ۲۰۴۸ رقابتی (realtime)
**Files:** `renderers/Realtime2048.tsx`, سیم‌کشی `tick` در `room-manager`.
- [ ] تست: `tick` فقط برای بازی realtime اجرا شود و پس از برنده متوقف شود.
- [ ] FAIL؛ پیاده‌سازی سوایپ/کلید + `prefers-reduced-motion`؛ PASS؛ commit.

### Task 10: گرگینه (مرحله‌ای)
**Files:** `renderers/Werewolf.tsx`, `shared/RoleCard.tsx`.
- [ ] تست: نقش هر صندلی فقط برای خودش؛ ددلاین فاز اعمال می‌شود؛ رأی تکراری رد.
- [ ] FAIL؛ پیاده‌سازی؛ PASS؛ commit.

### Task 11: استقرار و مستندسازی
**Files:** `infra/docker/nginx.conf` (`location /ws/` + Upgrade)، `apps/web/vite.config.ts` (`ws: true`)، `docs/16-table-games.md`, `docs/PROGRESS.md`, `README.md`، E2E `apps/web/e2e/table-games.spec.ts`.
- [ ] build/api tests؛ سپس `docker compose -f infra/docker/compose.yml up -d` و یک دست بازی واقعی از دو گوشی روی LAN.
- [ ] مستند: QR میز = ورود اتاق، سقف‌ها، رفتار reconnect، مجوز Apache-2.0.
- [ ] commit.

## Self-Review
پوشش: QR میز (T2/T5)، چند گوشی (T4/T5)، فارسی‌سازی کامل و طراحی اختصاصی (T1/T5–T10)، اطلاعات مخفی (T3/T4/T7/T10)، realtime (T9)، استقرار (T11). وابستگی‌ها یک‌طرفه‌اند و نام‌ها یکسان. خطاهای احتمالی هر پنج مورد Review Focus تست دارند.
