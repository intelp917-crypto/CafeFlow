import { z } from 'zod';

/**
 * Contracts for the floor-plan designer (phase 8).
 *
 * A floor owns one plan of freely positioned objects. Table objects point at
 * `dining_tables` so the map is not a drawing: it carries the real tables used
 * by orders, reservations and QR menus.
 */

export const LAYOUT_OBJECT_TYPES = [
  'table',
  'chair',
  'bar',
  'kitchen',
  'sofa',
  'service',
  'entrance',
  'exit',
  'zone',
  'other',
] as const;
export type LayoutObjectType = (typeof LAYOUT_OBJECT_TYPES)[number];

export const LAYOUT_OBJECT_TYPE_LABELS_FA: Record<LayoutObjectType, string> = {
  table: 'میز',
  chair: 'صندلی',
  bar: 'کانتر بار',
  kitchen: 'آشپزخانه',
  sofa: 'مبل و کاناپه',
  service: 'سرویس',
  entrance: 'ورودی',
  exit: 'خروجی',
  zone: 'محدوده',
  other: 'تجهیز',
};

export const LAYOUT_FLOOR_KINDS = ['indoor', 'vip', 'family', 'roof', 'outdoor', 'kitchen', 'other'] as const;
export type LayoutFloorKind = (typeof LAYOUT_FLOOR_KINDS)[number];

export const LAYOUT_FLOOR_KIND_LABELS_FA: Record<LayoutFloorKind, string> = {
  indoor: 'سالن سرپوشیده',
  vip: 'سالن VIP',
  family: 'سالن خانوادگی',
  roof: 'روف گاردن',
  outdoor: 'فضای باز',
  kitchen: 'آشپزخانه',
  other: 'سایر',
};

export const TABLE_SHAPES = ['square', 'round', 'rectangle'] as const;
export type LayoutTableShape = (typeof TABLE_SHAPES)[number];

export const TABLE_SHAPE_LABELS_FA: Record<LayoutTableShape, string> = {
  square: 'مربع',
  round: 'گرد',
  rectangle: 'مستطیل',
};

export const ENTITY_ZONE_KINDS = [
  'bar',
  'kitchen',
  'vip',
  'smoking',
  'outdoor',
  'waiting',
  'cashier',
  'entrance',
  'pickup',
] as const;
export type EntityZoneKind = (typeof ENTITY_ZONE_KINDS)[number];

export const ENTITY_ZONE_LABELS_FA: Record<EntityZoneKind, string> = {
  bar: 'فضای بار',
  kitchen: 'محدوده آشپزخانه',
  vip: 'فضای VIP',
  smoking: 'فضای سیگار',
  outdoor: 'فضای باز',
  waiting: 'محدوده انتظار',
  cashier: 'محل صندوق',
  entrance: 'ورودی و خروجی',
  pickup: 'محل تحویل سفارش',
};

/** A chair is stored as an offset from its table's centre so the table can move. */
export const layoutChairSchema = z.object({
  id: z.string().min(1).max(64),
  dx: z.number().min(-4000).max(4000),
  dy: z.number().min(-4000).max(4000),
  rotation: z.number().min(-3600).max(3600).default(0),
});
export type LayoutChair = z.infer<typeof layoutChairSchema>;

export const layoutObjectPropsSchema = z.object({
  labelFa: z.string().max(80).optional(),
  color: z.string().max(24).optional(),
  zoneKind: z.string().max(40).optional(),
  chairs: z.array(layoutChairSchema).max(80).optional(),
  note: z.string().max(200).optional(),
});
export type LayoutObjectProps = z.infer<typeof layoutObjectPropsSchema>;

export const layoutObjectSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(LAYOUT_OBJECT_TYPES),
  tableId: z.string().max(64).nullable().optional(),
  x: z.number().min(-20000).max(20000),
  y: z.number().min(-20000).max(20000),
  width: z.number().min(6).max(4000),
  height: z.number().min(6).max(4000),
  rotation: z.number().min(-3600).max(3600).default(0),
  zIndex: z.number().int().min(-500).max(5000).default(0),
  layer: z.string().max(40).default('default'),
  locked: z.boolean().default(false),
  groupId: z.string().max(64).nullable().optional(),
  props: layoutObjectPropsSchema.default({}),
});
export type LayoutObject = z.infer<typeof layoutObjectSchema>;

