# ۴. مستندات API

پیشوند پایه: `/api/v1` (قابل تغییر با `API_PREFIX`).
قالب خطا:

```json
{ "error": { "code": "UNAUTHORIZED", "message": "پیام فارسی", "details": [] } }
```

همه پیام‌های `message` فارسی و نمایش‌پذیرند؛ `code` پایدار و ماشینی است.

## احراز هویت

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| POST | `/auth/login` | عمومی | `{ username, password }`؛ کوکی `HttpOnly` ست می‌کند |
| POST | `/auth/logout` | عمومی | نشست فعلی را باطل و کوکی را پاک می‌کند |
| GET | `/auth/me` | نشست | کاربر، نقش‌ها، مجوزها، ماژول‌های فعال |
| GET | `/auth/sessions` | نشست | نشست‌های فعال خود کاربر |
| DELETE | `/auth/sessions/:id` | خود یا `sessions.manage` | بستن نشست |
| POST | `/auth/password` | نشست | `{ currentPassword, newPassword, confirmPassword }` |

پاسخ ورود:

```json
{
  "user": { "id": "…", "username": "admin", "fullName": "مدیر ارشد",
            "roles": ["super_admin"], "permissions": ["dashboard.read", "…"],
            "mustChangePassword": false },
  "modules": ["ordering", "qr_menu", "security"]
}
```

## سلامت

| GET | `/health` | عمومی | `{ status, database, time, version }` |

## داشبورد

| GET | `/dashboard/overview` | `dashboard.read` | فروش امروز (بازه روز تهران)، سفارش‌های فعال/تأخیری، میزها، درخواست‌ها، رزروها، آخرین سفارش‌ها و رویدادها |

## ماژول‌ها و تنظیمات

| GET | `/modules` | `modules.read` | فهرست ماژول‌ها با وضعیت و قابلیت پیکربندی |
| PATCH | `/modules/:key` | `modules.manage` | `{ enabled: boolean }`؛ ماژول هسته ۴۰۳، وابستگی غیرفعال ۴۰۹ |
| GET | `/settings` | `settings.read` | نام مجموعه، واحد پول، حالت ارقام، حق سرویس، مالیات، نشانی و مختصات نقشه |
| PATCH | `/settings` | `settings.write` | تغییر فیلدهای مجاز + ثبت حسابرسی قبل/بعد |

## کارکنان و نقش‌ها

| GET | `/users` | `users.read` | کارکنان با نقش‌ها و آخرین ورود |
| GET | `/roles` | `roles.read` | نقش‌ها با تعداد مجوز و کاربر |
| GET | `/permissions` | `roles.read` | فهرست مجوزها گروه‌بندی‌شده با برچسب فارسی |

## صف تأیید

| GET | `/approvals?status=` | `approvals.read` | درخواست‌ها (پیش‌فرض همه، مرتب: در انتظار اول) |
| POST | `/approvals/:id/decision` | `approvals.decide` | `{ decision: "approved" \| "rejected", note? }`؛ رد بدون دلیل ۴۰۰ |

## گزارش رویدادها

| GET | `/audit?page=&pageSize=&action=&actor=` | `audit.read` | صفحه‌بندی‌شده، جدیدترین اول |

## انبار (ماژول، پیش‌فرض خاموش)

| GET | `/inventory/overview` | `inventory.read` + ماژول فعال | شمارش مواد اولیه، کمبود، تأمین‌کننده، حرکت امروز |

## سطح مشتری (بدون نشست)

این مسیرها با `@Public()` باز هستند چون مشتری پشت میز حساب کاربری ندارد. امنیت آن‌ها از مسیرهای
زیر می‌آید، نه از توکن نشست: توکن QR میز، بازمحاسبه کامل مبلغ سمت سرور، کوکی شبه‌ناشناس دستگاه و
محدودیت نرخ. هیچ داده مدیریتی (کارکنان، فروش، انبار) از این مسیرها بیرون نمی‌رود.

| متد | مسیر | توضیح |
|---|---|---|
| GET | `/public/branding` | نام، لوگو، نشانی، تلفن و مختصات کافه از تنظیمات؛ مبنای سایدبار، breadcrumb، عنوان صفحه، کارت نقشه و manifest |
| GET | `/public/product-images/:file` | تصویر آپلودی محصول (PNG/JPEG/WebP) با کش `immutable`؛ نام فایل UUID است و مسیر بیرون از پوشه خوانده نمی‌شود |
| GET | `/public/menu?qr=<token>` | منوی همان میز: رستوران، دسته‌ها، محصولات، گروهِ گزینه‌ها، گزینه‌ها، افزودنی‌ها، در دسترس بودن بر اساس `availability_windows` به وقت تهران |
| POST | `/public/orders` | ثبت سفارش؛ `201` با `{ id, code, status, total, itemCount, tableNameFa, replayed, statusToken }` |
| POST | `/public/orders/:code/items?token=` | افزودن دور جدید به همان سفارش؛ `{ clientRequestId, items }`؛ قیمت سمت سرور، تکرار با همان `clientRequestId` بی‌اثر و پس از `ready`/`served` خطای `ORDER_NOT_EDITABLE` |
| GET | `/public/orders/:code?token=` | وضعیت سفارش برای صفحه پیگیری (اقلام، مبالغ، دلیل لغو)؛ `token` برای سفارش‌های تازه الزامی است |
| POST | `/public/requests` | درخواست مشتری: `waiter` \| `water` \| `tissues` \| `bill` \| `terminal` |
| POST | `/public/terminal-requests` | درخواست کارت‌خوان؛ ردیف در `terminal_requests` + اعلان صندوق |

