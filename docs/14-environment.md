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
| `API_PREFIX` | `/api/v1` | پیشوند مسیرها |
| `DATABASE_PATH` | `../../data/cafeflow.db` | نسبت به پوشه اجرای API (`apps/api`) |
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

```
data/cafeflow.db        پایگاه داده اصلی
data/cafeflow.db-wal    تراکنش‌های در جریان WAL
data/cafeflow.db-shm    حافظه مشترک
backups/                نسخه‌های پشتیبان (خارج از کنترل نسخه)
```

## پیش از استقرار

```bash
cp .env.example .env
# مقادیر را ویرایش کنید: SEED_ADMIN_PASSWORD, SESSION_COOKIE_SECURE=true
npm run db:setup -w @cafeflow/api
```
