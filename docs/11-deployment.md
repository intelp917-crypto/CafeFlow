# ۱۱. راهنمای استقرار

> **وضعیت:** هر دو مسیر آزموده شده‌اند. اجرای بدون Docker در توسعه، و استک `infra/docker` روی
> Docker Desktop (موتور لینوکس) در ۲۰۲۶-۱۱-۲۰: بیلد هر دو تصویر، سلامت کانتینرها، ورود/نشست از
> طریق nginx، پشتیبان روزانهٔ `integrity_check=ok`، HTTPS با Caddy و پایداری داده پس از
> `down`/`up`. گواهی دامنهٔ عمومی، سرور تولید و مانیتورینگ هنوز تأیید نشده است.

## الف) اجرای محلی بدون Docker (تأییدشده در این مخزن)

```bash
npm install
npm run build:shared
npm run db:setup -w @cafeflow/api      # مهاجرت + داده اولیه
npm run build -w @cafeflow/api
node apps/api/dist/main.js              # یا: npm run dev:api

npm run dev -w @cafeflow/web            # http://localhost:5173
```

- API روی `PORT` (پیش‌فرض ۳۰۰۰) و وب روی ۵۱۷۳.
- در توسعه، Vite مسیر `/api` را به API پروکسی می‌کند؛ بنابراین کوکی نشست first-party می‌ماند و CORS لازم نیست.
- فایل پایگاه داده: `data/cafeflow.db` (به همراه `-wal` و `-shm`)؛ ریشهٔ داده‌ها با `CAFEFLOW_DATA_DIR`
  قابل جابه‌جایی است.

## ب) Docker Compose (اجرا و تأییدشده در ۲۰۲۶-۱۱-۲۰)

```bash
cd infra/docker
cp .env.example .env      # SEED_ADMIN_PASSWORD را در .env عوض کنید
docker compose build
docker compose up -d                 # http://localhost:8080
docker compose --profile tls up -d   # https://localhost:8443 (گواهی داخلی Caddy)
```

سرویس‌ها:

| سرویس | تصویر | نقش |
|---|---|---|
| `api` | `Dockerfile.api` (node:24-slim, multi-stage, `USER node`) | NestJS قدیمی + SQLite (فقط مرجع/استک پیش از cutover) |
| `web` | `Dockerfile.web` (vite build → nginx) | SPA + پروکسی هم‌مبدأ `/api` |
| `backup` | همان تصویر API (اسکریپت `scripts/backup.mjs`) | نسخهٔ `VACUUM INTO` روزانه + چرخش |
| `proxy` | `caddy:2.8-alpine` با `profiles: ["tls"]` | پایانهٔ HTTPS/ACME |

> مسیر تولید اکنون بخش «بک‌اند Rust و ایمیج تک‌سرویسی» در ادامهٔ همین سند است: یک image/یک
> container با `Dockerfile.rust` و `compose.rust.yml`. استک سه‌سرویسی بالا فقط برای مقایسه و
> بازگشت اضطراری نگه داشته شده است.

- **Quay:** هر دو ایمیج در یک مخزن منتشر می‌شوند: `quay.io/intelp917/cafeflow:api-0.1.0` و
  `quay.io/intelp917/cafeflow:web-0.1.0`. تگ‌های کوتاه `api` و `web` برای دیپلوی پایدار (بدون نسخهٔ پین‌شده)
  هم موجودند. مخزن خصوصی است؛ هاست باید credential پول Quay داشته باشد.

- داده در volume‌ای به نام `data` (قابل تغییر با `DATA_VOLUME_NAME`) روی `/app/data` نگه‌داری
  می‌شود — همان مسیری که API به‌صورت پیش‌فرض از `/app/apps/api` رزولو می‌کند، پس حتی اگر
  `CAFEFLOW_DATA_DIR` فراموش شود، نوشتن بیرون از volume نمی‌افتد. پشتیبان‌ها در
  `cafeflow_backups` روی `/app/data/backups`.
- وب با nginx سرو می‌شود؛ `nginx.conf` مسیرهای SPA، کش دارایی و پروکسی API را مدیریت می‌کند.
- **ریست پایگاه داده بدون پاک‌کردن عکس‌ها:** فقط `cafeflow.db` و فایل‌های `-wal`/`-shm` را از
  volume حذف کنید و کانتینر را دوباره بالا بیاورید؛ `migrate` و `seed` دوباره اجرا می‌شوند و
  `uploads/` دست‌نخورده می‌ماند. اگر بعد از اولین بوت `SEED_ADMIN_PASSWORD` را عوض کرده‌اید،
  تا وقتی جدول `users` خالی نشود همان رمز قبلی معتبر می‌ماند.