ورودی سنگین سفارش:

```json
{
  "qrToken": "KWKQ7vo5e4hrLxVOmklllwR8",
  "clientRequestId": "a-uuid-generated-once-by-the-client",
  "note": "همه با هم سرو شود",
  "items": [
    { "productId": "…", "quantity": 2, "optionIds": ["…"], "extraIds": ["…"], "note": "شیر گرم‌تر" }
  ]
}
```

قواعد این مسیر:

- **قیمت از کلاینت پذیرفته نمی‌شود.** `unitPrice = base_price + Σ price_delta + Σ extra.price`، همه از
  پایگاه داده خوانده و در `order_items.unit_price_snapshot` نگه‌داری می‌شود.
- **idempotency**: ایندکس یکتای `ux_orders_idempotency (guest_device_id, client_request_id)`؛ ارسال
  دوباره همان پاسخ را با `replayed: true` برمی‌گرداند و سفارش دوم ساخته نمی‌شود.
- **گروهِ الزامی**: اگر گروهِ `required` بدون گزینه باشد `400 OPTION_REQUIRED`؛ گزینه/افزودنی متعلق به
  محصول دیگر `400 OPTION_INVALID` / `EXTRA_INVALID`.
- **ناموجود**: محصول حذف‌شده `400 PRODUCT_UNAVAILABLE`، محصول خاموش‌شده `409 PRODUCT_UNAVAILABLE`.
- **QR نامعتبر/غیرفعال**: `404 QR_NOT_FOUND` (همان پیام، بدون افشای این‌که کد وجود دارد یا نه).
- **پیامدها در یک تراکنش**: سفارش + آیتم‌ها + `prep_tasks` به تفکیک دپارتمان + اعلان‌ها + بازکردن
  `table_sessions` و اشغال میز.
- **محدودیت نرخ**: ۶ سفارش در ۱۰ دقیقه برای هر دستگاه، ۴۰ سفارش در ۱۰ دقیقه برای هر IP؛
  درخواست‌ها ۱۲ در دقیقه برای دستگاه و ۳۰ در دقیقه برای IP. عبور از سقف `429 RATE_LIMITED`.

**کوکی دستگاه:** `cafe_device` با `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` یک سال و `Secure` در
تولید. توکن تصادفی است و فقط `sha256` آن در `customer_devices` ذخیره می‌شود. اگر کلاینت توکنی بفرستد که
سرور صادر نکرده باشد، نادیده گرفته و توکن تازه صادر می‌شود (کلاینت نمی‌تواند هویت دستگاه را انتخاب کند).

**توکن وضعیت سفارش:** هنگام ساخت سفارش، سرور یک توکن تصادفی ۲۴ بایتی برمی‌گرداند و فقط
`sha256` آن را در `orders.status_token_hash` نگه می‌دارد. صفحهٔ پیگیری باید همان توکن را در `?token=`
بفرستد؛ توکن نادرست یا جاافتاده همان `404 ORDER_NOT_FOUND` را می‌دهد تا کسی با آزمودن خطاها کدها را
پیدا نکند. توکن فقط یک بار (هنگام ساخت) صادر می‌شود و در رابط مشتری در `sessionStorage` همان تب
می‌ماند، پس لینک به‌اشتراک‌گذاشته‌شده توکن را لو نمی‌دهد. سفارش‌های پیش از مهاجرت ۱۱ (یا رسیدهای
چاپی قدیمی) `status_token_hash = NULL` دارند و مثل قبل با کد خوانده می‌شوند.

**محدودیت نرخ مسیر وضعیت:** فقط پاسخ‌های ناموفق (کد ناموجود یا توکن نادرست) برای هر IP شمرده می‌شوند؛
پس از ۱۲۰ خطا در ۱۰ دقیقه پاسخ `429 RATE_LIMITED` می‌آید. درخواست موفق با توکن درست هرگز به این بودجه
دست نمی‌زند، چون مشتری واقعی همان سفارش را هر ۱۵ ثانیه می‌پرسد و خطا تولید نمی‌کند. کد سفارش ۶ کاراکتر
از الفبای ۳۲ حرفی است؛ شمارش کدها با این بودجه در عمل محدود می‌شود، اما مسیر وضعیت همچنان یک نقطهٔ
شمارش ممکن است و ضد‌تکرار در حافظهٔ فرایند است.

## عملیات کارکنان (فاز ۳)

این مسیرها نیازمند نشست و مجوز صریح هستند. UI فقط دکمه‌هایی را نشان می‌دهد که مجوزشان وجود دارد،
اما مرجع نهایی همیشه سرور است.

