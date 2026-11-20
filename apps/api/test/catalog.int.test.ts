import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  DEMO_PASSWORD,
  countAudit,
  createTestApp,
  login,
  server,
  type TestContext,
} from './helpers';

type Agent = ReturnType<typeof request.agent>;

let context: TestContext;
let admin: Agent;
let categoryId: string;
let productId: string;
let tableToken: string;

async function menu() {
  const response = await request(server(context.app)).get('/api/v1/public/menu');
  expect(response.status).toBe(200);
  return response.body as {
    categories: Array<{
      id: string;
      products: Array<{
        id: string;
        nameFa: string;
        price: number;
        isAvailable: boolean;
        imageUrl: string | null;
        unavailableReasonFa: string | null;
        optionGroups: Array<{ options: Array<{ id: string }> }>;
        extras: Array<{ id: string; nameFa: string; price: number }>;
        availabilityWindows: Array<{ weekday: number | null; startTime: string; endTime: string }>;
      }>;
    }>;
  };
}

function menuProducts(body: Awaited<ReturnType<typeof menu>>) {
  return body.categories.flatMap((category) => category.products);
}

async function placeOrder(product: string, optionIds: string[] = [], extraIds: string[] = []) {
  const agent = request.agent(server(context.app));
  await agent.get('/api/v1/public/menu');
  return agent.post('/api/v1/public/orders').send({
    qrToken: tableToken,
    clientRequestId: randomUUID(),
    items: [{ productId: product, quantity: 1, optionIds, extraIds }],
  });
}

beforeAll(async () => {
  context = await createTestApp();
  admin = (await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD)).agent;

  categoryId = (
    context.db.prepare('SELECT id FROM categories ORDER BY sort_order LIMIT 1').get() as { id: string }
  ).id;
  tableToken = (
    context.db.prepare("SELECT token FROM qr_codes WHERE kind = 'table' LIMIT 1").get() as { token: string }
  ).token;
});

afterAll(async () => {
  await context.close();
});

describe('GET /catalog', () => {
  it('returns categories, products and prep departments', async () => {
    const response = await admin.get('/api/v1/catalog');

    expect(response.status).toBe(200);
    expect(response.body.categories.length).toBeGreaterThan(0);
    expect(response.body.products.length).toBeGreaterThan(0);
    expect(response.body.departments.length).toBeGreaterThan(0);
    expect(response.body.products[0]).toMatchObject({
      categoryNameFa: expect.any(String),
      basePrice: expect.any(Number),
      isArchived: false,
    });
  });
});

