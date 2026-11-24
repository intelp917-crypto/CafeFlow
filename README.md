## اجرای بک‌اند Rust با CMD (ویندوز)

```bat
cd /d C:\Projects\CafeFlow\rust
set APP_ENV=development
cargo run --release -- db setup
cargo run --release -- serve
```

سپس `http://localhost:3000/staff/login` را باز کنید؛ بار اول ویزارد راه‌اندازی با کلید نصب می‌آید. داده‌ها در
`rust/data` و روی SQLite ذخیره می‌شوند؛ برای بستن سرور در همان پنجره `Ctrl+C` بزنید.

---

# CafeFlow ☕ — کافه‌فلو

**سامانه یکپارچه مدیریت کافه و رستوران — یک ایمیج، یک کانتینر، کل سایت.**
**All-in-one cafe & restaurant platform — one image, one container, the whole site.**

| فارسی | English |
|---|---|
| [راهنمای فارسی](#فارسی) | [English guide](#english) |

- ایمیج منتشرشده: `quay.io/intelp917/cafeflow:0.2.5` (و تگ کوتاه `latest`)
- digest برای پین‌کردن: `sha256:89b3824bdb9b195b71b09c86fb6205059b588c1749774c16a7db788fa7ce8af6`
- پورت پیش‌فرض: `3000` (فقط یک پورت برای API + SPA + WebSocket + رسانه)
- پایگاه داده پیش‌فرض: SQLite روی `/app/data` — بدون سرویس جانبی
- گزینهٔ جایگزین: PostgreSQL ۱۷+ با `DB_DRIVER=postgres`

---

<a id="فارسی"></a>

# راهنمای فارسی

## ۱. این پروژه چیست؟

CafeFlow کل چرخهٔ یک کافه/رستوران را در یک برنامهٔ وب فارسی و RTL پوشش می‌دهد:

- **منوی QR مشتری**: `/menu` (بدون میز) و `/menu/<qr-token>` (منوی همان میز)، سبد خرید، ثبت سفارش idempotent،
  پیگیری وضعیت در `/order/<code>` و درخواست گارسون/صورتحساب/کارت‌خوان.
- **پنل کارکنان**: `/staff/login` → `/admin` شامل داشبورد، سفارش‌ها، صف آماده‌سازی، میزها، درخواست‌ها،
  اعلان‌ها، صف چاپ، گزارش‌ها، چیدمان سالن و QR میز، کاتالوگ/منو، کارکنان و تنظیمات.
- **صندوق و مالی**: پرداخت جزئی/کامل، تقسیم فاکتور، تخفیف با تأیید مدیر، بازپرداخت، جلسات صندوق با مغایرت،
  هزینه‌ها و خلاصهٔ سود و زیان.
- **انبار و CRM (اختیاری)**: مواد اولیه، دستور پخت، خرید، ضایعات، گردش انبار؛ مشتری، امتیاز، کیف پول.
- **۳۸ بازی میزی چندنفره** با QR میز (ماژول اختیاری، اتاق‌ها در حافظهٔ همان پروسه).
- **امنیت**: scrypt، نشست سمت سرور با کوکی `HttpOnly`، RBAC با ۳۹ مجوز، قفل حساب، MFA (TOTP)،
  ثبت audit، هدرهای امنیتی.

رابط کاربری فارسی/RTL با تقویم جلالی، فونت Vazirmatn و رنگ برند `#aa472b`. مبلغ‌ها همیشه **عدد صحیح ریال** و
محاسبهٔ نهایی سمت سرور است.

## ۲. معماری ایمیج

```
                    ┌──────────────────────────── یک کانتینر ────────────────────────────┐
  مرورگر / موبایل ──▶│  cafeflow (Rust/Axum) :3000                                       │
                    │   • /api/v1/*     REST API                                        │
                    │   • /ws/games     WebSocket بازی‌ها                                │
                    │   • /assets /images /scenes /videos   فایل‌های SPA                 │
                    │   • fallback      index.html برای مسیرهای SPA                      │
                    │   • /app/data     SQLite + آپلودها + پشتیبان‌ها (volume)           │
                    └──────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                              quay.io/intelp917/cafeflow:0.2.5
```

- ایمیج نهایی بر پایهٔ Wolfi است و **Node و nginx ندارد**؛ فقط باینری، فایل‌های SPA و ابزارهای پایهٔ Wolfi
  (`curl` برای healthcheck و `apk` برای نگهداری) در آن است. Node فقط در مرحلهٔ build برای ساخت SPA استفاده می‌شود.
- کاربر اجرا: UID/GID `1000`؛ پورت داخلی `3000`؛ حجم ایمیج حدود **۲۴۳ مگابایت**
  (باینری `cafeflow` ≈ ۳۴MB و SPA ≈ ۷۸MB).
- فقط یک پروسهٔ API وجود دارد: **با SQLite و بازی‌های درون‌حافظه‌ای، چند نمونهٔ هم‌زمان روی یک volume پشتیبانی نمی‌شود.**

## ۳. پیش‌نیازها

| مورد | حداقل | پیشنهادی |
|---|---|---|
| سیستم‌عامل | Linux با Docker (Ubuntu 22.04/24.04 یا Debian 12) | Ubuntu 24.04 LTS |
| Docker | Docker Engine 24+ | آخرین نسخهٔ پایدار + Compose v2 |
| CPU | ۱ vCPU | **۲ vCPU** |
| RAM | ۱ گیگابایت | **۲ گیگابایت** |
| دیسک | ۱۰ گیگابایت SSD | **۴۰ گیگابایت NVMe** |
| شبکه | دسترسی خروجی برای pull ایمیج | IP ثابت + دامنه + HTTPS |
| اختیاری | PostgreSQL 17 (اگر SQLite کافی نیست) | ۴ vCPU / ۸GB / ۸۰GB جداگانه |

**چرا این اعداد؟** ایمیج ≈۲۴۳MB است و هر به‌روزرسانی یک لایهٔ تازه می‌آورد؛ SQLite و آپلودها روی دیسک رشد می‌کنند؛
پشتیبان روزانه هم همان دیسک را مصرف می‌کند. بار پردازشی یک کافه (چند ده کاربر هم‌زمان) با یک هستهٔ Rust
و SQLite راحت پاسخ می‌دهد؛ ۲ هسته/۲GB برای پشتیبان‌گیری، به‌روزرسانی بدون فشار و رشد آیندهٔ منو/بازی است.
برای چند شعبه یا چند نمونهٔ API هم‌زمان به PostgreSQL و ۴ هسته/۸GB بروید.

> اگر bind mount به‌جای named volume استفاده می‌کنید، مالکیت پوشه باید `1000:1000` باشد:
> `sudo chown -R 1000:1000 /srv/cafeflow`

## ۴. اجرای سریع (سه راه)

### راه ۱ — فقط Docker (سریع‌ترین)

```bash
# ۱) یک volume پایدار بسازید
docker volume create cafeflow_data

# ۲) اولین اجرا: مهاجرت + داده اولیه، سپس سرویس
docker run -d --name cafeflow \
  --restart unless-stopped \
  -p 8080:3000 \
  -e APP_ENV=production \
  -e SEED_DEMO_STAFF=false \
  -e SEED_DEMO_MENU=true \
  -e SESSION_COOKIE_SECURE=false \
  -v cafeflow_data:/app/data \
  quay.io/intelp917/cafeflow:0.2.5

# ۳) بررسی
curl -s http://127.0.0.1:8080/api/v1/health
# {"status":"ok","database":"ok","databaseDriver":"sqlite","version":"0.2.5",...}
```

سپس `http://SERVER-IP:8080/staff/login` را باز کنید.

> `SESSION_COOKIE_SECURE=false` فقط برای آزمایش HTTP است. روی HTTPS واقعی آن را `true` بگذارید
> (در حالت `APP_ENV=production` پیش‌فرض هم `true` است).

### راه ۲ — Docker Compose (پیشنهادی برای سرور)

فایل `docker-compose.yml` را روی سرور بسازید:

```yaml
services:
  cafeflow:
    image: quay.io/intelp917/cafeflow:0.2.5
    container_name: cafeflow
    restart: unless-stopped
    environment:
      APP_ENV: production
      PORT: "3000"
      CAFEFLOW_DATA_DIR: /app/data
      CAFEFLOW_BACKUP_DIR: /app/data/backups
      DB_DRIVER: sqlite
      DB_AUTO_MIGRATE: "true"
      SESSION_COOKIE_SECURE: "true"     # HTTPS اجباری؛ برای آزمایش HTTP موقتاً false
      SESSION_TTL_HOURS: "168"
      SEED_DEMO_STAFF: "false"
      SEED_DEMO_MENU: "true"
    ports:
      - "127.0.0.1:8080:3000"           # پشت reverse proxy
      # - "8080:3000"                   # دسترسی مستقیم بدون proxy
    volumes:
      - cafeflow_data:/app/data
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3000/api/v1/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

volumes:
  cafeflow_data:
```

```bash
docker compose up -d
docker compose logs -f cafeflow
docker compose ps            # STATUS باید healthy باشد
```

`db setup` idempotent است: در هر بوت اجرا می‌شود، ولی مهاجرت/دادهٔ اولیه را فقط یک‌بار (وقتی لازم باشد) اعمال می‌کند.

### راه ۳ — از سورس (توسعه یا ساخت ایمیج خودتان)

```bash
git clone <repo> && cd CafeFlow
npm ci
npm run build:shared
npm run build -w @cafeflow/web

cd rust
CAFEFLOW_DATA_DIR=../data cargo run -p cafeflow-api -- db setup
CAFEFLOW_DATA_DIR=../data WEB_ROOT=../apps/web/dist cargo run -p cafeflow-api -- serve
# http://localhost:3000

# یا ساخت همان ایمیج تولیدی:
cd ..
docker build -f infra/docker/Dockerfile.rust \
  -t cafeflow:0.2.5 -t quay.io/intelp917/cafeflow:0.2.5 .
```

## ۵. اولین ورود

اولین بار که `/staff/login` را باز کنید، به‌جای فرم ورود **ویزارد راه‌اندازی** نمایش داده می‌شود: نام کاربری و
گذرواژهٔ مدیر اصلی را می‌سازید و **کلید نصب** را وارد می‌کنید. هیچ `SEED_ADMIN_*` لازم نیست.

| مورد | مقدار |
|---|---|
| آدرس | `/staff/login` |
| کلید نصب | `P70w4EslWwiFvmay6Bs1` (قابل تغییر با `CAFEFLOW_INSTALL_KEY`) |
| بعد از ساخت | ورود خودکار به `/admin` |
| کارکنان نمونه (اگر `SEED_DEMO_STAFF=true`) | `manager`, `cashier`, `waiter`, `barista`, `kitchen` — گذرواژه `CafeFlow@1404` |

نکات:

1. ویزارد فقط وقتی نمایش داده می‌شود که هیچ کاربر فعالی با نقش `super_admin` وجود نداشته باشد؛ بعد از ساخت
   دوباره اجرا نمی‌شود (`409`). برای تغییر گذرواژه بعداً از «امنیت حساب» در پنل استفاده کنید.
2. اگر مدیر را از env می‌خواهید، `SEED_ADMIN_USERNAME` و `SEED_ADMIN_PASSWORD` را ست کنید (سازگاری با نصب قبلی).
3. در تولید `SEED_DEMO_STAFF=false` بگذارید؛ حساب‌های نمونه گذرواژهٔ شناخته‌شده دارند.
4. `SEED_DEMO_MENU=true` منوی نمونه با دسته/محصول و چند میز نمایشی (`demo-table-1`، …) می‌سازد.
   برای شروع با منوی خالی `false` بگذارید.
4. ماژول‌های انبار، مالی، CRM و کارکنان به‌صورت پیش‌فرض خاموش‌اند؛ از **تنظیمات ← ماژول‌ها** روشن کنید.

## ۶. متغیرهای محیطی

فایل آمادهٔ تولید: [`deploy.env.example`](deploy.env.example) — بدون تغییر هم کار می‌کند و با
`--env-file` به کانتینر بدهید.

| نام | پیش‌فرض | توضیح |
|---|---|---|
| `APP_ENV` | `development` | `production` باعث پیش‌فرض `SESSION_COOKIE_SECURE=true` می‌شود. `NODE_ENV` هم خوانده می‌شود. |
| `PORT` | `3000` | پورت داخلی HTTP. اگر عوض کردید، healthcheck ایمیج را هم override کنید. |
| `HOST` | `0.0.0.0` | رابط شنود. |
| `API_PREFIX` | `/api/v1` | پیشوند REST. |
| `WEB_ROOT` | `apps/web/dist` (در ایمیج `/app/public`) | ریشهٔ فایل‌های SPA. |
| `CAFEFLOW_DATA_DIR` | `data` (در ایمیج `/app/data`) | **ریشهٔ همهٔ دادهٔ پایدار**: پایگاه داده، آپلودها، پشتیبان‌ها. |
| `DATABASE_PATH` | `$CAFEFLOW_DATA_DIR/cafeflow.db` | مسیر فایل SQLite. |
| `CAFEFLOW_BACKUP_DIR` | `$CAFEFLOW_DATA_DIR/backups` | محل پشتیبان‌ها. |
| `DB_DRIVER` | `sqlite` | `sqlite` یا `postgres`. |
| `DATABASE_URL` | — | اجباری برای `postgres`؛ مثال: `postgres://user:pass@host:5432/cafeflow`. |
| `DB_POOL_MAX` | `1` (SQLite) / `10` (Postgres) | حداکثر اتصال استخر. |
| `DB_AUTO_MIGRATE` | `true` | اجرای مهاجرت‌ها در بوت. |
| `SESSION_COOKIE_NAME` | `cafe_session` | نام کوکی نشست. |
| `SESSION_TTL_HOURS` | `168` | عمر نشست (۷ روز). |
| `SESSION_COOKIE_SECURE` | `true` در production | روی HTTPS `true`؛ برای HTTP آزمایشی `false`. |
| `LOGIN_MAX_ATTEMPTS` | `5` | تلاش ناموفق پیش از قفل حساب. |
| `LOGIN_LOCK_MINUTES` | `15` | مدت قفل. |
| `CAFEFLOW_INSTALL_KEY` | `P70w4EslWwiFvmay6Bs1` | کلید ساخت اولین مدیر در `/staff/login`. |
| `SEED_ADMIN_USERNAME` | — | اختیاری؛ مدیر را از env می‌سازد (بدون ویزارد). |
| `SEED_ADMIN_PASSWORD` | — | اختیاری؛ خالی یعنی ساخت مدیر با ویزارد. |
| `SEED_DEMO_STAFF` | در Compose: `false` · در CLI: `true` | ساخت کارکنان نمونه. |
| `SEED_DEMO_MENU` | `true` | منوی نمونه و میزهای نمایشی. |
| `PUBLIC_APP_URL` | — | آدرس عمومی سایت (مثل `https://cafe.example.com`) برای لینک داخل QR وقتی هدر `Origin` در دسترس نیست. |
| `RUST_LOG` | `cafeflow_api=info,tower_http=info,sqlx=warn` | سطح لاگ. |

اعلان‌ها روی خود دستگاه نمایش داده می‌شوند: توست درون‌برنامه‌ای در همهٔ صفحه‌ها (پنل کارکنان، منوی مشتری و صفحهٔ
وضعیت سفارش) و اعلان موبایلی مرورگر پس از لمس دکمهٔ «فعال‌سازی اعلان». این قابلیت به `VAPID_*` یا سرویس پوش بیرونی
نیازی ندارد؛ اگر تب مرورگر کامل بسته باشد اعلانی نمی‌رسد.
متغیرهای `SMS_*` و `PRINT_BRIDGE_TOKEN` در این نسخه برای پیامک/چاپ خارجی استفاده نمی‌شوند؛ پل چاپ یک اسکریپت
جداگانه روی رایانهٔ کافه است و وجودش برای اجرای سایت لازم نیست.

## ۷. دادهٔ پایدار، پشتیبان و بازیابی

همهٔ وضعیت زمان اجرا زیر `CAFEFLOW_DATA_DIR` (در ایمیج `/app/data`) است:

```
/app/data/
  cafeflow.db          پایگاه داده SQLite
  cafeflow.db-wal      تراکنش‌های WAL
  cafeflow.db-shm      حافظهٔ مشترک
  uploads/products/    عکس‌های آپلودی مدیر
  backups/             نسخه‌های پشتیبان
  print-output/        فایل رسیدها (فقط اگر پل چاپ استفاده شود)
```

### پشتیبان آنلاین (بدون توقف سرویس)

```bash
docker exec cafeflow cafeflow backup
# ✅ پشتیبان ساخته شد: /app/data/backups/cafeflow-YYYYMMDD-HHmmss.sqlite
docker cp cafeflow:/app/data/backups ./backups-$(date +%F)
```

پشتیبان با `VACUUM INTO` ساخته می‌شود: فایل تک‌پارچه و سازگار با WAL. برای اجرای روزانه (cron روی هاست):

```cron
# هر شب ۰۳:۰۰
0 3 * * * docker exec cafeflow cafeflow backup && docker cp cafeflow:/app/data/backups /srv/cafeflow-offsite/backups
```

> نسخهٔ پشتیبان را روی دیسک/سرور دیگر هم نگه دارید؛ volume به‌تنهایی در برابر خرابی دیسک محافظت نمی‌کند.

### بازیابی

```bash
docker stop cafeflow
docker run --rm -v cafeflow_data:/data -v "$PWD":/restore alpine \
  sh -c 'cp /restore/cafeflow-YYYYMMDD-HHmmss.sqlite /data/cafeflow.db && rm -f /data/cafeflow.db-wal /data/cafeflow.db-shm'
docker start cafeflow
```

### ریست پایگاه داده (با حفظ عکس‌ها)

فقط `cafeflow.db`, `-wal` و `-shm` را حذف کنید و دوباره `cafeflow db setup` اجرا کنید؛ `uploads/` دست‌نخورده می‌ماند.
**این کار همهٔ سفارش‌ها، پرداخت‌ها و کاربران را پاک می‌کند.**

## ۸. HTTPS و reverse proxy

کوکی نشست در production `Secure` است؛ یعنی بدون HTTPS ورود «نمی‌چسبد». ساده‌ترین گزینه Caddy است:

```caddyfile
cafe.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo caddy run --config /etc/caddy/Caddyfile
```

با nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name cafe.example.com;
    ssl_certificate     /etc/letsencrypt/live/cafe.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cafe.example.com/privkey.pem;
    client_max_body_size 3m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;      # WebSocket بازی‌ها
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

نکات:

- WebSocket بازی‌ها روی `/ws/games` است؛ هدرهای `Upgrade`/`Connection` را عبور دهید.
- کانتینر را روی `127.0.0.1:8080` منتشر کنید و TLS را در proxy terminate کنید.
- **QR را از دامنهٔ عمومی بسازید.** لینک داخل QR از هدر `Origin` درخواست پنل ساخته می‌شود؛
  اگر پنل را با `http://localhost` باز کنید، QR هم `localhost` می‌شود. یا از دامنه وارد شوید،
  یا `PUBLIC_APP_URL=https://cafe.example.com` را تنظیم کنید.

## ۹. PostgreSQL (اختیاری)

SQLite برای یک کافه کافی است. PostgreSQL را وقتی انتخاب کنید که چند نمونهٔ API، چند شعبه یا
گزارش‌گیری سنگین می‌خواهید.

```bash
docker run -d --name cafeflow-db --restart unless-stopped \
  -e POSTGRES_DB=cafeflow -e POSTGRES_USER=cafeflow \
  -e POSTGRES_PASSWORD='یک-گذرواژه-قوی' \
  -v cafeflow_pg:/var/lib/postgresql/data \
  postgres:17-alpine
```

سپس برای کانتینر برنامه:

```yaml
environment:
  DB_DRIVER: postgres
  DATABASE_URL: postgres://cafeflow:یک-گذرواژه-قوی@cafeflow-db:5432/cafeflow
  DB_POOL_MAX: "10"
```

مهاجرت‌ها روی PostgreSQL هم خودکار اجرا می‌شوند. پشتیبان با `pg_dump` بگیرید (دستور داخلی `cafeflow backup`
فقط SQLite است و برای PostgreSQL خطا می‌دهد).

### کپی دادهٔ موجود SQLite به PostgreSQL

```bash
# پیش‌نمایش (هیچ تغییری نمی‌دهد)
docker run --rm -v cafeflow_data:/app/data --network host \
  -e DB_DRIVER=sqlite -e CAFEFLOW_DATA_DIR=/app/data \
  -e POSTGRES_URL='postgres://cafeflow:pass@127.0.0.1:5432/cafeflow' \
  quay.io/intelp917/cafeflow:0.2.5 db migrate-to-postgres --dry-run

# اجرای واقعی (مقصد باید خالی باشد)
docker run --rm -v cafeflow_data:/app/data --network host \
  -e DB_DRIVER=sqlite -e CAFEFLOW_DATA_DIR=/app/data \
  -e POSTGRES_URL='postgres://cafeflow:pass@127.0.0.1:5432/cafeflow' \
  quay.io/intelp917/cafeflow:0.2.5 db migrate-to-postgres
```

## ۱۰. دستورهای باینری داخل ایمیج

```bash
docker exec cafeflow cafeflow --help
```

| دستور | کار |
|---|---|
| `cafeflow serve` | اجرای HTTP (پیش‌فرض) |
| `cafeflow db setup` | مهاجرت + داده اولیه (idempotent) |
| `cafeflow db migrate` | فقط مهاجرت‌ها |
| `cafeflow db seed` | فقط داده اولیه |
| `cafeflow backup` | پشتیبان SQLite در `CAFEFLOW_BACKUP_DIR` |
| `cafeflow db migrate-to-postgres [--dry-run] [--force]` | کپی SQLite → PostgreSQL |

## ۱۱. به‌روزرسانی و بازگشت

```bash
# ۱) پشتیبان
docker exec cafeflow cafeflow backup
# ۲) دریافت نسخهٔ تازه (تگ دقیق را پین کنید)
docker pull quay.io/intelp917/cafeflow:0.2.5
# ۳) بازسازی کانتینر با همان volume
docker compose up -d          # یا: docker rm -f cafeflow && docker run ... (راه ۱)
```

- مهاجرت‌های جدید در بوت خودکار اعمال می‌شوند؛ `db setup` دوباره seed نمی‌سازد.
- برای بازگشت، تگ قبلی (مثلاً `0.1.0`) را در compose بگذارید و `up -d` کنید. اگر مهاجرت ناسازگار باشد،
  از پشتیبان قبل از به‌روزرسانی استفاده کنید.
- برای دیپلوی قطعی‌تر، ایمیج را با digest پین کنید: `quay.io/intelp917/cafeflow@sha256:...`.

### استقرار خودکار از GitHub (Publish image)

مخزن یک workflow آماده دارد: `.github/workflows/publish-image.yml`.

1. در Quay یک Robot Account بسازید (Organization → Robot Accounts) با دسترسی Write روی
   `intelp917/cafeflow`؛ نام ربات (مثل `intelp917+github`) و توکنش را بردارید.
2. در GitHub → Settings → Secrets and variables → Actions دو secret بسازید:
   `QUAY_USERNAME` = نام ربات و `QUAY_PASSWORD` = توکن ربات (نه گذرواژهٔ سایت Quay).
3. هر push روی `main` یا `feat/rust-backend` (و تگ‌های `v*`) تست‌ها را اجرا و ایمیج را push می‌کند.

| رویداد | تگ‌های تولیدشده |
|---|---|
| push روی `main` | `latest`، `0.2.5`، `main`، `sha-xxxxxxx` |
| push روی `feat/rust-backend` | `0.2.5`، `feat-rust-backend`، `sha-xxxxxxx` |
| تگ `v1.2.3` | `1.2.3`، `1.2`، `1`، `0.2.5`، `sha-xxxxxxx` |

`latest` فقط از `main` ساخته می‌شود؛ برای انتشار نهایی تغییرات را merge کنید. اگر secretها ست نشده
باشند، job ایمیج را فقط build می‌کند و چیزی push نمی‌شود. برای انتشار دستی: Actions → Publish image
→ Run workflow.

روی هاست، بعد از هر انتشار:

```bash
docker compose pull && docker compose up -d
```

یا با watchtower/کرون هر چند دقیقه `docker pull` را اجرا کنید.

### استقرار روی لیارا (Git)

فایل `liara.json` در ریشه اضافه شده و Dockerfile را از `infra/docker/Dockerfile.rust` می‌شناسد:

- در پنل، پلتفرم برنامه **Docker** و پورت `3000` باشد؛ دیسک `data` روی `/app/data` سوار شود.
- موقعیت build آلمان (`germany`) است تا دانلود پکیج محدودیت نداشته باشد.
- در استقرار از GitHub فیلدهای `app` و `platform` را در `liara.json` نگذارید؛ لیارا خودش آن‌ها را
  تشخیص می‌دهد (فایل نمونهٔ پنل این دو را دارد و همان باعث خطا می‌شود).
- متغیرها را در Environment Variables پنل ست کنید: `APP_ENV=production`، `SESSION_COOKIE_SECURE=true` و
  `PUBLIC_APP_URL=https://<دامنه>`؛ مدیر اصلی را از ویزارد `/staff/login` بسازید.
- اولین بوت خودکار `cafeflow db setup` را اجرا می‌کند (مهاجرت + seed فقط روی دیتابیس خالی)؛ برای
  خاموش کردنش `CAFEFLOW_AUTO_SETUP=0` بگذارید.

## ۱۲. بررسی سلامت و عملیات

```bash
curl -s http://127.0.0.1:8080/api/v1/health
docker logs -f --tail=200 cafeflow
docker stats --no-stream cafeflow
```

- `status: ok` و `database: ok` یعنی API و پایگاه داده سالم‌اند.
- محدودیت ورود: ۶۰ درخواست ورود در ۱۰ دقیقه از هر IP؛ جدا از آن، ۵ تلاش ناموفق حساب را ۱۵ دقیقه قفل می‌کند.
- سقف‌های داخلی به تفکیک دستگاه: ۲۰ درخواست مشتری در دقیقه برای هر دستگاه، ۳۰ ورود به بازی در دقیقه برای هر
  دستگاه و ۱۲۰ در دقیقه برای هر IP در بازی‌ها.
- برای **ساخت سفارش عمومی سقف IP داخلی وجود ندارد** (فقط idempotency هر دستگاه). اگر سایت روی اینترنت
  عمومی است، rate limit را در reverse proxy بگذارید.
- بازی‌ها اتاق در حافظه دارند؛ با ری‌استارت کانتینر، اتاق‌های بازی بسته می‌شوند (سفارش‌ها و داده‌ها نه).
- فقط **یک نمونه** از کانتینر روی یک volume اجرا کنید.

## ۱۳. عیب‌یابی

| نشانه | علت رایج | راه‌حل |
|---|---|---|
| ورود انجام می‌شود ولی بلافاصله خارج می‌شوید | `SESSION_COOKIE_SECURE=true` روی HTTP | HTTPS بگذارید یا موقتاً `false` کنید (فقط آزمایش) |
| QR به `localhost` اشاره می‌کند | پنل از `localhost` باز شده | از دامنه وارد شوید یا `PUBLIC_APP_URL` را تنظیم کنید |
| `429 RATE_LIMITED` | سقف نرخ ورود یا درخواست دستگاه/بازی | چند دقیقه صبر کنید؛ برای بار عمومی از rate limit پروکسی استفاده کنید |
| کانتینر `unhealthy` | پورت داخلی عوض شده | `PORT=3000` را نگه دارید یا healthcheck را override کنید |
| `Permission denied` روی `/app/data` | bind mount با مالک اشتباه | `chown -R 1000:1000 /srv/cafeflow` |
| `database is locked` | چند نمونهٔ هم‌زمان روی یک SQLite | فقط یک کانتینر؛ برای مقیاس، PostgreSQL |
| لاگین ۴۰۱ بدون پیام خطا | کوکی مرورگر قدیمی/نام دامنه عوض شده | کوکی‌ها را پاک کنید و دوباره وارد شوید |

## ۱۴. توسعه و آزمون

```bash
npm ci
npm run build:shared
npm run dev:web                 # Vite روی 5173 با proxy به API
(cd rust && CAFEFLOW_DATA_DIR=../data cargo run -p cafeflow-api -- serve)

cd rust
cargo test --workspace          # دامنه، DB، API، بازی‌ها و WebSocket
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
```

`apps/api` (NestJS) فقط مرجع تاریخی آزمون برابری است و در تولید استفاده نمی‌شود.

## ۱۵. ساختار مخزن

```
rust/            Cargo workspace: domain / db / games / api
apps/web         React SPA (مشتری، کارکنان، مدیریت)
apps/api         NestJS مرجع تاریخی (در تولید اجرا نمی‌شود)
packages/shared  منطق دامنه مشترک
packages/ui      کامپوننت‌های RTL
infra/docker     Dockerfile.rust و compose
docs/            مستندات فنی
```

## ۱۶. امنیت

- گذرواژهٔ مدیر را قبل از اولین بوت تنظیم کنید؛ seed فقط روی جدول خالی اجرا می‌شود.
- `SEED_DEMO_STAFF=false` در تولید.
- HTTPS اجباری؛ کوکی `Secure` + `HttpOnly` + `SameSite=Lax`.
- فایل `.env` هرگز commit نمی‌شود و در ایمیج نیست.
- دسترسی SSH و Docker روی سرور را محدود کنید؛ هر کسی به Docker دسترسی داشته باشد معادل root است.
- پشتیبان‌ها را بیرون از سرور نگه دارید.

## ۱۷. مستندات بیشتر

[معماری](docs/01-architecture.md) · [پایگاه داده](docs/02-database-schema.md) · [API](docs/04-api.md) ·
[امنیت](docs/05-auth-and-authorization.md) · [ماژول‌ها](docs/06-modules.md) · [چاپ](docs/10-printing.md) ·
[استقرار](docs/11-deployment.md) · [پشتیبان‌گیری](docs/12-backup-and-recovery.md) · [آزمون](docs/13-testing.md) ·
[محیط](docs/14-environment.md) · [بازی‌ها](docs/16-table-games.md) · [پیشرفت](docs/PROGRESS.md)

---

<a id="english"></a>

# English guide

## 1. What this is

CafeFlow is a complete, Persian-first (RTL) cafe and restaurant platform:

- **Guest QR menu** at `/menu` and `/menu/<qr-token>`, cart, idempotent ordering, order tracking at
  `/order/<code>`, and waiter/bill/card-terminal requests.
- **Staff panel** at `/staff/login` → `/admin`: dashboard, orders, prep queue, tables, requests,
  notifications, print queue, reports, floor plan/table QR, catalog, staff and settings.
- **Cashier & finance**: partial/full payments, split bills, manager-approved discounts, refunds,
  cash sessions with variance, expenses and profit summary.
- **Inventory & CRM (optional modules)**: ingredients, recipes, purchases, waste, stock movements;
  customers, loyalty points and wallet.
- **38 multiplayer table games** launched from the table QR (optional module; rooms live in memory).
- **Security**: scrypt, server-side sessions with `HttpOnly` cookies, 39-permission RBAC, account
  lockout, TOTP MFA, audit log and security headers.

All money is integer Iranian rial and every total is computed on the server. Dates use the Jalali
calendar and the UI is RTL with Vazirmatn.

## 2. Image architecture

Published image: `quay.io/intelp917/cafeflow:0.2.5` (also `:latest`), digest
`sha256:89b3824bdb9b195b71b09c86fb6205059b588c1749774c16a7db788fa7ce8af6`.

One container runs one Rust/Axum process on port `3000` that serves the REST API (`/api/v1`), the
game WebSocket (`/ws/games`), the built SPA (with history fallback) and uploaded media. The final
image is Wolfi-based with **no Node and no nginx** (only the binary, the SPA and base Wolfi tools such as
`curl` and `apk`). It runs as UID/GID `1000`
and weighs about **243 MB** (34 MB binary + 78 MB SPA). Node is used only in the build stage.

Because SQLite and the in-memory game rooms live in the process, **run exactly one instance against
one data volume**.

## 3. Host sizing

| Resource | Minimum | Recommended |
|---|---|---|
| OS | Linux + Docker (Ubuntu 22.04/24.04, Debian 12) | Ubuntu 24.04 LTS |
| Docker | Engine 24+ | latest stable + Compose v2 |
| CPU | 1 vCPU | **2 vCPU** |
| RAM | 1 GB | **2 GB** |
| Disk | 10 GB SSD | **40 GB NVMe** |
| Network | outbound access to pull the image | static IP, domain, HTTPS |
| Optional DB | PostgreSQL 17 | 4 vCPU / 8 GB / 80 GB, separate host |

Why: the image is ~243 MB and each update pulls new layers, SQLite and uploads grow on disk, and
local backups use the same disk. A single Rust process serves a busy cafe comfortably; 2 vCPU /
2 GB leaves room for backups, image pulls and future menu/game growth. Move to PostgreSQL and
4 vCPU / 8 GB for multiple API instances, multiple branches or heavy reporting.

If you use a bind mount instead of a named volume, the directory must be owned by `1000:1000`:
`sudo chown -R 1000:1000 /srv/cafeflow`.

## 4. Quick start

### Option A — Docker only

```bash
docker volume create cafeflow_data

docker run -d --name cafeflow \
  --restart unless-stopped \
  -p 8080:3000 \
  -e APP_ENV=production \
  -e SEED_DEMO_STAFF=false \
  -e SEED_DEMO_MENU=true \
  -e SESSION_COOKIE_SECURE=false \
  -v cafeflow_data:/app/data \
  quay.io/intelp917/cafeflow:0.2.5

curl -s http://127.0.0.1:8080/api/v1/health
```

Open `http://SERVER-IP:8080/staff/login`. `SESSION_COOKIE_SECURE=false` is for a plain-HTTP trial
only; use `true` with HTTPS (it is the default when `APP_ENV=production`).

### Option B — Docker Compose (recommended on a server)

Create `docker-compose.yml`:

```yaml
services:
  cafeflow:
    image: quay.io/intelp917/cafeflow:0.2.5
    container_name: cafeflow
    restart: unless-stopped
    environment:
      APP_ENV: production
      PORT: "3000"
      CAFEFLOW_DATA_DIR: /app/data
      CAFEFLOW_BACKUP_DIR: /app/data/backups
      DB_DRIVER: sqlite
      DB_AUTO_MIGRATE: "true"
      SESSION_COOKIE_SECURE: "true"     # requires HTTPS; set false only for an HTTP trial
      SESSION_TTL_HOURS: "168"
      SEED_DEMO_STAFF: "false"
      SEED_DEMO_MENU: "true"
    ports:
      - "127.0.0.1:8080:3000"           # behind a reverse proxy
      # - "8080:3000"                   # direct access without a proxy
    volumes:
      - cafeflow_data:/app/data
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3000/api/v1/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

volumes:
  cafeflow_data:
```

```bash
docker compose up -d
docker compose logs -f cafeflow
```

`db setup` is idempotent: it runs on every boot but migrates and seeds only when needed.

### Option C — From source

```bash
npm ci && npm run build:shared && npm run build -w @cafeflow/web
cd rust
CAFEFLOW_DATA_DIR=../data cargo run -p cafeflow-api -- db setup
CAFEFLOW_DATA_DIR=../data WEB_ROOT=../apps/web/dist cargo run -p cafeflow-api -- serve
```

Or build the production image yourself:

```bash
docker build -f infra/docker/Dockerfile.rust -t cafeflow:0.2.5 .
```

## 5. First login and seeding

| Item | Value |
|---|---|
| Login URL | `/staff/login` |
The first visit to `/staff/login` shows a **setup wizard** instead of the login form: you choose the
super admin username and password and enter the **install key**. No `SEED_ADMIN_*` variable is needed.

| Item | Value |
|---|---|
| URL | `/staff/login` |
| Install key | `P70w4EslWwiFvmay6Bs1` (override with `CAFEFLOW_INSTALL_KEY`) |
| After creating | signed in automatically and redirected to `/admin` |
| Demo staff (`SEED_DEMO_STAFF=true`) | `manager`, `cashier`, `waiter`, `barista`, `kitchen` with `CafeFlow@1404` |

Notes:

1. The wizard only appears while no active user holds the `super_admin` role; afterwards it returns
   `409`. Change the password later under Account security in the panel.
2. To keep creating the admin from env, set `SEED_ADMIN_USERNAME` and `SEED_ADMIN_PASSWORD`.
3. Keep `SEED_DEMO_STAFF=false` in production.
`SEED_DEMO_MENU=true` creates a demo catalog and demo tables (`demo-table-1`, …); set it to `false`
to start with an empty menu. Inventory, finance, CRM and employees modules are disabled by default —
enable them under Settings → Modules.

## 6. Environment variables

A production-ready template lives in [`deploy.env.example`](deploy.env.example): it works unchanged,
and you pass it with `--env-file`.

| Name | Default | Purpose |
|---|---|---|
| `APP_ENV` | `development` | `production` implies `SESSION_COOKIE_SECURE=true`; `NODE_ENV` is also read |
| `PORT` | `3000` | Internal HTTP port (also used by the image healthcheck) |
| `HOST` | `0.0.0.0` | Bind interface |
| `API_PREFIX` | `/api/v1` | REST prefix |
| `WEB_ROOT` | `apps/web/dist` (`/app/public` in the image) | Built SPA root |
| `CAFEFLOW_DATA_DIR` | `data` (`/app/data` in the image) | Root of all persistent state |
| `DATABASE_PATH` | `$CAFEFLOW_DATA_DIR/cafeflow.db` | SQLite file |
| `CAFEFLOW_BACKUP_DIR` | `$CAFEFLOW_DATA_DIR/backups` | Backup directory |
| `DB_DRIVER` | `sqlite` | `sqlite` or `postgres` |
| `DATABASE_URL` | — | Required for PostgreSQL |
| `DB_POOL_MAX` | `1` (SQLite) / `10` (Postgres) | Connection pool size |
| `DB_AUTO_MIGRATE` | `true` | Run migrations on startup |
| `SESSION_COOKIE_NAME` | `cafe_session` | Session cookie name |
| `SESSION_TTL_HOURS` | `168` | Session lifetime |
| `SESSION_COOKIE_SECURE` | `true` in production | Must be `true` behind HTTPS |
| `LOGIN_MAX_ATTEMPTS` | `5` | Failed logins before lockout |
| `LOGIN_LOCK_MINUTES` | `15` | Lockout duration |
| `CAFEFLOW_INSTALL_KEY` | `P70w4EslWwiFvmay6Bs1` | Key for the first-admin wizard on `/staff/login` |
| `SEED_ADMIN_USERNAME` | — | Optional; creates the admin from env instead of the wizard |
| `SEED_ADMIN_PASSWORD` | — | Optional; empty means the wizard creates the admin |
| `SEED_DEMO_STAFF` | compose `false`, CLI `true` | Create demo staff |
| `SEED_DEMO_MENU` | `true` | Create demo catalog and tables |
| `PUBLIC_APP_URL` | — | Public origin (e.g. `https://cafe.example.com`) used in QR links when `Origin` is unavailable |
| `RUST_LOG` | `cafeflow_api=info,tower_http=info,sqlx=warn` | Log filter |

Notifications are delivered on the device itself: an in-app toast on every page (staff panel, guest
menu and order status) plus a browser/mobile notification after the user taps “Enable notifications”.
No `VAPID_*` keys or external push service are needed; a fully closed tab receives nothing.
`SMS_*` and `PRINT_BRIDGE_TOKEN` are not used for outbound SMS/print in this release; the print
bridge is an optional script that runs on a cafe PC.

## 7. Persistent data, backup and restore

```
/app/data/
  cafeflow.db        SQLite database (+ -wal / -shm)
  uploads/products/  product images uploaded by staff
  backups/           VACUUM INTO snapshots
  print-output/      receipt files (only when using the print bridge)
```

```bash
# online backup, no downtime
docker exec cafeflow cafeflow backup
docker cp cafeflow:/app/data/backups ./backups-$(date +%F)

# nightly cron example
0 3 * * * docker exec cafeflow cafeflow backup && docker cp cafeflow:/app/data/backups /srv/cafeflow-offsite/backups
```

Restore:

```bash
docker stop cafeflow
docker run --rm -v cafeflow_data:/data -v "$PWD":/restore alpine \
  sh -c 'cp /restore/cafeflow-YYYYMMDD-HHmmss.sqlite /data/cafeflow.db && rm -f /data/cafeflow.db-wal /data/cafeflow.db-shm'
docker start cafeflow
```

To reset only the database (keeping uploads), delete `cafeflow.db`, `-wal` and `-shm`, then run
`cafeflow db setup` again. This deletes every order, payment and user.

## 8. HTTPS and reverse proxy

Production cookies are `Secure`, so login only sticks over HTTPS. Minimal Caddy setup:

```caddyfile
cafe.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080
}
```

With nginx, proxy to `127.0.0.1:8080`, forward `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`, and pass
`Upgrade`/`Connection` for `/ws/games`; raise `proxy_read_timeout` for long-lived WebSockets.

Publish the container on `127.0.0.1:8080` and let the proxy terminate TLS.

**Generate QR codes from the public domain.** The menu URL inside a QR code is built from the
request's `Origin` header, so opening the admin panel via `http://localhost` produces localhost QR
codes. Either use the real domain or set `PUBLIC_APP_URL=https://cafe.example.com`.

## 9. PostgreSQL (optional)

```bash
docker run -d --name cafeflow-db --restart unless-stopped \
  -e POSTGRES_DB=cafeflow -e POSTGRES_USER=cafeflow \
  -e POSTGRES_PASSWORD='a-strong-password' \
  -v cafeflow_pg:/var/lib/postgresql/data \
  postgres:17-alpine
```

Then set `DB_DRIVER=postgres`, `DATABASE_URL=postgres://cafeflow:...@cafeflow-db:5432/cafeflow` and
`DB_POOL_MAX=10`. Migrations run automatically. Use `pg_dump` for backups — the built-in
`cafeflow backup` command only supports SQLite.

Copy an existing SQLite database into an empty PostgreSQL database:

```bash
docker run --rm -v cafeflow_data:/app/data --network host \
  -e DB_DRIVER=sqlite -e CAFEFLOW_DATA_DIR=/app/data \
  -e POSTGRES_URL='postgres://cafeflow:pass@127.0.0.1:5432/cafeflow' \
  quay.io/intelp917/cafeflow:0.2.5 db migrate-to-postgres --dry-run
# then run the same command without --dry-run
```

## 10. Image commands

| Command | Purpose |
|---|---|
| `cafeflow serve` | Run the HTTP server (default) |
| `cafeflow db setup` | Migrate + seed, idempotent |
| `cafeflow db migrate` | Migrations only |
| `cafeflow db seed` | Seed only |
| `cafeflow backup` | SQLite snapshot into `CAFEFLOW_BACKUP_DIR` |
| `cafeflow db migrate-to-postgres [--dry-run] [--force]` | Copy SQLite into PostgreSQL |

## 11. Updates and rollback

```bash
docker exec cafeflow cafeflow backup
docker pull quay.io/intelp917/cafeflow:0.2.5
docker compose up -d        # or recreate the container with the same volume
```

New migrations apply on boot; `db setup` does not reseed. To roll back, pin the previous tag (or
digest) and recreate the container; restore the pre-update backup if a migration is incompatible.

### Deployment from GitHub (Publish image)

`.github/workflows/publish-image.yml` builds and publishes the image.

1. Create a Quay Robot Account (Organization → Robot Accounts) with Write access to
   `intelp917/cafeflow`; copy its username (`intelp917+github`) and token.
2. Add repository secrets `QUAY_USERNAME` and `QUAY_PASSWORD` (the robot token, not the web
   password) under Settings → Secrets and variables → Actions.
3. Pushes to `main` or `feat/rust-backend` (and `v*` tags) run the tests and publish.

| Event | Tags |
|---|---|
| push to `main` | `latest`, `0.2.5`, `main`, `sha-xxxxxxx` |
| push to `feat/rust-backend` | `0.2.5`, `feat-rust-backend`, `sha-xxxxxxx` |
| `v1.2.3` tag | `1.2.3`, `1.2`, `1`, `0.2.5`, `sha-xxxxxxx` |

`latest` is built from `main` only. Without the secrets the image is still built but nothing is
pushed. To publish manually: Actions → Publish image → Run workflow.

On the host after a release:

```bash
docker compose pull && docker compose up -d
```

or let watchtower/cron run `docker pull`.

### Deploying on Liara (Git)

`liara.json` points Liara at the monorepo Dockerfile (`infra/docker/Dockerfile.rust`).

- In the panel the app platform must be **Docker** with port `3000`, and the `data` disk mounted at
  `/app/data`.
- Build location is `germany` so package downloads are unrestricted.
- For GitHub deploys do not put `app` or `platform` in `liara.json`; Liara detects both (the file
  the panel offers contains them, and that is what breaks the Git deploy).
- Set the variables in the panel's Environment Variables: `APP_ENV=production`,
  `SESSION_COOKIE_SECURE=true` and `PUBLIC_APP_URL=https://<domain>`; create the first admin
  through the `/staff/login` wizard.
- The first boot runs `cafeflow db setup` automatically (migrations + seed only for an empty
  database); set `CAFEFLOW_AUTO_SETUP=0` to turn it off.

## 12. Health and operations

```bash
curl -s http://127.0.0.1:8080/api/v1/health
docker logs -f --tail=200 cafeflow
docker stats --no-stream cafeflow
```

- `status: ok` and `database: ok` mean the API and database are healthy.
- Login lockout: 5 failed attempts → 15 minutes.
- Login is limited to 60 requests / 10 minutes / IP, and 5 failed passwords lock the account for 15 minutes.
- Per-device limits: 20 customer requests/min, 30 game joins/min per device and 120/min per IP for games.
- There is **no built-in per-IP cap on public order creation**; if the site is exposed to the open
  internet, add a rate limit in your reverse proxy.
- Game rooms are in memory and reset on restart (orders and data do not).
- Run exactly one container per SQLite volume.

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Login succeeds but immediately logs out | `SESSION_COOKIE_SECURE=true` over HTTP | use HTTPS, or set `false` for a trial only |
| QR codes point to `localhost` | admin panel opened via localhost | use the domain or set `PUBLIC_APP_URL` |
| `429 RATE_LIMITED` | login or per-device/game rate limit | wait a few minutes; add a proxy-level limit for public traffic |
| Container `unhealthy` | internal port changed | keep `PORT=3000` or override the healthcheck |
| `Permission denied` on `/app/data` | bind mount owned by another user | `chown -R 1000:1000 /srv/cafeflow` |
| `database is locked` | several instances on one SQLite file | run one container; use PostgreSQL to scale |
| Unauthorized after changing domain | stale cookies for the old host | clear cookies and sign in again |

## 14. Development

```bash
npm ci && npm run build:shared
npm run dev:web                  # Vite on 5173, proxying to the API
(cd rust && CAFEFLOW_DATA_DIR=../data cargo run -p cafeflow-api -- serve)

cd rust
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
```

`apps/api` (NestJS) is kept only as a historical parity reference and is not used in production.

## 15. Security notes

- Set a strong `SEED_ADMIN_PASSWORD` before the first boot; seeding only happens on an empty database.
- Keep `SEED_DEMO_STAFF=false` in production.
- Always serve over HTTPS with `Secure`/`HttpOnly`/`SameSite=Lax` cookies.
- Never commit `.env`; it is not part of the image.
- Restrict SSH and Docker access — Docker access is effectively root.
- Keep off-site backups; a volume does not protect against disk failure.

## 16. More documentation

[Architecture](docs/01-architecture.md) · [Database](docs/02-database-schema.md) · [API](docs/04-api.md) ·
[Auth](docs/05-auth-and-authorization.md) · [Modules](docs/06-modules.md) · [Printing](docs/10-printing.md) ·
[Deployment](docs/11-deployment.md) · [Backup](docs/12-backup-and-recovery.md) · [Testing](docs/13-testing.md) ·
[Environment](docs/14-environment.md) · [Table games](docs/16-table-games.md) · [Progress](docs/PROGRESS.md)