| متد | مسیر | مجوز | توضیح |
|---|---|---|---|
| GET | `/orders?scope=active\|all&status=&tableId=&kind=&q=&page=&pageSize=` | `orders.read` | صف سفارش‌ها با شمارش آماده‌سازی، پرچم تأخیر و صفحه‌بندی |
| GET | `/orders/:id` | `orders.read` | اقلام، گزینه‌ها/افزودنی‌ها، وضعیت آماده‌سازی هر آیتم، تاریخچه و انتقال‌های مجاز |
| POST | `/orders` | `orders.write` | سفارش دستی کارمند: `{ tableId?, note?, items: [{ productId, quantity, optionIds?, extraIds?, note? }] }`؛ قیمت‌ها از منوی زنده سمت سرور محاسبه و سفارش `confirmed` ثبت می‌شود |
| PATCH | `/orders/:id/items/:itemId` | `orders.write` | `{ quantity }`: جایگزینی تعداد یا `0` برای حذف قلم؛ جمع‌ها از اقلام باقی‌مانده بازمحاسبه و وظیفهٔ آماده‌سازی لغو می‌شود؛ پس از سرو `409` |
| POST | `/orders/:id/items` | `orders.write` | افزودن دور بعدی به سفارش باز؛ همان ساختار `items`، جمع‌ها و صورت‌حساب باز بازمحاسبه می‌شوند؛ سفارش بسته `409 ORDER_CLOSED` |
| POST | `/orders/:id/transition` | `orders.write` (و `orders.cancel` برای لغو) | `{ to, reason? }` |
| GET | `/prep/queue?kind=barista\|kitchen\|bar\|other&includeFinished=` | `prep.read` | صف آیتم‌های آماده‌سازی با زمان سپری‌شده و تأخیر |
| POST | `/prep/:id/transition` | `prep.update` | `{ to: queued\|in_progress\|ready\|delayed\|cancelled }` |
| GET | `/tables` | `layout.read` | وضعیت زنده میزها، نشست باز، سفارش فعال، مبلغ باز، درخواست در انتظار |
| GET | `/service-requests?status=pending\|all` | `orders.read` | درخواست‌های مشتری |
| POST | `/service-requests/:id/status` | `orders.write` | `{ status: accepted\|done\|cancelled }`؛ هر درخواست یک بار بسته می‌شود |
| GET | `/terminal-requests?status=pending\|all` | `payments.read` | درخواست‌های کارت‌خوان |
| POST | `/terminal-requests/:id/complete` | `payments.create` | تحویل کارت‌خوان |

قواعد انتقال:

- انتقال غیرمجاز طبق ماشین وضعیت: `409 ORDER_TRANSITION_INVALID`.
- `to: "paid"`: `409 PAYMENT_REQUIRED` — پرداخت و تسویه در فاز ۴.
- `to: "partially_ready"`: `400 DERIVED_STATUS` — این وضعیت فقط از صف آماده‌سازی مشتق می‌شود.
- لغو: مجوز `orders.cancel` + دلیل غیرخالی، وگرنه `403 PERMISSION_DENIED` / `400 CANCEL_REASON_REQUIRED`؛
  سپس آیتم‌ها و وظایف آماده‌سازی لغو می‌شوند، اگر سفارش فعال دیگری روی میز نباشد نشست بسته و میز آزاد
  می‌شود، و `order.cancelled` در گزارش حسابرسی ثبت می‌شود.
- سفارش پایانی (`paid`/`cancelled`): `409 ORDER_CLOSED`.

خودکارسازی آماده‌سازی (همه از مسیر مجاز ماشین وضعیت عبور می‌کنند و `order.status_auto` ثبت می‌شود):

| رویداد | اثر روی سفارش |
|---|---|
| شروع یک آیتم | `confirmed → preparing` (اگر سفارش هنوز `submitted` باشد، `confirmed` هم خودکار ثبت می‌شود) |
| آماده‌شدن بخشی | `preparing → partially_ready` |
| آماده‌شدن همه | `ready` + اعلان به گارسون |
| لغو همه| `cancelled` |
| `served → awaiting_payment` (دستی) | اعلان به صندوق + وضعیت میز `waiting_payment` |

بدون بلادرنگ: صفحه‌های عملیاتی با polling (۸–۱۰ ثانیه) تازه می‌شوند؛ WebSocket ادعا نمی‌شود.

## صندوق، تسویه و بستن میز (فاز ۴)

| متد | مسیر | مجوز | توضیح |
|---|---|---|---|
| GET | `/orders/:id/payments` | `payments.read` | صورت‌حساب، مجموع پرداخت‌شده، مانده و تاریخچه پرداخت |
| POST | `/orders/:id/payments` | `payments.create` | `{ method, amount, reference?, splitId? }`؛ با `splitId` مبلغ باید دقیقاً برابر همان سهم باشد و همان سهم تسویه می‌شود؛ `201` با همان نمای صورت‌حساب |
| POST | `/tables/:id/close` | `layout.write` یا `payments.create` | بستن نشست میز بعد از تسویه کامل |
| POST | `/terminal-requests/:id/complete` | `payments.create` | `{ orderId?, method?, amount? }` — پرداخت کارتی + تکمیل درخواست |

### قواعد پرداخت

- فقط سفارش‌های `served` و `awaiting_payment` پرداخت می‌پذیرند؛ زودتر از سرو: `409 ORDER_NOT_PAYABLE`.
- مبلغ ارسالی باید عدد صحیح ریال و بیشتر از صفر باشد؛ بیشتر از مانده: `400 PAYMENT_EXCEEDS_REMAINING`.
  اعشار یا مبلغ صفر با `400 VALIDATION_FAILED` رد می‌شود.
