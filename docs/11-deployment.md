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
| `api` | `Dockerfile.api` (node:24-slim, multi-stage, `USER node`) | NestJS + SQLite + مهاجرت/seed در بوت |
| `web` | `Dockerfile.web` (vite build → nginx) | SPA + پروکسی هم‌مبدأ `/api` |
| `backup` | همان تصویر API (اسکریپت `scripts/backup.mjs`) | نسخهٔ `VACUUM INTO` روزانه + چرخش |
| `proxy` | `caddy:2.8-alpine` با `profiles: ["tls"]` | پایانهٔ HTTPS/ACME |

- داده در volume `cafeflow_data` روی `/var/lib/cafeflow` نگه‌داری می‌شود؛ پشتیبان‌ها در
  `cafeflow_backups` روی `/var/lib/cafeflow/backups`.
- وب با nginx سرو می‌شود؛ `nginx.conf` مسیرهای SPA، کش دارایی و پروکسی API را مدیریت می‌کند.
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
| `$CAFEFLOW_DATA_DIR/backups/` | نسخه‌های `VACUUM INTO` | تاریخچهٔ پشتیبان |
| `$CAFEFLOW_DATA_DIR/print-output/` | فایل رسیدهای پل چاپ | رسیدهای چاپ‌شدهٔ روی دیسک |

**Docker:**
- `cafeflow_data` → `/var/lib/cafeflow` و `cafeflow_backups` → `/var/lib/cafeflow/backups`.
- `docker compose down` و `up` داده را پاک نمی‌کند؛ **هرگز `docker compose down -v` نزنید** (volume را حذف می‌کند).
- اگر می‌خواهید داده در مسیر مشخصی از هاست باشد، volume را با bind mount عوض کنید:
  ```yaml
  volumes:
    - /srv/cafeflow:/var/lib/cafeflow
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
