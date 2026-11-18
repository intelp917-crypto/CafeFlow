import { createHash, randomInt, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  CUSTOMER_REQUEST_LABELS_FA,
  ORDER_STATUS_LABELS_FA,
  percentOf,
  type OrderStatus,
  type PublicMenuCategory,
  type PublicMenuProduct,
  type PublicMenuResponse,
  type PublicOrderInput,
  type PublicOrderResponse,
  type PublicOrderStatusResponse,
  type PublicRequestInput,
} from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';
import { AppError, badRequest, conflict, notFound } from '../../common/errors';
import { createOpaqueToken } from '../../common/password';
import { SlidingWindowLimiter } from '../../common/rate-limit';
import { PublicRepository, type ProductRow } from './public.repository';

const TEHRAN_OFFSET_MINUTES = 210;
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_ITEMS_PER_ORDER = 30;

export interface DeviceIdentity {
  deviceId: string;
  token: string;
  isNew: boolean;
}

export interface PricedOption {
  id: string;
  nameFa: string;
  priceDelta: number;
}

export interface PricedExtra {
  id: string;
  nameFa: string;
  price: number;
}

export interface PricedItem {
  product: ProductRow;
  quantity: number;
  options: PricedOption[];
  extras: PricedExtra[];
  unitPrice: number;
  total: number;
  note: string | null;
}

