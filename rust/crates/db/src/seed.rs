use std::collections::HashMap;

use anyhow::{Context, Result};
use cafeflow_domain::{MODULE_DEFINITIONS, ModuleKey};
use sqlx::{Any, Row, Transaction};
use uuid::Uuid;

use crate::database::Database;
use crate::password::{hash_password, now_iso};

#[derive(Debug, Clone)]
pub struct SeedOptions {
    pub admin_username: String,
    pub admin_password: String,
    pub demo_staff: bool,
    pub demo_menu: bool,
}

const PERMISSIONS: &[(&str, &str, &str)] = &[
    ("dashboard.read", "مشاهده داشبورد", "dashboard"),
    ("catalog.read", "مشاهده منو و محصولات", "catalog"),
    ("catalog.write", "مدیریت منو و محصولات", "catalog"),
    ("layout.read", "مشاهده میزها و طبقات", "layout"),
    ("layout.write", "مدیریت میزها و طبقات", "layout"),
    ("orders.read", "مشاهده سفارش‌ها", "orders"),
    ("orders.write", "ثبت و ویرایش سفارش", "orders"),
    ("orders.cancel", "لغو سفارش", "orders"),
    ("orders.discount", "اعمال تخفیف روی سفارش", "orders"),
    ("prep.read", "مشاهده صف آماده‌سازی", "prep"),
    ("prep.update", "تغییر وضعیت آماده‌سازی", "prep"),
    ("payments.read", "مشاهده پرداخت‌ها", "payments"),
    ("payments.create", "ثبت پرداخت و تسویه", "payments"),
    ("payments.refund", "بازگشت وجه", "payments"),
    ("reservations.read", "مشاهده رزروها", "reservations"),
    ("reservations.write", "مدیریت رزروها", "reservations"),
    ("discounts.read", "مشاهده تخفیف‌ها و QR", "discounts"),
    ("discounts.write", "مدیریت تخفیف‌ها و QR", "discounts"),
    ("users.read", "مشاهده کارکنان", "users"),
    ("users.write", "مدیریت کارکنان", "users"),
    ("roles.read", "مشاهده نقش‌ها", "users"),
    ("roles.write", "مدیریت نقش‌ها و دسترسی‌ها", "users"),
    ("modules.read", "مشاهده وضعیت ماژول‌ها", "system"),
    ("modules.manage", "فعال/غیرفعال کردن ماژول‌ها", "system"),
    ("settings.read", "مشاهده تنظیمات", "system"),
    ("settings.write", "تغییر تنظیمات سیستم", "system"),
    ("audit.read", "مشاهده گزارش رویدادها", "security"),
    ("approvals.read", "مشاهده صف تأیید", "security"),
    ("approvals.decide", "تأیید یا رد درخواست‌ها", "security"),
    ("sessions.manage", "مدیریت نشست‌های ورود", "security"),
    ("reports.read", "مشاهده گزارش‌های مدیریتی", "reports"),
    ("inventory.read", "مشاهده انبار", "inventory"),
    ("inventory.write", "مدیریت انبار", "inventory"),
    ("finance.read", "مشاهده امور مالی", "finance"),
    ("finance.write", "ثبت تراکنش مالی", "finance"),
    ("crm.read", "مشاهده مشتریان", "crm"),
    ("crm.write", "مدیریت مشتریان و باشگاه مشتریان", "crm"),
    ("shifts.read", "مشاهده شیفت‌ها", "shifts"),
    ("shifts.write", "مدیریت شیفت‌ها", "shifts"),
    ("messages.read", "مشاهده مرکز پیام", "messages"),
    ("messages.write", "ارسال پیام و مدیریت قالب‌ها", "messages"),
];

