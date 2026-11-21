#!/usr/bin/env node
/**
 * Generate the PostgreSQL migration set from the SQLite schema.
 *
 * The application intentionally keeps the same portable data model on both
 * engines: UUIDs and timestamps are TEXT, money is INTEGER and booleans are
 * INTEGER 0/1. Only the DDL that SQLite spells differently is rewritten here.
 * Review the generated SQL before shipping a new migration.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const source = join('apps', 'api', 'migrations');
const target = join('rust', 'migrations', 'postgres');
mkdirSync(target, { recursive: true });

const sqliteNow = /strftime\('%Y-%m-%dT%H:%M:%fZ', 'now'\)/g;
const postgresNow = `to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

for (const file of readdirSync(source).filter((name) => name.endsWith('.sql')).sort()) {
  let sql = readFileSync(join(source, file), 'utf8');

  sql = sql
    .replace(/PRAGMA foreign_keys = ON;\s*/g, '')
    .replace(/COLLATE NOCASE/g, '')
    .replace(sqliteNow, postgresNow)
    .replace(/lower\(hex\(randomblob\(16\)\)\)/g, 'md5(random()::text)')
    .replace(/INSERT OR IGNORE INTO/g, 'INSERT INTO');

  // SQLite's INSERT OR IGNORE becomes the standard ON CONFLICT clause.
  sql = sql.replace(/INSERT INTO[\s\S]*?;/g, (statement) =>
    statement.includes('ON CONFLICT')
      ? statement
      : statement.replace(/;$/, ' ON CONFLICT DO NOTHING;'),
  );

  if (file === '001_init.sql') {
    sql = sql.replace(
      /CREATE INDEX idx_users_username ON users \(username\);/,
      `CREATE INDEX idx_users_username ON users (username);\n-- SQLite used COLLATE NOCASE; PostgreSQL enforces the same rule with an expression index.\nCREATE UNIQUE INDEX ux_users_username_lower ON users (lower(username));`,
    );
  }

  writeFileSync(join(target, file), sql);
}

console.log(`Generated PostgreSQL migrations in ${target}`);