- **صورتحساب (`bills`) در اولین پرداخت ساخته می‌شود** و تا رسیدن مجموع به مبلغ سفارش `open` می‌ماند؛
  با تسویه کامل `settled` و `settled_at` پر می‌شود. `orders.paid_total` همیشه از مجموع پرداخت‌های تأییدشده
  **منهای بازپرداخت‌ها** بازمحاسبه می‌شود، نه از مقدار ارسالی کلاینت.
- سفارش وقتی به `paid` می‌رود که مجموع پرداخت‌ها به مبلغ کل برسد (در همان تراکنش)؛ پرداخت جزئی سفارش را
  `awaiting_payment` می‌کند. پرداخت دوباره روی سفارش تسویه‌شده `409 ORDER_ALREADY_PAID` است.
- سفارش لغوشده پرداخت نمی‌پذیرد (`409 ORDER_CLOSED`).
- حسابرسی: `payment.recorded`، `payment.settled`، `order.paid` با مقدار قبل/بعد و روش پرداخت.

### بستن میز

- بدون نشست باز: `409 TABLE_NO_OPEN_SESSION`.
- اگر هر سفارش نشست تسویه یا لغو نشده باشد: `409 TABLE_HAS_UNPAID_ORDERS` با `details` شامل کد، وضعیت
  و مانده هر سفارش. بستن، نشست را `closed` و میز را `available` می‌کند و `table.closed` ثبت می‌شود.
- لغو آخرین سفارش میز، نشست را خودکار می‌بندد؛ پس از آن بستن دستی نمی‌تواند انجام شود (همان ۴۰۹).

### تکمیل درخواست کارت‌خوان

- سفارش هدف به ترتیب: `orderId` بدنه ← سفارش لینک‌شده به درخواست ← قدیمی‌ترین سفارش تسویه‌نشده میز.
- اگر مانده‌ای وجود داشته باشد، پرداخت کارتی (پیش‌فرض `card`) با مبلغ مانده یا مبلغ ارسالی ثبت و سفارش
  تسویه می‌شود؛ اگر مانده‌ای نباشد، درخواست بدون اختراع پرداخت `completed` می‌شود (`payment: null`).
- اگر سفارش هدف هنوز سرو نشده باشد: `409 ORDER_NOT_PAYABLE` و درخواست `pending` می‌ماند.
- درخواست بسته‌شده: `409 REQUEST_CLOSED`.

## تخفیف، بازپرداخت، رسید و چاپ (فاز ۵)

| متد | مسیر | مجوز | توضیح |
|---|---|---|---|
| POST | `/orders/:id/splits` | `payments.create` | `{ parts }` (۲ تا ۲۰)؛ تقسیم مساوی پیش از اولین پرداخت؛ `201` با نمای صورت‌حساب و `splits` |
| PUT | `/orders/:id/splits` | `payments.create` | `{ splits: [{ label?, amount }] }` (۲ تا ۲۰)؛ تقسیم دلبخواه؛ جمع باید برابر مبلغ فاکتور باشد (`400 SPLIT_TOTAL_MISMATCH`) و برچسب تکراری رد می‌شود (`SPLIT_LABEL_DUPLICATE`)؛ `200` |
| DELETE | `/orders/:id/splits` | `payments.create` | پاک‌کردن تقسیم استفاده‌نشده؛ `404 SPLITS_NOT_FOUND` وقتی سهمی نیست |
| POST | `/orders/:id/discount` | `orders.discount` | `{ amount?, percent?, reason }` (دقیقاً یکی از مبلغ/درصد)؛ `200` با نمای صورت‌حساب |
| POST | `/orders/:id/refunds` | `payments.refund` | `{ amount, reason, method? }`؛ `201` با `{ refundId, amount, paidTotal, remaining, status }` |
| POST | `/orders/:id/receipt` | `orders.read` | صف‌کردن رسید متن سفارش؛ `201` با `{ job, existed }`؛ با `{ proforma: true }` پیش‌فاکتور پیش از سرو (کلید یکتای `proforma:{order}:{total}`) |
| POST | `/orders/:id/tickets` | `orders.read` | یک بلیت چاپ برای هر واحد آماده‌سازی؛ `201` با `{ jobs, created }` و کلید یکتای `ticket:{order}:{dept}:{qty}` |
| GET | `/print/jobs?status=` | `orders.read` | صف چاپ (`queued`\|`sent`\|`printed`\|`failed`\|`cancelled`)، حداکثر ۱۰۰ ردیف با متن رسید |
| POST | `/print/jobs/:id/sent` | `orders.read` | claim اتمی `queued → sent` برای پل چاپ؛ تکرار روی کار `sent` بی‌خطر، روی کار چاپ‌شده `409 PRINT_JOB_ALREADY_PRINTED` و روی کار برداشته‌شده `409 PRINT_JOB_NOT_QUEUED` |
| POST | `/print/jobs/:id/printed` | `orders.read` | تأیید چاپ (`attempts += 1`, `printed_at`) |
| POST | `/print/jobs/:id/failed` | `orders.read` | `{ error }`؛ ثبت خطای چاپ |

