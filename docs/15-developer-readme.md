# ۱۵. راهنمای توسعه‌دهنده

## پیش‌نیازها

- Node.js ۲۲ یا بالاتر (توسعه با ۲۴ انجام شده)
- npm ۱۰+
- اختیاری: Docker Desktop برای استقرار کانتینری (استک `infra/docker` با آن اجرا و تأیید شده است)

## راه‌اندازی

```bash
npm install                # نصب همه workspaces
npm run build:shared       # پکیج مشترک باید پیش از API ساخته شود
npm run db:setup -w @cafeflow/api
npm run dev:api            # http://localhost:3000
npm run dev:web            # http://localhost:5173
```

حساب اولیه: `admin` / `CafeFlow@1404` (یا `SEED_ADMIN_PASSWORD`). کارکنان نمونه:
`manager`, `cashier`, `waiter`, `barista`, `kitchen` با گذرواژه `CafeFlow@1404`.

### دسترسی از موبایل روی شبکهٔ محلی

`npm start` و سرورهای بالا روی `0.0.0.0` گوش می‌دهند، پس همان برنامه از گوشی یا
رایانهٔ دیگری در همان Wi-Fi با `http://<ip-دستگاه>:5173` باز می‌شود؛ آدرس‌ها هنگام
`npm start` چاپ می‌شوند. اگر ویندوز درخواست کرد، در فایروال برای Node اجازهٔ
شبکهٔ خصوصی بدهید. برای استک کانتینری همین کار با `http://<ip-دستگاه>:8080`
انجام می‌شود و `SESSION_COOKIE_SECURE` باید `false` باشد (HTTP ساده).

## ساختار مخزن

```
apps/api/src
  common/        guardها، خطاها، کوکی، رمزنگاری، دکوراتورها، توکن‌های تزریق
  config/        خواندن و اعتبارسنجی محیط
  db/            اتصال SQLite، اجرای مهاجرت، seed، CLI
  modules/       auth, audit, dashboard, settings, users, approvals, inventory, health
  app.module.ts  ثبت ماژول‌ها و APP_GUARDها
apps/api/migrations    فایل‌های SQL (فقط افزودنی)
apps/api/test          آزمون‌های یکپارچه با پایگاه داده موقت

apps/web/src
  lib/           api client، context احراز هویت، قالب‌بندی فارسی، برچسب‌ها
  layouts/       پوسته مدیریت RTL
  pages/         ورود، داشبورد، ماژول‌ها، کارکنان، تأییدها، رویدادها، تنظیمات، گذرواژه
packages/shared  منطق دامنه مشترک (تست‌شده و بدون وابستگی به فریم‌ورک)
packages/ui      کامپوننت‌های RTL-first
```

## قواعد کدنویسی

### زبان
- کد، نام متغیر/تابع، شناسه پایگاه داده، مسیر API، لاگ فنی و کامنت: **انگلیسی**.
- هر متن قابل مشاهده برای کاربر (برچسب، پیام خطا، وضعیت): **فارسی**.
- پیام خطای API فارسی است چون مستقیم نمایش داده می‌شود؛ `code` انگلیسی و پایدار.

### تزریق وابستگی
`emitDecoratorMetadata` خاموش است، بنابراین **همه پارامترهای سازنده باید `@Inject(TOKEN)` داشته باشند**:

```ts
constructor(
  @Inject(DB_SERVICE) private readonly database: DatabaseService,
  @Inject(AuditService) private readonly audit: AuditService,
) {}
```

دلیل: کد باید در `tsc`، `tsx` (dev) و `vitest` (esbuild) یکسان کار کند.

### دسترسی به داده
- SQL فقط در repository/service و فقط پارامتری.
- عملیات چندمرحله‌ای در `database.transaction(...)`.
- مبلغ همیشه عدد صحیح ریال؛ هیچ محاسبه مالی از کلاینت پذیرفته نمی‌شود.

### امنیت
- مسیر جدید به‌صورت پیش‌فرض خصوصی است؛ برای عمومی‌کردن `@Public()` لازم است.
- مجوزها با `@Permissions('…')`؛ ماژول اختیاری با `@RequireModule('…')`.
- عملیات حساس باید `audit.record(...)` در همان مسیر اجرا کند.

### UI
- فقط خصوصیات منطقی CSS (`ms/me`, `ps/pe`, `start/end`) برای پشتیبانی RTL.
- تاریخ با `formatJalali`، مبلغ با `formatRial`؛ هیچ قالب‌بندی دستی تاریخ.
- هر صفحه باید حالت بارگذاری، خالی و خطا داشته باشد.

## افزودن یک endpoint جدید

1. سرویس + repository در ماژول مربوط.
2. کنترلر با `@Permissions(...)` و `parseWith(schema, body)`.
3. در صورت داشتن ماژول اختیاری: `@RequireModule('key')`.
4. ثبت در `docs/04-api.md`.
5. آزمون یکپارچه (دسترسی مجاز/غیرمجاز).

## افزودن یک مهاجرت

```bash
# فایل جدید بسازید؛ هرگز فایل اعمال‌شده را ویرایش نکنید
apps/api/migrations/002_add_something.sql
npm run db:migrate -w @cafeflow/api
```

قواعد: `IF NOT EXISTS` برای ایندکس‌ها، `NOT NULL` با `DEFAULT` برای جدول‌های موجود، سازگاری با PostgreSQL در حد امکان.

## افزودن یک ماژول اختیاری

1. کلید را در `packages/shared/src/modules.ts` اضافه کنید (`defaultEnabled: false`, `configurable: true`).
2. جدول‌ها را در یک مهاجرت جدید بسازید.
3. endpointها را با `@RequireModule('key')` بپوشانید.
4. وابستگی به هسته را از طریق رویداد انجام دهید، نه import مستقیم.
5. آزمون چرخه فعال/غیرفعال با حفظ داده.

## عیب‌یابی

| نشانه | علت احتمالی | راه‌حل |
|---|---|---|
| `Cannot resolve dependencies` | پارامتر سازنده بدون `@Inject` | توکن را اضافه کنید |
| API روی پورت تصادفی | `PORT=0` در محیط | متغیر را تنظیم کنید؛ مقدار نامعتبر به ۳۰۰۰ برمی‌گردد |
| خطای قفل SQLite در تست | اجرای موازی فایل‌ها | `fileParallelism: false` فعال است؛ فایل تست جدید بسازید نه تست در همان فایل |
| کوکی ست نمی‌شود در dev | دسترسی مستقیم به ۳۰۰۰ به‌جای ۵۱۷۳ | از `http://localhost:5173` استفاده کنید |
| `tsc` خطای type در web | `@cafeflow/shared` ساخته نشده | `npm run build:shared` |

## مستندات مرتبط

`docs/01` معماری · `docs/02` پایگاه داده · `docs/03` ERD · `docs/04` API · `docs/05` امنیت ·
`docs/06` ماژول‌ها · `docs/07` طراحی · `docs/08` نقشه سالن · `docs/09` چرخه سفارش ·
`docs/10` چاپ · `docs/11` استقرار · `docs/12` پشتیبان · `docs/13` آزمون · `docs/14` محیط ·
`docs/PROGRESS.md` وضعیت و تصمیم‌ها
