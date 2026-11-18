import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Database } from 'better-sqlite3';
import { AppModule } from '../src/app.module';
import { AppExceptionFilter } from '../src/common/errors';
import { DatabaseService } from '../src/db/database.service';
import { seedDatabase } from '../src/db/seed';

export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = 'Admin@12345';
export const DEMO_PASSWORD = 'CafeFlow@1404';

export interface TestContext {
  app: INestApplication;
  db: Database;
  directory: string;
  close: () => Promise<void>;
}

/**
 * Boots the real Nest application against a throw-away SQLite file. Using the
 * production module graph means the guards, filters and SQL under test are the
 * same ones that serve requests.
 */
export async function createTestApp(): Promise<TestContext> {
  const directory = mkdtempSync(join(tmpdir(), 'cafeflow-test-'));
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = join(directory, 'test.db');
  process.env.SESSION_COOKIE_NAME = 'cafe_session';
  process.env.LOGIN_MAX_ATTEMPTS = '5';
  process.env.LOGIN_LOCK_MINUTES = '15';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AppExceptionFilter());
  await app.init();

  const database = app.get(DatabaseService);
  seedDatabase(database.db, {
    adminUsername: ADMIN_USERNAME,
    adminPassword: ADMIN_PASSWORD,
    demoStaff: true,
    demoMenu: true,
  });

  return {
    app,
    db: database.db,
    directory,
    close: async () => {
      await app.close();
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        // Windows may still hold the SQLite WAL file briefly; the temp folder is
        // disposable either way.
      }
    },
  };
}

export function server(app: INestApplication) {
  return app.getHttpServer();
}

/** Logs in and returns a supertest agent that keeps the session cookie. */
export async function login(app: INestApplication, username: string, password: string) {
  const agent = request.agent(server(app));
  const response = await agent.post('/api/v1/auth/login').send({ username, password });
  return { agent, response };
}

export function countAudit(db: Database, action: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE action = ?').get(action) as { n: number };
  return row.n;
}
