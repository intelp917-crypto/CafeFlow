//! Module registry shared by guards and the settings screen.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ModuleKey {
    Ordering,
    QrMenu,
    Tables,
    WaiterDashboard,
    KitchenDashboard,
    BaristaDashboard,
    CashierDashboard,
    Security,
    Notifications,
    Printing,
    Reservations,
    Inventory,
    Employees,
    Finance,
    Crm,
    Games,
}

pub const MODULE_KEYS: [ModuleKey; 16] = [
    ModuleKey::Ordering,
    ModuleKey::QrMenu,
    ModuleKey::Tables,
    ModuleKey::WaiterDashboard,
    ModuleKey::KitchenDashboard,
    ModuleKey::BaristaDashboard,
    ModuleKey::CashierDashboard,
    ModuleKey::Security,
    ModuleKey::Notifications,
    ModuleKey::Printing,
    ModuleKey::Reservations,
    ModuleKey::Inventory,
    ModuleKey::Employees,
    ModuleKey::Finance,
    ModuleKey::Crm,
    ModuleKey::Games,
];

impl ModuleKey {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ordering => "ordering",
            Self::QrMenu => "qr_menu",
            Self::Tables => "tables",
            Self::WaiterDashboard => "waiter_dashboard",
            Self::KitchenDashboard => "kitchen_dashboard",
            Self::BaristaDashboard => "barista_dashboard",
            Self::CashierDashboard => "cashier_dashboard",
            Self::Security => "security",
            Self::Notifications => "notifications",
            Self::Printing => "printing",
            Self::Reservations => "reservations",
            Self::Inventory => "inventory",
            Self::Employees => "employees",
            Self::Finance => "finance",
            Self::Crm => "crm",
            Self::Games => "games",
        }
    }

    pub fn parse_key(value: &str) -> Option<Self> {
        MODULE_KEYS.into_iter().find(|key| key.as_str() == value)
    }

    pub fn definition(self) -> ModuleDefinition {
        MODULE_DEFINITIONS
            .into_iter()
            .find(|definition| definition.key == self)
            .expect("every module key has a definition")
    }
}

#[derive(Debug, Clone)]
pub struct ModuleDefinition {
    pub key: ModuleKey,
    pub name_fa: &'static str,
    pub description_fa: &'static str,
    pub default_enabled: bool,
    pub configurable: bool,
    pub depends_on: &'static [ModuleKey],
    pub phase: u8,
}