### قواعد تخفیف

- فقط پیش از هر پرداخت: اگر `paid_total` (خالص) بزرگ‌تر از صفر باشد `409 DISCOUNT_AFTER_PAYMENT`؛
  سفارش `paid`/`cancelled` → `409 ORDER_CLOSED`.
- مبلغ/درصد سمت سرور به ریال گرد می‌شود؛ بیشتر از `subtotal`: `400 DISCOUNT_EXCEEDS_SUBTOTAL`.
- **تخفیف بیش از ۲۰٪ جمع اقلام** نیازمند مجوز `approvals.decide` است، وگرنه `403 APPROVAL_REQUIRED`.
  این یک بررسی سرور است، نه مخفی‌کردن دکمه.
- `total = subtotal − discount + service_charge + tax_total`؛ صورت‌حساب باز هم‌زمان به‌روز می‌شود و
  رویداد `order.discount_applied` + حسابرسی `order.discount_applied` ثبت می‌شود.
- تخفیف قابل تغییر است تا زمانی که پرداختی ثبت نشده؛ هر بار مبلغ جایگزین مقدار قبلی می‌شود.

### قواعد بازپرداخت

- فقط سفارش `paid` (`409 ORDER_NOT_PAID`).
- مبلغ باید عدد صحیح، بیشتر از صفر و حداکثر برابر پرداخت خالص باشد (`400 REFUND_EXCEEDS_PAID`).
- بازپرداخت یک ردیف `payments` با `status = refunded` می‌سازد؛ پرداخت اصلی حذف نمی‌شود، سفارش `paid`
  می‌ماند و صورت‌حساب `settled` می‌ماند. `orders.paid_total` و `bills.paid_total` به مبلغ خالص کاهش می‌یابند.
- بازپرداخت جزئی مجاز است؛ مجموع بازپرداخت‌ها از پرداخت خالص بیشتر نمی‌شود. حسابرسی: `payment.refunded`.

### رسید و صف چاپ

- متن رسید سمت سرور از snapshot سفارش ساخته می‌شود (نام مجموعه، کد، میز، تاریخ جلالی، اقلام با گزینه/افزودنی،
  جمع، تخفیف، حق سرویس، مالیات، پرداخت‌ها) و در `print_jobs.payload_json` ذخیره می‌شود.
- `job_key = receipt:{orderId}:{paidTotal}` ایندکس یکتاست: کلیک دوباره همان کار را برمی‌گرداند
  (`existed: true`) و کاغذ دوم تولید نمی‌کند. پس از تغییر مبلغ (تخفیف/بازپرداخت) رسید تازه مجاز است.
- رسید فقط برای سفارش `served`/`awaiting_payment`/`paid` صف می‌شود؛ زودتر `409 RECEIPT_NOT_AVAILABLE`.
- چاپ واقعی با `scripts/print-bridge.mjs` (ورود با حساب کارمند دارای `orders.read`، claim با
  `POST /print/jobs/:id/sent`، نوشتن فایل متنی و POST نتیجه) یا با تأیید دستی در `/admin/print`.
  claim اتمی است تا دو پل هم‌زمان یک رسید را دو بار چاپ نکنند. اتصال مستقیم به پرینتر در API وجود ندارد.

## اعلان‌ها (فاز ۵)

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| GET | `/notifications?unread=1` | هر کاربر واردشده | اعلان‌های شخصی (`user_id`) و نقش‌محور (`role_key` نقش‌های کاربر) + `unreadCount` |
| POST | `/notifications/:id/read` | همان مخاطب | علامت خوانده‌شده؛ اعلان نقش دیگر `404 NOTIFICATION_NOT_FOUND` |
| POST | `/notifications/read-all` | همان مخاطب | خواندن همه اعلان‌های قابل‌دسترس؛ پاسخ `{ updated, unreadCount: 0 }` |

اعلان نقش‌محور بین همه دارندگان آن نقش مشترک است؛ خواندن آن برای یک نفر، برای کل نقش خوانده می‌شود
(محدودیت مستند). هیچ ارسال SMS/Push وجود ندارد.

## گزارش‌ها (فاز ۵)

| متد | مسیر | مجوز | توضیح |
|---|---|---|---|
| GET | `/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` | `reports.read` | فروش، بازپرداخت، خالص، تعداد پرداخت/سفارش، میانگین، تفکیک روش، فروش روزانه، ۱۰ محصول پرفروش |
| GET | `/reports/payments.csv?from=&to=` | `reports.read` | CSV با BOM (Excel فارسی) از همه پرداخت‌ها/بازپرداخت‌های بازه |
| GET | `/reports/payments.xlsx?from=&to=` | `reports.read` | کتاب کار واقعی XLSX (یک برگ «پرداخت‌ها»، مبلغ عددی، تاریخ جلالی) بدون کتابخانهٔ خارجی |

- بازه بر اساس **روز تقویم تهران** است؛ `from`/`to` میلادی `YYYY-MM-DD` و شامل هر دو روز.
  بدون پارامتر، امروز تهران. تاریخ بی‌معنی `400 INVALID_DATE_RANGE`، شروع بعد از پایان هم `400`.
