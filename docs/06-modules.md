# ۶. معماری ماژول‌ها

منبع حقیقت: `packages/shared/src/modules.ts` — همان فهرست هم در API و هم در UI استفاده می‌شود.

## فهرست ماژول‌ها

| کلید | نام | پیش‌فرض | قابل پیکربندی | وابستگی | فاز |
|---|---|---|---|---|---|
| `ordering` | سامانه سفارش | روشن | خیر | — | ۲ |
| `qr_menu` | منوی QR مشتری | روشن | خیر | ordering | ۲ |
| `tables` | مدیریت میز و سالن | روشن | خیر | — | ۳ |
| `waiter_dashboard` | داشبورد گارسون | روشن | خیر | tables, ordering | ۳ |
| `kitchen_dashboard` | داشبورد آشپزخانه | روشن | خیر | ordering | ۳ |
| `barista_dashboard` | داشبورد باریستا | روشن | خیر | ordering | ۳ |
| `cashier_dashboard` | داشبورد صندوق | روشن | خیر | ordering | ۴ |
| `security` | امنیت و کنترل دسترسی | روشن | خیر | — | ۱ ✅ |
| `notifications` | اعلان‌ها | روشن | خیر | — | ۵ |
| `printing` | چاپ و رسید | روشن | خیر | ordering | ۴ |
| `reservations` | رزرو میز | روشن | بله | tables | ۵ |
| `inventory` | مدیریت انبار | **خاموش** | بله | ordering | ۶ |
| `employees` | کارکنان و شیفت | **خاموش** | بله | tables | ۶ |
| `finance` | مدیریت مالی | **خاموش** | بله | ordering | ۶ |
| `crm` | باشگاه مشتریان | **خاموش** | بله | ordering | ۶ |

## قرارداد هر ماژول

```ts
interface ModuleDefinition {
  key: ModuleKey;
  nameFa: string;
  descriptionFa: string;
  defaultEnabled: boolean;
  configurable: boolean;     // مدیر می‌تواند فعال/غیرفعال کند
  dependsOn: ModuleKey[];    // پیش‌نیازها
  phase: number;             // فازی که قابلیت‌ها عملیاتی می‌شوند
}
```

## اجرای قواعد

1. **سرور مرجع است.** مسیرهای یک ماژول اختیاری با `@RequireModule('inventory')` علامت می‌خورند؛ `ModuleGuard` وضعیت را از `module_settings` می‌خواند و در حالت خاموش `403 MODULE_DISABLED` با پیام فارسی برمی‌گرداند.
2. **هسته به ماژول اختیاری وابسته نیست.** کد `ordering` هرگز `inventory` را import نمی‌کند؛ ماژول اختیاری به رویداد (`order.confirmed`) مشترک می‌شود و در حالت خاموش هیچ کاری نمی‌کند.
3. **داده حذف نمی‌شود.** جدول‌های همه ماژول‌ها در `001_init.sql` ساخته می‌شوند؛ خاموش کردن فقط دسترسی را می‌بندد (آزمون `modules.int.test.ts` این را با یک ردیف واقعی بررسی می‌کند).
4. **ماژول هسته غیرقابل خاموش‌کردن است.** `PATCH /modules/:key` برای `configurable: false` مقدار `403 MODULE_NOT_CONFIGURABLE` می‌دهد.
5. **وابستگی برقرار باید فعال باشد.** اگر ماژول وابسته خاموش باشد، فعال‌سازی `409 MODULE_DEPENDENCY_DISABLED` با نام فارسی وابستگی‌ها برمی‌گرداند.
6. **همه تغییرها حسابرسی می‌شوند** (`module.enabled` / `module.disabled` با قبل/بعد).
7. **UI وضعیت را نشان می‌دهد** و برای ماژول‌های هسته سوییچ غیرفعال است.

## چرا «خاموش» به معنی «نبود» نیست

یک رستوران ممکن است انبار را یک فصل استفاده کند و فصل بعد نه. خاموش کردن باید بی‌خطر و برگشت‌پذیر باشد:

```text
enable → use → disable → (ordering unaffected, rows kept) → enable → same data
```

این چرخه در `apps/api/test/modules.int.test.ts` آزمون شده است.