pub const MODULE_DEFINITIONS: [ModuleDefinition; 16] = [
    ModuleDefinition {
        key: ModuleKey::Ordering,
        name_fa: "سامانه سفارش",
        description_fa: "هسته ثبت و پیگیری سفارش‌ها؛ بدون این ماژول هیچ سفارشی ثبت نمی‌شود.",
        default_enabled: true,
        configurable: false,
        depends_on: &[],
        phase: 2,
    },
    ModuleDefinition {
        key: ModuleKey::QrMenu,
        name_fa: "منوی QR مشتری",
        description_fa: "منوی دیجیتال مشتری و ثبت سفارش از روی کد QR میز.",
        default_enabled: true,
        configurable: false,
        depends_on: &[ModuleKey::Ordering],
        phase: 2,
    },
    ModuleDefinition {
        key: ModuleKey::Tables,
        name_fa: "مدیریت میز و سالن",
        description_fa: "طبقات، میزها، وضعیت اشغال و چیدمان سالن.",
        default_enabled: true,
        configurable: false,
        depends_on: &[],
        phase: 3,
    },
    ModuleDefinition {
        key: ModuleKey::WaiterDashboard,
        name_fa: "داشبورد گارسون",
        description_fa: "میزهای تحت مسئولیت، درخواست‌های مشتری و ثبت سفارش.",
        default_enabled: true,
        configurable: false,
        depends_on: &[ModuleKey::Tables, ModuleKey::Ordering],
        phase: 3,
    },
    ModuleDefinition {
        key: ModuleKey::KitchenDashboard,
        name_fa: "داشبورد آشپزخانه",
        description_fa: "صف آماده‌سازی غذا و کنترل زمان پخت.",
        default_enabled: true,
        configurable: false,
        depends_on: &[ModuleKey::Ordering],
        phase: 3,
    },
    ModuleDefinition {
        key: ModuleKey::BaristaDashboard,
        name_fa: "داشبورد باریستا",
        description_fa: "صف آماده‌سازی نوشیدنی‌ها و تحویل به گارسون.",
        default_enabled: true,
        configurable: false,
        depends_on: &[ModuleKey::Ordering],
        phase: 3,
    },
    ModuleDefinition {
        key: ModuleKey::CashierDashboard,
        name_fa: "داشبورد صندوق",
        description_fa: "صورتحساب، تسویه، تفکیک و ادغام فاکتور.",
        default_enabled: true,
        configurable: false,
        depends_on: &[ModuleKey::Ordering],
        phase: 4,
    },
    ModuleDefinition {
        key: ModuleKey::Security,
        name_fa: "امنیت و کنترل دسترسی",
        description_fa: "احراز هویت، نقش‌ها، مجوزهای دقیق و گزارش رویدادها.",
        default_enabled: true,
        configurable: false,
        depends_on: &[],
        phase: 1,
    },
    ModuleDefinition {
        key: ModuleKey::Notifications,
        name_fa: "اعلان‌ها و پیام‌ها",
        description_fa: "اعلان درون‌برنامه‌ای، پوش مرورگر و پیامک از طریق صف ارسال.",
        default_enabled: true,
        configurable: false,
        depends_on: &[],
        phase: 5,
    },
    ModuleDefinition {
        key: ModuleKey::Printing,
        name_fa: "چاپ و رسید",
        description_fa: "چاپ رسید صندوق و سفارش آشپزخانه/باریستا از طریق پل چاپ محلی.",
        default_enabled: true,
        configurable: false,
        depends_on: &[ModuleKey::Ordering],
        phase: 4,
    },
    ModuleDefinition {
        key: ModuleKey::Reservations,
        name_fa: "رزرو میز",
        description_fa: "ثبت رزرو تلفنی و حضوری همراه با تأیید مدیر.",
        default_enabled: true,
        configurable: true,
        depends_on: &[ModuleKey::Tables],
        phase: 5,
    },
    ModuleDefinition {
        key: ModuleKey::Inventory,
        name_fa: "مدیریت انبار",
        description_fa: "مواد اولیه، دستور پخت، کسر خودکار موجودی و هشدار کمبود.",
        default_enabled: false,
        configurable: true,
        depends_on: &[ModuleKey::Ordering],
        phase: 6,
    },
    ModuleDefinition {
        key: ModuleKey::Employees,
        name_fa: "کارکنان و شیفت‌ها",
        description_fa: "پروفایل کارکنان، برنامه شیفت، حضور و غیاب و عملکرد.",
        default_enabled: false,
        configurable: true,
        depends_on: &[ModuleKey::Tables],
        phase: 6,
    },
    ModuleDefinition {
        key: ModuleKey::Finance,
        name_fa: "مدیریت مالی",
        description_fa: "درآمد، هزینه، صندوق‌ها، مغایرت نقدی و تراکنش‌های تغییرناپذیر.",
        default_enabled: false,
        configurable: true,
        depends_on: &[ModuleKey::Ordering],
        phase: 6,
    },
    ModuleDefinition {
        key: ModuleKey::Crm,
        name_fa: "باشگاه مشتریان",
        description_fa: "پروفایل مشتری، امتیاز، کیف پول و کمپین‌های وفاداری.",
        default_enabled: false,
        configurable: true,
        depends_on: &[ModuleKey::Ordering],
        phase: 6,
    },
    ModuleDefinition {
        key: ModuleKey::Games,
        name_fa: "بازی میزی مهمان‌ها",
        description_fa: "اتاق بازی هر میز با کد QR؛ مهمان‌ها با گوشی خودشان کنار هم بازی می‌کنند. با خاموش‌کردن آن، دکمهٔ بازی از منوی مشتری و مسیرهای بازی بسته می‌شود.",
        default_enabled: true,
        configurable: true,
        depends_on: &[ModuleKey::Tables],
        phase: 7,
    },
];

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleStatusDto {
    pub key: &'static str,
    pub name_fa: &'static str,
    pub description_fa: &'static str,
    pub enabled: bool,
    pub configurable: bool,
    pub phase: u8,
}

pub fn module_status(enabled: impl Fn(ModuleKey) -> bool) -> Vec<ModuleStatusDto> {
    MODULE_DEFINITIONS
        .into_iter()
        .map(|definition| ModuleStatusDto {
            key: definition.key.as_str(),
            name_fa: definition.name_fa,
            description_fa: definition.description_fa,
            enabled: enabled(definition.key),
            configurable: definition.configurable,
            phase: definition.phase,
        })
        .collect()
}