const ROLES: &[(&str, &str, &str)] = &[
    (
        "super_admin",
        "مدیر ارشد",
        "دسترسی کامل به تمام بخش‌های سیستم",
    ),
    (
        "manager",
        "مدیر رستوران",
        "مدیریت عملیات، کارکنان و گزارش‌ها",
    ),
    (
        "cashier",
        "صندوق‌دار",
        "تسویه سفارش‌ها، ثبت پرداخت و صدور رسید",
    ),
    (
        "waiter",
        "گارسون",
        "مدیریت میزهای تحت مسئولیت و ثبت سفارش مشتری",
    ),
    (
        "barista",
        "باریستا",
        "آماده‌سازی نوشیدنی‌ها و مدیریت صف باریستا",
    ),
    (
        "kitchen",
        "آشپزخانه",
        "آماده‌سازی غذاها و مدیریت صف آشپزخانه",
    ),
    (
        "inventory_manager",
        "مسئول انبار",
        "مدیریت مواد اولیه، موجودی و خرید",
    ),
    (
        "accountant",
        "حسابدار",
        "مشاهده و ثبت اطلاعات مالی و گزارش‌های فروش",
    ),
];

const DEMO_STAFF: &[(&str, &str, &str, &str)] = &[
    ("manager", "مدیر رستوران", "مدیر رستوران", "manager"),
    ("cashier", "صندوق‌دار", "صندوق‌دار", "cashier"),
    ("waiter", "گارسون", "گارسون", "waiter"),
    ("barista", "باریستا", "باریستا", "barista"),
    ("kitchen", "آشپزخانه", "آشپزخانه", "kitchen"),
];

pub async fn is_seeded(database: &Database) -> Result<bool> {
    let row = sqlx::query("SELECT COUNT(*) AS n FROM users")
        .fetch_one(&database.pool)
        .await?;
    Ok(row.get::<i64, _>("n") > 0)
}