export const saveFloorplanSchema = z.object({
  width: z.number().min(400).max(6000),
  height: z.number().min(300).max(6000),
  gridSize: z.number().min(4).max(100),
  objects: z.array(layoutObjectSchema).max(400),
});
export type SaveFloorplanInput = z.infer<typeof saveFloorplanSchema>;

export const createFloorSchema = z.object({
  nameFa: z.string().trim().min(1, 'نام طبقه را وارد کنید.').max(60, 'نام طبقه حداکثر ۶۰ نویسه است.'),
  kind: z.enum(LAYOUT_FLOOR_KINDS).default('indoor'),
  sortOrder: z.number().int().min(0).max(999).optional(),
});
export type CreateFloorInput = z.infer<typeof createFloorSchema>;

export const updateFloorSchema = z.object({
  nameFa: z.string().trim().min(1).max(60).optional(),
  kind: z.enum(LAYOUT_FLOOR_KINDS).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateFloorInput = z.infer<typeof updateFloorSchema>;

export const createAreaSchema = z.object({
  nameFa: z.string().trim().min(1, 'نام بخش را وارد کنید.').max(60),
});
export type CreateAreaInput = z.infer<typeof createAreaSchema>;

export const updateAreaSchema = z.object({
  nameFa: z.string().trim().min(1).max(60).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateAreaInput = z.infer<typeof updateAreaSchema>;

export const createLayoutTableSchema = z.object({
  floorId: z.string().min(1),
  areaId: z.string().min(1).nullable().optional(),
  nameFa: z.string().trim().min(1).max(60).optional(),
  code: z.string().trim().min(1).max(12).optional(),
  capacity: z.number().int().min(1, 'ظرفیت میز باید دست‌کم یک نفر باشد.').max(60),
  shape: z.enum(TABLE_SHAPES).default('square'),
  x: z.number().min(0).max(20000),
  y: z.number().min(0).max(20000),
  width: z.number().min(20).max(1000),
  height: z.number().min(20).max(1000),
  rotation: z.number().min(-3600).max(3600).default(0),
  waiterUserId: z.string().min(1).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type CreateLayoutTableInput = z.infer<typeof createLayoutTableSchema>;

export const updateLayoutTableSchema = z.object({
  nameFa: z.string().trim().min(1).max(60).optional(),
  code: z.string().trim().min(1).max(12).optional(),
  capacity: z.number().int().min(1).max(60).optional(),
  shape: z.enum(TABLE_SHAPES).optional(),
  areaId: z.string().min(1).nullable().optional(),
  waiterUserId: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  note: z.string().max(200).nullable().optional(),
});
export type UpdateLayoutTableInput = z.infer<typeof updateLayoutTableSchema>;

export interface LayoutAreaDto {
  id: string;
  nameFa: string;
  isActive: boolean;
}

export interface LayoutTableDto {
  id: string;
  code: string;
  nameFa: string;
  capacity: number;
  shape: LayoutTableShape;
  status: string;
  areaId: string | null;
  waiterUserId: string | null;
  isActive: boolean;
  hasQr: boolean;
}

export interface LayoutPlanDto {
  width: number;
  height: number;
  gridSize: number;
  objects: LayoutObject[];
}

export interface LayoutFloorDto {
  id: string;
  nameFa: string;
  kind: LayoutFloorKind;
  sortOrder: number;
  isActive: boolean;
  areas: LayoutAreaDto[];
  plan: LayoutPlanDto;
  tables: LayoutTableDto[];
}

export interface LayoutResponse {
  floors: LayoutFloorDto[];
  waiters: Array<{ id: string; fullName: string }>;
}

export interface LayoutVersionDto {
  id: string;
  version: number;
  createdAt: string;
  createdByName: string | null;
  objectCount: number;
}

export interface LayoutTableQrDto {
  tableId: string;
  tableNameFa: string;
  token: string;
  menuUrl: string;
}