- **تصاویر محصول:** عکس‌های نمونه در `apps/web/public/images/products` داخل تصویر وب هستند و
  nginx برای `/images/` با `try_files $uri =404` سرو می‌کند؛ نبودِ فایل دیگر با `index.html` و
  کد ۲۰۰ جواب نمی‌گیرد. service worker هم فقط پاسخ‌های `image/*` را کش می‌کند و با هر نسخهٔ تازه
  کش قبلی را پاک می‌کند. عکس‌هایی که مدیر آپلود می‌کند زیر
  `$CAFEFLOW_DATA_DIR/uploads/products` روی همان volume می‌مانند.
- **volume قدیمی:** اگر پایگاه داده پیش از اضافه‌شدن عکس‌های نمونه ساخته شده باشد، اجرای بعدی
  `seed` فقط عکس‌های خالی همان محصولات نمونه را با نام دقیق پر می‌کند
  (`backfillDemoProductImages`) و عکس انتخابی مدیر را تغییر نمی‌دهد. برای خاموش‌کردن این
  تکمیل خودکار `SEED_DEMO_MENU=false` بگذارید.
- **متغیرها:** `SEED_ADMIN_PASSWORD` اجباری است (`:?` در compose). `SESSION_COOKIE_SECURE` پیش‌فرض
  `true` است؛ فقط برای آزمون سادهٔ HTTP باید صریحاً `false` شود. `WEB_PORT` (پیش‌فرض ۸۰۸۰)،
  `HTTPS_PORT` (۸۴۴۳)، `HTTP_PORT` (۸۰)، `BACKUP_KEEP` (۱۴)، `SEED_DEMO_STAFF` (`false`).