export interface PricedOrder {
  items: PricedItem[];
  subtotal: number;
  serviceCharge: number;
  taxTotal: number;
  total: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Tehran weekday (0 = Sunday) and minutes since midnight. */
function tehranClock(now: Date = new Date()): { weekday: number; minutes: number } {
  const local = new Date(now.getTime() + TEHRAN_OFFSET_MINUTES * 60_000);
  return {
    weekday: local.getUTCDay(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

function parseTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

@Injectable()
export class PublicService {
  private readonly orderLimiter = new SlidingWindowLimiter(10 * 60_000, 6);
  private readonly requestLimiter = new SlidingWindowLimiter(60_000, 12);
  // A client can always discard its cookie and appear as a new device, so the
  // per-IP budget is what actually bounds anonymous abuse.
  private readonly ipOrderLimiter = new SlidingWindowLimiter(10 * 60_000, 40);
  private readonly ipRequestLimiter = new SlidingWindowLimiter(60_000, 30);

  constructor(
    @Inject(PublicRepository) private readonly repository: PublicRepository,
    @Inject(DB_SERVICE) private readonly database: DatabaseService,
  ) {}

  /* ------------------------------- identity ------------------------------- */

  /**
   * Resolves the pseudonymous device cookie. The browser keeps only an opaque
   * random token; eligibility and history are always looked up server-side.
   */
  resolveDevice(cookieToken: string | undefined): DeviceIdentity {
    if (cookieToken && cookieToken.length >= 16) {
      const hash = sha256(cookieToken);
      const existing = this.repository.findDeviceByTokenHash(hash);
      if (existing) {
        this.repository.touchDevice(existing.id);
        return { deviceId: existing.id, token: cookieToken, isNew: false };
      }
    }

    const token = createOpaqueToken(24);
    const deviceId = randomUUID();
    this.repository.createDevice(deviceId, sha256(token));
    return { deviceId, token, isNew: true };
  }

  /* --------------------------------- menu --------------------------------- */

  getMenu(qrToken: string | undefined): PublicMenuResponse {
    const settings = this.repository.getSettings();
    let qr: PublicMenuResponse['qr'] = null;
    let table: PublicMenuResponse['table'] = null;

    if (qrToken) {
      const row = this.repository.findQrByToken(qrToken);
      if (!row || row.is_active !== 1) {
        throw notFound('این کد QR معتبر نیست یا غیرفعال شده است.', 'QR_NOT_FOUND');
      }
      if (row.kind === 'table' && !row.table_id) {
        throw notFound('میز مربوط به این کد QR دیگر فعال نیست.', 'QR_TABLE_INACTIVE');
      }
      qr = { kind: row.kind, label: row.label };
      if (row.kind === 'table' && row.table_id) {
        table = {
          id: row.table_id,
          nameFa: row.table_name_fa ?? row.table_code ?? 'میز',
          code: row.table_code ?? '',
          floorNameFa: row.floor_name_fa,
        };
      }
    }

    const categories = this.buildMenuCategories();
    return {
      restaurant: {
        nameFa: settings.restaurant_name_fa,
        currency: settings.currency,
        digitMode: settings.digit_mode,
        serviceChargePercent: settings.service_charge_percent,
        taxPercent: settings.tax_percent,
      },
      qr,
      table,
      categories,
      serverTime: new Date().toISOString(),
    };
  }

  private buildMenuCategories(): PublicMenuCategory[] {
    const categories = this.repository.listCategories();
    const products = this.repository.listProducts();
    const groups = this.repository.listOptionGroups();
    const options = this.repository.listOptions();
    const extras = this.repository.listExtras();
    const windows = this.repository.listAvailabilityWindows();
    const { weekday, minutes } = tehranClock();

    const optionsByGroup = new Map<string, typeof options>();
    for (const option of options) {
      const list = optionsByGroup.get(option.option_group_id) ?? [];
      list.push(option);
      optionsByGroup.set(option.option_group_id, list);
    }

    const groupsByProduct = new Map<string, typeof groups>();
    for (const group of groups) {
      const list = groupsByProduct.get(group.product_id) ?? [];
      list.push(group);
      groupsByProduct.set(group.product_id, list);
    }

    const extrasByProduct = new Map<string, typeof extras>();
    for (const extra of extras) {
      const list = extrasByProduct.get(extra.product_id) ?? [];
      list.push(extra);
      extrasByProduct.set(extra.product_id, list);
    }

    const windowsByProduct = new Map<string, typeof windows>();
    for (const window of windows) {
      const list = windowsByProduct.get(window.product_id) ?? [];
      list.push(window);
      windowsByProduct.set(window.product_id, list);
    }

    const byCategory = new Map<string, PublicMenuProduct[]>();

    for (const product of products) {
      const productWindows = windowsByProduct.get(product.id) ?? [];
      let available = product.is_available === 1;
      let reason: string | null = available ? null : 'این محصول موقتاً ناموجود است.';

      if (available && productWindows.length > 0) {
        const insideWindow = productWindows.some((window) => {
          if (window.weekday !== null && window.weekday !== weekday) return false;
          const start = parseTimeToMinutes(window.start_time);
          const end = parseTimeToMinutes(window.end_time);
          return minutes >= start && minutes < end;
        });
        if (!insideWindow) {
          available = false;
          reason = 'این محصول در این ساعت سرو نمی‌شود.';
        }
      }

      const productGroups = (groupsByProduct.get(product.id) ?? []).map((group) => ({
        id: group.id,
        nameFa: group.name_fa,
        minSelect: group.min_select,
        maxSelect: group.max_select,
        isRequired: group.is_required === 1 || group.min_select > 0,
        options: (optionsByGroup.get(group.id) ?? []).map((option) => ({
          id: option.id,
          nameFa: option.name_fa,
          priceDelta: option.price_delta,
        })),
      }));

      const item: PublicMenuProduct = {
        id: product.id,
        categoryId: product.category_id,
        nameFa: product.name_fa,
        descriptionFa: product.description_fa,
        price: product.base_price,
        imageUrl: product.image_url,
        prepMinutes: product.prep_minutes,
        isAvailable: available,
        unavailableReasonFa: reason,
        optionGroups: productGroups,
        extras: (extrasByProduct.get(product.id) ?? []).map((extra) => ({
          id: extra.id,
          nameFa: extra.name_fa,
          price: extra.price,
        })),
      };

      const list = byCategory.get(product.category_id) ?? [];
      list.push(item);
      byCategory.set(product.category_id, list);
    }

    return categories
      .map((category) => ({
        id: category.id,
        nameFa: category.name_fa,
        slug: category.slug,
        products: byCategory.get(category.id) ?? [],
      }))
      .filter((category) => category.products.length > 0);
  }

  /* -------------------------------- pricing -------------------------------- */

  priceOrder(input: PublicOrderInput): PricedOrder {
    if (input.items.length > MAX_ITEMS_PER_ORDER) {
      throw badRequest(`حداکثر ${MAX_ITEMS_PER_ORDER} قلم در هر سفارش مجاز است.`);
    }

    const settings = this.repository.getSettings();
    const { weekday, minutes } = tehranClock();
    const groups = this.repository.listOptionGroups();
    const options = this.repository.listOptions();
    const extras = this.repository.listExtras();
    const windows = this.repository.listAvailabilityWindows();

    const optionById = new Map(options.map((option) => [option.id, option]));
    const groupById = new Map(groups.map((group) => [group.id, group]));

    const priced: PricedItem[] = [];

    for (const line of input.items) {
      const product = this.repository.findProductById(line.productId);
      if (!product) {
        throw badRequest('یکی از محصولات انتخاب‌شده دیگر در منو نیست.', 'PRODUCT_UNAVAILABLE');
      }
      if (product.is_available !== 1) {
        throw conflict(`«${product.name_fa}» در حال حاضر ناموجود است.`, 'PRODUCT_UNAVAILABLE');
      }

      const productWindows = windows.filter((window) => window.product_id === product.id);
      if (productWindows.length > 0) {
        const insideWindow = productWindows.some((window) => {
          if (window.weekday !== null && window.weekday !== weekday) return false;
          const start = parseTimeToMinutes(window.start_time);
          const end = parseTimeToMinutes(window.end_time);
          return minutes >= start && minutes < end;
        });
        if (!insideWindow) {
          throw conflict(`«${product.name_fa}» در این ساعت سرو نمی‌شود.`, 'PRODUCT_OUTSIDE_HOURS');
        }
      }

      // Options must belong to this product's groups, and each group's
      // min/max selection must be honoured. Duplicate ids are collapsed so a
      // repeated option can never inflate the price twice.
      const productGroups = groups.filter((group) => group.product_id === product.id);
      const selectedByGroup = new Map<string, PricedOption[]>();

      for (const optionId of new Set(line.optionIds)) {
        const option = optionById.get(optionId);
        if (!option) throw badRequest('یکی از گزینه‌های انتخاب‌شده معتبر نیست.', 'OPTION_INVALID');
        const group = groupById.get(option.option_group_id);
        if (!group || group.product_id !== product.id) {
          throw badRequest(`گزینه انتخاب‌شده برای «${product.name_fa}» مجاز نیست.`, 'OPTION_INVALID');
        }
        const list = selectedByGroup.get(group.id) ?? [];
        list.push({ id: option.id, nameFa: option.name_fa, priceDelta: option.price_delta });
        selectedByGroup.set(group.id, list);
      }

      for (const group of productGroups) {
        const count = selectedByGroup.get(group.id)?.length ?? 0;
        const minimum = group.is_required === 1 ? Math.max(group.min_select, 1) : group.min_select;
        if (count < minimum) {
          throw badRequest(`برای «${product.name_fa}» انتخاب «${group.name_fa}» الزامی است.`, 'OPTION_REQUIRED');
        }
        if (count > group.max_select) {
          throw badRequest(`حداکثر ${group.max_select} انتخاب برای «${group.name_fa}» مجاز است.`, 'OPTION_LIMIT');
        }
      }

      const selectedOptions: PricedOption[] = [...selectedByGroup.values()].flat();

      const allowedExtras = extras.filter((extra) => extra.product_id === product.id);
      const selectedExtras: PricedExtra[] = [];
      for (const extraId of line.extraIds) {
        const extra = allowedExtras.find((candidate) => candidate.id === extraId);
        if (!extra) {
          throw badRequest(`افزودنی انتخاب‌شده برای «${product.name_fa}» مجاز نیست.`, 'EXTRA_INVALID');
        }
        if (selectedExtras.some((existing) => existing.id === extra.id)) continue;
        selectedExtras.push({ id: extra.id, nameFa: extra.name_fa, price: extra.price });
      }

      const unitPrice =
        product.base_price +
        selectedOptions.reduce((sum, option) => sum + option.priceDelta, 0) +
        selectedExtras.reduce((sum, extra) => sum + extra.price, 0);

      priced.push({
        product,
        quantity: line.quantity,
        options: selectedOptions,
        extras: selectedExtras,
        unitPrice,
        total: unitPrice * line.quantity,
        note: line.note ?? null,
      });
    }

    const subtotal = priced.reduce((sum, item) => sum + item.total, 0);
    if (subtotal <= 0) throw badRequest('مبلغ سفارش نامعتبر است.', 'INVALID_TOTAL');

    const serviceCharge = percentOf(subtotal, settings.service_charge_percent);
    const taxTotal = percentOf(subtotal + serviceCharge, settings.tax_percent);

    return {
      items: priced,
      subtotal,
      serviceCharge,
      taxTotal,
      total: subtotal + serviceCharge + taxTotal,
    };
  }

  /* ------------------------------- ordering -------------------------------- */

  createOrder(input: PublicOrderInput, device: DeviceIdentity, clientIp?: string): PublicOrderResponse {
    if (clientIp && !this.ipOrderLimiter.hit(`order:${clientIp}`)) {
      throw new AppError('RATE_LIMITED', 429, 'تعداد درخواست‌ها از این شبکه زیاد بوده است. کمی بعد تلاش کنید.');
    }
    if (!this.orderLimiter.hit(device.deviceId)) {
      throw new AppError(
        'RATE_LIMITED',
        429,
        'تعداد سفارش‌های شما در زمان کوتاه زیاد بوده است. چند دقیقه دیگر تلاش کنید.',
      );
    }

    const qr = this.repository.findQrByToken(input.qrToken);
    if (!qr || qr.is_active !== 1) {
      throw notFound('این کد QR معتبر نیست یا غیرفعال شده است.', 'QR_NOT_FOUND');
    }
    if (qr.kind === 'table' && !qr.table_id) {
      throw notFound('میز مربوط به این کد QR دیگر فعال نیست.', 'QR_TABLE_INACTIVE');
    }

    const replay = this.repository.findOrderByRequestId(device.deviceId, input.clientRequestId);
    if (replay) {
      const existing = this.repository.findOrderSummaryByCode(replay.code);
      if (existing) return this.toOrderResponse(existing, true);
    }

    const priced = this.priceOrder(input);
    const code = this.generateOrderCode();
    const orderId = randomUUID();
    const nowIso = new Date().toISOString();

    this.database.transaction(() => {
      let tableSessionId: string | null = null;
      if (qr.kind === 'table' && qr.table_id) {
        const open = this.repository.findOpenTableSession(qr.table_id);
        tableSessionId = open?.id ?? this.repository.openTableSession(qr.table_id, null);
      }

      this.database.run(
        `INSERT INTO orders
           (id, code, table_id, table_session_id, guest_device_id, status, source,
            subtotal, discount_total, service_charge, tax_total, total, note,
            client_request_id, submitted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'submitted', 'qr', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          code,
          qr.table_id,
          tableSessionId,
          device.deviceId,
          priced.subtotal,
          priced.serviceCharge,
          priced.taxTotal,
          priced.total,
          input.note ?? null,
          input.clientRequestId,
          nowIso,
          nowIso,
          nowIso,
        ],
      );

      for (const item of priced.items) {
        const itemId = randomUUID();
        this.database.run(
          `INSERT INTO order_items
             (id, order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity,
              options_json, extras_json, note, department_id, status, total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          [
            itemId,
            orderId,
            item.product.id,
            item.product.name_fa,
            item.unitPrice,
            item.quantity,
            item.options.length > 0 ? JSON.stringify(item.options) : null,
            item.extras.length > 0 ? JSON.stringify(item.extras) : null,
            item.note,
            item.product.department_id,
            item.total,
          ],
        );

        for (const option of item.options) {
          this.database.run(
            `INSERT INTO order_item_options (id, order_item_id, option_id, name_snapshot, price_snapshot)
             VALUES (?, ?, ?, ?, ?)`,
            [randomUUID(), itemId, option.id, option.nameFa, option.priceDelta],
          );
        }

        this.database.run(
          `INSERT INTO prep_tasks (id, order_item_id, order_id, department_id, status, priority, target_minutes)
           VALUES (?, ?, ?, ?, 'queued', 0, ?)`,
          [randomUUID(), itemId, orderId, item.product.department_id, item.product.prep_minutes],
        );
      }

      this.database.run(
        `INSERT INTO order_events (id, order_id, type, from_status, to_status, payload_json, created_at)
         VALUES (?, ?, 'order.submitted', 'draft', 'submitted', ?, ?)`,
        [
          randomUUID(),
          orderId,
          JSON.stringify({
            source: 'qr',
            tableId: qr.table_id,
            itemCount: priced.items.length,
            total: priced.total,
          }),
          nowIso,
        ],
      );
    });

    this.repository.insertNotification({
      roleKey: 'waiter',
      type: 'order.created',
      titleFa: `سفارش جدید ${code}`,
      bodyFa: qr.table_name_fa
        ? `${qr.table_name_fa} — ${priced.items.length} قلم`
        : `${priced.items.length} قلم — سفارش بدون میز`,
      data: { orderId, code, tableId: qr.table_id },
    });

    const summary = this.repository.findOrderSummaryByCode(code);
    if (!summary) throw new AppError('ORDER_NOT_CREATED', 500, 'ثبت سفارش انجام نشد. دوباره تلاش کنید.');

    return this.toOrderResponse(summary, false);
  }

  getOrderStatus(code: string): PublicOrderStatusResponse {
    const summary = this.repository.findOrderSummaryByCode(code);
    if (!summary) throw notFound('سفارشی با این کد یافت نشد.', 'ORDER_NOT_FOUND');

    const items = this.repository.listOrderItems(summary.id);

    return {
      code: summary.code,
      status: summary.status,
      statusLabelFa: ORDER_STATUS_LABELS_FA[summary.status as OrderStatus] ?? summary.status,
      subtotal: summary.subtotal,
      serviceCharge: summary.service_charge,
      taxTotal: summary.tax_total,
      total: summary.total,
      note: summary.note,
      cancelReason: summary.cancel_reason,
      tableNameFa: summary.table_name_fa,
      tableCode: summary.table_code,
      createdAt: summary.created_at,
      updatedAt: summary.updated_at,
      items: items.map((item) => ({
        id: item.id,
        nameFa: item.product_name_snapshot,
        quantity: item.quantity,
        unitPrice: item.unit_price_snapshot,
        total: item.total,
        status: item.status,
        note: item.note,
      })),
    };
  }

  /* ---------------------------- service requests --------------------------- */

  createRequest(
    input: PublicRequestInput,
    device: DeviceIdentity,
    clientIp?: string,
  ): { id: string; type: string } {
    if (clientIp && !this.ipRequestLimiter.hit(`request:${clientIp}`)) {
      throw new AppError('RATE_LIMITED', 429, 'تعداد درخواست‌ها از این شبکه زیاد بوده است. کمی بعد تلاش کنید.');
    }
    if (!this.requestLimiter.hit(device.deviceId)) {
      throw new AppError('RATE_LIMITED', 429, 'تعداد درخواست‌های شما زیاد بوده است. کمی صبر کنید.');
    }

    const qr = this.repository.findQrByToken(input.qrToken);
    if (!qr || qr.is_active !== 1) {
      throw notFound('این کد QR معتبر نیست یا غیرفعال شده است.', 'QR_NOT_FOUND');
    }
    if (qr.kind === 'table' && !qr.table_id) {
      throw notFound('میز مربوط به این کد QR دیگر فعال نیست.', 'QR_TABLE_INACTIVE');
    }

    let orderId: string | null = null;
    if (input.orderCode) {
      const order = this.repository.findOrderSummaryByCode(input.orderCode);
      if (order) orderId = order.id;
    }

    const requestId = this.repository.insertCustomerRequest({
      tableId: qr.table_id,
      orderId,
      type: input.type,
      note: input.note ?? null,
      deviceId: device.deviceId,
    });

    let terminalRequestId: string | null = null;
    if (input.type === 'terminal') {
      terminalRequestId = this.repository.insertTerminalRequest({
        orderId,
        tableId: qr.table_id,
        note: input.note ?? null,
      });
    }

    const label = CUSTOMER_REQUEST_LABELS_FA[input.type];
    this.repository.insertNotification({
      roleKey: input.type === 'terminal' || input.type === 'bill' ? 'cashier' : 'waiter',
      type: `customer_request.${input.type}`,
      titleFa: `${label} — ${qr.table_name_fa ?? 'بدون میز'}`,
      bodyFa: input.note ?? null,
      data: { requestId, terminalRequestId, tableId: qr.table_id, orderCode: input.orderCode ?? null },
    });

    return { id: requestId, type: input.type };
  }

  /* --------------------------------- helpers ------------------------------- */

  private toOrderResponse(
    summary: NonNullable<ReturnType<PublicRepository['findOrderSummaryByCode']>>,
    replayed: boolean,
  ): PublicOrderResponse {
    const items = this.repository.listOrderItems(summary.id);
    return {
      id: summary.id,
      code: summary.code,
      status: summary.status,
      statusLabelFa: ORDER_STATUS_LABELS_FA[summary.status as OrderStatus] ?? summary.status,
      total: summary.total,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      tableNameFa: summary.table_name_fa,
      createdAt: summary.created_at,
      replayed,
    };
  }

  private generateOrderCode(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let suffix = '';
      for (let i = 0; i < 6; i += 1) {
        suffix += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
      }
      const code = `CF-${suffix}`;
      if (!this.repository.codeExists(code)) return code;
    }
    throw new AppError('CODE_GENERATION_FAILED', 500, 'تولید کد سفارش ناموفق بود. دوباره تلاش کنید.');
  }
}
