# ۱۴. راهنمای تنظیمات محیط

## فایل‌ها

- `.env.example` — الگوی کامل با توضیح هر متغیر (بدون مقدار حساس).
- `.env` — مقادیر واقعی؛ **commit نمی‌شود** (در `.gitignore`).
- API هنگام بوت، `.env` را از پوشه اجرا یا ریشه مخزن می‌خواند (`process.loadEnvFile`).

## متغیرها

| نام | پیش‌فرض | توضیح |
|---|---|---|
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `PORT` | `3000` | پورت API؛ مقدار نامعتبر (۰ یا خارج از بازه) به ۳۰۰۰ برمی‌گردد |
| `HOST` | `0.0.0.0` | رابط شنود API؛ `0.0.0.0` یعنی از شبکهٔ محلی هم در دسترس است، `127.0.0.1` یعنی فقط همین دستگاه |
| `API_PREFIX` | `/api/v1` | پیشوند مسیرها |
| `CAFEFLOW_DATA_DIR` | `../../data` | **ریشهٔ پایدار داده‌ها**؛ در Docker روی volume با مسیر `/app/data`، در استقرار بدون Docker مسیر مطلق روی دیسک پایدار |
| `DATABASE_PATH` | `$CAFEFLOW_DATA_DIR/cafeflow.db` | بازنویسی اختیاری فایل پایگاه داده |
| `CAFEFLOW_BACKUP_DIR` | `$CAFEFLOW_DATA_DIR/backups` | محل پشتیبان‌ها |
| `PRINT_OUTPUT_DIR` | `$CAFEFLOW_DATA_DIR/print-output` | خروجی پل چاپ (فقط اسکریپت پل) |
| `SESSION_COOKIE_NAME` | `cafe_session` | نام کوکی نشست |
| `SESSION_TTL_HOURS` | `168` | عمر نشست (۷ روز) |
| `SESSION_COOKIE_SECURE` | `false` | در تولید `true` (نیازمند HTTPS) |
| `LOGIN_MAX_ATTEMPTS` | `5` | تلاش ناموفق پیش از قفل |
| `LOGIN_LOCK_MINUTES` | `15` | مدت قفل حساب |
| `SEED_ADMIN_USERNAME` | `admin` | نام کاربری مدیر اولیه |
| `SEED_ADMIN_PASSWORD` | `CafeFlow@1404` | گذرواژه مدیر اولیه — **تغییر دهید** |
| `SEED_DEMO_STAFF` | `true` | ساخت کارکنان نمونه در نصب اولیه |
| `SMS_PROVIDER` / `SMS_API_KEY` | خالی | فاز ۵؛ خالی ⇒ ارسال پیامک no-op |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | خالی | فاز ۵؛ اعلان مرورگر |
| `PRINT_BRIDGE_TOKEN` | خالی | فاز ۴؛ توکن پل چاپ |

## قواعد امنیتی

1. هیچ رمز، توکن یا کلیدی در کد یا مستندات نوشته نمی‌شود.
2. `.env` فقط روی سرور با دسترسی محدود (chmod 600) نگه‌داری می‌شود.
3. گذرواژه‌های نمونه (`CafeFlow@1404`) تنها برای نصب توسعه‌اند و **قبل از استفاده واقعی** باید تغییر کنند.
4. مقادیر حساس در لاگ‌ها چاپ نمی‌شوند؛ `password_hash` هرگز در پاسخ API نیست.
5. در تولید `NODE_ENV=production` جلوی seed خودکار را می‌گیرد؛ داده اولیه را آگاهانه با `npm run db:setup` بسازید.

## مسیرهای داده

همهٔ وضعیت زمان اجرا زیر یک ریشه است (`CAFEFLOW_DATA_DIR`)؛ پیش‌فرض توسعه `data/` در ریشهٔ مخزن است:

```
$CAFEFLOW_DATA_DIR/
  cafeflow.db            پایگاه داده اصلی
  cafeflow.db-wal        تراکنش‌های در جریان WAL
  cafeflow.db-shm        حافظه مشترک
  backups/               نسخه‌های پشتیبان (VACUUM INTO)
  print-output/          فایل‌های رسید پل چاپ
```

در تولید این ریشه باید یک مسیر مطلق بیرون از پوشهٔ پروژه و روی دیسک پایدار باشد (`/app/data`
در Compose، از volume‌ای به نام `data`). جزئیات و چک‌لیست ریستارت در `docs/11-deployment.md`.

## پیش از استقرار

```bash
cp .env.example .env
# مقادیر را ویرایش کنید: SEED_ADMIN_PASSWORD, SESSION_COOKIE_SECURE=true
npm run db:setup -w @cafeflow/api
```
