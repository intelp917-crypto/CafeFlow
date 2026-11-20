import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  isSafeProductImageUrl,
  normalizeForSearch,
  normalizePersian,
  type CatalogAvailabilityWindow,
  type CatalogImportInput,
  type CatalogImportResult,
  type CatalogImportRow,
  type CatalogCategory,
  type CatalogExtra,
  type CatalogOptionGroup,
  type CatalogProduct,
  type CatalogResponse,
  type CreateCategoryInput,
  type CreateProductInput,
  type ProductOptionsInput,
  type ProductExtrasInput,
  type ProductAvailabilityInput,
  type ReorderCategoriesInput,
  type ReorderProductsInput,
  type UpdateCategoryInput,
  type UpdateProductInput,
} from '@cafeflow/shared';
import { badRequest, conflict, notFound } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import {
  CatalogRepository,
  type CategoryRow,
  type ExtraRow,
  type AvailabilityWindowRow,
  type OptionGroupRow,
  type OptionRow,
  type ProductRow,
} from './catalog.repository';

export interface ActingUser {
  userId: string;
  username: string;
}

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** `hot-drinks` style slug; Persian names fall back to a readable id. */
function slugify(name: string, id: string): string {
  const base = normalizeForSearch(name)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length > 0 ? base : `category-${id.slice(0, 8)}`;
}

/** RFC 4180-ish parser: quotes, doubled quotes, CRLF and commas inside fields. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (quoted) {
    throw badRequest('نقل‌قول در فایل CSV بسته نشده است.', 'CSV_UNTERMINATED_QUOTE');
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Accepts Persian digits, thousands separators and stray spaces. */
function parseIntegerCell(value: string): number | null {
  const normalized = normalizePersian(value).replace(/[^\d-]/g, '');
  if (normalized === '' || normalized === '-') return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** `undefined` means "not provided"; `null` means "provided but unreadable". */
function parseFlagCell(value: string): boolean | undefined | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return undefined;
  if (['true', '1', 'yes', 'y', 'فعال', 'بله', 'دارد'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'غیرفعال', 'نه', 'ندارد'].includes(normalized)) return false;
  return null;
}

interface ImportPlan {
  line: number;
  action: CatalogImportRow['action'];
  nameFa: string;
  categoryNameFa: string;
  messageFa: string | null;
  categoryKey: string;
  categoryId: string;
  categoryIsNew: boolean;
  existingProductId: string | null;
  price: number | null;
  descriptionFa: string | null;
  departmentId: string | null;
  prepMinutes: number | null;
  imageUrl: string | null;
  isAvailable: boolean | null;
  isActive: boolean | null;
}

