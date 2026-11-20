import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

export interface CategoryRow {
  id: string;
  name_fa: string;
  slug: string;
  sort_order: number;
  is_active: number;
  product_count: number;
}

export interface ProductRow {
  id: string;
  category_id: string;
  category_name_fa: string;
  sort_order: number;
  name_fa: string;
  description_fa: string | null;
  base_price: number;
  department_id: string | null;
  department_name_fa: string | null;
  prep_minutes: number;
  image_url: string | null;
  is_available: number;
  is_active: number;
  is_archived: number;
  updated_at: string;
}

export interface OptionGroupRow {
  id: string;
  product_id: string;
  name_fa: string;
  min_select: number;
  max_select: number;
  is_required: number;
  sort_order: number;
}

export interface OptionRow {
  id: string;
  option_group_id: string;
  name_fa: string;
  price_delta: number;
  is_active: number;
  sort_order: number;
}

export interface ExtraRow {
  id: string;
  product_id: string;
  name_fa: string;
  price: number;
  is_active: number;
  sort_order: number;
}

export interface AvailabilityWindowRow {
  product_id: string;
  weekday: number | null;
  start_time: string;
  end_time: string;
}

export interface DepartmentRow {
  id: string;
  name_fa: string;
}

const PRODUCT_COLUMNS: Record<string, string> = {
  categoryId: 'category_id',
  nameFa: 'name_fa',
  searchKey: 'search_key',
  descriptionFa: 'description_fa',
  basePrice: 'base_price',
  departmentId: 'department_id',
  prepMinutes: 'prep_minutes',
  sortOrder: 'sort_order',
  imageUrl: 'image_url',
  isAvailable: 'is_available',
  isActive: 'is_active',
  isArchived: 'is_archived',
};

const CATEGORY_COLUMNS: Record<string, string> = {
  nameFa: 'name_fa',
  sortOrder: 'sort_order',
  isActive: 'is_active',
};

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * Data access for the catalogue. Every statement is parameterised and the
 * option tree is only ever replaced inside a transaction.
 */
@Injectable()
export class CatalogRepository {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  listCategories(): CategoryRow[] {
    return this.database.all<CategoryRow>(
      `SELECT c.id, c.name_fa, c.slug, c.sort_order, c.is_active,
              (SELECT COUNT(*)
                 FROM products p
                WHERE p.category_id = c.id
                  AND p.deleted_at IS NULL
                  AND p.is_archived = 0) AS product_count
         FROM categories c
        WHERE c.deleted_at IS NULL
        ORDER BY c.sort_order ASC, c.name_fa ASC`,
    );
  }

  findCategory(id: string): CategoryRow | undefined {
    return this.database.get<CategoryRow>(
      `SELECT c.id, c.name_fa, c.slug, c.sort_order, c.is_active,
              (SELECT COUNT(*)
                 FROM products p
                WHERE p.category_id = c.id
                  AND p.deleted_at IS NULL
                  AND p.is_archived = 0) AS product_count
         FROM categories c
        WHERE c.id = ? AND c.deleted_at IS NULL`,
      [id],
    );
  }

  slugTaken(slug: string): boolean {
    return this.database.count('SELECT COUNT(*) AS n FROM categories WHERE slug = ?', [slug]) > 0;
  }