describe('categories', () => {
  it('creates a category with a unique generated slug and an audit row', async () => {
    const response = await admin.post('/api/v1/catalog/categories').send({ nameFa: 'نوشیدنی ویژه' });

    expect(response.status).toBe(201);
    expect(response.body.nameFa).toBe('نوشیدنی ویژه');
    expect(response.body.slug).toBeTruthy();
    expect(response.body.isActive).toBe(true);
    expect(countAudit(context.db, 'catalog.category.create')).toBeGreaterThan(0);
  });

  it('rejects a duplicate name, even with Arabic variant letters', async () => {
    const response = await admin.post('/api/v1/catalog/categories').send({ nameFa: 'نوشيدني ويژه' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CATEGORY_EXISTS');
  });

  it('hides an inactive category from the customer menu', async () => {
    const created = await admin.post('/api/v1/catalog/categories').send({ nameFa: 'فصلی' });
    const id = created.body.id as string;

    await admin.patch(`/api/v1/catalog/categories/${id}`).send({ isActive: false });

    const categories = (await admin.get('/api/v1/catalog')).body.categories as Array<{
      id: string;
      isActive: boolean;
    }>;
    expect(categories.find((row) => row.id === id)?.isActive).toBe(false);

    await admin.delete(`/api/v1/catalog/categories/${id}`);
  });

  it('reorders categories atomically and rejects an incomplete list', async () => {
    const catalog = await admin.get('/api/v1/catalog');
    const ids = catalog.body.categories.map((row: { id: string }) => row.id);
    const reversed = [...ids].reverse();

    const saved = await admin.put('/api/v1/catalog/categories/order').send({ ids: reversed });
    expect(saved.status).toBe(200);
    expect(saved.body.map((row: { id: string }) => row.id)).toEqual(reversed);
    expect(countAudit(context.db, 'catalog.category.reorder')).toBeGreaterThan(0);

    const reloaded = await admin.get('/api/v1/catalog');
    expect(reloaded.body.categories.map((row: { id: string }) => row.id)).toEqual(reversed);

    const incomplete = await admin.put('/api/v1/catalog/categories/order').send({ ids: reversed.slice(1) });
    expect(incomplete.status).toBe(400);
    expect(incomplete.body.error.code).toBe('CATEGORY_ORDER_INCOMPLETE');

    const duplicate = await admin
      .put('/api/v1/catalog/categories/order')
      .send({ ids: [reversed[0], reversed[0], ...reversed.slice(1)] });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.code).toBe('CATEGORY_ORDER_STALE');

    // Restore the seeded order for the assertions that follow.
    await admin.put('/api/v1/catalog/categories/order').send({ ids });
  });
});

describe('products', () => {
  it('creates a product that appears on the QR menu with the same price', async () => {
    const response = await admin.post('/api/v1/catalog/products').send({
      categoryId,
      nameFa: 'موکا فندقی',
      descriptionFa: 'شکلات تلخ و فندق',
      imageUrl: 'https://images.example.test/mocha.jpg',
      basePrice: 165000,
      prepMinutes: 6,
    });

    expect(response.status).toBe(201);
    productId = response.body.id;

    const card = menuProducts(await menu()).find((product) => product.id === productId);
    expect(card).toBeDefined();
    expect(card?.price).toBe(165000);
    expect(card?.isAvailable).toBe(true);
    expect(card?.imageUrl).toBe('https://images.example.test/mocha.jpg');
  });

  it('rejects a duplicate product name inside the same category', async () => {
    const response = await admin.post('/api/v1/catalog/products').send({
      categoryId,
      nameFa: 'موکا فندقي',
      basePrice: 100000,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PRODUCT_EXISTS');
  });

  it('rejects a negative price with a Persian validation message', async () => {
    const response = await admin.post('/api/v1/catalog/products').send({
      categoryId,
      nameFa: 'محصول آزمایشی',
      basePrice: -1,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/منفی/);
  });

  it('rejects an unsafe image URL and clears an existing image URL', async () => {
    const unsafe = await admin.patch(`/api/v1/catalog/products/${productId}`).send({ imageUrl: 'javascript:alert(1)' });
    expect(unsafe.status).toBe(400);
    expect(unsafe.body.error.code).toBe('VALIDATION_FAILED');

    const cleared = await admin.patch(`/api/v1/catalog/products/${productId}`).send({ imageUrl: null });
    expect(cleared.status).toBe(200);
    const card = menuProducts(await menu()).find((product) => product.id === productId);
    expect(card?.imageUrl).toBeNull();
  });

  it('applies a price change to the customer menu', async () => {
    const response = await admin.patch(`/api/v1/catalog/products/${productId}`).send({ basePrice: 172000 });
    expect(response.status).toBe(200);

    const card = menuProducts(await menu()).find((product) => product.id === productId);
    expect(card?.price).toBe(172000);
  });

  it('blocks ordering while the product is marked unavailable', async () => {
    await admin.patch(`/api/v1/catalog/products/${productId}`).send({ isAvailable: false });

    const card = menuProducts(await menu()).find((product) => product.id === productId);
    expect(card?.isAvailable).toBe(false);

    const order = await placeOrder(productId);
    expect(order.status).toBe(409);
    expect(order.body.error.code).toBe('PRODUCT_UNAVAILABLE');

    await admin.patch(`/api/v1/catalog/products/${productId}`).send({ isAvailable: true });
  });

  it('replaces the option tree and prices the selected option server-side', async () => {
    const replaced = await admin.put(`/api/v1/catalog/products/${productId}/options`).send({
      groups: [
        {
          nameFa: 'اندازه',
          minSelect: 1,
          maxSelect: 1,
          isRequired: true,
          options: [
            { nameFa: 'کوچک', priceDelta: 0 },
            { nameFa: 'بزرگ', priceDelta: 25000 },
          ],
        },
      ],
    });

    expect(replaced.status).toBe(200);
    expect(replaced.body.optionGroups).toHaveLength(1);
    expect(replaced.body.optionGroups[0].options).toHaveLength(2);

    const card = menuProducts(await menu()).find((product) => product.id === productId);
    const largeOption = card?.optionGroups[0].options[1];
    expect(largeOption).toBeDefined();

    const withoutOption = await placeOrder(productId);
    expect(withoutOption.status).toBe(400);
    expect(withoutOption.body.error.code).toBe('OPTION_REQUIRED');

    const order = await placeOrder(productId, [largeOption!.id]);
    expect(order.status).toBe(201);

    const item = context.db
      .prepare('SELECT unit_price_snapshot FROM order_items WHERE order_id = ?')
      .get(order.body.id) as { unit_price_snapshot: number };
    expect(item.unit_price_snapshot).toBe(172000 + 25000);
  });

  it('replaces product extras and applies their server-side price to customer orders', async () => {
    const replaced = await admin.put(`/api/v1/catalog/products/${productId}/extras`).send({
      extras: [{ nameFa: 'خامه', price: 12000 }],
    });

    expect(replaced.status).toBe(200);
    expect(replaced.body.extras).toHaveLength(1);
    expect(replaced.body.extras[0]).toMatchObject({ nameFa: 'خامه', price: 12000, isActive: true });

    const card = menuProducts(await menu()).find((product) => product.id === productId);
    expect(card?.extras).toHaveLength(1);
    expect(card?.extras[0]?.nameFa).toBe('خامه');

    const selectedOption = card?.optionGroups[0]?.options[0];
    expect(selectedOption).toBeDefined();
    const order = await placeOrder(productId, [selectedOption!.id], [card!.extras[0]!.id]);
    expect(order.status).toBe(201);

    const item = context.db
      .prepare('SELECT unit_price_snapshot FROM order_items WHERE order_id = ?')
      .get(order.body.id) as { unit_price_snapshot: number };
    expect(item.unit_price_snapshot).toBe(172000 + 12000);
    expect(countAudit(context.db, 'catalog.product.extras')).toBeGreaterThan(0);
  });

  it('replaces product service windows, returns them in the catalogue and audits the change', async () => {
    const windows = [
      { weekday: 6, startTime: '08:00', endTime: '12:00' },
      { weekday: null, startTime: '14:00', endTime: '18:30' },
    ];
    const saved = await admin.put(`/api/v1/catalog/products/${productId}/availability`).send({ windows });

    expect(saved.status).toBe(200);
    expect(saved.body.availabilityWindows).toEqual(windows);

    const catalog = await admin.get('/api/v1/catalog');
    const product = catalog.body.products.find((row: { id: string }) => row.id === productId);
    expect(product.availabilityWindows).toEqual(windows);
    expect(countAudit(context.db, 'catalog.product.availability')).toBeGreaterThan(0);

    const tehranWeekday = new Date(Date.now() + 210 * 60_000).getUTCDay();
    const closedDay = (tehranWeekday + 1) % 7;
    const closed = await admin.put(`/api/v1/catalog/products/${productId}/availability`).send({
      windows: [{ weekday: closedDay, startTime: '00:00', endTime: '23:59' }],
    });
    expect(closed.status).toBe(200);
    const card = menuProducts(await menu()).find((row) => row.id === productId);
    expect(card?.isAvailable).toBe(false);
    expect(card?.unavailableReasonFa).toMatch(/این ساعت/);

    const outsideHours = await placeOrder(productId);
    expect(outsideHours.status).toBe(409);
    expect(outsideHours.body.error.code).toBe('PRODUCT_OUTSIDE_HOURS');

    const cleared = await admin.put(`/api/v1/catalog/products/${productId}/availability`).send({ windows: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.availabilityWindows).toEqual([]);
  });

  it('rejects invalid and overnight availability windows', async () => {
    const invalid = await admin.put(`/api/v1/catalog/products/${productId}/availability`).send({
      windows: [{ weekday: 1, startTime: '18:00', endTime: '08:00' }],
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');

    const malformed = await admin.put(`/api/v1/catalog/products/${productId}/availability`).send({
      windows: [{ weekday: 7, startTime: '8:00', endTime: '18:00' }],
    });
    expect(malformed.status).toBe(400);
  });

  it('reorders products inside a category and the QR menu follows that order', async () => {
    const first = await admin.post('/api/v1/catalog/products').send({
      categoryId,
      nameFa: 'آمریکانو تست ترتیب',
      basePrice: 98000,
    });
    const second = await admin.post('/api/v1/catalog/products').send({
      categoryId,
      nameFa: 'زعفران لاته تست ترتیب',
      basePrice: 128000,
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const catalog = await admin.get('/api/v1/catalog');
    const ids = catalog.body.products
      .filter((row: { categoryId: string }) => row.categoryId === categoryId)
      .map((row: { id: string }) => row.id);
    const reordered = [
      second.body.id,
      ...ids.filter((id: string) => id !== second.body.id && id !== first.body.id),
      first.body.id,
    ];

    const saved = await admin.put('/api/v1/catalog/products/order').send({ categoryId, ids: reordered });
    expect(saved.status).toBe(200);
    expect(saved.body.map((row: { id: string }) => row.id)).toEqual(reordered);
    expect(countAudit(context.db, 'catalog.product.reorder')).toBeGreaterThan(0);

    const menuCategory = (await menu()).categories.find((category) => category.id === categoryId);
    const menuIds = menuCategory?.products.map((product) => product.id) ?? [];
    expect(menuIds.indexOf(second.body.id)).toBeLessThan(menuIds.indexOf(first.body.id));

    const incomplete = await admin
      .put('/api/v1/catalog/products/order')
      .send({ categoryId, ids: reordered.slice(1) });
    expect(incomplete.status).toBe(400);
    expect(incomplete.body.error.code).toBe('PRODUCT_ORDER_INCOMPLETE');

    const unknown = await admin
      .put('/api/v1/catalog/products/order')
      .send({ categoryId, ids: [reordered[0], randomUUID(), ...reordered.slice(1)] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('PRODUCT_ORDER_STALE');
  });

  it('refuses a line whose option deltas make the final price negative', async () => {
    const replaced = await admin.put(`/api/v1/catalog/products/${productId}/options`).send({
      groups: [
        {
          nameFa: 'تخفیف اشتباهی',
          minSelect: 1,
          maxSelect: 1,
          isRequired: true,
          options: [{ nameFa: 'تخفیف بزرگ', priceDelta: -500000 }],
        },
      ],
    });
    expect(replaced.status).toBe(200);

    const optionId = replaced.body.optionGroups[0].options[0].id as string;
    const order = await placeOrder(productId, [optionId]);
    expect(order.status).toBe(400);
    expect(order.body.error.code).toBe('UNIT_PRICE_NEGATIVE');
  });

  it('archives a product off the menu and restores it', async () => {
    const archived = await admin.delete(`/api/v1/catalog/products/${productId}`);
    expect(archived.status).toBe(200);
    expect(archived.body.isArchived).toBe(true);

    expect(menuProducts(await menu()).some((product) => product.id === productId)).toBe(false);

    const restored = await admin.patch(`/api/v1/catalog/products/${productId}`).send({ isArchived: false });
    expect(restored.status).toBe(200);
    expect(menuProducts(await menu()).some((product) => product.id === productId)).toBe(true);
  });
});

describe('csv import', () => {
  const header = 'category,name,price,description,department,prepMinutes,imageUrl,isAvailable,isActive';

  it('previews a dry run without writing anything', async () => {
    const csv = [header, 'نوشیدنی ویژه ایمپورت,لیموناد زعفرانی,1350000,"لیمو، زعفران و یخ",بار,5,https://images.example.test/saffron-lemonade.webp,true,true'].join('\n');

    const preview = await admin.post('/api/v1/catalog/import').send({ csv, dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.body.dryRun).toBe(true);
    expect(preview.body.summary).toMatchObject({ created: 1, updated: 0, errors: 0, categoriesCreated: 1 });
    expect(preview.body.rows[0]).toMatchObject({ action: 'created', nameFa: 'لیموناد زعفرانی', messageFa: null });

    const catalog = await admin.get('/api/v1/catalog');
    expect(catalog.body.products.some((row: { nameFa: string }) => row.nameFa === 'لیموناد زعفرانی')).toBe(false);
  });

  it('creates the menu from CSV, keeps the quoted comma and updates on re-import', async () => {
    const csv = [header, 'نوشیدنی ویژه ایمپورت,لیموناد زعفرانی,1350000,"لیمو، زعفران و یخ",بار,5,https://images.example.test/saffron-lemonade.webp,true,true'].join('\n');

    const imported = await admin.post('/api/v1/catalog/import').send({ csv });
    expect(imported.status).toBe(200);
    expect(imported.body.summary).toMatchObject({ created: 1, updated: 0, errors: 0, categoriesCreated: 1 });

    const catalog = await admin.get('/api/v1/catalog');
    const product = catalog.body.products.find((row: { nameFa: string }) => row.nameFa === 'لیموناد زعفرانی');
    expect(product.descriptionFa).toBe('لیمو، زعفران و یخ');
    expect(product.basePrice).toBe(1350000);
    expect(product.imageUrl).toBe('https://images.example.test/saffron-lemonade.webp');
    expect(product.prepMinutes).toBe(5);

    const card = menuProducts(await menu()).find((row) => row.nameFa === 'لیموناد زعفرانی');
    expect(card?.price).toBe(1350000);
    expect(countAudit(context.db, 'catalog.import')).toBeGreaterThan(0);

    const second = await admin.post('/api/v1/catalog/import').send({ csv: csv.replace('1350000', '۱۴۰۰۰۰۰') });
    expect(second.body.summary).toMatchObject({ created: 0, updated: 1, categoriesCreated: 0 });

    const updated = (await admin.get('/api/v1/catalog')).body.products.find(
      (row: { nameFa: string }) => row.nameFa === 'لیموناد زعفرانی',
    );
    expect(updated.basePrice).toBe(1400000);
  });

  it('reports invalid rows and still imports the valid ones', async () => {
    const csv = [
      header,
      'نوشیدنی سرد,موکا یخی,1500000,,بار,,,true,true',
      'نوشیدنی سرد,قیمت منفی,-5,,بار,,,true,true',
      'نوشیدنی سرد,قیمت متنی,abc,,بار,,,true,true',
      'نوشیدنی سرد,موکا یخی,1500000,,بار,,,true,true',
      'نوشیدنی سرد,واحد ناموجود,1200000,,واحد ناموجود,,,true,true',
      'نوشیدنی سرد,تصویر ناامن,1200000,,بار,,javascript:alert(1),true,true',
    ].join('\n');

    const result = await admin.post('/api/v1/catalog/import').send({ csv });
    expect(result.status).toBe(200);
    expect(result.body.summary).toMatchObject({ created: 1, errors: 5 });

    const messages = result.body.rows
      .filter((row: { action: string }) => row.action === 'error')
      .map((row: { messageFa: string }) => row.messageFa);
    expect(messages.some((message: string) => message.includes('قیمت'))).toBe(true);
    expect(messages.some((message: string) => message.includes('واحد آماده‌سازی'))).toBe(true);
    expect(messages.some((message: string) => message.includes('نشانی تصویر'))).toBe(true);
    expect(messages.some((message: string) => message.includes('تکرار'))).toBe(true);

    const catalog = await admin.get('/api/v1/catalog');
    expect(catalog.body.products.some((row: { nameFa: string }) => row.nameFa === 'موکا یخی')).toBe(true);
    expect(catalog.body.products.some((row: { nameFa: string }) => row.nameFa === 'قیمت منفی')).toBe(false);
  });

  it('rejects a file without the required headers', async () => {
    const response = await admin
      .post('/api/v1/catalog/import')
      .send({ csv: ['category,name', 'نوشیدنی,چای'].join('\n') });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CSV_HEADER');
  });
});

describe('guards', () => {
  it('refuses catalogue writes to a role without catalog.write', async () => {
    const cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;

    const response = await cashier.post('/api/v1/catalog/products').send({
      categoryId,
      nameFa: 'محصول غیرمجاز',
      basePrice: 1000,
    });

    expect(response.status).toBe(403);
  });

  it('refuses to delete a category that still holds products', async () => {
    const response = await admin.delete(`/api/v1/catalog/categories/${categoryId}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CATEGORY_NOT_EMPTY');
  });

  it('writes audit rows for every catalogue mutation', () => {
    expect(countAudit(context.db, 'catalog.product.create')).toBeGreaterThan(0);
    expect(countAudit(context.db, 'catalog.product.update')).toBeGreaterThan(0);
    expect(countAudit(context.db, 'catalog.product.options')).toBeGreaterThan(0);
    expect(countAudit(context.db, 'catalog.category.update')).toBeGreaterThan(0);
    expect(countAudit(context.db, 'catalog.category.delete')).toBeGreaterThan(0);
  });
});

describe('product images', () => {
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('stores a PNG and serves it from the public same-origin URL', async () => {
    const uploaded = await admin.post('/api/v1/catalog/images').send({ dataUrl: png });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.mime).toBe('image/png');
    expect(uploaded.body.url).toMatch(/^\/api\/v1\/public\/product-images\/[0-9a-f-]{36}\.png$/);

    const served = await request(server(context.app)).get(uploaded.body.url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/png');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect((served.body as Buffer).length).toBeGreaterThan(0);
  });

  it('rejects SVG, a mismatched signature, oversized data and unknown files', async () => {
    const svg = await admin
      .post('/api/v1/catalog/images')
      .send({ dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' });
    expect(svg.status).toBe(400);
    expect(svg.body.error.code).toBe('IMAGE_FORMAT');

    const fake = await admin.post('/api/v1/catalog/images').send({ dataUrl: 'data:image/png;base64,aGVsbG8=' });
    expect(fake.status).toBe(400);
    expect(fake.body.error.code).toBe('IMAGE_SIGNATURE');

    const oversized = Buffer.alloc(410 * 1024, 1).toString('base64');
    const big = await admin.post('/api/v1/catalog/images').send({ dataUrl: `data:image/png;base64,${oversized}` });
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe('IMAGE_TOO_LARGE');

    const missing = await request(server(context.app)).get(
      '/api/v1/public/product-images/11111111-1111-1111-1111-111111111111.png',
    );
    expect(missing.status).toBe(404);

    const traversal = await request(server(context.app)).get('/api/v1/public/product-images/..%2F..%2Fpackage.json');
    expect(traversal.status).toBe(404);
  });
});
