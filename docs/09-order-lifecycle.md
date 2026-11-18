# ۹. چرخه عمر سفارش

منبع حقیقت: `packages/shared/src/order-state.ts` (همان تابع در API و UI استفاده می‌شود).

## وضعیت‌ها و انتقال‌های مجاز

```text
draft ──► submitted ──► awaiting_confirmation ──► confirmed ──► preparing
  │           │                  │                     │            │
  │           ├──► confirmed     └──► cancelled        │            ├──► partially_ready ──► ready
  │           └──► cancelled                           │            │                        │
  └──► cancelled                                       └──► cancelled              served ──┤
                                                                                           ▼
                                                        awaiting_payment ──► paid
                                                                            served ──► paid
```

| از | به |
|---|---|
| `draft` | `submitted`, `cancelled` |
| `submitted` | `awaiting_confirmation`, `confirmed`, `cancelled` |
| `awaiting_confirmation` | `confirmed`, `cancelled` |
| `confirmed` | `preparing`, `cancelled` |
| `preparing` | `partially_ready`, `ready`, `cancelled` |
| `partially_ready` | `ready`, `cancelled` |
| `ready` | `served`, `cancelled` |
| `served` | `awaiting_payment`, `paid` |
| `awaiting_payment` | `paid` |
| `paid`, `cancelled` | — (پایانی) |

هر انتقال غیرمجاز در سرویس با `assertTransition` و پیام فارسی رد می‌شود؛ CHECK ستون `orders.status` هم مجموعه وضعیت‌ها را محدود می‌کند.

## آماده‌سازی در سطح آیتم

`prep_tasks` به‌ازای هر `order_item` یک ردیف دارد:

```text
queued ──► in_progress ──► ready
   │            │  ▲
   │            ▼  │
   └──────► delayed ┘        (cancelled از هر حالت غیرپایانی)
```

- `ready` و `cancelled` پایانی‌اند؛ بازگشت ممکن نیست.
- `target_minutes` از `products.prep_minutes` گرفته می‌شود و مبنای هشدار تأخیر در داشبورد است
  (`(now - created_at) > target_minutes`).
- وقتی همه آیتم‌های یک سفارش `ready` شوند، وضعیت سفارش به `ready` و در صورت آماده‌شدن بخشی، به
  `partially_ready` می‌رود (فاز ۳).

## روتینگ به دپارتمان

`products.department_id` مقصد را تعیین می‌کند: نوشیدنی گرم/سرد باریستا، غذا آشپزخانه، سایر نوشیدنی‌ها بار.
همین مقدار در `order_items.department_id` و `prep_tasks.department_id` snapshot می‌شود تا تغییر بعدی محصول،
سفارش در جریان را جابه‌جا نکند.

## ضد تکرار (Idempotency)

- کلاینت برای هر تلاش ثبت، یک `clientRequestId` (UUID) می‌سازد و تا دریافت پاسخ قطعی همان را می‌فرستد.
- ایندکس یکتا روی `(guest_device_id, client_request_id)` مانع درج دوباره می‌شود؛ در تکرار، پاسخ همان سفارش موجود است (فاز ۲).
- دکمه ارسال در UI تا دریافت پاسخ سرور در حالت بارگذاری می‌ماند؛ هیچ «ثبت شد» حدسی نمایش داده نمی‌شود.

## هزینه‌ها و مبالغ

- `order_items.unit_price_snapshot` و `product_name_snapshot` در لحظه ثبت ذخیره می‌شوند.
- `subtotal`، `discount_total`، `service_charge`، `tax_total` و `total` فقط سمت سرور محاسبه می‌شوند
  (`percentOf` با گرد کردن به ریال نزدیک‌تر).
- تخفیف QR در فاز ۵ با اعتبارسنجی سمت سرور (کمپین فعال، بازه زمانی، سقف استفاده، دستگاه) اعمال می‌شود؛
  مقدار ارسالی کلاینت هرگز مبنا نیست.

## خودکارسازی و محدودیت‌های دستی (فاز ۳)

