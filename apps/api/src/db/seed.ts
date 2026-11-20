import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import {
  MODULES,
  PERMISSIONS,
  SEED_ROLES,
  normalizeForSearch,
  type PermissionKey,
} from '@cafeflow/shared';
import { createOpaqueToken, hashPassword } from '../common/password';

export interface SeedOptions {
  adminUsername: string;
  adminPassword: string;
  demoStaff: boolean;
  demoMenu: boolean;
}

interface SeedResult {
  seeded: boolean;
  reason?: string;
  userIds: Record<string, string>;
}

const now = () => new Date().toISOString();

function insertPermission(db: Database, key: string, labelFa: string, group: string): string {
  const existing = db.prepare('SELECT id FROM permissions WHERE key = ?').get(key) as { id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE permissions SET name_fa = ?, group_key = ? WHERE id = ?').run(labelFa, group, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db.prepare('INSERT INTO permissions (id, key, name_fa, group_key) VALUES (?, ?, ?, ?)').run(
    id,
    key,
    labelFa,
    group,
  );
  return id;
}

function insertRole(db: Database, key: string, nameFa: string, descriptionFa: string): string {
  const existing = db.prepare('SELECT id FROM roles WHERE key = ?').get(key) as { id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE roles SET name_fa = ?, description_fa = ? WHERE id = ?').run(nameFa, descriptionFa, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db.prepare('INSERT INTO roles (id, key, name_fa, description_fa, is_system) VALUES (?, ?, ?, ?, 1)').run(
    id,
    key,
    nameFa,
    descriptionFa,
  );
  return id;
}

function insertUser(
  db: Database,
  username: string,
  fullName: string,
  password: string,
  roleIds: string[],
): string {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string } | undefined;
  const id = existing?.id ?? randomUUID();
  if (!existing) {
    db.prepare(
      `INSERT INTO users (id, username, full_name, password_hash, is_active, must_change_password)
       VALUES (?, ?, ?, ?, 1, 0)`,
    ).run(id, username, fullName, hashPassword(password));
  }
  for (const roleId of roleIds) {
    db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, roleId);
  }
  return id;
}

/**
 * Seeds the minimum an installation needs: permissions, roles, an admin user,
 * module flags and the settings row. Menu/layout demo rows are optional.
 *
 * The function is idempotent: running it twice will not duplicate rows.
 */
