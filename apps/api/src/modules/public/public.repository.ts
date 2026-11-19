import { Inject, Injectable } from '@nestjs/common';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

export interface QrLookupRow {
  id: string;
  kind: 'table' | 'promo';
  token: string;
  table_id: string | null;
  campaign_id: string | null;
  label: string | null;
  is_active: number;
  table_code: string | null;
  table_name_fa: string | null;
  floor_name_fa: string | null;
}

export interface ProductRow {
  id: string;
  category_id: string;
  name_fa: string;
  description_fa: string | null;
  base_price: number;
  image_url: string | null;
  department_id: string | null;
  department_name_fa: string | null;
  prep_minutes: number;
  is_available: number;
  dietary_json: string | null;
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
}

export interface ExtraRow {
  product_id: string;
  id: string;
  name_fa: string;
  price: number;
}

export interface AvailabilityRow {
  product_id: string;
  weekday: number | null;
  start_time: string;
  end_time: string;
}

export interface SettingsRow {
  restaurant_name_fa: string;
  currency: string;
  digit_mode: 'fa' | 'latin';
  service_charge_percent: number;
  tax_percent: number;
  logo_url: string;
  address_fa: string;
  phone: string;
}

export interface DeviceRow {
  id: string;
  token_hash: string;
}

@Injectable()
export class PublicRepository {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  findQrByToken(token: string): QrLookupRow | undefined {
    return this.database.get<QrLookupRow>(
      `SELECT q.id, q.kind, q.token, q.table_id, q.campaign_id, q.label, q.is_active,
              t.code AS table_code, t.name_fa AS table_name_fa, f.name_fa AS floor_name_fa
         FROM qr_codes q
         LEFT JOIN dining_tables t ON t.id = q.table_id AND t.deleted_at IS NULL AND t.is_active = 1
         LEFT JOIN floors f ON f.id = t.floor_id
        WHERE q.token = ?`,
      [token],
    );
  }

  getSettings(): SettingsRow {
    return (
      this.database.get<SettingsRow>(
        `SELECT restaurant_name_fa, currency, digit_mode, service_charge_percent, tax_percent,
                logo_url, address_fa, phone
           FROM settings WHERE id = 'singleton'`,
      ) ?? {
        restaurant_name_fa: 'کافه‌فلو',
        currency: 'IRR',
        digit_mode: 'fa',
        service_charge_percent: 0,
        tax_percent: 0,
        logo_url: '',
        address_fa: '',
        phone: '',
      }
    );
  }

  listCategories() {
    return this.database.all<{ id: string; name_fa: string; slug: string }>(
      `SELECT id, name_fa, slug FROM categories
        WHERE is_active = 1 AND deleted_at IS NULL
        ORDER BY sort_order ASC, name_fa ASC`,
    );
  }

  listProducts(): ProductRow[] {
    return this.database.all<ProductRow>(
      `SELECT p.id, p.category_id, p.name_fa, p.description_fa, p.base_price, p.image_url,
              p.department_id, d.name_fa AS department_name_fa, p.prep_minutes,
              p.is_available, p.dietary_json
         FROM products p
         JOIN categories c ON c.id = p.category_id AND c.is_active = 1 AND c.deleted_at IS NULL
         LEFT JOIN departments d ON d.id = p.department_id
        WHERE p.is_active = 1 AND p.is_archived = 0 AND p.deleted_at IS NULL
        ORDER BY c.sort_order ASC, p.name_fa ASC`,
    );
  }

  listOptionGroups(): OptionGroupRow[] {
    return this.database.all<OptionGroupRow>(
      `SELECT id, product_id, name_fa, min_select, max_select, is_required, sort_order
         FROM option_groups ORDER BY sort_order ASC, name_fa ASC`,
    );
  }

  listOptions(): OptionRow[] {
    return this.database.all<OptionRow>(
      `SELECT o.id, o.option_group_id, o.name_fa, o.price_delta
         FROM product_options o
         JOIN option_groups g ON g.id = o.option_group_id
        WHERE o.is_active = 1
        ORDER BY o.sort_order ASC, o.name_fa ASC`,
    );
  }

  listExtras(): ExtraRow[] {
    return this.database.all<ExtraRow>(
      `SELECT pe.product_id, e.id, e.name_fa, e.price
         FROM product_extras pe
         JOIN extras e ON e.id = pe.extra_id AND e.is_active = 1
        ORDER BY e.name_fa ASC`,
    );
  }

  listAvailabilityWindows(): AvailabilityRow[] {
    return this.database.all<AvailabilityRow>(
      `SELECT product_id, weekday, start_time, end_time FROM availability_windows WHERE is_active = 1`,
    );
  }

  findProductById(productId: string): ProductRow | undefined {
    return this.database.get<ProductRow>(
      `SELECT p.id, p.category_id, p.name_fa, p.description_fa, p.base_price, p.image_url,
              p.department_id, d.name_fa AS department_name_fa, p.prep_minutes,
              p.is_available, p.dietary_json
         FROM products p
         LEFT JOIN departments d ON d.id = p.department_id
         JOIN categories c ON c.id = p.category_id AND c.is_active = 1 AND c.deleted_at IS NULL
        WHERE p.id = ? AND p.is_active = 1 AND p.is_archived = 0 AND p.deleted_at IS NULL`,
      [productId],
    );
  }

