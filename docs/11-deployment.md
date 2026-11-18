# ۱۱. راهنمای استقرار

> **مهم:** در محیط توسعه فعلی Docker نصب نیست؛ فایل‌های `infra/docker` نوشته شده‌اند اما
> **اجرا و تأیید نشده‌اند**. مسیر بدون Docker در همین محیط آزموده شده است.

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
- فایل پایگاه داده: `data/cafeflow.db` (به همراه `-wal` و `-shm`).

## ب) Docker Compose (نوشته‌شده، تأیید نشده)

```bash
cd infra/docker
docker compose --env-file ../../.env up -d --build
```

سرویس‌ها:

| سرویس | تصویر | نقش |
|---|---|---|
| `api` | `Dockerfile.api` (node:24-slim, multi-stage) | NestJS + SQLite |
| `web` | `Dockerfile.web` (vite build → nginx) | SPA + پروکسی `/api` |
| `backup` | `alpine` + `sqlite3` (cron) | نسخه پشتیبان روزانه |

- داده در volume `cafeflow_data` نگه‌داری می‌شود (`/data/cafeflow.db`).
- وب با nginx سرو می‌شود؛ `nginx.conf` مسیرهای SPA و پروکسی API را مدیریت می‌کند.
- **پیش از استفاده واقعی:** تصاویر را بسازید، `SESSION_COOKIE_SECURE=true` بگذارید و پشت HTTPS (Caddy/nginx + گواهی) قرار دهید.

## ج) تولید در سرور (Docker یا سرور فیزیکی)

1. `NODE_ENV=production` و `SESSION_COOKIE_SECURE=true`.
2. `SEED_ADMIN_PASSWORD` قوی تنظیم کنید یا پس از `db:setup` گذرواژه را از رابط تغییر دهید.
3. مهاجرت‌ها را با `npm run db:migrate` اجرا کنید (خودکار در بوت هم اجرا می‌شوند).
4. پشتیبان‌گیری را فعال کنید (docs/12).
5. HTTPS را با reverse proxy تأمین کنید؛ کوکی `Secure` بدون HTTPS کار نمی‌کند.
6. پل چاپ را روی رایانه‌ای در شبکه رستوران اجرا و توکن آن را تنظیم کنید (فاز ۴).

## بررسی سلامت

```bash
curl -s http://localhost:3000/api/v1/health
# {"status":"ok","database":"ok",...}
```

## نکات عملیاتی

- **یک نسخه API** بنویسید؛ SQLite یک نویسنده در هر لحظه دارد و برای یک رستوران کافی است، اما چند نمونه API روی یک فایل توصیه نمی‌شود.
- مسیر مهاجرت PostgreSQL (فاز ۷) برای چند شعبه/بار بالا آماده است.
- فایل‌های `.env` هرگز commit نمی‌شوند (`.gitignore`).
