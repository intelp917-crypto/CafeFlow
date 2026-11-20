import { z } from 'zod';

/**
 * Contracts for catalogue management (phase 10).
 *
 * Until now the menu only existed in seed data: a real café could not enter its
 * own categories and products. These routes are the write side of the same
 * tables the customer menu reads, so a saved product appears on the QR menu
 * without touching the database.
 *
 * Prices are integer rial. Deleting is always soft: order history keeps its
 * snapshot and a product can be restored from the archive.
 */

const nameField = (label: string, max: number) =>
  z
    .string({ error: `${label} الزامی است.` })
    .trim()
    .min(1, `${label} الزامی است.`)
    .max(max, `${label} بیش از حد طولانی است.`);

const priceField = (label: string, allowNegative = false) => {
  const base = z
    .number({ error: `${label} باید عدد باشد.` })
    .int(`${label} باید عدد صحیح ریال باشد.`);
  return (allowNegative ? base.min(-100_000_000, `${label} از حد مجاز کوچک‌تر است.`) : base.min(0, `${label} نمی‌تواند منفی باشد.`)).max(
    1_000_000_000,
    `${label} بیش از حد بزرگ است.`,
  );
};

const atLeastOneField = (value: Record<string, unknown>) =>
  Object.values(value).some((entry) => entry !== undefined);