  /* ---------------------------- customer devices ---------------------------- */

  findDeviceByTokenHash(tokenHash: string): DeviceRow | undefined {
    return this.database.get<DeviceRow>('SELECT id, token_hash FROM customer_devices WHERE token_hash = ?', [
      tokenHash,
    ]);
  }

  createDevice(id: string, tokenHash: string): void {
    this.database.run('INSERT INTO customer_devices (id, token_hash) VALUES (?, ?)', [id, tokenHash]);
  }

  touchDevice(id: string): void {
    this.database.run('UPDATE customer_devices SET last_seen_at = ? WHERE id = ?', [new Date().toISOString(), id]);
  }

  /* --------------------------------- orders -------------------------------- */

  findOrderByRequestId(deviceId: string, clientRequestId: string): { id: string; code: string } | undefined {
    return this.database.get<{ id: string; code: string }>(
      'SELECT id, code FROM orders WHERE guest_device_id = ? AND client_request_id = ?',
      [deviceId, clientRequestId],
    );
  }

  codeExists(code: string): boolean {
    return Boolean(this.database.get('SELECT 1 AS x FROM orders WHERE code = ?', [code]));
  }

  findOrderSummaryByCode(code: string) {
    return this.database.get<{
      id: string;
      code: string;
      status: string;
      total: number;
      subtotal: number;
      service_charge: number;
      tax_total: number;
      created_at: string;
      updated_at: string;
      table_name_fa: string | null;
      table_code: string | null;
      note: string | null;
      cancel_reason: string | null;
    }>(
      `SELECT o.id, o.code, o.status, o.total, o.subtotal, o.service_charge, o.tax_total,
              o.created_at, o.updated_at, o.note, o.cancel_reason,
              t.name_fa AS table_name_fa, t.code AS table_code
         FROM orders o
         LEFT JOIN dining_tables t ON t.id = o.table_id
        WHERE o.code = ?`,
      [code],
    );
  }

  listOrderItems(orderId: string) {
    return this.database.all<{
      id: string;
      product_name_snapshot: string;
      unit_price_snapshot: number;
      quantity: number;
      total: number;
      status: string;
      note: string | null;
      options_json: string | null;
      extras_json: string | null;
    }>(
      `SELECT id, product_name_snapshot, unit_price_snapshot, quantity, total, status, note,
              options_json, extras_json
         FROM order_items WHERE order_id = ? ORDER BY created_at ASC`,
      [orderId],
    );
  }

  /* ------------------------------- operations ------------------------------ */

  findOpenTableSession(tableId: string): { id: string } | undefined {
    return this.database.get<{ id: string }>(
      "SELECT id FROM table_sessions WHERE table_id = ? AND status = 'open'",
      [tableId],
    );
  }

  openTableSession(tableId: string, guestCount: number | null): string {
    const id = randomId();
    this.database.run(
      `INSERT INTO table_sessions (id, table_id, guest_count, status) VALUES (?, ?, ?, 'open')`,
      [id, tableId, guestCount],
    );
    this.database.run(
      `UPDATE dining_tables
          SET status = 'occupied', updated_at = ?
        WHERE id = ? AND status = 'available'`,
      [new Date().toISOString(), tableId],
    );
    return id;
  }

  insertNotification(params: {
    roleKey: string | null;
    type: string;
    titleFa: string;
    bodyFa?: string | null;
    data?: unknown;
  }): void {
    this.database.run(
      `INSERT INTO notifications (id, role_key, type, title_fa, body_fa, data_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        randomId(),
        params.roleKey,
        params.type,
        params.titleFa,
        params.bodyFa ?? null,
        params.data === undefined ? null : JSON.stringify(params.data),
      ],
    );
  }

  insertCustomerRequest(params: {
    tableId: string | null;
    orderId: string | null;
    type: string;
    note: string | null;
    deviceId: string | null;
  }): string {
    const id = randomId();
    this.database.run(
      `INSERT INTO customer_requests (id, table_id, order_id, type, note, status, created_by_device_id)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [id, params.tableId, params.orderId, params.type, params.note, params.deviceId],
    );
    return id;
  }

  insertTerminalRequest(params: { orderId: string | null; tableId: string | null; note: string | null }): string {
    const id = randomId();
    this.database.run(
      `INSERT INTO terminal_requests (id, order_id, table_id, status, note)
       VALUES (?, ?, ?, 'pending', ?)`,
      [id, params.orderId, params.tableId, params.note],
    );
    return id;
  }

  get databaseHandle(): DatabaseService {
    return this.database;
  }
}

function randomId(): string {
  // Local helper so repositories can create ids without importing crypto in
  // every call site; UUIDs are the project-wide convention.
  return globalThis.crypto.randomUUID();
}