- فروش = مجموع پرداخت‌های `confirmed`؛ خالص = فروش − بازپرداخت‌ها؛ سفارش تسویه‌شده از `orders.paid_at` شمارش می‌شود.
- «فروش روزانه» با `date(paid_at,'+210 minutes')` گروه می‌شود تا مرز نیمه‌شب تهران درست باشد.

## رزرو (فاز ۶) — `@RequireModule('reservations')`

| متد | مسیر | مجوز | توضیح |
|---|---|---|---|
| GET | `/reservations?date=YYYY-MM-DD&scope=upcoming\|all&status=&tableId=` | `reservations.read` | رزروهای روز تقویم تهران (یا همه) + شمارش وضعیت‌ها |
| POST | `/reservations` | `reservations.write` | نام، شماره تماس، تعداد مهمان، زمان ISO، مدت (۱۵–۴۸۰)، میز اختیاری |
| POST | `/reservations/:id/status` | `reservations.write` | `pending`/`confirmed`/`seated`/`cancelled`/`no_show` با نقشه انتقال |

- شماره تماس با ارقام لاتین و بدون فاصله ذخیره می‌شود؛ عدد فارسی/عربی پذیرفته است.
- تداخل بازه‌ها با `julianday` در SQLite بررسی می‌شود: رزرو هم‌پوشان روی همان میز `409 RESERVATION_CONFLICT`.
  رزروی که دقیقاً وقتی رزرو دیگر تمام می‌شود شروع شود مجاز است.
- تعداد مهمان بیش از ظرفیت میز `400 CAPACITY_EXCEEDED`؛ زمان گذشته `400 RESERVATION_IN_PAST`.
- تأیید میز آزاد را `reserved`، حضور را `occupied` و لغو/عدم‌حضور میز رزروشده بدون نشست را `available` می‌کند.

## انبار (فاز ۶) — `@RequireModule('inventory')`

| متد | مسیر | مجوز | توضیح |
|---|---|---|---|
| GET | `/inventory/overview` | `inventory.read` | شمارش مواد اولیه/کمبود/تأمین‌کننده/گردش امروز |
| GET | `/inventory/ingredients` | `inventory.read` | موجودی، حد هشدار، بهای واحد و پرچم کمبود |
| POST | `/inventory/ingredients` | `inventory.write` | نام، واحد (به‌صورت نماد)، موجودی اولیه، حد هشدار، بهای واحد |
| POST | `/inventory/ingredients/:id/adjustments` | `inventory.write` | `{ delta, reason }`؛ منفی‌شدن موجودی `400 INSUFFICIENT_STOCK` |
| GET | `/inventory/movements?limit=60` | `inventory.read` | گردش انبار با نوع، مرجع سفارش و کاربر |
| GET | `/inventory/recipes` | `inventory.read` | دستور پخت محصولات |
| POST | `/inventory/recipes/:productId` | `inventory.write` | `{ yieldQty, items:[{ingredientId, qty}] }`؛ `qty` مقدار مصرف برای `yieldQty` محصول است؛ آرایه خالی دستور پخت را پاک می‌کند |

- هنگام ثبت سفارش، اگر ماژول روشن باشد، برای هر محصول `تعداد فروخته‌شده × مقدار ماده / yieldQty` از موجودی کم و
  ردیف `sale_deduction` ثبت می‌شود؛ فراخوانی دوباره بی‌اثر است. رابط انبار بازده دستور (تعداد محصول حاصل) را جداگانه می‌گیرد و هنگام ویرایش مقدار قبلی را بازیابی می‌کند.
- لغو سفارش فقط خالص کسر‌شده را با ردیف `restore` برمی‌گرداند.
- ماژول پیش‌فرض خاموش است؛ در حالت خاموش هیچ کسر/بازگردانی انجام نمی‌شود و داده حذف نمی‌شود.

## کارکنان (فاز ۶)

| متد | مسیر | مجوز | توضیح |
|---|---|---|---|
| POST | `/users` | `users.write` | `{ username, fullName, password, roleKeys[] }`؛ حساب با `mustChangePassword` ساخته می‌شود |
| PATCH | `/users/:id` | `users.write` | `fullName`, `isActive`, `roleKeys[]`, `newPassword`, `resetMfa` — همه اختیاری |

- نام کاربری یکتا (بدون حساسیت به بزرگی/کوچکی)؛ نقش نامعتبر `400 ROLE_NOT_FOUND`.
- غیرفعال‌سازی یا بازنشانی گذرواژه، همه نشست‌های آن کاربر را باطل می‌کند؛ غیرفعال‌کردن حساب خود `400 CANNOT_DISABLE_SELF`.
- `resetMfa: true` کلید TOTP و کدهای پشتیبان را پاک می‌کند (دستگاه گمشده) و در حسابرسی `staff.updated` ثبت می‌شود.

## جلسات صندوق (فاز ۶) — `@RequireModule('finance')`

| متد | مسیر | مجوز | توضیح |
|---|---|---|---|
| GET | `/cash-sessions?registerId=` | `finance.read` | صندوق‌ها، جلسه باز و ۲۰ جلسه بسته |
| POST | `/cash-sessions/open` | `finance.write` | `{ registerId, openingFloat }`؛ یک جلسه باز در هر صندوق |
| POST | `/cash-sessions/:id/close` | `finance.write` | `{ closingAmount }` → مبلغ انتظار، شمارش و مغایرت |