export function isSafeProductImageUrl(value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/* -------------------------------- categories ------------------------------- */

export const createCategorySchema = z.object({
  nameFa: nameField('نام دسته', 60),
  sortOrder: z.number({ error: 'ترتیب باید عدد باشد.' }).int('ترتیب باید عدد صحیح باشد.').min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    nameFa: nameField('نام دسته', 60).optional(),
    sortOrder: z.number({ error: 'ترتیب باید عدد باشد.' }).int('ترتیب باید عدد صحیح باشد.').min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(atLeastOneField, { message: 'حداقل یک تغییر لازم است.' });
/**
 * The complete display order in one write. Sending every id (not just the two
 * swapped rows) means the server can prove the list is the same one the
 * manager saw before rewriting `sort_order`.
 */
export const reorderCategoriesSchema = z.object({
  ids: z
    .array(z.string({ error: 'شناسهٔ دسته الزامی است.' }).trim().min(1, 'شناسهٔ دسته الزامی است.'))
    .min(1, 'ترتیب دسته‌ها خالی است.')
    .max(200, 'تعداد دسته‌ها بیش از حد مجاز است.'),
});
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;

/**
 * Display order of the products inside one category. The whole list travels so
 * a second manager cannot silently drop a product from the order.
 */
export const reorderProductsSchema = z.object({
  categoryId: z.string({ error: 'دسته الزامی است.' }).trim().min(1, 'دسته الزامی است.'),
  ids: z
    .array(z.string({ error: 'شناسهٔ محصول الزامی است.' }).trim().min(1, 'شناسهٔ محصول الزامی است.'))
    .min(1, 'فهرست محصولات خالی است.')
    .max(500, 'تعداد محصولات بیش از حد مجاز است.'),
});
export type ReorderProductsInput = z.infer<typeof reorderProductsSchema>;

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export interface CatalogCategory {
  id: string;
  nameFa: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  /** Non-archived products in this category; blocks deletion while non-zero. */
  productCount: number;
}

/* --------------------------------- products -------------------------------- */

export const createProductSchema = z.object({
  categoryId: z.string({ error: 'دسته الزامی است.' }).trim().min(1, 'دسته الزامی است.'),
  nameFa: nameField('نام محصول', 80),
  descriptionFa: z.string().trim().max(400, 'توضیح بیش از حد طولانی است.').optional(),
  basePrice: priceField('قیمت'),
  departmentId: z.string().trim().max(64).nullable().optional(),
  prepMinutes: z
    .number({ error: 'زمان آماده‌سازی باید عدد باشد.' })
    .int('زمان آماده‌سازی باید عدد صحیح باشد.')
    .min(0, 'زمان آماده‌سازی نمی‌تواند منفی باشد.')
    .max(240, 'زمان آماده‌سازی بیش از حد بزرگ است.')
    .optional(),
  imageUrl: z
    .string()
    .trim()
    .max(500, 'نشانی تصویر بیش از حد طولانی است.')
    .refine(isSafeProductImageUrl, 'نشانی تصویر باید HTTPS یا مسیر محلی هم‌مبدأ باشد.')
    .nullable()
    .optional(),
  isAvailable: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema
  .partial()
  .extend({
    /** Restores an archived product without leaving its old identity behind. */
    isArchived: z.boolean().optional(),
  })
  .refine(atLeastOneField, { message: 'حداقل یک تغییر لازم است.' });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export interface CatalogOption {
  id: string;
  nameFa: string;
  priceDelta: number;
  isActive: boolean;
}

export interface CatalogOptionGroup {
  id: string;
  nameFa: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  options: CatalogOption[];
}

export interface CatalogExtra {
  id: string;
  nameFa: string;
  price: number;
  isActive: boolean;
}

export interface CatalogAvailabilityWindow {
  weekday: number | null;
  startTime: string;
  endTime: string;
}

export interface CatalogProduct {
  id: string;
  categoryId: string;
  categoryNameFa: string;
  /** Position inside its category; smaller shows first on the QR menu. */
  sortOrder: number;
  nameFa: string;
  descriptionFa: string | null;
  basePrice: number;
  departmentId: string | null;
  departmentNameFa: string | null;
  prepMinutes: number;
  imageUrl: string | null;
  isAvailable: boolean;
  isActive: boolean;
  isArchived: boolean;
  updatedAt: string;
  optionGroups: CatalogOptionGroup[];
  extras: CatalogExtra[];
  availabilityWindows: CatalogAvailabilityWindow[];
}

export interface CatalogDepartment {
  id: string;
  nameFa: string;
}

export interface CatalogResponse {
  categories: CatalogCategory[];
  products: CatalogProduct[];
  departments: CatalogDepartment[];
}

/* ------------------------------ option groups ------------------------------ */

const optionSchema = z.object({
  nameFa: nameField('نام گزینه', 60),
  priceDelta: priceField('اختلاف قیمت', true).optional(),
  isActive: z.boolean().optional(),
});

const optionGroupSchema = z
  .object({
    nameFa: nameField('نام گروه گزینه', 60),
    minSelect: z.number({ error: 'حداقل انتخاب باید عدد باشد.' }).int().min(0, 'حداقل انتخاب نمی‌تواند منفی باشد.').max(20).optional(),
    maxSelect: z.number({ error: 'حداکثر انتخاب باید عدد باشد.' }).int().min(1, 'حداکثر انتخاب باید حداقل ۱ باشد.').max(20).optional(),
    isRequired: z.boolean().optional(),
    options: z
      .array(optionSchema)
      .min(1, 'هر گروه گزینه حداقل یک گزینه می‌خواهد.')
      .max(20, 'هر گروه حداکثر ۲۰ گزینه می‌تواند داشته باشد.'),
  })
  .refine((group) => (group.maxSelect ?? 1) >= (group.minSelect ?? 0), {
    message: 'حداکثر انتخاب نمی‌تواند از حداقل کمتر باشد.',
    path: ['maxSelect'],
  });

/**
 * The whole option tree of one product, replaced atomically. Option ids are not
 * promised to survive: order history stores a name/price snapshot and its
 * `option_id` is cleared by the foreign key, so a replaced option can never
 * change an old receipt.
 */
export const productOptionsSchema = z.object({
  groups: z.array(optionGroupSchema).max(10, 'هر محصول حداکثر ۱۰ گروه گزینه می‌تواند داشته باشد.'),
});
export type ProductOptionsInput = z.infer<typeof productOptionsSchema>;

/* ---------------------------------- extras --------------------------------- */

const extraSchema = z.object({
  nameFa: nameField('نام افزودنی', 60),
  price: priceField('قیمت افزودنی'),
  isActive: z.boolean().optional(),
});

export const productExtrasSchema = z.object({
  extras: z.array(extraSchema).max(30, 'هر محصول حداکثر ۳۰ افزودنی می‌تواند داشته باشد.'),
});
export type ProductExtrasInput = z.infer<typeof productExtrasSchema>;

/* --------------------------- availability windows -------------------------- */

const timeField = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'ساعت باید به شکل HH:mm باشد.');

const availabilityWindowSchema = z
  .object({
    weekday: z.number().int().min(0).max(6).nullable(),
    startTime: timeField,
    endTime: timeField,
  })
  .refine((window) => window.startTime < window.endTime, {
    message: 'ساعت پایان باید بعد از ساعت شروع باشد؛ بازهٔ عبوری از نیمه‌شب پشتیبانی نمی‌شود.',
    path: ['endTime'],
  });

export const productAvailabilitySchema = z.object({
  windows: z.array(availabilityWindowSchema).max(30, 'هر محصول حداکثر ۳۰ بازهٔ سرو دارد.'),
});
export type ProductAvailabilityInput = z.infer<typeof productAvailabilitySchema>;

/* ------------------------------- csv import -------------------------------- */

/**
 * Bulk menu entry. The text travels as JSON so the API needs no multipart
 * parser; the client reads the file locally with `FileReader`.
 */
export const importCatalogSchema = z.object({
  csv: z
    .string({ error: 'محتوای فایل CSV الزامی است.' })
    .min(1, 'محتوای فایل CSV الزامی است.')
    .max(300_000, 'حجم فایل CSV بیش از حد بزرگ است (حداکثر ۳۰۰ کیلوبایت).'),
  dryRun: z.boolean().optional(),
});
export type CatalogImportInput = z.infer<typeof importCatalogSchema>;

export interface CatalogImportRow {
  line: number;
  action: 'created' | 'updated' | 'error';
  nameFa: string;
  categoryNameFa: string;
  messageFa: string | null;
}

export interface CatalogImportResult {
  dryRun: boolean;
  rows: CatalogImportRow[];
  summary: {
    created: number;
    updated: number;
    errors: number;
    categoriesCreated: number;
  };
}

/* ----------------------------- product images ------------------------------ */

/**
 * A product photo travels as a data URL and is written to the persistent data
 * directory; the product stores the same-origin path that is returned. Only
 * PNG, JPEG and WebP are accepted — SVG is deliberately excluded because it can
 * carry script.
 */
export const uploadProductImageSchema = z.object({
  dataUrl: z
    .string({ error: 'تصویر الزامی است.' })
    .min(1, 'تصویر الزامی است.')
    .max(600_000, 'حجم تصویر بیش از حد بزرگ است (حداکثر حدود ۴۰۰ کیلوبایت).'),
});
export type UploadProductImageInput = z.infer<typeof uploadProductImageSchema>;

export interface UploadProductImageResponse {
  url: string;
  bytes: number;
  mime: string;
}

/** The header the importer understands; every column except the first three is optional. */
export const CATALOG_IMPORT_COLUMNS = [
  'category',
  'name',
  'price',
  'description',
  'department',
  'prepMinutes',
  'imageUrl',
  'isAvailable',
  'isActive',
] as const;