- **HTTPS روی دامنهٔ واقعی:** `CAFEFLOW_HOST=cafe.example.com` و `CAFEFLOW_TLS=owner@example.com`
  (برای Let's Encrypt) و پورت‌های ۸۰/۴۴۳ را باز کنید. با مقدار پیش‌فرض، Caddy گواهی داخلی می‌دهد و
  مرورگر تا نصب CA هشدار می‌دهد؛ کوکی همچنان `Secure` است.
- **پشتیبان:** سرویس `backup` بلافاصله یک نسخه می‌گیرد و هر ۲۴ ساعت تکرار می‌کند؛ چون volume پشتیبان
  با مالک root ساخته می‌شود، همین یک سرویس با `user: "0:0"` اجرا می‌شود (API غیر‌root می‌ماند).
  mount داده برای این سرویس عمداً `:ro` نیست، چون SQLite برای خواندن پایگاه WAL به فایل‌های
  `-wal`/`-shm` قابل‌نوشتن نیاز دارد.
- **آزمون‌های انجام‌شده روی همین استک:** `GET /` و مسیر عمیق SPA از nginx (۲۰۰)،
  `/api/v1/health` (۲۰۰ با `database: ok`)، ورود `admin` و `GET /auth/me` با کوکی نشست (۲۰۰)،
  ساخت پشتیبان با `integrity_check=ok`، `https://localhost:8443` با گواهی Caddy و همان ورود،
  و ماندن داده‌ها پس از `docker compose down` + `up` (بدون `-v`).
- **تأیید نشده:** گواهی دامنهٔ عمومی، سرور لینوکسی واقعی، مانیتورینگ و آپلود خارج از سرور.

## مسیرهای پایدار (بعد از ریستارت سرور)

کل وضعیت زمان اجرا زیر یک ریشه است و با `CAFEFLOW_DATA_DIR` تعیین می‌شود:

| مسیر | محتوا | اگر پایدار نباشد چه از دست می‌رود |
|---|---|---|
| `$CAFEFLOW_DATA_DIR/cafeflow.db` (+ `-wal`/`-shm`) | پایگاه داده | سفارش‌ها، پرداخت‌ها، منو، کاربران، تنظیمات و همهٔ رویدادها |
| `$CAFEFLOW_DATA_DIR/uploads/products/` | عکس‌های آپلودی محصولات | عکس‌هایی که مدیر از پنل آپلود کرده است |
| `$CAFEFLOW_DATA_DIR/backups/` | نسخه‌های `VACUUM INTO` | تاریخچهٔ پشتیبان |
| `$CAFEFLOW_DATA_DIR/print-output/` | فایل رسیدهای پل چاپ | رسیدهای چاپ‌شدهٔ روی دیسک |

**Docker:**
- volume `data` (یا `DATA_VOLUME_NAME`) → `/app/data` و `cafeflow_backups` → `/app/data/backups`.
  درون ایمیج `Dockerfile.api` پوشهٔ `/app/data` ساخته و مالکش `node` می‌شود تا volume تازه هم
  قابل‌نوشتن باشد.
- `docker compose down` و `up` داده را پاک نمی‌کند؛ **هرگز `docker compose down -v` نزنید** (volume را حذف می‌کند).
- اگر می‌خواهید داده در مسیر مشخصی از هاست باشد، mount را با bind mount عوض کنید:
  ```yaml
  volumes:
    - /srv/cafeflow:/app/data
  ```

**بدون Docker (systemd):**
```ini
[Service]
WorkingDirectory=/opt/cafeflow
EnvironmentFile=/etc/cafeflow/cafeflow.env   # CAFEFLOW_DATA_DIR=/var/lib/cafeflow
ExecStart=/usr/bin/node apps/api/dist/main.js
User=cafeflow
```
```bash
sudo install -d -o cafeflow -g cafeflow /var/lib/cafeflow
```

- با هر بوت، API مسیر واقعی داده و پشتیبان را در لاگ چاپ می‌کند؛ اگر مسیر داخل پوشهٔ پروژه یا `/tmp` بود،
  یعنی تنظیم نشده و با ریستارت/دیپلوی بعدی از دست می‌رود.
- `.env`، `data/`، `backups/` و `print-output/` در `.gitignore` هستند و هرگز داخل تصویر Docker کپی نمی‌شوند.
- پوشهٔ `data/` پروژه فقط برای توسعه است؛ آن را در تولید استفاده نکنید.

## ج) تولید در سرور (Docker یا سرور فیزیکی)

1. `NODE_ENV=production` و `SESSION_COOKIE_SECURE=true`.
2. `SEED_ADMIN_PASSWORD` قوی تنظیم کنید یا پس از `db:setup` گذرواژه را از رابط تغییر دهید.
3. مهاجرت‌ها را با `npm run db:migrate` اجرا کنید (خودکار در بوت هم اجرا می‌شوند).
4. پشتیبان‌گیری را فعال کنید (docs/12).
5. HTTPS را با reverse proxy تأمین کنید؛ کوکی `Secure` بدون HTTPS کار نمی‌کند.
6. پل چاپ را روی رایانه‌ای در شبکه رستوران اجرا و توکن آن را تنظیم کنید (فاز ۴).

## پشتیبان‌گیری بدون توقف سرویس

```bash
npm run backup                                  # → data/backups/cafeflow-YYYYMMDD-HHmmss.db
CAFEFLOW_DATA_DIR=/var/lib/cafeflow npm run backup
CAFEFLOW_DATA_DIR=/var/lib/cafeflow BACKUP_KEEP=30 npm run backup   # نگه‌داشتن ۳۰ نسخه اخیر
BACKUP_DIR=/mnt/backup npm run backup           # پشتیبان روی دیسک دوم
```

- اسکریپت `scripts/backup.mjs` از `VACUUM INTO` استفاده می‌کند؛ فایل تک‌پارچه و سازگار با WAL تولید می‌شود
  و نیازی به توقف API نیست.
- پس از ساخت، `integrity_check` و شمارش سفارش/پرداخت چاپ می‌شود؛ خروجی غیرصفر یعنی نسخه سالم نیست.
- چرخش بر اساس تعداد (`BACKUP_KEEP`، پیش‌فرض ۱۴) انجام می‌شود؛ زمان‌بندی (cron/Task Scheduler) و آپلود
  خارج از سرور **تنظیم نشده** است.
- بازیابی: API را متوقف کنید، فایل پایگاه داده جاری را کنار بگذارید و نسخه پشتیبان را در
  `$CAFEFLOW_DATA_DIR/cafeflow.db` کپی کنید (فایل‌های `-wal`/`-shm` قدیمی را حذف کنید) و دوباره بالا بیاورید.

## PWA و آزمون E2E

- بیلد وب شامل `manifest.webmanifest`، `sw.js`، `offline.html` و `icon-192/512.png` است. سرویس‌ورکر فقط
  در بیلد تولیدی ثبت می‌شود و پاسخ‌های `/api` را هرگز کش نمی‌کند؛ صفحه آفلاین فقط برای ناوبری است.
- آیکون‌ها با `node scripts/make-icons.mjs` بازتولید می‌شوند.
- آزمون دود مرورگر (روی Edge نصب‌شده):

```bash
npm run test:e2e
# اختیاری: E2E_ADMIN_USERNAME و E2E_ADMIN_PASSWORD برای حساب دیگری
```

- در CI، Playwright خودش API و Vite را بالا می‌آورد؛ روی ماشین توسعه سرورهای در حال اجرا دوباره استفاده می‌شوند.
- تأیید واقعی آفلاین روی بیلد تولیدی:

```bash
npm run build -w @cafeflow/web
(cd apps/web && npx vite preview --port 4173 --strictPort) &
npm run verify:pwa     # manifest، سرویس‌ورکر و صفحه آفلاین را با Edge بررسی می‌کند
```

## بررسی سلامت

```bash
curl -s http://localhost:3000/api/v1/health
# {"status":"ok","database":"ok",...}
```

## نکات عملیاتی

- **یک نسخه API** بنویسید؛ SQLite یک نویسنده در هر لحظه دارد و برای یک رستوران کافی است، اما چند نمونه API روی یک فایل توصیه نمی‌شود.
- مسیر مهاجرت PostgreSQL (فاز ۷) برای چند شعبه/بار بالا آماده است.
- فایل‌های `.env` هرگز commit نمی‌شوند (`.gitignore`).

## د) بک‌اند Rust و ایمیج تک‌سرویسی (پایهٔ مهاجرت)

> **وضعیت صادقانه:** این موج زیرساخت، احراز هویت و مسیر مشتری QR را به Rust منتقل کرده است:
> health، login/logout، نشست‌ها، تغییر گذرواژه، MFA، منوی عمومی، ثبت سفارش idempotent،
> پیگیری سفارش، داشبورد عملیات، فهرست/جزئیات/انتقال سفارش کارکنان، سفارش دستی، ویرایش اقلام،
> میزها، صف آماده‌سازی با پیشروی خودکار سفارش، صندوق (پرداخت جزئی/کامل، تقسیم فاکتور،
> تخفیف، بازپرداخت و کارت‌خوان)، درخواست‌های گارسون/کارت‌خوان و بستن میز،
> کاتالوگ مدیریت (دسته، محصول، گزینه، افزودنی، ساعت سرو، ایمپورت CSV و تصویر محصول)،
> گزارش فروش/بازپرداخت/روش‌ها/محصولات با خروجی CSV و XLSX،
> بلیت/پیش‌فاکتور چاپ و صف چاپ با claim اتمی برای پل چاپ، کاتالوگ و اتاق/سوکت هر ۳۸ بازی
> میزی با موتور قواعد Boa داخل همان باینری، SPA/۴۰۴ واقعی media و انتخاب SQLite/PostgreSQL. کاتالوگ دمو
> در اولین seed ساخته می‌شود تا منوی QR و سفارش آزمایشی از همان ابتدا کار کنند. ایمیج تک‌سرویسی
> Rust مسیر deployable است و هیچ سرویس Node در زمان اجرا
> لازم نیست.

```bash
# ساخت و اجرای محلی باینری
cd rust
DB_DRIVER=sqlite CAFEFLOW_DATA_DIR=../data cargo run -p cafeflow-api -- db setup
DB_DRIVER=sqlite CAFEFLOW_DATA_DIR=../data WEB_ROOT=../apps/web/dist cargo run -p cafeflow-api -- serve
# http://127.0.0.1:3000  (API و SPA روی یک پورت)
```

- ایمیج واحد: `infra/docker/Dockerfile.rust` (مرحلهٔ Node فقط برای build وب؛ runtime نهایی
  Wolfi بدون Node/nginx). پایه‌ها به‌صورت پیش‌فرض از `cgr.dev/chainguard` هستند تا به Docker Hub
  وابسته نباشند؛ با `--build-arg NODE_IMAGE=...`، `RUST_IMAGE=...` یا `RUNTIME_IMAGE=...`
  می‌توان آن‌ها را عوض کرد.
- Compose تک‌سرویسی: `infra/docker/compose.rust.yml`؛ SQLite پیش‌فرض است. در اولین اجرا
  `cafeflow db setup` مهاجرت و seed را انجام می‌دهد. برای PostgreSQL
  `DB_DRIVER=postgres` و `DATABASE_URL` را تنظیم کنید؛ سرور PostgreSQL سرویس جداگانه است.
  `SESSION_COOKIE_SECURE` پیش‌فرض `true` است؛ فقط برای آزمون سادهٔ HTTP روی شبکهٔ محلی آن را
  صریحاً `false` کنید.
- کپی داده از SQLite موجود به PostgreSQL تازه (بدون تغییر فایل مبدأ):

```bash
DB_DRIVER=postgres DATABASE_URL=postgres://user:pass@host/cafeflow cargo run -p cafeflow-api -- db migrate
DB_DRIVER=sqlite DATABASE_PATH=/path/to/cafeflow.db POSTGRES_URL=postgres://user:pass@host/cafeflow \
  cargo run -p cafeflow-api -- db migrate-to-postgres --dry-run
# پس از بررسی پیش‌نمایش (مقصد باید تازه باشد):
DB_DRIVER=sqlite DATABASE_PATH=/path/to/cafeflow.db POSTGRES_URL=postgres://user:pass@host/cafeflow \
  cargo run -p cafeflow-api -- db migrate-to-postgres
```

- فرمان کپی، مقصد غیرخالی را رد می‌کند. `--force` فقط وقتی مقصد را می‌خواهید بازنویسی کنید.
- پشتیبان SQLite با همان باینری: `cafeflow backup` (خروجی در `CAFEFLOW_BACKUP_DIR`).
