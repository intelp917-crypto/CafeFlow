/**
 * Granular permission catalogue.
 *
 * Permissions are the only authorization primitive the backend trusts.
 * Roles are just named bundles of permissions and may be edited by an
 * administrator, so no rule may ever depend on a role name directly.
 */

export const PERMISSIONS = [
  { key: 'dashboard.read', labelFa: 'مشاهده داشبورد', group: 'dashboard' },

  { key: 'catalog.read', labelFa: 'مشاهده منو و محصولات', group: 'catalog' },
  { key: 'catalog.write', labelFa: 'مدیریت منو و محصولات', group: 'catalog' },

  { key: 'layout.read', labelFa: 'مشاهده میزها و طبقات', group: 'layout' },
  { key: 'layout.write', labelFa: 'مدیریت میزها و طبقات', group: 'layout' },

  { key: 'orders.read', labelFa: 'مشاهده سفارش‌ها', group: 'orders' },
  { key: 'orders.write', labelFa: 'ثبت و ویرایش سفارش', group: 'orders' },
  { key: 'orders.cancel', labelFa: 'لغو سفارش', group: 'orders' },
  { key: 'orders.discount', labelFa: 'اعمال تخفیف روی سفارش', group: 'orders' },

  { key: 'prep.read', labelFa: 'مشاهده صف آماده‌سازی', group: 'prep' },
  { key: 'prep.update', labelFa: 'تغییر وضعیت آماده‌سازی', group: 'prep' },

  { key: 'payments.read', labelFa: 'مشاهده پرداخت‌ها', group: 'payments' },
  { key: 'payments.create', labelFa: 'ثبت پرداخت و تسویه', group: 'payments' },
  { key: 'payments.refund', labelFa: 'بازگشت وجه', group: 'payments' },

  { key: 'reservations.read', labelFa: 'مشاهده رزروها', group: 'reservations' },
  { key: 'reservations.write', labelFa: 'مدیریت رزروها', group: 'reservations' },

  { key: 'discounts.read', labelFa: 'مشاهده تخفیف‌ها و QR', group: 'discounts' },
  { key: 'discounts.write', labelFa: 'مدیریت تخفیف‌ها و QR', group: 'discounts' },

  { key: 'users.read', labelFa: 'مشاهده کارکنان', group: 'users' },
  { key: 'users.write', labelFa: 'مدیریت کارکنان', group: 'users' },
  { key: 'roles.read', labelFa: 'مشاهده نقش‌ها', group: 'users' },
  { key: 'roles.write', labelFa: 'مدیریت نقش‌ها و دسترسی‌ها', group: 'users' },

  { key: 'modules.read', labelFa: 'مشاهده وضعیت ماژول‌ها', group: 'system' },
  { key: 'modules.manage', labelFa: 'فعال/غیرفعال کردن ماژول‌ها', group: 'system' },
  { key: 'settings.read', labelFa: 'مشاهده تنظیمات', group: 'system' },
  { key: 'settings.write', labelFa: 'تغییر تنظیمات سیستم', group: 'system' },

  { key: 'audit.read', labelFa: 'مشاهده گزارش رویدادها', group: 'security' },
  { key: 'approvals.read', labelFa: 'مشاهده صف تأیید', group: 'security' },
  { key: 'approvals.decide', labelFa: 'تأیید یا رد درخواست‌ها', group: 'security' },
  { key: 'sessions.manage', labelFa: 'مدیریت نشست‌های ورود', group: 'security' },

  { key: 'reports.read', labelFa: 'مشاهده گزارش‌های مدیریتی', group: 'reports' },

  { key: 'inventory.read', labelFa: 'مشاهده انبار', group: 'inventory' },
  { key: 'inventory.write', labelFa: 'مدیریت انبار', group: 'inventory' },

  { key: 'finance.read', labelFa: 'مشاهده امور مالی', group: 'finance' },
  { key: 'finance.write', labelFa: 'ثبت تراکنش مالی', group: 'finance' },

  { key: 'crm.read', labelFa: 'مشاهده مشتریان', group: 'crm' },
  { key: 'crm.write', labelFa: 'مدیریت مشتریان و باشگاه مشتریان', group: 'crm' },

  { key: 'shifts.read', labelFa: 'مشاهده شیفت‌ها', group: 'shifts' },
  { key: 'shifts.write', labelFa: 'مدیریت شیفت‌ها', group: 'shifts' },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

/** Menu label for a permission key (Persian), used by the admin UI. */
export function permissionLabelFa(key: string): string {
  return PERMISSIONS.find((p) => p.key === key)?.labelFa ?? key;
}

export const PERMISSION_GROUP_LABELS_FA: Record<string, string> = {
  dashboard: 'داشبورد',
  catalog: 'منو و محصولات',
  layout: 'میزها و سالن',
  orders: 'سفارش‌ها',
  prep: 'آماده‌سازی',
  payments: 'پرداخت‌ها',
  reservations: 'رزروها',
  discounts: 'تخفیف و QR',
  users: 'کارکنان و نقش‌ها',
  system: 'سیستم',
  security: 'امنیت',
  reports: 'گزارش‌ها',
  inventory: 'انبار',
  finance: 'مالی',
  crm: 'باشگاه مشتریان',
  shifts: 'شیفت‌ها',
};

/**
 * Seed role definitions. Roles live in the database and are editable;
 * these bundles only describe the initial installation.
 */
export interface SeedRole {
  key: string;
  nameFa: string;
  descriptionFa: string;
  permissions: PermissionKey[] | '*';
}

export const SEED_ROLES: SeedRole[] = [
  {
    key: 'super_admin',
    nameFa: 'مدیر ارشد',
    descriptionFa: 'دسترسی کامل به تمام بخش‌های سیستم',
    permissions: '*',
  },
  {
    key: 'manager',
    nameFa: 'مدیر رستوران',
    descriptionFa: 'مدیریت عملیات، کارکنان و گزارش‌ها بدون دسترسی به تراکنش‌های مالی حساس',
    permissions: [
      'dashboard.read',
      'catalog.read',
      'catalog.write',
      'layout.read',
      'layout.write',
      'orders.read',
      'orders.write',
      'orders.cancel',
      'orders.discount',
      'prep.read',
      'prep.update',
      'payments.read',
      'payments.create',
      'reservations.read',
      'reservations.write',
      'discounts.read',
      'discounts.write',
      'users.read',
      'users.write',
      'roles.read',
      'modules.read',
      'settings.read',
      'audit.read',
      'approvals.read',
      'approvals.decide',
      'sessions.manage',
      'reports.read',
      'inventory.read',
      'shifts.read',
      'crm.read',
    ],
  },
  {
    key: 'cashier',
    nameFa: 'صندوق‌دار',
    descriptionFa: 'تسویه سفارش‌ها، ثبت پرداخت و صدور رسید',
    permissions: [
      'dashboard.read',
      'orders.read',
      'payments.read',
      'payments.create',
      'payments.refund',
      'layout.read',
      'catalog.read',
      'discounts.read',
      'orders.discount',
      'reports.read',
    ],
  },
  {
    key: 'waiter',
    nameFa: 'گارسون',
    descriptionFa: 'مدیریت میزهای تحت مسئولیت و ثبت سفارش مشتری',
    permissions: [
      'dashboard.read',
      'layout.read',
      'layout.write',
      'catalog.read',
      'orders.read',
      'orders.write',
      'prep.read',
      'reservations.read',
      'reservations.write',
    ],
  },
  {
    key: 'barista',
    nameFa: 'باریستا',
    descriptionFa: 'آماده‌سازی نوشیدنی‌ها و مدیریت صف باریستا',
    permissions: ['dashboard.read', 'prep.read', 'prep.update', 'orders.read', 'catalog.read'],
  },
  {
    key: 'kitchen',
    nameFa: 'آشپزخانه',
    descriptionFa: 'آماده‌سازی غذاها و مدیریت صف آشپزخانه',
    permissions: ['dashboard.read', 'prep.read', 'prep.update', 'orders.read', 'catalog.read'],
  },
  {
    key: 'inventory_manager',
    nameFa: 'مسئول انبار',
    descriptionFa: 'مدیریت مواد اولیه، موجودی و خرید',
    permissions: ['dashboard.read', 'inventory.read', 'inventory.write', 'reports.read', 'catalog.read'],
  },
  {
    key: 'accountant',
    nameFa: 'حسابدار',
    descriptionFa: 'مشاهده و ثبت اطلاعات مالی و گزارش‌های فروش',
    permissions: ['dashboard.read', 'finance.read', 'reports.read', 'payments.read', 'audit.read'],
  },
];
