import Database from 'better-sqlite3';
import { loadConfig, loadEnvFile } from '../config/env';
import { ensureDatabaseDirectory, runMigrations } from './migrate';
import { backfillDemoProductImages, isSeeded, seedDatabase } from './seed';

/**
 * Database CLI.
 *
 *   npm run db:migrate   apply pending migrations
 *   npm run db:seed      seed roles/users/layout/menu (idempotent)
 *   npm run db:setup     migrate + seed
 */
async function main(): Promise<void> {
  loadEnvFile();
  const command = process.argv[2] ?? 'setup';
  const config = loadConfig();

  ensureDatabaseDirectory(config.databasePath);
  const db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  try {
    switch (command) {
      case 'migrate': {
        const applied = runMigrations(db);
        console.log(
          applied.length > 0
            ? `✅ ${applied.length} مهاجرت اعمال شد: ${applied.join(', ')}`
            : '✅ پایگاه داده به‌روز است؛ مهاجرتی برای اعمال وجود ندارد.',
        );
        break;
      }
      case 'seed':
      case 'setup': {
        const applied = runMigrations(db);
        console.log(applied.length > 0 ? `✅ ${applied.length} مهاجرت اعمال شد.` : '✅ مهاجرت‌ها از قبل اعمال شده‌اند.');

        if (isSeeded(db) && command === 'seed') {
          // The demo photos shipped after the first seeds; a volume created by an
          // older image would never get them because the seed is skipped.
          if ((process.env.SEED_DEMO_MENU ?? 'true') === 'true') {
            const filled = backfillDemoProductImages(db);
            if (filled > 0) console.log(`✅ تصویر ${filled} محصول نمونه تکمیل شد.`);
          }
          console.log('ℹ️ داده‌های اولیه از قبل وجود دارند؛ برای جلوگیری از بازنویسی، seed انجام نشد.');
          break;
        }

        seedDatabase(db, {
          adminUsername: process.env.SEED_ADMIN_USERNAME ?? 'admin',
          adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'CafeFlow@1404',
          demoStaff: (process.env.SEED_DEMO_STAFF ?? 'true') === 'true',
          demoMenu: (process.env.SEED_DEMO_MENU ?? 'true') === 'true',
        });
        console.log(`✅ داده اولیه آماده شد. فایل پایگاه داده: ${config.databasePath}`);
        console.log('⚠️ گذرواژه مدیر را پس از نخستین ورود تغییر دهید.');
        break;
      }
      default:
        console.error(`دستور ناشناخته: ${command}. دستورهای مجاز: migrate | seed | setup`);
        process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('❌ خطا در اجرای دستور پایگاه داده:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