- `POST /orders/:id/transition` فقط انتقال‌های مجاز ماشین وضعیت را می‌پذیرد؛ بقیه `409` می‌شوند.
- `paid` از UI و API پذیرفته نمی‌شود (`409 PAYMENT_REQUIRED`) چون پرداخت در فاز ۴ می‌آید.
- `partially_ready` دستی نیست (`400 DERIVED_STATUS`) و فقط از صف آماده‌سازی مشتق می‌شود.
- خودکارسازی از **همان** گراف انتقال‌ها عبور می‌کند: برای رساندن سفارش به هدف، کوتاه‌ترین مسیر مجاز
  پیموده و هر گام به‌صورت جداگانه در `order_events` با `type = 'order.status_auto'` ثبت می‌شود.
  مثال: آماده‌شدن اولین آیتم یک سفارش `submitted`، دو گام `submitted → confirmed → preparing` را ثبت می‌کند.
- لغو سفارش، وظایف آماده‌سازی و آیتم‌های ناتمام را `cancelled` می‌کند و تنها وقتی سفارش فعال دیگری روی
  همان نشست نیست، نشست را می‌بندد و میز را آزاد می‌کند.
- اعلان‌ها: `order.ready` برای نقش گارسون و `order.awaiting_payment` برای نقش صندوق در جدول `notifications`.

## تسویه (فاز ۴)

- پرداخت فقط در وضعیت‌های `served` و `awaiting_payment` پذیرفته می‌شود؛ سفارش را نمی‌توان پیش از سرو تسویه کرد.
- `paid` وضعیتی است که **از پرداخت مشتق می‌شود**: ثبت پرداخت‌ها مجموع را بازمحاسبه می‌کند و وقتی برابر مبلغ
  سفارش شد، سفارش از مسیر مجاز به `paid` می‌رود (`order.paid` در حسابرسی). هیچ کلاینتی مستقیماً `paid` نمی‌فرستد.
- پرداخت جزئی، سفارش را `awaiting_payment` می‌کند؛ بیش‌پرداخت رد می‌شود.
- یک صورت‌حساب (`bills`) در اولین پرداخت ساخته می‌شود؛ `open` تا رسیدن به مبلغ کل، سپس `settled`.
- بستن میز جدا از تسویه است: سفارش‌های `paid`/`cancelled` شده نشست را باز نگه می‌دارند تا کارکنان
  میز را ببندند؛ بستن با سفارش تسویه‌نشده `409` است.

## تخفیف، بازپرداخت و رسید (فاز ۵)

- **تخفیف** پیش از هر پرداختی روی `subtotal` اعمال می‌شود و `total` را بازمحاسبه می‌کند
  (`total = subtotal − discount + service_charge + tax_total`). بیش از ۲۰٪ جمع اقلام نیازمند `approvals.decide`
  است و در سرور بررسی می‌شود. اثر جانبی: صورت‌حساب باز هم‌زمان به‌روز می‌شود و `order.discount_applied`
  در `order_events` ثبت می‌گردد؛ وضعیت سفارش تغییر نمی‌کند.
- **بازپرداخت** وضعیت سفارش را برنمی‌گرداند: سفارش `paid` می‌ماند، صورت‌حساب `settled` می‌ماند، و یک ردیف
  `payments` با `status = refunded` اضافه می‌شود. `orders.paid_total` و `bills.paid_total` برابر
  **پرداخت خالص** (تأییدشده − بازپرداخت) می‌شوند و رویداد `payment.refunded` ثبت می‌شود. پس از بازپرداخت،
  بستن میز همچنان مجاز است چون شرط بستن، تسویه/لغو سفارش‌ها است نه مبلغ خالص.
- **رسید** از snapshot سفارش ساخته می‌شود و در صف `print_jobs` با کلید یکتای `receipt:{orderId}:{paidTotal}`
  قرار می‌گیرد؛ تکرار کلیک، کار دوم نمی‌سازد و تغییر مبلغ رسید تازه را مجاز می‌کند.

## ثبت تاریخچه

`order_events` برای هر انتقال: `type`, `from_status`, `to_status`, `actor_user_id`, `payload_json`, `created_at`.
`orders` هم `submitted_at`, `served_at`, `paid_at`, `closed_at` را نگه می‌دارد.