export function seedDatabase(db: Database, options: SeedOptions): SeedResult {
  const permissionIds = new Map<string, string>();
  const roleIds = new Map<string, string>();
  const userIds: Record<string, string> = {};

  const seeded = db.transaction(() => {
    // --- permissions -----------------------------------------------------
    for (const permission of PERMISSIONS) {
      permissionIds.set(permission.key, insertPermission(db, permission.key, permission.labelFa, permission.group));
    }

    // --- roles -----------------------------------------------------------
    for (const role of SEED_ROLES) {
      const roleId = insertRole(db, role.key, role.nameFa, role.descriptionFa);
      roleIds.set(role.key, roleId);

      const keys: PermissionKey[] =
        role.permissions === '*' ? (PERMISSIONS.map((p) => p.key) as PermissionKey[]) : role.permissions;

      db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
      const insert = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
      for (const key of keys) {
        const permissionId = permissionIds.get(key);
        if (!permissionId) throw new Error(`مجوز ناشناخته در نقش ${role.key}: ${key}`);
        insert.run(roleId, permissionId);
      }
    }

    // --- users -----------------------------------------------------------
    userIds['super_admin'] = insertUser(
      db,
      options.adminUsername,
      'مدیر ارشد',
      options.adminPassword,
      [roleIds.get('super_admin')!],
    );

    if (options.demoStaff) {
      const demoPassword = 'CafeFlow@1404';
      userIds['manager'] = insertUser(db, 'manager', 'سارا احمدی', demoPassword, [roleIds.get('manager')!]);
      userIds['cashier'] = insertUser(db, 'cashier', 'رضا کریمی', demoPassword, [roleIds.get('cashier')!]);
      userIds['waiter'] = insertUser(db, 'waiter', 'امیر رضایی', demoPassword, [roleIds.get('waiter')!]);
      userIds['barista'] = insertUser(db, 'barista', 'نیلوفر موسوی', demoPassword, [roleIds.get('barista')!]);
      userIds['kitchen'] = insertUser(db, 'kitchen', 'حسین نوری', demoPassword, [roleIds.get('kitchen')!]);
    }

    // --- settings & module flags ----------------------------------------
    db.prepare(
      `INSERT OR IGNORE INTO settings (id, latitude, longitude) VALUES ('singleton', 35.6936023, 51.027541)`,
    ).run();
    const moduleInsert = db.prepare(
      `INSERT INTO module_settings (key, is_enabled, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO NOTHING`,
    );
    for (const module of MODULES) {
      moduleInsert.run(module.key, module.defaultEnabled ? 1 : 0, now());
    }

    // --- prep departments -------------------------------------------------
    const departments: Array<{ key: string; nameFa: string; kind: 'barista' | 'kitchen' | 'bar' }> = [
      { key: 'barista', nameFa: 'باریستا', kind: 'barista' },
      { key: 'kitchen', nameFa: 'آشپزخانه', kind: 'kitchen' },
      { key: 'bar', nameFa: 'بار', kind: 'bar' },
    ];
    const departmentIds = new Map<string, string>();
    for (const department of departments) {
      const existing = db.prepare('SELECT id FROM departments WHERE key = ?').get(department.key) as
        | { id: string }
        | undefined;
      const id = existing?.id ?? randomUUID();
      if (!existing) {
        db.prepare('INSERT INTO departments (id, key, name_fa, kind) VALUES (?, ?, ?, ?)').run(
          id,
          department.key,
          department.nameFa,
          department.kind,
        );
      }
      departmentIds.set(department.key, id);
    }

    if (!options.demoMenu) return { seeded: true, userIds };

    // --- floors, areas, tables -------------------------------------------
    const floorSpecs = [
      { nameFa: 'طبقه همکف', sort: 1 },
      { nameFa: 'طبقه اول', sort: 2 },
    ];
    const floorIds: string[] = [];
    const existingFloors = db.prepare('SELECT COUNT(*) AS n FROM floors').get() as { n: number };
    if (existingFloors.n === 0) {
      for (const spec of floorSpecs) {
        const id = randomUUID();
        db.prepare('INSERT INTO floors (id, name_fa, sort_order) VALUES (?, ?, ?)').run(id, spec.nameFa, spec.sort);
        floorIds.push(id);
      }

      const groundId = floorIds[0]!;
      const terraceId = randomUUID();
      db.prepare('INSERT INTO areas (id, floor_id, name_fa, sort_order) VALUES (?, ?, ?, ?)').run(
        terraceId,
        groundId,
        'تراس',
        1,
      );
      db.prepare('INSERT INTO areas (id, floor_id, name_fa, sort_order) VALUES (?, ?, ?, ?)').run(
        randomUUID(),
        groundId,
        'سالن اصلی',
        2,
      );

      const tableSpecs = [
        { code: 'T1', nameFa: 'میز ۱', capacity: 2, floorId: groundId, areaId: terraceId },
        { code: 'T2', nameFa: 'میز ۲', capacity: 2, floorId: groundId, areaId: terraceId },
        { code: 'T3', nameFa: 'میز ۳', capacity: 4, floorId: groundId, areaId: null },
        { code: 'T4', nameFa: 'میز ۴', capacity: 4, floorId: groundId, areaId: null },
        { code: 'T5', nameFa: 'میز ۵', capacity: 6, floorId: groundId, areaId: null },
        { code: 'T6', nameFa: 'میز ۶', capacity: 2, floorId: floorIds[1]!, areaId: null },
        { code: 'T7', nameFa: 'میز ۷', capacity: 4, floorId: floorIds[1]!, areaId: null },
        { code: 'T8', nameFa: 'میز ۸', capacity: 8, floorId: floorIds[1]!, areaId: null },
      ];

      const qrInsert = db.prepare(
        'INSERT INTO qr_codes (id, kind, token, table_id, label, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      );
      const waiterId = userIds['waiter'] ?? null;

      for (const table of tableSpecs) {
        const id = randomUUID();
        const token = createOpaqueToken(18);
        db.prepare(
          `INSERT INTO dining_tables (id, floor_id, area_id, code, name_fa, capacity, shape, waiter_user_id, qr_token)
           VALUES (?, ?, ?, ?, ?, ?, 'square', ?, ?)`,
        ).run(id, table.floorId, table.areaId, table.code, table.nameFa, table.capacity, waiterId, token);
        qrInsert.run(randomUUID(), 'table', token, id, table.nameFa);
      }
    }

    // --- menu -------------------------------------------------------------
    const existingProducts = db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number };
    if (existingProducts.n === 0) {
      const categories: Array<{ nameFa: string; slug: string; sort: number }> = [
        { nameFa: 'نوشیدنی گرم', slug: 'hot-drinks', sort: 1 },
        { nameFa: 'نوشیدنی سرد', slug: 'cold-drinks', sort: 2 },
        { nameFa: 'غذا', slug: 'food', sort: 3 },
        { nameFa: 'کیک و دسر', slug: 'desserts', sort: 4 },
      ];
      const categoryIds = new Map<string, string>();
      for (const category of categories) {
        const id = randomUUID();
        db.prepare('INSERT INTO categories (id, name_fa, slug, sort_order) VALUES (?, ?, ?, ?)').run(
          id,
          category.nameFa,
          category.slug,
          category.sort,
        );
        categoryIds.set(category.slug, id);
      }

      const products: Array<{
        nameFa: string;
        category: string;
        price: number;
        department: 'barista' | 'kitchen' | 'bar';
        descriptionFa: string;
        prep: number;
        imageUrl: string;
      }> = [
        { nameFa: 'اسپرسو', category: 'hot-drinks', price: 850000, department: 'barista', descriptionFa: 'تک شات اسپرسو با دانه ۱۰۰٪ عربیکا', prep: 3, imageUrl: '/images/products/espresso.jpg' },
        { nameFa: 'آمریکانو', category: 'hot-drinks', price: 950000, department: 'barista', descriptionFa: 'اسپرسو با آب گرم', prep: 4, imageUrl: '/images/products/americano.jpg' },
        { nameFa: 'لاته', category: 'hot-drinks', price: 1250000, department: 'barista', descriptionFa: 'اسپرسو با شیر بخارپز و لاته‌آرت', prep: 5, imageUrl: '/images/products/latte.jpg' },
        { nameFa: 'کاپوچینو', category: 'hot-drinks', price: 1180000, department: 'barista', descriptionFa: 'اسپرسو، شیر و فوم مخملی', prep: 5, imageUrl: '/images/products/cappuccino.jpg' },
        { nameFa: 'چای سیاه', category: 'hot-drinks', price: 550000, department: 'bar', descriptionFa: 'چای سیاه با نبات', prep: 4, imageUrl: '/images/products/black-tea.jpg' },
        { nameFa: 'آیس لاته', category: 'cold-drinks', price: 1380000, department: 'barista', descriptionFa: 'اسپرسو، شیر سرد و یخ', prep: 5, imageUrl: '/images/products/iced-latte.jpg' },
        { nameFa: 'لیموناد', category: 'cold-drinks', price: 980000, department: 'bar', descriptionFa: 'لیموی تازه، نعناع و سودا', prep: 4, imageUrl: '/images/products/lemonade.jpg' },
        { nameFa: 'موهیتو', category: 'cold-drinks', price: 1050000, department: 'bar', descriptionFa: 'نعناع، لیمو و سودا', prep: 4, imageUrl: '/images/products/mojito.jpg' },
        { nameFa: 'پاستا آلفردو', category: 'food', price: 2600000, department: 'kitchen', descriptionFa: 'پاستا با سس سفید و مرغ گریل', prep: 18, imageUrl: '/images/products/alfredo-pasta.jpg' },
        { nameFa: 'ساندویچ مرغ', category: 'food', price: 1950000, department: 'kitchen', descriptionFa: 'نان تست، مرغ گریل و سس مخصوص', prep: 12, imageUrl: '/images/products/chicken-sandwich.jpg' },
        { nameFa: 'سالاد سزار', category: 'food', price: 1750000, department: 'kitchen', descriptionFa: 'کاهو، مرغ، نان تست و سس سزار', prep: 10, imageUrl: '/images/products/caesar-salad.jpg' },
        { nameFa: 'چیزکیک', category: 'desserts', price: 1150000, department: 'kitchen', descriptionFa: 'چیزکیک نیویورکی با سس توت', prep: 3, imageUrl: '/images/products/cheesecake.jpg' },
        { nameFa: 'براونی', category: 'desserts', price: 980000, department: 'kitchen', descriptionFa: 'براونی شکلاتی گرم', prep: 4, imageUrl: '/images/products/brownie.jpg' },
      ];

      const productIds = new Map<string, string>();
      for (const product of products) {
        const id = randomUUID();
        db.prepare(
          `INSERT INTO products (id, category_id, name_fa, search_key, description_fa, base_price, department_id, prep_minutes, image_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          categoryIds.get(product.category)!,
          product.nameFa,
          normalizeForSearch(product.nameFa),
          product.descriptionFa,
          product.price,
          departmentIds.get(product.department)!,
          product.prep,
          product.imageUrl,
        );
        productIds.set(product.nameFa, id);
      }

      // Options and extras for the latte so the customer flow has real data.
      const latteId = productIds.get('لاته');
      if (latteId) {
        const groupId = randomUUID();
        db.prepare(
          'INSERT INTO option_groups (id, product_id, name_fa, min_select, max_select, is_required, sort_order) VALUES (?, ?, ?, 1, 1, 1, 1)',
        ).run(groupId, latteId, 'نوع شیر');
        const milkOptions = [
          { nameFa: 'شیر معمولی', delta: 0 },
          { nameFa: 'شیر بادام', delta: 180000 },
          { nameFa: 'شیر سویا', delta: 150000 },
        ];
        for (const [index, option] of milkOptions.entries()) {
          db.prepare(
            'INSERT INTO product_options (id, option_group_id, name_fa, price_delta, sort_order) VALUES (?, ?, ?, ?, ?)',
          ).run(randomUUID(), groupId, option.nameFa, option.delta, index);
        }

        const extraId = randomUUID();
        db.prepare('INSERT INTO extras (id, name_fa, price) VALUES (?, ?, ?)').run(extraId, 'شات اضافه', 220000);
        db.prepare('INSERT INTO product_extras (product_id, extra_id) VALUES (?, ?)').run(latteId, extraId);
      }
    }

    return { seeded: true, userIds };
  })();

  db.prepare(
    `INSERT INTO audit_logs (id, actor_user_id, actor_username, action, entity_type, entity_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    null,
    'system',
    'system.seed',
    'system',
    'seed',
    JSON.stringify({ demoMenu: options.demoMenu, demoStaff: options.demoStaff }),
    now(),
  );

  return seeded;
}

/** True when the installation already has an administrator account. */
export function isSeeded(db: Database): boolean {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return row.n > 0;
}
