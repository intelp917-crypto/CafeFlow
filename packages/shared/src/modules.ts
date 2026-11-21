/**
 * Module registry shared by the API (feature guards) and the web app
 * (navigation + settings screen).
 *
 * Core modules cannot be disabled because the ordering workflow depends on
 * them. Optional business modules default to OFF and must never be a
 * dependency of the core ordering path.
 */

export const MODULE_KEYS = [
  'ordering',
  'tables',
  'qr_menu',
  'waiter_dashboard',
  'kitchen_dashboard',
  'barista_dashboard',
  'cashier_dashboard',
  'security',
  'notifications',
  'printing',
  'reservations',
  'inventory',
  'employees',
  'finance',
  'crm',
  'games',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleDefinition {
  key: ModuleKey;
  nameFa: string;
  descriptionFa: string;
  /** Enabled on a fresh installation. */
  defaultEnabled: boolean;
  /** Administrators may toggle this module from settings. */
  configurable: boolean;
  /** Modules this one reads from; disabling a dependency must warn. */
  dependsOn: ModuleKey[];
  /** Phase in which the module's features become functional. */
  phase: number;
}

export const MODULES: ModuleDefinition[] = [
  {
    key: 'ordering',
    nameFa: 'سامانه سفارش',
    descriptionFa: 'هسته ثبت و پیگیری سفارش‌ها؛ بدون این ماژول هیچ سفارشی ثبت نمی‌شود.',
    defaultEnabled: true,
    configurable: false,
    dependsOn: [],
    phase: 2,
  },
  {
    key: 'qr_menu',
    nameFa: 'منوی QR مشتری',
    descriptionFa: 'منوی دیجیتال مشتری و ثبت سفارش از روی کد QR میز.',
    defaultEnabled: true,
    configurable: false,
    dependsOn: ['ordering'],
    phase: 2,
  },
  {
    key: 'tables',
    nameFa: 'مدیریت میز و سالن',
    descriptionFa: 'طبقات، میزها، وضعیت اشغال و چیدمان سالن.',
    defaultEnabled: true,
    configurable: false,
    dependsOn: [],
    phase: 3,
  },
  {
    key: 'waiter_dashboard',
    nameFa: 'داشبورد گارسون',
    descriptionFa: 'میزهای تحت مسئولیت، درخواست‌های مشتری و ثبت سفارش.',
    defaultEnabled: true,
    configurable: false,
    dependsOn: ['tables', 'ordering'],
    phase: 3,
  },
  {
    key: 'kitchen_dashboard',
    nameFa: 'داشبورد آشپزخانه',
    descriptionFa: 'صف آماده‌سازی غذا و کنترل زمان پخت.',
    defaultEnabled: true,
    configurable: false,
    dependsOn: ['ordering'],
    phase: 3,
  },
  {
    key: 'barista_dashboard',
    nameFa: 'داشبورد باریستا',
    descriptionFa: 'صف آماده‌سازی نوشیدنی‌ها و تحویل به گارسون.',
    defaultEnabled: true,
    configurable: false,
    dependsOn: ['ordering'],
    phase: 3,
  },
  {
    key: 'cashier_dashboard',
    nameFa: 'داشبورد صندوق',
    descriptionFa: 'صورتحساب، تسویه، تفکیک و ادغام فاکتور.',
    defaultEnabled: true,
    configurable: false,
    dependsOn: ['ordering'],
    phase: 4,
  },
  {
    key: 'security',
    nameFa: 'امنیت و کنترل دسترسی',
    descriptionFa: 'احراز هویت، نقش‌ها، مجوزهای دقیق و گزارش رویدادها.',
    defaultEnabled: true,
    configurable: false,
    dependsOn: [],
    phase: 1,
  },
  {
    key: 'notifications',
    nameFa: 'اعلان‌ها و پیام‌ها',
    descriptionFa: 'اعلان درون‌برنامه‌ای، پوش مرورگر و پیامک از طریق صف ارسال.',
    defaultEnabled: true,
    configurable: false,
    dependsOn: [],
    phase: 5,
  },
  {
    key: 'printing',
    nameFa: 'چاپ و رسید',
    descriptionFa: 'چاپ رسید صندوق و سفارش آشپزخانه/باریستا از طریق پل چاپ محلی.',
    defaultEnabled: true,
    configurable: false,
    dependsOn: ['ordering'],
    phase: 4,
  },
  {
    key: 'reservations',
    nameFa: 'رزرو میز',
    descriptionFa: 'ثبت رزرو تلفنی و حضوری همراه با تأیید مدیر.',
    defaultEnabled: true,
    configurable: true,
    dependsOn: ['tables'],
    phase: 5,
  },
  {
    key: 'inventory',
    nameFa: 'مدیریت انبار',
    descriptionFa: 'مواد اولیه، دستور پخت، کسر خودکار موجودی و هشدار کمبود.',
    defaultEnabled: false,
    configurable: true,
    dependsOn: ['ordering'],
    phase: 6,
  },
  {
    key: 'employees',
    nameFa: 'کارکنان و شیفت‌ها',
    descriptionFa: 'پروفایل کارکنان، برنامه شیفت، حضور و غیاب و عملکرد.',
    defaultEnabled: false,
    configurable: true,
    dependsOn: ['tables'],
    phase: 6,
  },
  {
    key: 'finance',
    nameFa: 'مدیریت مالی',
    descriptionFa: 'درآمد، هزینه، صندوق‌ها، مغایرت نقدی و تراکنش‌های تغییرناپذیر.',
    defaultEnabled: false,
    configurable: true,
    dependsOn: ['ordering'],
    phase: 6,
  },
  {
    key: 'crm',
    nameFa: 'باشگاه مشتریان',
    descriptionFa: 'پروفایل مشتری، امتیاز، کیف پول و کمپین‌های وفاداری.',
    defaultEnabled: false,
    configurable: true,
    dependsOn: ['ordering'],
    phase: 6,
  },
  {
    key: 'games',
    nameFa: 'بازی میزی مهمان‌ها',
    descriptionFa:
      'اتاق بازی هر میز با کد QR؛ مهمان‌ها با گوشی خودشان کنار هم بازی می‌کنند. با خاموش‌کردن آن، دکمهٔ بازی از منوی مشتری و مسیرهای بازی بسته می‌شود.',
    defaultEnabled: true,
    configurable: true,
    dependsOn: ['tables'],
    phase: 7,
  },
];

export const MODULE_MAP: Record<ModuleKey, ModuleDefinition> = MODULES.reduce(
  (acc, m) => {
    acc[m.key] = m;
    return acc;
  },
  {} as Record<ModuleKey, ModuleDefinition>,
);

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/** Optional modules only — the ones an administrator can switch on or off. */
export const CONFIGURABLE_MODULES = MODULES.filter((m) => m.configurable);

export type ModuleState = Record<ModuleKey, boolean>;

export function defaultModuleState(): ModuleState {
  return MODULES.reduce((acc, m) => {
    acc[m.key] = m.defaultEnabled;
    return acc;
  }, {} as ModuleState);
}
