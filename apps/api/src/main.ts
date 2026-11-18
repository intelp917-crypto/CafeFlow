import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig, loadEnvFile } from './config/env';
import { AppExceptionFilter } from './common/errors';
import { DatabaseService } from './db/database.service';
import { isSeeded, seedDatabase } from './db/seed';

async function bootstrap(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  app.setGlobalPrefix(config.apiPrefix.replace(/^\//, ''));
  app.useGlobalFilters(new AppExceptionFilter());
  app.enableShutdownHooks();

  const database = app.get(DatabaseService);

  // A brand new installation is seeded automatically outside production so the
  // first login works. In production the operator runs `npm run db:setup`
  // explicitly, with their own administrator password.
  if (!isSeeded(database.db) && !config.isProduction) {
    seedDatabase(database.db, {
      adminUsername: process.env.SEED_ADMIN_USERNAME ?? 'admin',
      adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'CafeFlow@1404',
      demoStaff: (process.env.SEED_DEMO_STAFF ?? 'true') === 'true',
      demoMenu: true,
    });
    logger.warn('پایگاه داده خالی بود و داده اولیه ایجاد شد. گذرواژه مدیر را تغییر دهید.');
  }

  await app.listen(config.port);

  logger.log(`CafeFlow API روی پورت ${config.port} آماده است (${config.apiPrefix})`);
  logger.log(`پایگاه داده: ${database.filePath}`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('راه‌اندازی API با خطا مواجه شد:', error);
  process.exit(1);
});