  insertCategory(input: { id: string; nameFa: string; slug: string; sortOrder: number; isActive: boolean }) {
    this.database.run(
      `INSERT INTO categories (id, name_fa, slug, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [input.id, input.nameFa, input.slug, input.sortOrder, input.isActive ? 1 : 0],
    );
  }

  updateCategory(id: string, patch: Record<string, unknown>) {
    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, column] of Object.entries(CATEGORY_COLUMNS)) {
      if (patch[key] === undefined) continue;
      sets.push(`${column} = ?`);
      values.push(typeof patch[key] === 'boolean' ? (patch[key] ? 1 : 0) : patch[key]);
    }
    if (sets.length === 0) return;

    values.push(id);
    this.database.run(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, values);
  }

  /** One transaction for multi-row imports; repositories share the connection. */
  transaction<T>(fn: () => T): T {
    return this.database.transaction(fn);
  }

  /** Rewrites the whole visible order atomically, 1-based. */
  reorderCategories(ids: string[]): void {
    this.database.transaction(() => {
      ids.forEach((id, index) => {
        this.database.run('UPDATE categories SET sort_order = ? WHERE id = ? AND deleted_at IS NULL', [
          index + 1,
          id,
        ]);
      });
    });
  }

  softDeleteCategory(id: string) {
    this.database.run(
      `UPDATE categories SET deleted_at = ${NOW}, is_active = 0 WHERE id = ?`,
      [id],
    );
  }

  /** Any product still in the catalogue blocks deletion, archived or not. */
  countProductsInCategory(id: string): number {
    return this.database.count(
      'SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND deleted_at IS NULL',
      [id],
    );
  }

  listProducts(): ProductRow[] {
    return this.database.all<ProductRow>(
      `SELECT p.id, p.category_id, c.name_fa AS category_name_fa, p.name_fa, p.description_fa,
              p.base_price, p.department_id, d.name_fa AS department_name_fa, p.prep_minutes,
              p.image_url, p.is_available, p.is_active, p.is_archived, p.sort_order, p.updated_at
         FROM products p
         JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL
         LEFT JOIN departments d ON d.id = p.department_id
        WHERE p.deleted_at IS NULL
        ORDER BY c.sort_order ASC, p.sort_order ASC, p.name_fa ASC`,
    );
  }

  findProduct(id: string): ProductRow | undefined {
    return this.database.get<ProductRow>(
      `SELECT p.id, p.category_id, c.name_fa AS category_name_fa, p.name_fa, p.description_fa,
              p.base_price, p.department_id, d.name_fa AS department_name_fa, p.prep_minutes,
              p.image_url, p.is_available, p.is_active, p.is_archived, p.sort_order, p.updated_at
         FROM products p
         JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL
         LEFT JOIN departments d ON d.id = p.department_id
        WHERE p.id = ? AND p.deleted_at IS NULL`,
      [id],
    );
  }

  findProductBySearchKey(categoryId: string, searchKey: string): ProductRow | undefined {
    return this.database.get<ProductRow>(
      `SELECT p.id, p.category_id, c.name_fa AS category_name_fa, p.name_fa, p.description_fa,
              p.base_price, p.department_id, d.name_fa AS department_name_fa, p.prep_minutes,
              p.image_url, p.is_available, p.is_active, p.is_archived, p.sort_order, p.updated_at
         FROM products p
         JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL
         LEFT JOIN departments d ON d.id = p.department_id
        WHERE p.category_id = ? AND p.search_key = ? AND p.deleted_at IS NULL`,
      [categoryId, searchKey],
    );
  }

  insertProduct(input: {
    id: string;
    categoryId: string;
    nameFa: string;
    searchKey: string;
    descriptionFa: string | null;
    basePrice: number;
    departmentId: string | null;
    prepMinutes: number;
    sortOrder: number;
    imageUrl: string | null;
    isAvailable: boolean;
    isActive: boolean;
  }) {
    this.database.run(
      `INSERT INTO products
        (id, category_id, name_fa, search_key, description_fa, base_price, department_id,
         prep_minutes, sort_order, image_url, is_available, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.categoryId,
        input.nameFa,
        input.searchKey,
        input.descriptionFa,
        input.basePrice,
        input.departmentId,
        input.prepMinutes,
        input.sortOrder,
        input.imageUrl,
        input.isAvailable ? 1 : 0,
        input.isActive ? 1 : 0,
      ],
    );
  }

  /** A new product is appended to the end of its category. */
  nextProductSortOrder(categoryId: string): number {
    const row = this.database.get<{ next: number }>(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM products WHERE category_id = ? AND deleted_at IS NULL',
      [categoryId],
    );
    return row?.next ?? 1;
  }

  /** Rewrites the order of one category atomically, 1-based. */
  reorderProducts(categoryId: string, ids: string[]): void {
    this.database.transaction(() => {
      ids.forEach((id, index) => {
        this.database.run(
          `UPDATE products SET sort_order = ?, updated_at = ${NOW}
            WHERE id = ? AND category_id = ? AND deleted_at IS NULL`,
          [index + 1, id, categoryId],
        );
      });
    });
  }

