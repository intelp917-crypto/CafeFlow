import type { EntityZoneKind, LayoutObjectType, LayoutTableShape } from '@cafeflow/shared';

/** Items offered by the designer's tool library. */
export interface LibraryItem {
  key: string;
  label: string;
  group: 'tables' | 'equipment' | 'zones';
  type: LayoutObjectType;
  shape?: LayoutTableShape;
  capacity?: number;
  zoneKind?: EntityZoneKind;
  width: number;
  height: number;
  color?: string;
}

export const TABLE_LIBRARY: LibraryItem[] = [
  { key: 'table-square', label: 'میز مربع', group: 'tables', type: 'table', shape: 'square', capacity: 4, width: 110, height: 110 },
  { key: 'table-round', label: 'میز گرد', group: 'tables', type: 'table', shape: 'round', capacity: 4, width: 110, height: 110 },
  { key: 'table-rect', label: 'میز مستطیل', group: 'tables', type: 'table', shape: 'rectangle', capacity: 6, width: 170, height: 90 },
];

export const EQUIPMENT_LIBRARY: LibraryItem[] = [
  { key: 'bar', label: 'کانتر بار', group: 'equipment', type: 'bar', width: 260, height: 70, color: '#6a3018' },
  { key: 'kitchen', label: 'آشپزخانه', group: 'equipment', type: 'kitchen', width: 240, height: 160, color: '#3b2519' },
  { key: 'sofa', label: 'مبل و کاناپه', group: 'equipment', type: 'sofa', width: 200, height: 80, color: '#9c8b76' },
  { key: 'chair', label: 'صندلی', group: 'equipment', type: 'chair', width: 40, height: 40, color: '#b95f33' },
  { key: 'service', label: 'سرویس', group: 'equipment', type: 'service', width: 90, height: 70, color: '#9a6c12' },
  { key: 'entrance', label: 'ورودی', group: 'equipment', type: 'entrance', width: 110, height: 45, color: '#3f7a45' },
  { key: 'exit', label: 'خروجی', group: 'equipment', type: 'exit', width: 110, height: 45, color: '#b23a26' },
];

export const ZONE_LIBRARY: LibraryItem[] = [
  { key: 'zone-bar', label: 'فضای بار', group: 'zones', type: 'zone', zoneKind: 'bar', width: 260, height: 180, color: '#e19e76' },
  { key: 'zone-kitchen', label: 'محدوده آشپزخانه', group: 'zones', type: 'zone', zoneKind: 'kitchen', width: 260, height: 180, color: '#cdbda7' },
  { key: 'zone-vip', label: 'فضای VIP', group: 'zones', type: 'zone', zoneKind: 'vip', width: 240, height: 180, color: '#eec0a1' },
  { key: 'zone-smoking', label: 'فضای سیگار', group: 'zones', type: 'zone', zoneKind: 'smoking', width: 200, height: 160, color: '#c4d9e1' },
  { key: 'zone-outdoor', label: 'فضای باز', group: 'zones', type: 'zone', zoneKind: 'outdoor', width: 240, height: 180, color: '#cde3c6' },
  { key: 'zone-waiting', label: 'محدوده انتظار', group: 'zones', type: 'zone', zoneKind: 'waiting', width: 180, height: 120, color: '#efdcae' },
  { key: 'zone-cashier', label: 'محل صندوق', group: 'zones', type: 'zone', zoneKind: 'cashier', width: 160, height: 110, color: '#f0c8ba' },
  { key: 'zone-entrance', label: 'ورودی و خروجی', group: 'zones', type: 'zone', zoneKind: 'entrance', width: 180, height: 90, color: '#e6dbc9' },
  { key: 'zone-pickup', label: 'محل تحویل سفارش', group: 'zones', type: 'zone', zoneKind: 'pickup', width: 160, height: 110, color: '#f7ddc9' },
];

export const ALL_LIBRARY_ITEMS = [...TABLE_LIBRARY, ...EQUIPMENT_LIBRARY, ...ZONE_LIBRARY];

export function findLibraryItem(key: string): LibraryItem | undefined {
  return ALL_LIBRARY_ITEMS.find((item) => item.key === key);
}