- مبلغ انتظار = موجودی اولیه + پرداخت‌های نقدی تأییدشده − بازپرداخت‌های نقدی در بازه جلسه؛ هیچ عددی از کلاینت
  به‌عنوان «انتظار» پذیرفته نمی‌شود.
- بستن دوباره یا جلسه دوم هم‌زمان `409`. ماژول پیش‌فرض خاموش است.

## باشگاه مشتریان (فاز ۶) — `@RequireModule('crm')`

| متد | مسیر | مجوز | توضیح |
|---|---|---|---|
| GET | `/customers?q=&limit=50` | `crm.read` | جست‌وجو بر اساس نام/شماره |
| POST | `/customers` | `crm.write` | نام، شماره یکتا، تاریخ تولد، یادداشت، رضایت پیامک |
| GET | `/customers/:id` | `crm.read` | پروفایل + ۵۰ ردیف آخر دفتر امتیاز/کیف پول |
| POST | `/customers/:id/loyalty` | `crm.write` | `{ points?, wallet?, reason }` — حداقل یکی باید غیرصفر باشد |

- شماره تکراری `409 CUSTOMER_EXISTS`؛ برداشت بیش از موجودی کیف پول/امتیاز `400`.
- سطح از امتیاز مشتق می‌شود: ۲۰۰ نقره‌ای، ۵۰۰ طلایی، ۱۰۰۰ ویژه. ماژول پیش‌فرض خاموش است.

## تأیید دو مرحله‌ای (فاز ۷)

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| GET | `/auth/mfa` | هر کاربر واردشده | `{ enabled, confirmedAt }` |
| POST | `/auth/mfa/enroll` | هر کاربر واردشده | `{ secret, otpauthUrl }`؛ اگر فعال باشد `409 MFA_ALREADY_ENABLED` |
| POST | `/auth/mfa/activate` | هر کاربر واردشده | `{ code }` → فعال‌سازی؛ کد نادرست `401 MFA_INVALID`، بدون ثبت‌نام `400 MFA_NOT_ENROLLED` |
| POST | `/auth/mfa/recovery-codes` | هر کاربر واردشده | `{ password, code }` → ۱۰ کد پشتیبان جدید؛ کدهای قبلی باطل می‌شوند |
| POST | `/auth/mfa/disable` | هر کاربر واردشده | `{ password, code? }`؛ گذرواژه نادرست `401 INVALID_CREDENTIALS` |

- ورود (`POST /auth/login`) فیلد اختیاری `code` می‌گیرد: کد ۶ رقمی TOTP یا کد پشتیبان `XXXX-XXXX`.
  حساب فعال‌شده بدون کد `401 MFA_REQUIRED` و با کد نادرست `401 MFA_INVALID` پاسخ می‌دهد؛ گذرواژه همیشه
  پیش از بررسی کد سنجیده می‌شود. هر کد پشتیبان فقط یک‌بار پذیرفته می‌شود.
- فعال‌سازی در پاسخ ۱۰ کد پشتیبان برمی‌گرداند (تنها بار نمایش)؛ در سرور فقط هش SHA-256 ذخیره می‌شود.
- الگوریتم TOTP (SHA-1، ۶ رقم، ۳۰ ثانیه) در سرور است؛ کلید فقط هنگام ثبت‌نام یک‌بار برمی‌گردد.

## سخت‌سازی HTTP (فاز ۷)

- همه پاسخ‌ها `X-Request-Id`، `X-Content-Type-Options`، `X-Frame-Options`، `Referrer-Policy`،
  `Permissions-Policy` و CSP سخت‌گیرانه دارند؛ HSTS فقط در تولید.
- ورود: ۶۰ تلاش در ۱۰ دقیقه برای هر IP، علاو‌ه بر قفل حساب (۵ تلاش ناموفق → ۱۵ دقیقه).
- `/health` نسخه API را برمی‌گرداند (`0.7.0`).

## کاتالوگ و منو (فاز ۱۰)