  updateProduct(id: string, patch: Record<string, unknown>) {
    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, column] of Object.entries(PRODUCT_COLUMNS)) {
      if (patch[key] === undefined) continue;
      sets.push(`${column} = ?`);
      values.push(typeof patch[key] === 'boolean' ? (patch[key] ? 1 : 0) : patch[key]);
    }
    if (sets.length === 0) return;

    sets.push(`updated_at = ${NOW}`);
    values.push(id);
    this.database.run(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, values);
  }

  listOptionGroups(): OptionGroupRow[] {
    return this.database.all<OptionGroupRow>(
      `SELECT id, product_id, name_fa, min_select, max_select, is_required, sort_order
         FROM option_groups
        ORDER BY sort_order ASC, name_fa ASC`,
    );
  }

  listOptions(): OptionRow[] {
    return this.database.all<OptionRow>(
      `SELECT id, option_group_id, name_fa, price_delta, is_active, sort_order
         FROM product_options
        ORDER BY sort_order ASC, name_fa ASC`,
    );
  }

  deleteOptionGroups(productId: string) {
    this.database.run('DELETE FROM option_groups WHERE product_id = ?', [productId]);
  }

  insertOptionGroup(input: {
    id: string;
    productId: string;
    nameFa: string;
    minSelect: number;
    maxSelect: number;
    isRequired: boolean;
    sortOrder: number;
  }) {
    this.database.run(
      `INSERT INTO option_groups (id, product_id, name_fa, min_select, max_select, is_required, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.productId,
        input.nameFa,
        input.minSelect,
        input.maxSelect,
        input.isRequired ? 1 : 0,
        input.sortOrder,
      ],
    );
  }

  insertOption(input: {
    id: string;
    optionGroupId: string;
    nameFa: string;
    priceDelta: number;
    isActive: boolean;
    sortOrder: number;
  }) {
    this.database.run(
      `INSERT INTO product_options (id, option_group_id, name_fa, price_delta, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.optionGroupId,
        input.nameFa,
        input.priceDelta,
        input.isActive ? 1 : 0,
        input.sortOrder,
      ],
    );
  }

  listProductExtras(): ExtraRow[] {
    return this.database.all<ExtraRow>(
      `SELECT pe.product_id, e.id, e.name_fa, e.price, e.is_active, pe.rowid AS sort_order
         FROM product_extras pe
         JOIN extras e ON e.id = pe.extra_id
        ORDER BY pe.rowid ASC`,
    );
  }

  listAvailabilityWindows(): AvailabilityWindowRow[] {
    return this.database.all<AvailabilityWindowRow>(
      `SELECT product_id, weekday, start_time, end_time
         FROM availability_windows
        WHERE is_active = 1
        ORDER BY product_id, rowid`,
    );
  }

  replaceAvailabilityWindows(
    productId: string,
    windows: Array<{ weekday: number | null; startTime: string; endTime: string }>,
  ) {
    this.database.transaction(() => {
      this.database.run('DELETE FROM availability_windows WHERE product_id = ?', [productId]);
      windows.forEach((window) => {
        this.database.run(
          `INSERT INTO availability_windows (id, product_id, weekday, start_time, end_time, is_active)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [randomUUID(), productId, window.weekday, window.startTime, window.endTime],
        );
      });
    });
  }

  departments(): DepartmentRow[] {
    return this.database.all<DepartmentRow>('SELECT id, name_fa FROM departments ORDER BY name_fa ASC');
  }

  /** Replaces one product's extras atomically; used extras retain order snapshots. */
  replaceProductExtras(
    productId: string,
    extras: Array<{ nameFa: string; price: number; isActive: boolean }>,
  ) {
    return this.database.transaction(() => {
      const previous = this.database.all<{ extra_id: string }>(
        'SELECT extra_id FROM product_extras WHERE product_id = ?',
        [productId],
      );
      this.database.run('DELETE FROM product_extras WHERE product_id = ?', [productId]);
      for (const extra of extras) {
        const extraId = randomUUID();
        this.database.run(
          'INSERT INTO extras (id, name_fa, price, is_active) VALUES (?, ?, ?, ?)',
          [extraId, extra.nameFa, extra.price, extra.isActive ? 1 : 0],
        );
        this.database.run('INSERT INTO product_extras (product_id, extra_id) VALUES (?, ?)', [productId, extraId]);
      }
      for (const { extra_id: extraId } of previous) {
        this.database.run(
          'DELETE FROM extras WHERE id = ? AND NOT EXISTS (SELECT 1 FROM product_extras WHERE extra_id = ?)',
          [extraId, extraId],
        );
      }
    });
  }

  /** Runs the option-tree replacement atomically and returns the new ids. */
  replaceOptions(
    productId: string,
    groups: Array<{
      nameFa: string;
      minSelect: number;
      maxSelect: number;
      isRequired: boolean;
      options: Array<{ nameFa: string; priceDelta: number; isActive: boolean }>;
    }>,
  ) {
    return this.database.transaction(() => {
      this.deleteOptionGroups(productId);

      groups.forEach((group, groupIndex) => {
        const groupId = randomUUID();
        this.insertOptionGroup({
          id: groupId,
          productId,
          nameFa: group.nameFa,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          isRequired: group.isRequired,
          sortOrder: groupIndex,
        });

        group.options.forEach((option, optionIndex) => {
          this.insertOption({
            id: randomUUID(),
            optionGroupId: groupId,
            nameFa: option.nameFa,
            priceDelta: option.priceDelta,
            isActive: option.isActive,
            sortOrder: optionIndex,
          });
        });
      });
    });
  }
}
