import { z } from 'zod';

/**
 * Contracts for the unauthenticated customer surface (QR menu).
 *
 * The same Zod schemas validate requests in the API and describe the payloads
 * the web app sends, so the two can never drift apart.
 */

export const publicOrderItemSchema = z.object({
  productId: z.string().min(1, 'شناسه محصول الزامی است.'),
  quantity: z
    .number({ error: 'تعداد باید عدد باشد.' })
    .int('تعداد باید عدد صحیح باشد.')
    .min(1, 'حداقل تعداد ۱ است.')
    .max(20, 'حداکثر تعداد ۲۰ است.'),
  optionIds: z.array(z.string()).max(20).default([]),
  extraIds: z.array(z.string()).max(20).default([]),
  note: z.string().trim().max(200, 'یادداشت آیتم بیش از حد طولانی است.').optional(),
});

export const publicOrderSchema = z.object({
  qrToken: z.string().min(1, 'کد QR الزامی است.'),
  clientRequestId: z
    .string()
    .min(8, 'شناسه درخواست نامعتبر است.')
    .max(64, 'شناسه درخواست نامعتبر است.'),
  note: z.string().trim().max(300, 'یادداشت سفارش بیش از حد طولانی است.').optional(),
  items: z.array(publicOrderItemSchema).min(1, 'سبد خرید خالی است.').max(30, 'تعداد اقلام بیش از حد مجاز است.'),
});

export type PublicOrderInput = z.infer<typeof publicOrderSchema>;
export type PublicOrderItemInput = z.infer<typeof publicOrderItemSchema>;

/** Another round on an existing order; the status token authorises it. */
export const publicOrderItemsSchema = publicOrderSchema.pick({
  clientRequestId: true,
  items: true,
});
export type PublicOrderItemsInput = z.infer<typeof publicOrderItemsSchema>;

export const customerRequestTypes = [
  'waiter',
  'water',
  'tissues',
  'bill',
  'terminal',
  'assistance',
  'custom',
] as const;

export type CustomerRequestType = (typeof customerRequestTypes)[number];

export const CUSTOMER_REQUEST_LABELS_FA: Record<CustomerRequestType, string> = {
  waiter: 'درخواست گارسون',
  water: 'درخواست آب',
  tissues: 'درخواست دستمال',
  bill: 'درخواست صورتحساب',
  terminal: 'درخواست کارت‌خوان',
  assistance: 'درخواست کمک',
  custom: 'درخواست دیگر',
};

export const publicRequestSchema = z.object({
  qrToken: z.string().min(1, 'کد QR الزامی است.'),
  type: z.enum(customerRequestTypes, { error: 'نوع درخواست نامعتبر است.' }),
  note: z.string().trim().max(300, 'توضیح درخواست بیش از حد طولانی است.').optional(),
  orderCode: z.string().trim().max(32).optional(),
});

export type PublicRequestInput = z.infer<typeof publicRequestSchema>;

/** Card-terminal request specifically (validated independently of the type field). */
export const publicTerminalRequestSchema = z.object({
  qrToken: z.string().min(1, 'کد QR الزامی است.'),
  note: z.string().trim().max(300, 'توضیح درخواست بیش از حد طولانی است.').optional(),
  orderCode: z.string().trim().max(32).optional(),
});

export type PublicTerminalRequestInput = z.infer<typeof publicTerminalRequestSchema>;

/* ------------------------------ response types ----------------------------- */

export interface PublicMenuOption {
  id: string;
  nameFa: string;
  priceDelta: number;
}

export interface PublicMenuOptionGroup {
  id: string;
  nameFa: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  options: PublicMenuOption[];
}

export interface PublicMenuExtra {
  id: string;
  nameFa: string;
  price: number;
}

export interface PublicMenuProduct {
  id: string;
  categoryId: string;
  nameFa: string;
  descriptionFa: string | null;
  price: number;
  imageUrl: string | null;
  prepMinutes: number;
  isAvailable: boolean;
  unavailableReasonFa: string | null;
  optionGroups: PublicMenuOptionGroup[];
  extras: PublicMenuExtra[];
}

export interface PublicMenuCategory {
  id: string;
  nameFa: string;
  slug: string;
  products: PublicMenuProduct[];
}

export interface PublicMenuResponse {
  restaurant: {
    nameFa: string;
    currency: string;
    digitMode: 'fa' | 'latin';
    serviceChargePercent: number;
    taxPercent: number;
    logoUrl: string;
    addressFa: string;
    phone: string;
    /** The café pin, editable in Settings; null until an admin sets it. */
    latitude: number | null;
    longitude: number | null;
  };
  qr: { kind: 'table' | 'promo'; label: string | null } | null;
  table: { id: string; nameFa: string; code: string; floorNameFa: string | null } | null;
  categories: PublicMenuCategory[];
  serverTime: string;
}

/** Public shell identity, used by the landing page, status page and footers. */
export interface PublicBrandingResponse {
  nameFa: string;
  logoUrl: string;
  addressFa: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
}

export interface PublicOrderResponse {
  id: string;
  code: string;
  status: string;
  statusLabelFa: string;
  total: number;
  itemCount: number;
  tableNameFa: string | null;
  createdAt: string;
  replayed: boolean;
  /** Bearer token for the status page; returned once, on creation. */
  statusToken?: string | null;
}

export interface PublicOrderItemsResponse {
  code: string;
  status: string;
  total: number;
  addedSubtotal: number;
  itemCount: number;
  replayed: boolean;
}

export interface PublicOrderStatusResponse {
  code: string;
  status: string;
  statusLabelFa: string;
  subtotal: number;
  serviceCharge: number;
  taxTotal: number;
  total: number;
  note: string | null;
  cancelReason: string | null;
  tableNameFa: string | null;
  tableCode: string | null;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    nameFa: string;
    quantity: number;
    unitPrice: number;
    total: number;
    status: string;
    note: string | null;
  }>;
}