| متد | مسیر | دسترسی | توضیح |
|---|---|---|---|
| GET | `/catalog` | `catalog.read` | دسته‌ها، محصولات (شامل بایگانی‌شده)، واحدهای آماده‌سازی، گزینه‌ها، افزودنی‌ها و ساعت‌های سرو |
| POST | `/catalog/categories` | `catalog.write` | `{ nameFa, sortOrder?, isActive? }` |
| PUT | `/catalog/categories/order` | `catalog.write` | `{ ids }` — ترتیب کامل و اتمی؛ فهرست ناقص `400 CATEGORY_ORDER_INCOMPLETE` و شناسهٔ ناشناس/تکراری `400 CATEGORY_ORDER_STALE` |
| PUT | `/catalog/products/order` | `catalog.write` | `{ categoryId, ids }` — ترتیب نمایش محصولات همان دسته؛ فهرست ناقص `400 PRODUCT_ORDER_INCOMPLETE` و شناسهٔ ناشناس/تکراری `400 PRODUCT_ORDER_STALE` |
| PATCH | `/catalog/categories/:id` | `catalog.write` | حداقل یکی از `nameFa/sortOrder/isActive` |
| DELETE | `/catalog/categories/:id` | `catalog.write` | حذف نرم؛ دستهٔ دارای محصول `409 CATEGORY_NOT_EMPTY` |
| POST | `/catalog/products` | `catalog.write` | `{ categoryId, nameFa, basePrice, descriptionFa?, imageUrl?, departmentId?, prepMinutes?, isAvailable?, isActive? }` |
| PATCH | `/catalog/products/:id` | `catalog.write` | همان فیلدها + `isArchived` برای بازگردانی؛ `imageUrl: null` تصویر را پاک می‌کند |
| PUT | `/catalog/products/:id/options` | `catalog.write` | `{ groups: [{ nameFa, minSelect, maxSelect, isRequired, options[] }] }` |
| PUT | `/catalog/products/:id/extras` | `catalog.write` | `{ extras: [{ nameFa, price, isActive? }] }`؛ حداکثر ۳۰ افزودنی برای هر محصول |
| PUT | `/catalog/products/:id/availability` | `catalog.write` | `{ windows: [{ weekday: 0..6 \| null, startTime: "HH:mm", endTime: "HH:mm" }] }`؛ روز ۰=یکشنبه، ۶=شنبه، `null`=هر روز؛ حداکثر ۳۰ بازه |
| DELETE | `/catalog/products/:id` | `catalog.write` | بایگانی (`isArchived = 1`)، نه حذف ردیف |
| POST | `/catalog/images` | `catalog.write` | `{ dataUrl }` — فقط PNG/JPEG/WebP با امضای معتبر، حداکثر ۴۰۰ کیلوبایت؛ پاسخ `{ url, bytes, mime }` با مسیر هم‌مبدأ |
| POST | `/catalog/import` | `catalog.write` | `{ csv, dryRun? }` — ایمپورت انبوه؛ سطرهای معتبر در یک تراکنش نوشته و سطرهای خطادار گزارش می‌شوند. ستون‌ها: `category,name,price,description,department,prepMinutes,imageUrl,isAvailable,isActive` |

- قیمت همیشه عدد صحیح ریال است؛ مقدار منفی `400` با پیام فارسی برمی‌گرداند. قیمت نهایی هر قلم پس از گزینه‌ها
  و افزودنی‌ها نمی‌تواند منفی شود: `400 UNIT_PRICE_NEGATIVE`. `imageUrl` فقط HTTPS یا مسیر نسبی هم‌مبدأ می‌پذیرد؛ آپلود فایل در این API وجود ندارد.
- نام دسته و نام محصول (در هر دسته) پس از نرمال‌سازی فارسی یکتاست: `409 CATEGORY_EXISTS` / `409 PRODUCT_EXISTS`.
- محصول فقط وقتی در منوی QR دیده می‌شود که دسته و خودِ محصول فعال و بایگانی‌نشده باشند؛ تغییر در همین صفحه
  بلافاصله روی `/public/menu` اثر می‌گذارد.
- `PUT .../options` کل درخت گزینه‌ها را در یک تراکنش جایگزین می‌کند. شناسهٔ گزینهٔ قبلی در `order_item_options`
  با کلید خارجی `SET NULL` پاک می‌شود ولی نام و قیمت snapshot می‌ماند، پس رسید قدیمی تغییر نمی‌کند.
- `PUT .../extras` فهرست افزودنی‌های همان محصول را در یک تراکنش جایگزین می‌کند؛ افزودنی‌های فعال در منوی QR نمایش داده می‌شوند و قیمت انتخاب‌شده سمت سرور محاسبه می‌شود. snapshot سفارش‌های قبلی مستقل می‌ماند.
- `PUT .../availability` بازه‌ها را اتمی جایگزین می‌کند؛ ساعت‌ها HH:mm و بر مبنای ساعت تهران‌اند. پایان باید بعد از شروع باشد و بازه از نیمه‌شب نمی‌گذرد. بدون بازه، محدودیت زمانی وجود ندارد؛ اگر بازه تعریف شود، محصول بیرون از همهٔ بازه‌های فعال در منوی مشتری ناموجود و سفارش آن با `409 PRODUCT_OUTSIDE_HOURS` رد می‌شود.
- هر تغییر (دسته، محصول، گزینه‌ها، افزودنی‌ها، ساعت سرو) ردیف حسابرسی با مقدار قبل و بعد می‌نویسد.

## مسیرهای فازهای بعد

`/layout`, `/floorplans`, `/qr-codes`, `/campaigns` — قرارداد آن‌ها در `docs/PROGRESS.md` و فاز مربوطه تکمیل می‌شود.

## قواعد عمومی

- صفحه‌بندی: `page` (از ۱) و `pageSize` (۱ تا ۱۰۰، پیش‌فرض ۲۰) → `{ items, page, pageSize, total, totalPages }`.
- اعتبارسنجی: Zod؛ خطای ۴۰۰ با `VALIDATION_FAILED` و `details` شامل `path` و `message` فارسی.
- نرخ خطای احراز هویت: ۵ تلاش ناموفق → قفل ۱۵ دقیقه‌ای (`429 ACCOUNT_LOCKED`).
- هیچ محاسبه مالی از کلاینت پذیرفته نمی‌شود؛ مبلغ نهایی همیشه سمت سرور از snapshot آیتم‌ها بازمحاسبه می‌شود.
