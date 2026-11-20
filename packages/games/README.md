# @cafeflow/games — قواعد بازی‌های میزی

این بسته فقط **قواعد خالص بازی** را نگه می‌دارد: بدون HTTP، بدون WebSocket، بدون DOM.

## منبع

فایل‌های داخل `upstream/games/` **بدون تغییر** از
[absswds/GameNest](https://github.com/absswds/GameNest) (v2.2.0، شاخهٔ `master`) برداشته شده‌اند و
تحت مجوز Apache-2.0 هستند (فایل‌های `LICENSE` و `NOTICE` در همین پوشه).

همهٔ ۳۸ ماژول بازی (تخته‌ای، کارتی، اجتماعی و فکری) به‌همراه فایل‌های داده‌شان
(`quizrace-questions`, `undercover-words*`, `drawguess-words`)، کمکی‌های `games/lib` و
`games/vendor` منتقل شده‌اند. تنها فایل بیرون از `games/` که لازم بود
`public/js/paodekuai-patterns.js` است (تحلیل ترکیب کارت‌ها) که دست‌نخورده در
`upstream/public/js/` نگه داشته می‌شود. کل `server.js`، صفحه‌های HTML و رندررهای مرورگری آن
پروژه استفاده نشده‌اند.

## چه چیزی مال ما است

- `src/manifest.ts` — فهرست فارسی، دسته‌بندی، حداقل/حداکثر بازیکن و حالت اجرای هر بازی.
- `src/i18n/fa.ts` — ترجمهٔ پیام‌های خطای موتور به فارسی.
- `src/adapter.ts` — تنها نقطهٔ اتصال به بازی‌ها (`loadGame`)، با تایپ‌های TypeScript.

اگر روزی یک فایل `upstream/` را تغییر دادیم، باید سرصفحهٔ «modified» با توضیح تغییر به آن اضافه
شود (الزام Apache-2.0، بند 4b).