/**
 * Catalogue writes.
 *
 * The rules mirror what the customer menu already assumed: a product appears on
 * the QR menu only when its category and itself are active and it is not
 * archived, and every price is an integer rial. Nothing here deletes rows that
 * orders point at — deletion is an archive plus a soft delete for categories.
 */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(CatalogRepository) private readonly repository: CatalogRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private toCategory(row: CategoryRow): CatalogCategory {
    return {
      id: row.id,
      nameFa: row.name_fa,
      slug: row.slug,
      sortOrder: row.sort_order,
      isActive: row.is_active === 1,
      productCount: row.product_count,
    };
  }

  private optionTree() {
    const groups = this.repository.listOptionGroups();
    const options = this.repository.listOptions();

    const optionsByGroup = new Map<string, OptionRow[]>();
    for (const option of options) {
      const list = optionsByGroup.get(option.option_group_id) ?? [];
      list.push(option);
      optionsByGroup.set(option.option_group_id, list);
    }

    const groupsByProduct = new Map<string, OptionGroupRow[]>();
    for (const group of groups) {
      const list = groupsByProduct.get(group.product_id) ?? [];
      list.push(group);
      groupsByProduct.set(group.product_id, list);
    }

    return { optionsByGroup, groupsByProduct };
  }

  private extrasTree(): Map<string, ExtraRow[]> {
    const byProduct = new Map<string, ExtraRow[]>();
    for (const extra of this.repository.listProductExtras()) {
      const list = byProduct.get(extra.product_id) ?? [];
      list.push(extra);
      byProduct.set(extra.product_id, list);
    }
    return byProduct;
  }

  private availabilityTree(): Map<string, AvailabilityWindowRow[]> {
    const byProduct = new Map<string, AvailabilityWindowRow[]>();
    for (const window of this.repository.listAvailabilityWindows()) {
      const list = byProduct.get(window.product_id) ?? [];
      list.push(window);
      byProduct.set(window.product_id, list);
    }
    return byProduct;
  }

  private toProduct(
    row: ProductRow,
    groupsByProduct: Map<string, OptionGroupRow[]>,
    optionsByGroup: Map<string, OptionRow[]>,
    extrasByProduct: Map<string, ExtraRow[]>,
    availabilityByProduct: Map<string, AvailabilityWindowRow[]>,
  ): CatalogProduct {
    const optionGroups: CatalogOptionGroup[] = (groupsByProduct.get(row.id) ?? []).map((group) => ({
      id: group.id,
      nameFa: group.name_fa,
      minSelect: group.min_select,
      maxSelect: group.max_select,
      isRequired: group.is_required === 1,
      options: (optionsByGroup.get(group.id) ?? []).map((option) => ({
        id: option.id,
        nameFa: option.name_fa,
        priceDelta: option.price_delta,
        isActive: option.is_active === 1,
      })),
    }));

    return {
      id: row.id,
      categoryId: row.category_id,
      categoryNameFa: row.category_name_fa,
      sortOrder: row.sort_order,
      nameFa: row.name_fa,
      descriptionFa: row.description_fa,
      basePrice: row.base_price,
      departmentId: row.department_id,
      departmentNameFa: row.department_name_fa,
      prepMinutes: row.prep_minutes,
      imageUrl: row.image_url,
      isAvailable: row.is_available === 1,
      isActive: row.is_active === 1,
      isArchived: row.is_archived === 1,
      updatedAt: row.updated_at,
      optionGroups,
      extras: (extrasByProduct.get(row.id) ?? []).map((extra): CatalogExtra => ({
        id: extra.id,
        nameFa: extra.name_fa,
        price: extra.price,
        isActive: extra.is_active === 1,
      })),
      availabilityWindows: (availabilityByProduct.get(row.id) ?? []).map(
        (window): CatalogAvailabilityWindow => ({
          weekday: window.weekday,
          startTime: window.start_time,
          endTime: window.end_time,
        }),
      ),
    };
  }

  private findProductOrFail(id: string): ProductRow {
    const row = this.repository.findProduct(id);
    if (!row) throw notFound('این محصول در منو نیست.', 'PRODUCT_NOT_FOUND');
    return row;
  }

  private requireCategory(categoryId: string): CategoryRow {
    const category = this.repository.findCategory(categoryId);
    if (!category) throw badRequest('دستهٔ انتخاب‌شده وجود ندارد یا حذف شده است.', 'CATEGORY_NOT_FOUND');
    return category;
  }

  private requireDepartment(departmentId: string | null | undefined): string | null {
    if (!departmentId) return null;
    const found = this.repository.departments().some((row) => row.id === departmentId);
    if (!found) throw badRequest('واحد آماده‌سازی انتخاب‌شده وجود ندارد.', 'DEPARTMENT_NOT_FOUND');
    return departmentId;
  }

  private assertCategoryNameFree(nameFa: string, exceptId?: string) {
    const wanted = normalizeForSearch(nameFa);
    const duplicate = this.repository
      .listCategories()
      .find((row) => row.id !== exceptId && normalizeForSearch(row.name_fa) === wanted);
    if (duplicate) throw conflict(`دستهٔ «${duplicate.name_fa}» از قبل وجود دارد.`, 'CATEGORY_EXISTS');
  }

  private assertProductNameFree(categoryId: string, nameFa: string, exceptId?: string) {
    const existing = this.repository.findProductBySearchKey(categoryId, normalizeForSearch(nameFa));
    if (existing && existing.id !== exceptId) {
      throw conflict(`محصول «${existing.name_fa}» در این دسته از قبل وجود دارد.`, 'PRODUCT_EXISTS');
    }
  }

  private record(
    action: string,
    entityType: 'category' | 'product',
    entityId: string,
    actor: ActingUser,
    meta: RequestMeta,
    before: unknown,
    after: unknown,
  ) {
    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action,
      entityType,
      entityId,
      before,
      after,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
  }

  getCatalog(): CatalogResponse {
    const { groupsByProduct, optionsByGroup } = this.optionTree();
    const extrasByProduct = this.extrasTree();
    const availabilityByProduct = this.availabilityTree();

    return {
      categories: this.repository.listCategories().map((row) => this.toCategory(row)),
      products: this.repository
        .listProducts()
        .map((row) => this.toProduct(row, groupsByProduct, optionsByGroup, extrasByProduct, availabilityByProduct)),
      departments: this.repository.departments().map((row) => ({ id: row.id, nameFa: row.name_fa })),
    };
  }

  /* -------------------------------- categories ------------------------------- */

  createCategory(input: CreateCategoryInput, actor: ActingUser, meta: RequestMeta): CatalogCategory {
    const nameFa = normalizePersian(input.nameFa);
    this.assertCategoryNameFree(nameFa);

    const id = randomUUID();
    let slug = slugify(nameFa, id);
    if (this.repository.slugTaken(slug)) slug = `${slug}-${id.slice(0, 6)}`;

    const sortOrder =
      input.sortOrder ??
      this.repository.listCategories().reduce((max, row) => Math.max(max, row.sort_order), 0) + 1;

    this.repository.insertCategory({
      id,
      nameFa,
      slug,
      sortOrder,
      isActive: input.isActive ?? true,
    });

    const created = this.toCategory(this.repository.findCategory(id) as CategoryRow);
    this.record('catalog.category.create', 'category', id, actor, meta, null, created);
    return created;
  }

  updateCategory(
    id: string,
    input: UpdateCategoryInput,
    actor: ActingUser,
    meta: RequestMeta,
  ): CatalogCategory {
    const existing = this.repository.findCategory(id);
    if (!existing) throw notFound('این دسته یافت نشد.', 'CATEGORY_NOT_FOUND');

    const patch: Record<string, unknown> = {};
    if (input.nameFa !== undefined) {
      const nameFa = normalizePersian(input.nameFa);
      this.assertCategoryNameFree(nameFa, id);
      patch.nameFa = nameFa;
    }
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    this.repository.updateCategory(id, patch);

    const updated = this.toCategory(this.repository.findCategory(id) as CategoryRow);
    this.record('catalog.category.update', 'category', id, actor, meta, this.toCategory(existing), updated);
    return updated;
  }

  /**
   * Takes the full ordered list from the client and rewrites `sort_order` in
   * one transaction. An unknown or missing id is rejected, so two managers
   * editing at once cannot silently drop a category from the order.
   */
  reorderCategories(input: ReorderCategoriesInput, actor: ActingUser, meta: RequestMeta): CatalogCategory[] {
    const current = this.repository.listCategories();
    const known = new Set(current.map((row) => row.id));
    const unique = new Set(input.ids);

    if (unique.size !== input.ids.length || input.ids.some((id) => !known.has(id))) {
      throw badRequest('فهرست دسته‌ها با ترتیب ذخیره‌شده هم‌خوان نیست؛ صفحه را تازه کنید.', 'CATEGORY_ORDER_STALE');
    }
    if (input.ids.length !== current.length) {
      throw badRequest('برای تغییر ترتیب، همهٔ دسته‌های فعال را بفرستید.', 'CATEGORY_ORDER_INCOMPLETE');
    }

    this.repository.reorderCategories(input.ids);

    const after = this.repository.listCategories().map((row) => this.toCategory(row));
    this.record(
      'catalog.category.reorder',
      'category',
      'order',
      actor,
      meta,
      current.map((row) => ({ id: row.id, sortOrder: row.sort_order })),
      after.map((row) => ({ id: row.id, sortOrder: row.sortOrder })),
    );
    return after;
  }

  /**
   * Bulk menu import. Invalid rows are reported and skipped; valid rows are
   * written in one transaction, so a 300-row file is not lost because of one
   * typo. `dryRun` returns exactly the same report without touching the data.
   */
  importCatalog(input: CatalogImportInput, actor: ActingUser, meta: RequestMeta): CatalogImportResult {
    const table = parseCsv(input.csv.replace(/^\uFEFF/, '')).filter((row) =>
      row.some((cell) => cell.trim() !== ''),
    );
    if (table.length < 2) {
      throw badRequest('فایل باید یک سطر سرستون و حداقل یک محصول داشته باشد.', 'CSV_EMPTY');
    }

    const header = table[0]!.map((cell) => cell.trim().toLowerCase());
    const column = (key: string) => header.indexOf(key.toLowerCase());
    if (column('category') < 0 || column('name') < 0 || column('price') < 0) {
      throw badRequest('سرستون‌های category، name و price در سطر اول الزامی‌اند.', 'CSV_HEADER');
    }

    const body = table.slice(1);
    if (body.length > 1000) {
      throw badRequest('حداکثر ۱۰۰۰ محصول در هر ایمپورت مجاز است.', 'CSV_TOO_LARGE');
    }

    const categories = new Map(
      this.repository.listCategories().map((row) => [normalizeForSearch(row.name_fa), row] as const),
    );
    const departments = this.repository.departments();
    const baseSort = [...categories.values()].reduce((max, row) => Math.max(max, row.sort_order), 0);
    const newCategoryIds = new Map<string, string>();
    const seenProducts = new Set<string>();
    const plans: ImportPlan[] = [];

    body.forEach((cells, offset) => {
      const line = offset + 2;
      const cell = (key: string) => {
        const at = column(key);
        return at >= 0 ? (cells[at] ?? '').trim() : '';
      };

      const categoryNameFa = normalizePersian(cell('category'));
      const nameFa = normalizePersian(cell('name'));
      const fail = (messageFa: string) =>
        plans.push({
          line,
          action: 'error',
          nameFa: nameFa || `سطر ${line}`,
          categoryNameFa,
          messageFa,
          categoryKey: '',
          categoryId: '',
          categoryIsNew: false,
          existingProductId: null,
          price: null,
          descriptionFa: null,
          departmentId: null,
          prepMinutes: null,
          imageUrl: null,
          isAvailable: null,
          isActive: null,
        });

      if (categoryNameFa === '' || nameFa === '') {
        fail('نام دسته و نام محصول الزامی است.');
        return;
      }

      const categoryKey = normalizeForSearch(categoryNameFa);
      const existingCategory = categories.get(categoryKey);
      let categoryId = existingCategory?.id ?? newCategoryIds.get(categoryKey);
      if (!categoryId) {
        categoryId = randomUUID();
        newCategoryIds.set(categoryKey, categoryId);
      }

      const searchKey = normalizeForSearch(nameFa);
      const productKey = `${categoryId}|${searchKey}`;
      if (seenProducts.has(productKey)) {
        fail('این محصول در همین فایل تکرار شده است.');
        return;
      }
      seenProducts.add(productKey);

      const existingProduct = existingCategory
        ? this.repository.findProductBySearchKey(existingCategory.id, searchKey)
        : undefined;

      const priceText = cell('price');
      const price = priceText === '' ? null : parseIntegerCell(priceText);
      if (priceText !== '' && price === null) {
        fail('قیمت باید عدد صحیح ریال باشد.');
        return;
      }
      if (price !== null && price < 0) {
        fail('قیمت نمی‌تواند منفی باشد.');
        return;
      }
      if (!existingProduct && price === null) {
        fail('برای محصول تازه، قیمت الزامی است.');
        return;
      }

      let departmentId: string | null = null;
      const departmentName = normalizePersian(cell('department'));
      if (departmentName !== '') {
        const found = departments.find(
          (row) => normalizeForSearch(row.name_fa) === normalizeForSearch(departmentName),
        );
        if (!found) {
          fail(`واحد آماده‌سازی «${departmentName}» پیدا نشد.`);
          return;
        }
        departmentId = found.id;
      }

      const prepText = cell('prepMinutes');
      let prepMinutes: number | null = null;
      if (prepText !== '') {
        const parsed = parseIntegerCell(prepText);
        if (parsed === null || parsed < 0 || parsed > 240) {
          fail('زمان آماده‌سازی باید عدد صحیح بین ۰ و ۲۴۰ دقیقه باشد.');
          return;
        }
        prepMinutes = parsed;
      }

      const imageText = cell('imageUrl');
      if (imageText !== '' && !isSafeProductImageUrl(imageText)) {
        fail('نشانی تصویر باید HTTPS یا مسیر هم‌مبدأ باشد.');
        return;
      }

      const availableFlag = parseFlagCell(cell('isAvailable'));
      if (availableFlag === null) {
        fail('مقدار isAvailable باید true یا false باشد.');
        return;
      }
      const activeFlag = parseFlagCell(cell('isActive'));
      if (activeFlag === null) {
        fail('مقدار isActive باید true یا false باشد.');
        return;
      }

      plans.push({
        line,
        action: existingProduct ? 'updated' : 'created',
        nameFa,
        categoryNameFa,
        messageFa: null,
        categoryKey,
        categoryId,
        categoryIsNew: !existingCategory,
        existingProductId: existingProduct?.id ?? null,
        price,
        descriptionFa: cell('description') === '' ? null : normalizePersian(cell('description')),
        departmentId,
        prepMinutes,
        imageUrl: imageText === '' ? null : imageText,
        isAvailable: availableFlag ?? null,
        isActive: activeFlag ?? null,
      });
    });

    const writable = plans.filter((plan) => plan.action !== 'error');
    const plannedCategories = new Set(
      writable.filter((plan) => plan.categoryIsNew).map((plan) => plan.categoryKey),
    );

    let categoriesCreated = plannedCategories.size;
    if (!input.dryRun && writable.length > 0) {
      categoriesCreated = this.applyImport(writable, categories, baseSort);
    }

    const summary = {
      created: writable.filter((plan) => plan.action === 'created').length,
      updated: writable.filter((plan) => plan.action === 'updated').length,
      errors: plans.length - writable.length,
      categoriesCreated,
    };

    if (!input.dryRun && writable.length > 0) {
      this.audit.record({
        actorUserId: actor.userId,
        actorUsername: actor.username,
        action: 'catalog.import',
        entityType: 'catalog',
        entityId: 'menu',
        before: null,
        after: summary,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
    }

    return {
      dryRun: Boolean(input.dryRun),
      rows: plans.map((plan) => ({
        line: plan.line,
        action: plan.action,
        nameFa: plan.nameFa,
        categoryNameFa: plan.categoryNameFa,
        messageFa: plan.messageFa,
      })),
      summary,
    };
  }

  /** Writes the valid plans in one transaction and returns new category count. */
  private applyImport(
    plans: ImportPlan[],
    categories: Map<string, CategoryRow>,
    baseSort: number,
  ): number {
    let createdCategories = 0;
    let sortCursor = baseSort;

    this.repository.transaction(() => {
      for (const plan of plans) {
        if (!categories.has(plan.categoryKey)) {
          sortCursor += 1;
          let slug = slugify(plan.categoryNameFa, plan.categoryId);
          if (this.repository.slugTaken(slug)) slug = `${slug}-${plan.categoryId.slice(0, 6)}`;
          this.repository.insertCategory({
            id: plan.categoryId,
            nameFa: plan.categoryNameFa,
            slug,
            sortOrder: sortCursor,
            isActive: true,
          });
          categories.set(plan.categoryKey, {
            id: plan.categoryId,
            name_fa: plan.categoryNameFa,
            slug,
            sort_order: sortCursor,
            is_active: 1,
            product_count: 0,
          });
          createdCategories += 1;
        }

        if (plan.existingProductId) {
          const patch: Record<string, unknown> = {};
          if (plan.price !== null) patch.basePrice = plan.price;
          if (plan.descriptionFa !== null) patch.descriptionFa = plan.descriptionFa;
          if (plan.departmentId !== null) patch.departmentId = plan.departmentId;
          if (plan.prepMinutes !== null) patch.prepMinutes = plan.prepMinutes;
          if (plan.imageUrl !== null) patch.imageUrl = plan.imageUrl;
          if (plan.isAvailable !== null) patch.isAvailable = plan.isAvailable;
          if (plan.isActive !== null) patch.isActive = plan.isActive;
          if (Object.keys(patch).length > 0) this.repository.updateProduct(plan.existingProductId, patch);
          continue;
        }

        this.repository.insertProduct({
          id: randomUUID(),
          categoryId: plan.categoryId,
          nameFa: plan.nameFa,
          searchKey: normalizeForSearch(plan.nameFa),
          descriptionFa: plan.descriptionFa,
          basePrice: plan.price ?? 0,
          departmentId: plan.departmentId,
          prepMinutes: plan.prepMinutes ?? 10,
          sortOrder: this.repository.nextProductSortOrder(plan.categoryId),
          imageUrl: plan.imageUrl,
          isAvailable: plan.isAvailable ?? true,
          isActive: plan.isActive ?? true,
        });
      }
    });

    return createdCategories;
  }

  deleteCategory(id: string, actor: ActingUser, meta: RequestMeta) {
    const existing = this.repository.findCategory(id);
    if (!existing) throw notFound('این دسته یافت نشد.', 'CATEGORY_NOT_FOUND');

    const products = this.repository.countProductsInCategory(id);
    if (products > 0) {
      throw conflict(
        `این دسته ${products} محصول دارد؛ ابتدا محصولات را جابه‌جا یا بایگانی کنید.`,
        'CATEGORY_NOT_EMPTY',
      );
    }

    this.repository.softDeleteCategory(id);
    this.record('catalog.category.delete', 'category', id, actor, meta, this.toCategory(existing), null);
    return { id };
  }

  /* --------------------------------- products -------------------------------- */

  createProduct(input: CreateProductInput, actor: ActingUser, meta: RequestMeta): CatalogProduct {
    this.requireCategory(input.categoryId);
    const nameFa = normalizePersian(input.nameFa);
    this.assertProductNameFree(input.categoryId, nameFa);

    const id = randomUUID();
    this.repository.insertProduct({
      id,
      categoryId: input.categoryId,
      nameFa,
      searchKey: normalizeForSearch(nameFa),
      descriptionFa: input.descriptionFa ? normalizePersian(input.descriptionFa) : null,
      basePrice: input.basePrice,
      departmentId: this.requireDepartment(input.departmentId),
      prepMinutes: input.prepMinutes ?? 10,
      sortOrder: this.repository.nextProductSortOrder(input.categoryId),
      imageUrl: input.imageUrl || null,
      isAvailable: input.isAvailable ?? true,
      isActive: input.isActive ?? true,
    });

    const { groupsByProduct, optionsByGroup } = this.optionTree();
    const created = this.toProduct(
      this.findProductOrFail(id),
      groupsByProduct,
      optionsByGroup,
      this.extrasTree(),
      this.availabilityTree(),
    );
    this.record('catalog.product.create', 'product', id, actor, meta, null, created);
    return created;
  }

  updateProduct(
    id: string,
    input: UpdateProductInput,
    actor: ActingUser,
    meta: RequestMeta,
  ): CatalogProduct {
    const existing = this.findProductOrFail(id);
    const patch: Record<string, unknown> = {};

    if (input.categoryId !== undefined && input.categoryId !== existing.category_id) {
      this.requireCategory(input.categoryId);
      patch.categoryId = input.categoryId;
      // Moving to another category puts the product at the end of its new list
      // instead of inheriting a position that belongs to the old category.
      patch.sortOrder = this.repository.nextProductSortOrder(input.categoryId);
    }

    if (input.nameFa !== undefined) {
      const nameFa = normalizePersian(input.nameFa);
      this.assertProductNameFree(input.categoryId ?? existing.category_id, nameFa, id);
      patch.nameFa = nameFa;
      patch.searchKey = normalizeForSearch(nameFa);
    }

    if (input.descriptionFa !== undefined) {
      patch.descriptionFa = input.descriptionFa ? normalizePersian(input.descriptionFa) : null;
    }
    if (input.basePrice !== undefined) patch.basePrice = input.basePrice;
    if (input.departmentId !== undefined) patch.departmentId = this.requireDepartment(input.departmentId);
    if (input.prepMinutes !== undefined) patch.prepMinutes = input.prepMinutes;
    if (input.imageUrl !== undefined) patch.imageUrl = input.imageUrl || null;
    if (input.isAvailable !== undefined) patch.isAvailable = input.isAvailable;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    if (input.isArchived !== undefined) patch.isArchived = input.isArchived;

    this.repository.updateProduct(id, patch);

    const { groupsByProduct, optionsByGroup } = this.optionTree();
    const extrasByProduct = this.extrasTree();
    const availabilityByProduct = this.availabilityTree();
    const updatedRow = this.findProductOrFail(id);
    const before = this.toProduct(existing, groupsByProduct, optionsByGroup, extrasByProduct, availabilityByProduct);
    const after = this.toProduct(updatedRow, groupsByProduct, optionsByGroup, extrasByProduct, availabilityByProduct);
    this.record('catalog.product.update', 'product', id, actor, meta, before, after);
    return after;
  }

  archiveProduct(id: string, actor: ActingUser, meta: RequestMeta) {
    return this.updateProduct(id, { isArchived: true }, actor, meta);
  }

  restoreProduct(id: string, actor: ActingUser, meta: RequestMeta) {
    return this.updateProduct(id, { isArchived: false }, actor, meta);
  }

  /**
   * Rewrites the display order of one category. The complete list is required,
   * so a stale page (or a product archived in another tab) is rejected instead
   * of producing an order that silently loses a row.
   */
  reorderProducts(
    input: ReorderProductsInput,
    actor: ActingUser,
    meta: RequestMeta,
  ): CatalogProduct[] {
    const current = this.repository.listProducts().filter((row) => row.category_id === input.categoryId);
    const known = new Set(current.map((row) => row.id));
    const unique = new Set(input.ids);

    if (unique.size !== input.ids.length || input.ids.some((id) => !known.has(id))) {
      throw badRequest(
        'فهرست محصولات با ترتیب ذخیره‌شده هم‌خوان نیست؛ صفحه را تازه کنید.',
        'PRODUCT_ORDER_STALE',
      );
    }
    if (input.ids.length !== current.length) {
      throw badRequest(
        'برای تغییر ترتیب، همهٔ محصولات این دسته را بفرستید.',
        'PRODUCT_ORDER_INCOMPLETE',
      );
    }

    this.repository.reorderProducts(input.categoryId, input.ids);

    const { groupsByProduct, optionsByGroup } = this.optionTree();
    const extrasByProduct = this.extrasTree();
    const availabilityByProduct = this.availabilityTree();
    const after = this.repository
      .listProducts()
      .filter((row) => row.category_id === input.categoryId)
      .map((row) => this.toProduct(row, groupsByProduct, optionsByGroup, extrasByProduct, availabilityByProduct));

    this.record(
      'catalog.product.reorder',
      'product',
      input.categoryId,
      actor,
      meta,
      current.map((row) => ({ id: row.id, sortOrder: row.sort_order })),
      after.map((row) => ({ id: row.id, sortOrder: row.sortOrder })),
    );
    return after;
  }

  replaceExtras(
    id: string,
    input: ProductExtrasInput,
    actor: ActingUser,
    meta: RequestMeta,
  ): CatalogProduct {
    const existing = this.findProductOrFail(id);
    const before = this.extrasTree().get(id) ?? [];
    const extras = input.extras.map((extra) => ({
      nameFa: normalizePersian(extra.nameFa),
      price: extra.price,
      isActive: extra.isActive ?? true,
    }));

    this.repository.replaceProductExtras(id, extras);

    const after = this.extrasTree().get(id) ?? [];
    const { groupsByProduct, optionsByGroup } = this.optionTree();
    const product = this.toProduct(
      existing,
      groupsByProduct,
      optionsByGroup,
      this.extrasTree(),
      this.availabilityTree(),
    );
    this.record('catalog.product.extras', 'product', id, actor, meta, before, after);
    return product;
  }

  replaceAvailability(
    id: string,
    input: ProductAvailabilityInput,
    actor: ActingUser,
    meta: RequestMeta,
  ): CatalogProduct {
    const existing = this.findProductOrFail(id);
    const before = this.availabilityTree().get(id) ?? [];
    const windows = input.windows.map((window) => ({
      weekday: window.weekday,
      startTime: window.startTime,
      endTime: window.endTime,
    }));

    this.repository.replaceAvailabilityWindows(id, windows);

    const after = this.availabilityTree().get(id) ?? [];
    const { groupsByProduct, optionsByGroup } = this.optionTree();
    const product = this.toProduct(
      existing,
      groupsByProduct,
      optionsByGroup,
      this.extrasTree(),
      this.availabilityTree(),
    );
    this.record('catalog.product.availability', 'product', id, actor, meta, before, after);
    return product;
  }

  replaceOptions(
    id: string,
    input: ProductOptionsInput,
    actor: ActingUser,
    meta: RequestMeta,
  ): CatalogProduct {
    const existing = this.findProductOrFail(id);
    const beforeTree = this.optionTree();
    const before = this.toProduct(
      existing,
      beforeTree.groupsByProduct,
      beforeTree.optionsByGroup,
      this.extrasTree(),
      this.availabilityTree(),
    );

    const groups = input.groups.map((group) => ({
      nameFa: normalizePersian(group.nameFa),
      minSelect: group.minSelect ?? 0,
      maxSelect: group.maxSelect ?? 1,
      isRequired: group.isRequired ?? false,
      options: group.options.map((option) => ({
        nameFa: normalizePersian(option.nameFa),
        priceDelta: option.priceDelta ?? 0,
        isActive: option.isActive ?? true,
      })),
    }));

    this.repository.replaceOptions(id, groups);

    const afterTree = this.optionTree();
    const after = this.toProduct(
      this.findProductOrFail(id),
      afterTree.groupsByProduct,
      afterTree.optionsByGroup,
      this.extrasTree(),
      this.availabilityTree(),
    );
    this.record('catalog.product.options', 'product', id, actor, meta, before.optionGroups, after.optionGroups);
    return after;
  }
}
