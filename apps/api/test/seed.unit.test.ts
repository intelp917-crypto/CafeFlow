import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate';
import { backfillDemoProductImages, isSeeded, seedDatabase } from '../src/db/seed';

/**
 * A Docker volume keeps its database forever, and `seed` is skipped once an
 * administrator exists. The demo product photos were added after some volumes
 * were already seeded, so these tests pin the safe backfill: empty photos only,
 * demo names only, never over an admin's own choice.
 */
function seededDatabase(): Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  seedDatabase(db, {
    adminUsername: 'admin',
    adminPassword: 'Admin@12345',
    demoStaff: false,
    demoMenu: true,
  });
  return db;
}

describe('demo product photos', () => {
  it('fills photos on a volume that was seeded before they existed', () => {
    const db = seededDatabase();
    expect(isSeeded(db)).toBe(true);

    // Exactly the state of an older volume: rows exist, images do not.
    db.prepare('UPDATE products SET image_url = NULL').run();

    expect(backfillDemoProductImages(db)).toBe(13);

    const rows = db.prepare('SELECT name_fa, image_url FROM products').all() as Array<{
      name_fa: string;
      image_url: string | null;
    }>;
    expect(rows).toHaveLength(13);
    for (const row of rows) {
      expect(row.image_url).toMatch(/^\/images\/products\/[a-z-]+\.jpg$/);
    }

    // Idempotent: a second run has nothing left to fill.
    expect(backfillDemoProductImages(db)).toBe(0);
    db.close();
  });

  it('never overwrites a photo the administrator chose', () => {
    const db = seededDatabase();
    db.prepare("UPDATE products SET image_url = '/images/custom.jpg' WHERE name_fa = 'اسپرسو'").run();
    db.prepare("UPDATE products SET image_url = NULL WHERE name_fa = 'لاته'").run();

    expect(backfillDemoProductImages(db)).toBe(1);

    const rows = db
      .prepare("SELECT name_fa, image_url FROM products WHERE name_fa IN ('اسپرسو', 'لاته')")
      .all() as Array<{ name_fa: string; image_url: string }>;
    const byName = new Map(rows.map((row) => [row.name_fa, row.image_url]));
    expect(byName.get('اسپرسو')).toBe('/images/custom.jpg');
    expect(byName.get('لاته')).toBe('/images/products/latte.jpg');
    db.close();
  });

  it('leaves a product that is not in the demo menu alone', () => {
    const db = seededDatabase();
    db.prepare(
      `INSERT INTO products (id, category_id, name_fa, search_key, base_price, prep_minutes, image_url)
       VALUES ('custom-1', (SELECT id FROM categories LIMIT 1), 'نوشیدنی خانه', 'نوشیدنی خانه', 1000, 5, NULL)`,
    ).run();

    backfillDemoProductImages(db);

    const row = db.prepare("SELECT image_url FROM products WHERE id = 'custom-1'").get() as {
      image_url: string | null;
    };
    expect(row.image_url).toBeNull();
    db.close();
  });
});
