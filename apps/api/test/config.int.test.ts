import { afterEach, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config/env';

const KEYS = ['CAFEFLOW_DATA_DIR', 'CAFEFLOW_BACKUP_DIR', 'DATABASE_PATH'];

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe('persistent data paths', () => {
  it('keeps the database and backups under one configurable root', () => {
    process.env.CAFEFLOW_DATA_DIR = '/var/lib/cafeflow';

    const config = loadConfig();
    const root = resolve('/var/lib/cafeflow');

    expect(config.dataDirectory).toBe(root);
    expect(config.databasePath).toBe(join(root, 'cafeflow.db'));
    expect(config.backupDirectory).toBe(join(root, 'backups'));
  });

  it('honours explicit overrides for the database and backup folder', () => {
    process.env.CAFEFLOW_DATA_DIR = '/srv/cafeflow';
    process.env.DATABASE_PATH = '/mnt/ssd/live.db';
    process.env.CAFEFLOW_BACKUP_DIR = '/mnt/backup/cafeflow';

    const config = loadConfig();

    expect(config.databasePath).toBe(resolve('/mnt/ssd/live.db'));
    expect(config.backupDirectory).toBe(resolve('/mnt/backup/cafeflow'));
  });

  it('falls back to the repository data folder when nothing is configured', () => {
    const config = loadConfig();

    expect(config.dataDirectory).toBe(resolve('../../data'));
    expect(config.databasePath).toBe(join(resolve('../../data'), 'cafeflow.db'));
  });
});
