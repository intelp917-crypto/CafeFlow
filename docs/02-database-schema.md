# ۲. اسکیمای پایگاه داده (Database Schema)

فایل مرجع: `apps/api/migrations/001_init.sql` — همه جدول‌ها از ابتدا ساخته می‌شوند؛ جدول‌های ماژول‌های اختیاری حتی وقتی ماژول خاموش است وجود دارند تا با فعال/غیرفعال کردن، داده‌ای از بین نرود.

## قواعد ثابت

- **پول**: `INTEGER` ریال. هیچ ستون پولی `REAL` نیست.
- **شناسه**: `TEXT` حاوی UUID تولیدشده در برنامه.
- **زمان**: رشته ISO-8601 در UTC. نمایش جلالی/تهران فقط در لایه ارائه.
- **FK**: `PRAGMA foreign_keys = ON` در هر اتصال؛ حذف‌های آبشاری فقط برای داده‌های فرزند واقعی.
- **حذف نرم**: `deleted_at` روی `users`, `categories`, `products`, `dining_tables`, `customers`.
- **حسابرسی**: `audit_logs` فقط افزودنی؛ هیچ مسیری آن را ویرایش نمی‌کند.

## گروه‌ها

### هویت و دسترسی
`users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `sessions`, `audit_logs`, `approval_requests`

- `users.password_hash` با scrypt (`scrypt$N$salt$hash`).
- `sessions.token_hash` = SHA-256 توکن تصادفی؛ توکن خام هرگز ذخیره نمی‌شود.
- `users.locked_until` + `failed_login_attempts` برای قفل موقت پس از تلاش‌های ناموفق.

### سازمان و سالن
`employees`, `departments`, `floors`, `areas`, `dining_tables`, `table_sessions`, `table_merge_members`,
`floorplans`, `floorplan_versions`, `floorplan_objects`, `chairs`

- ایندکس یکتای جزئی `ux_table_open_session` تضمین می‌کند هر میز حداکثر یک نشست باز داشته باشد:
  `CREATE UNIQUE INDEX ux_table_open_session ON table_sessions (table_id) WHERE status = 'open'`.
- `dining_tables.qr_token` یکتا؛ ردیف متناظر در `qr_codes` نوع `table`.

### منو
`categories`, `products`, `product_variants`, `option_groups`, `product_options`, `extras`,
`product_extras`, `product_images`, `availability_windows`

- `products.search_key` نسخه نرمال‌شده فارسی نام است (ي→ی، ك→ک، ارقام عربی→لاتین) تا جست‌وجوی «كيك» و «کیک» یک نتیجه بدهد.
- `products.department_id` مقصد آماده‌سازی (باریستا/آشپزخانه/بار) را تعیین می‌کند.

### QR و تخفیف
`qr_codes` (نوع `table` یا `promo` با CHECK سازگاری), `campaigns`, `campaign_targets`,
`campaign_redemptions`, `customer_devices`

- `customer_devices.token_hash` شناسه شبه‌ناشناس سمت سرور؛ هیچ شناسه سخت‌افزاری خوانده نمی‌شود.

### سفارش
`orders`, `order_items`, `order_item_options`, `prep_tasks`, `order_events`

- `orders.status` با CHECK هم‌راستا با ماشین وضعیت `packages/shared/src/order-state.ts`.
- ایندکس یکتای `(guest_device_id, client_request_id)` از ثبت تکراری سفارش جلوگیری می‌کند.
- `order_items` قیمت و نام را در لحظه ثبت **snapshot** می‌کند؛ تغییر بعدی منو گذشته را تغییر نمی‌دهد.
- `order_events` تاریخچه فقط افزودنی انتقال‌ها.

### پرداخت
`bills`, `payments`, `bill_splits`, `cash_registers`, `terminal_requests`

- `payments.amount > 0`، `status` قابل بازگشت (`refunded`) نه حذف.

### سرویس
`customer_requests`, `reservations`

### عملیات
`notifications`, `notification_templates`, `notification_outbox`, `push_subscriptions`,
`printers`, `print_jobs`, `settings`, `module_settings`

- `settings` تک‌ردیفی است (`CHECK (id = 'singleton')`).
- `module_settings` منبع وضعیت فعال/غیرفعال ماژول‌ها؛ `ModuleGuard` آن را می‌خواند.

### ماژول‌های اختیاری (پیش‌فرض خاموش)
- انبار: `measurement_units`, `ingredients`, `recipes`, `recipe_items`, `suppliers`, `purchases`, `purchase_items`, `stock_movements`, `waste_records`
- مالی: `financial_transactions` (تغییرناپذیر؛ اصلاح با تراکنش معکوس), `expenses`, `cash_sessions`
- CRM: `customers`, `loyalty_accounts`, `loyalty_ledger`, `wallet_ledger`

## ایندکس‌های کلیدی

```sql
idx_orders_status_created      (status, created_at DESC)
idx_orders_table_status        (table_id, status)
idx_order_items_department     (department_id, status)
idx_prep_tasks_department_status (department_id, status, created_at)
idx_payments_paid_at           (paid_at DESC)
idx_audit_created              (created_at DESC)
idx_sessions_expires           (expires_at)
idx_customer_requests_table_status (table_id, status)
```

## مهاجرت‌ها

- فایل‌ها: `apps/api/migrations/NNN_name.sql` (ترتیب عددی).
- اجرا: `npm run db:migrate` یا خودکار در بوت `DatabaseService`.
- هر فایل در یک تراکنش اجرا و در `schema_migrations` ثبت می‌شود.
- قواعد: مهاجرت‌های اعمال‌شده هرگز ویرایش نمی‌شوند؛ تغییر جدید = فایل جدید.
- انتقال به PostgreSQL در فاز ۷: همان اسکیما با `TEXT`→`text`، `INTEGER`→`integer`، `REAL`→`numeric`،
  `strftime`→`now()`، و ایندکس‌های جزئی که PostgreSQL نیز پشتیبانی می‌کند.

## تراکنش و همزمانی

- ثبت سفارش، تسویه، کسر انبار و تصمیم تأیید در `database.transaction(...)` اجرا می‌شوند.
- حالت WAL امکان خواندن هم‌زمان با یک نویسنده را می‌دهد؛ `busy_timeout = 5000` در رقابت نوشتن صبر می‌کند.
- برای جلوگیری از کسر مضاعف انبار در سفارش‌های هم‌زمان، به‌روزرسانی موجودی با شرط `current_qty >= ?` انجام می‌شود و صفر ردیف تغییر یافته یعنی شکست تراکنش.