/// Idempotent bootstrap: roles, permissions, one administrator, module
/// defaults and the singleton settings row. The catalog/layout demo dataset is
/// intentionally a separate migration because it is much larger.
pub async fn seed_database(database: &Database, options: &SeedOptions) -> Result<bool> {
    if is_seeded(database).await? {
        return Ok(false);
    }

    let admin_hash = hash_password(&options.admin_password)
        .map_err(anyhow::Error::msg)
        .context("hash گذرواژه مدیر")?;
    let now = now_iso();
    let mut tx = database.pool.begin().await?;

    let mut role_ids: HashMap<String, String> = HashMap::new();
    for (key, name_fa, description_fa) in ROLES {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO roles (id, key, name_fa, description_fa, is_system, created_at)
             VALUES ($1, $2, $3, $4, 1, $5)
             ON CONFLICT (key) DO NOTHING",
        )
        .bind(&id)
        .bind(*key)
        .bind(*name_fa)
        .bind(*description_fa)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        role_ids.insert((*key).to_string(), id);
    }
    // Re-read in case a previous partial seed created rows with different ids.
    let role_rows = sqlx::query("SELECT id, key FROM roles")
        .fetch_all(&mut *tx)
        .await?;
    for row in role_rows {
        role_ids.insert(row.get("key"), row.get("id"));
    }

    let mut permission_ids: HashMap<String, String> = HashMap::new();
    for (key, name_fa, group) in PERMISSIONS {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO permissions (id, key, name_fa, group_key, created_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (key) DO NOTHING",
        )
        .bind(&id)
        .bind(*key)
        .bind(*name_fa)
        .bind(*group)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        permission_ids.insert((*key).to_string(), id);
    }
    let permission_rows = sqlx::query("SELECT id, key FROM permissions")
        .fetch_all(&mut *tx)
        .await?;
    for row in permission_rows {
        permission_ids.insert(row.get("key"), row.get("id"));
    }

    let admin_role = role_ids
        .get("super_admin")
        .ok_or_else(|| anyhow::anyhow!("نقش super_admin ساخته نشد"))?;
    for permission_id in permission_ids.values() {
        sqlx::query(
            "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING",
        )
        .bind(admin_role)
        .bind(permission_id)
        .execute(&mut *tx)
        .await?;
    }
    // The manager gets the same operational basket for the first release; the
    // granular role map is ported with the RBAC parity wave.
    if let Some(manager_role) = role_ids.get("manager") {
        for permission_id in permission_ids.values() {
            sqlx::query(
                "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING",
            )
            .bind(manager_role)
            .bind(permission_id)
            .execute(&mut *tx)
            .await?;
        }
    }
    grant_role_subset(
        &mut tx,
        &role_ids,
        &permission_ids,
        "cashier",
        &[
            "dashboard.read",
            "orders.read",
            "payments.read",
            "payments.create",
            "payments.refund",
            "layout.read",
            "catalog.read",
            "discounts.read",
            "orders.discount",
            "reports.read",
        ],
    )
    .await?;
    grant_role_subset(
        &mut tx,
        &role_ids,
        &permission_ids,
        "waiter",
        &[
            "dashboard.read",
            "layout.read",
            "layout.write",
            "catalog.read",
            "orders.read",
            "orders.write",
            "prep.read",
            "reservations.read",
            "reservations.write",
        ],
    )
    .await?;
    grant_role_subset(
        &mut tx,
        &role_ids,
        &permission_ids,
        "barista",
        &[
            "dashboard.read",
            "prep.read",
            "prep.update",
            "orders.read",
            "catalog.read",
        ],
    )
    .await?;
    grant_role_subset(
        &mut tx,
        &role_ids,
        &permission_ids,
        "kitchen",
        &[
            "dashboard.read",
            "prep.read",
            "prep.update",
            "orders.read",
            "catalog.read",
        ],
    )
    .await?;

    let admin_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO users (id, username, full_name, password_hash, is_active, must_change_password, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, 0, $5, $5)
         ON CONFLICT DO NOTHING",
    )
    .bind(&admin_id)
    .bind(options.admin_username.trim().to_lowercase())
    .bind("مدیر سیستم")
    .bind(&admin_hash)
    .bind(&now)
    .execute(&mut *tx)
    .await?;
    let admin_row = sqlx::query("SELECT id FROM users WHERE username = $1")
        .bind(options.admin_username.trim().to_lowercase())
        .fetch_one(&mut *tx)
        .await?;
    let admin_id: String = admin_row.get("id");
    sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(&admin_id)
        .bind(admin_role)
        .execute(&mut *tx)
        .await?;

    if options.demo_staff {
        let demo_hash = hash_password("CafeFlow@1404").map_err(anyhow::Error::msg)?;
        for (username, full_name, _position, role) in DEMO_STAFF {
            let id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO users (id, username, full_name, password_hash, is_active, must_change_password, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, 1, 0, $5, $5)
                 ON CONFLICT DO NOTHING",
            )
            .bind(&id)
            .bind(*username)
            .bind(*full_name)
            .bind(&demo_hash)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
            if let Some(role_id) = role_ids.get(*role) {
                let user_row = sqlx::query("SELECT id FROM users WHERE username = $1")
                    .bind(*username)
                    .fetch_one(&mut *tx)
                    .await?;
                let user_id: String = user_row.get("id");
                sqlx::query(
                    "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                )
                .bind(user_id)
                .bind(role_id)
                .execute(&mut *tx)
                .await?;
            }
        }
    }

    sqlx::query(
        "INSERT INTO settings (id, restaurant_name_fa, updated_at)
         VALUES ('singleton', 'کافه‌فلو', $1)
         ON CONFLICT DO NOTHING",
    )
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    for definition in MODULE_DEFINITIONS {
        sqlx::query(
            "INSERT INTO module_settings (key, is_enabled, updated_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (key) DO NOTHING",
        )
        .bind(definition.key.as_str())
        .bind(if definition.default_enabled { 1 } else { 0 })
        .bind(&now)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    if options.demo_menu {
        tracing::warn!("demo menu seed در موج کاتالوگ منتقل می‌شود؛ فعلاً فقط هسته ساخته شد.");
    }
    Ok(true)
}

async fn grant_role_subset(
    tx: &mut Transaction<'_, Any>,
    role_ids: &HashMap<String, String>,
    permission_ids: &HashMap<String, String>,
    role: &str,
    permissions: &[&str],
) -> Result<()> {
    let Some(role_id) = role_ids.get(role) else {
        return Ok(());
    };
    for key in permissions {
        let Some(permission_id) = permission_ids.get(*key) else {
            continue;
        };
        sqlx::query(
            "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING",
        )
        .bind(role_id)
        .bind(permission_id)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

#[allow(dead_code)]
fn _assert_module_key(key: ModuleKey) -> &'static str {
    key.as_str()
}
