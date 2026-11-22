//! Administration surfaces: settings, modules, staff, audit, approvals,
//! in-app notifications and the outbound message queue.

use std::collections::HashMap;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, header};
use cafeflow_db::{AuditEntry, AuthSession, now_iso_after_minutes};
use cafeflow_domain::{ModuleKey, module_status};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::{require_auth, session_has_permission};
use crate::error::{AppError, bad_request, conflict, forbidden, not_found, validation_failed};
use crate::state::AppState;

pub(crate) fn db_error(error: impl std::fmt::Display) -> AppError {
    tracing::error!("database error: {error}");
    AppError::internal("خطای پایگاه داده رخ داد.")
}

pub(crate) fn parse_body<T: for<'de> Deserialize<'de>>(body: &Bytes) -> Result<T, AppError> {
    serde_json::from_slice(body).map_err(|_| validation_failed("داده‌های درخواست معتبر نیست."))
}

pub(crate) async fn guard(
    state: &AppState,
    headers: &HeaderMap,
    permission: &str,
) -> Result<AuthSession, AppError> {
    let session = require_auth(state, headers).await?;
    if !session_has_permission(state, &session.user.id, permission).await? {
        return Err(forbidden(
            "برای انجام این عملیات مجوز لازم را ندارید.",
            "FORBIDDEN",
        ));
    }
    Ok(session)
}

pub(crate) fn client_ip(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned)
        })
}

pub(crate) fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.chars().take(500).collect())
}

pub(crate) async fn record(state: &AppState, entry: AuditEntry) {
    if let Err(error) = state.db.record_audit(&entry).await {
        tracing::warn!("ثبت audit ناموفق بود: {error}");
    }
}

pub(crate) async fn module_enabled(state: &AppState, key: ModuleKey) -> Result<bool, AppError> {
    let row = sqlx::query("SELECT is_enabled FROM module_settings WHERE key = $1")
        .bind(key.as_str())
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    Ok(match row {
        Some(row) => row.get::<i64, _>("is_enabled") == 1,
        None => key.definition().default_enabled,
    })
}

pub(crate) async fn require_module(state: &AppState, key: ModuleKey) -> Result<(), AppError> {
    if module_enabled(state, key).await? {
        Ok(())
    } else {
        Err(forbidden(
            "این ماژول در تنظیمات غیرفعال شده است.",
            "MODULE_DISABLED",
        ))
    }
}

/* -------------------------------- settings -------------------------------- */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    restaurant_name_fa: String,
    logo_url: String,
    address_fa: String,
    phone: String,
    email: String,
    latitude: Option<f64>,
    longitude: Option<f64>,
    currency: String,
    digit_mode: String,
    timezone: String,
    locale: String,
    service_charge_percent: i64,
    tax_percent: i64,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct UpdateSettingsInput {
    restaurant_name_fa: Option<String>,
    digit_mode: Option<String>,
    service_charge_percent: Option<i64>,
    tax_percent: Option<i64>,
    timezone: Option<String>,
    logo_url: Option<String>,
    address_fa: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    latitude: Option<Option<f64>>,
    longitude: Option<Option<f64>>,
}

#[derive(Debug, Clone)]
enum SettingValue {
    Text(String),
    Int(i64),
    Real(f64),
    Null,
}

async fn settings_row(state: &AppState) -> Result<SettingsDto, AppError> {
    let row = sqlx::query(
        "SELECT restaurant_name_fa, logo_url, address_fa, phone, email, latitude, longitude,
                currency, digit_mode, timezone, locale, service_charge_percent, tax_percent
           FROM settings WHERE id = 'singleton'",
    )
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    let Some(row) = row else {
        return Ok(SettingsDto {
            restaurant_name_fa: "کافه‌فلو".into(),
            logo_url: String::new(),
            address_fa: String::new(),
            phone: String::new(),
            email: String::new(),
            latitude: None,
            longitude: None,
            currency: "IRR".into(),
            digit_mode: "fa".into(),
            timezone: "Asia/Tehran".into(),
            locale: "fa-IR".into(),
            service_charge_percent: 0,
            tax_percent: 0,
        });
    };
    Ok(SettingsDto {
        restaurant_name_fa: row.get("restaurant_name_fa"),
        logo_url: row.try_get("logo_url").unwrap_or_default(),
        address_fa: row.try_get("address_fa").unwrap_or_default(),
        phone: row.try_get("phone").unwrap_or_default(),
        email: row.try_get("email").unwrap_or_default(),
        latitude: row.try_get::<Option<f64>, _>("latitude").unwrap_or(None),
        longitude: row.try_get::<Option<f64>, _>("longitude").unwrap_or(None),
        currency: row.get("currency"),
        digit_mode: row.get("digit_mode"),
        timezone: row.get("timezone"),
        locale: row.get("locale"),
        service_charge_percent: row.get("service_charge_percent"),
        tax_percent: row.get("tax_percent"),
    })
}

pub async fn get_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SettingsDto>, AppError> {
    guard(&state, &headers, "settings.read").await?;
    Ok(Json(settings_row(&state).await?))
}

pub async fn update_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<SettingsDto>, AppError> {
    let session = guard(&state, &headers, "settings.write").await?;
    let input: UpdateSettingsInput = parse_body(&body)?;
    let before = settings_row(&state).await?;

    if let Some(mode) = &input.digit_mode
        && mode != "fa"
        && mode != "latin"
    {
        return Err(validation_failed("حالت ارقام باید فارسی یا لاتین باشد."));
    }
    if let Some(percent) = input.service_charge_percent
        && !(0..=30).contains(&percent)
    {
        return Err(validation_failed("درصد حق سرویس باید بین ۰ تا ۳۰ باشد."));
    }
    if let Some(percent) = input.tax_percent
        && !(0..=30).contains(&percent)
    {
        return Err(validation_failed("درصد مالیات باید بین ۰ تا ۳۰ باشد."));
    }
    if let Some(name) = &input.restaurant_name_fa
        && (name.trim().is_empty() || name.chars().count() > 120)
    {
        return Err(validation_failed(
            "نام رستوران باید بین ۱ تا ۱۲۰ نویسه باشد.",
        ));
    }
    if let Some(timezone) = &input.timezone
        && !(3..=64).contains(&timezone.chars().count())
    {
        return Err(validation_failed("منطقه زمانی معتبر نیست."));
    }
    if let Some(logo) = &input.logo_url
        && logo.len() > 300_000
    {
        return Err(validation_failed(
            "حجم لوگو بیش از حد بزرگ است (حداکثر ۲۲۰ کیلوبایت).",
        ));
    }
    if let Some(email) = &input.email
        && !email.is_empty()
        && (!email.contains('@') || email.chars().count() > 120)
    {
        return Err(validation_failed("ایمیل معتبر نیست."));
    }
    if let Some(lat) = input.latitude.flatten()
        && !(-90.0..=90.0).contains(&lat)
    {
        return Err(validation_failed("عرض جغرافیایی باید بین ۹۰- و ۹۰ باشد."));
    }
    if let Some(lng) = input.longitude.flatten()
        && !(-180.0..=180.0).contains(&lng)
    {
        return Err(validation_failed("طول جغرافیایی باید بین ۱۸۰- و ۱۸۰ باشد."));
    }

    let next_lat = input.latitude.unwrap_or(before.latitude);
    let next_lng = input.longitude.unwrap_or(before.longitude);
    if next_lat.is_none() != next_lng.is_none() {
        return Err(bad_request(
            "عرض و طول جغرافیایی باید با هم ثبت یا با هم پاک شوند.",
            "LOCATION_INCOMPLETE",
        ));
    }

    let mut columns: Vec<(String, SettingValue)> = Vec::new();
    let mut push = |column: &str, value: SettingValue| {
        columns.push((column.to_string(), value));
    };
    if let Some(value) = input.restaurant_name_fa {
        push(
            "restaurant_name_fa",
            SettingValue::Text(value.trim().to_string()),
        );
    }
    if let Some(value) = input.digit_mode {
        push("digit_mode", SettingValue::Text(value));
    }
    if let Some(value) = input.service_charge_percent {
        push("service_charge_percent", SettingValue::Int(value));
    }
    if let Some(value) = input.tax_percent {
        push("tax_percent", SettingValue::Int(value));
    }
    if let Some(value) = input.timezone {
        push("timezone", SettingValue::Text(value));
    }
    if let Some(value) = input.logo_url {
        push("logo_url", SettingValue::Text(value));
    }
    if let Some(value) = input.address_fa {
        push("address_fa", SettingValue::Text(value.trim().to_string()));
    }
    if let Some(value) = input.phone {
        push("phone", SettingValue::Text(value.trim().to_string()));
    }
    if let Some(value) = input.email {
        push("email", SettingValue::Text(value.trim().to_string()));
    }
    if let Some(value) = input.latitude {
        push(
            "latitude",
            value.map_or(SettingValue::Null, SettingValue::Real),
        );
    }
    if let Some(value) = input.longitude {
        push(
            "longitude",
            value.map_or(SettingValue::Null, SettingValue::Real),
        );
    }

    if !columns.is_empty() {
        let mut sets = Vec::new();
        for (index, (column, _)) in columns.iter().enumerate() {
            sets.push(format!("{column} = ${}", index + 1));
        }
        sets.push(format!("updated_at = ${}", columns.len() + 1));
        let sql = format!(
            "UPDATE settings SET {} WHERE id = 'singleton'",
            sets.join(", ")
        );
        let mut query = sqlx::query(&sql);
        for (_, value) in &columns {
            query = match value {
                SettingValue::Text(value) => query.bind(value),
                SettingValue::Int(value) => query.bind(*value),
                SettingValue::Real(value) => query.bind(*value),
                SettingValue::Null => query.bind(None::<f64>),
            };
        }
        query
            .bind(now_iso_after_minutes(0))
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }

    let after = settings_row(&state).await?;
    if !columns.is_empty() {
        record(
            &state,
            AuditEntry {
                actor_user_id: Some(session.user.id.clone()),
                actor_username: Some(session.user.username.clone()),
                action: "settings.updated".into(),
                entity_type: "settings".into(),
                entity_id: Some("singleton".into()),
                before_json: serde_json::to_string(&before_json(&before)).ok(),
                after_json: serde_json::to_string(&after_json(&after)).ok(),
                ip: client_ip(&headers),
                user_agent: user_agent(&headers),
                ..Default::default()
            },
        )
        .await;
    }
    Ok(Json(after))
}

fn before_json(value: &SettingsDto) -> Value {
    json!({
        "restaurantNameFa": value.restaurant_name_fa,
        "digitMode": value.digit_mode,
        "serviceChargePercent": value.service_charge_percent,
        "taxPercent": value.tax_percent,
        "timezone": value.timezone,
        "logoUrl": value.logo_url,
        "addressFa": value.address_fa,
        "phone": value.phone,
        "email": value.email,
        "latitude": value.latitude,
        "longitude": value.longitude,
    })
}

fn after_json(value: &SettingsDto) -> Value {
    before_json(value)
}

pub async fn list_modules(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "modules.read").await?;
    let rows = sqlx::query("SELECT key, is_enabled FROM module_settings")
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?;
    let stored: HashMap<String, bool> = rows
        .iter()
        .map(|row| (row.get("key"), row.get::<i64, _>("is_enabled") == 1))
        .collect();
    let items = module_status(|key| {
        stored
            .get(key.as_str())
            .copied()
            .unwrap_or_else(|| key.definition().default_enabled)
    });
    Ok(Json(json!({ "items": items })))
}

#[derive(Debug, Deserialize)]
struct ToggleModuleInput {
    enabled: bool,
}

pub async fn set_module(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(key): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "modules.manage").await?;
    let input: ToggleModuleInput = parse_body(&body)?;
    let Some(module_key) = ModuleKey::parse_key(&key) else {
        return Err(not_found("ماژول درخواستی یافت نشد.", "MODULE_NOT_FOUND"));
    };
    let definition = module_key.definition();
    if !definition.configurable {
        return Err(forbidden(
            format!(
                "ماژول «{}» بخشی از هسته سیستم است و قابل غیرفعال‌سازی نیست.",
                definition.name_fa
            ),
            "MODULE_NOT_CONFIGURABLE",
        ));
    }

    let current = module_enabled(&state, module_key).await?;
    if current == input.enabled {
        return Ok(Json(json!({
            "key": definition.key.as_str(),
            "nameFa": definition.name_fa,
            "descriptionFa": definition.description_fa,
            "enabled": current,
            "configurable": definition.configurable,
            "phase": definition.phase,
        })));
    }

    if input.enabled {
        let mut disabled = Vec::new();
        for dependency in definition.depends_on {
            if !module_enabled(&state, *dependency).await? {
                disabled.push(dependency.definition().name_fa);
            }
        }
        if !disabled.is_empty() {
            return Err(conflict(
                format!(
                    "برای فعال‌سازی «{}» ابتدا ماژول‌های وابسته را فعال کنید: {}",
                    definition.name_fa,
                    disabled.join("، ")
                ),
                "MODULE_DEPENDENCY_DISABLED",
            ));
        }
    }

    sqlx::query(
        "INSERT INTO module_settings (key, is_enabled, updated_by, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET is_enabled = excluded.is_enabled,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at",
    )
    .bind(definition.key.as_str())
    .bind(i64::from(input.enabled))
    .bind(&session.user.id)
    .bind(now_iso_after_minutes(0))
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;

    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: if input.enabled {
                "module.enabled".into()
            } else {
                "module.disabled".into()
            },
            entity_type: "module".into(),
            entity_id: Some(key),
            before_json: Some(json!({ "enabled": current }).to_string()),
            after_json: Some(json!({ "enabled": input.enabled }).to_string()),
            metadata_json: Some(json!({ "moduleNameFa": definition.name_fa }).to_string()),
            ip: client_ip(&headers),
            user_agent: user_agent(&headers),
        },
    )
    .await;

    Ok(Json(json!({
        "key": definition.key.as_str(),
        "nameFa": definition.name_fa,
        "descriptionFa": definition.description_fa,
        "enabled": input.enabled,
        "configurable": definition.configurable,
        "phase": definition.phase,
    })))
}

/* --------------------------------- users ---------------------------------- */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffMemberDto {
    id: String,
    username: String,
    full_name: String,
    is_active: bool,
    must_change_password: bool,
    last_login_at: Option<String>,
    created_at: String,
    roles: Vec<String>,
    role_names_fa: Vec<String>,
}

async fn member(state: &AppState, id: &str) -> Result<StaffMemberDto, AppError> {
    let row = sqlx::query(
        "SELECT id, username, full_name, is_active, must_change_password, last_login_at, created_at
           FROM users WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    let Some(row) = row else {
        return Err(not_found("کاربر یافت نشد.", "USER_NOT_FOUND"));
    };
    let roles = sqlx::query(
        "SELECT r.key, r.name_fa FROM roles r
           JOIN user_roles ur ON ur.role_id = r.id
          WHERE ur.user_id = $1 ORDER BY r.key",
    )
    .bind(id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(StaffMemberDto {
        id: row.get("id"),
        username: row.get("username"),
        full_name: row.get("full_name"),
        is_active: row.get::<i64, _>("is_active") == 1,
        must_change_password: row.get::<i64, _>("must_change_password") == 1,
        last_login_at: row.get("last_login_at"),
        created_at: row.get("created_at"),
        roles: roles.iter().map(|row| row.get("key")).collect(),
        role_names_fa: roles.iter().map(|row| row.get("name_fa")).collect(),
    })
}

pub async fn list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "users.read").await?;
    let rows = sqlx::query(
        "SELECT id FROM users WHERE deleted_at IS NULL
          ORDER BY is_active DESC, created_at ASC",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let mut items = Vec::new();
    for row in rows {
        items.push(member(&state, &row.get::<String, _>("id")).await?);
    }
    let total = items.len();
    Ok(Json(json!({ "items": items, "total": total })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateStaffInput {
    username: String,
    full_name: String,
    password: String,
    role_keys: Vec<String>,
}

async fn role_rows(state: &AppState, keys: &[String]) -> Result<Vec<(String, String)>, AppError> {
    let mut unique: Vec<String> = Vec::new();
    for key in keys {
        if !unique.contains(key) {
            unique.push(key.clone());
        }
    }
    let mut found = Vec::new();
    for key in &unique {
        let row = sqlx::query("SELECT id, key FROM roles WHERE key = $1")
            .bind(key)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?;
        match row {
            Some(row) => found.push((row.get("id"), row.get("key"))),
            None => {
                return Err(bad_request(format!("نقش نامعتبر: {key}"), "ROLE_NOT_FOUND")
                    .with_details(json!({ "missing": [key] })));
            }
        }
    }
    if found.is_empty() {
        return Err(validation_failed("حداقل یک نقش لازم است."));
    }
    if found.len() > 8 {
        return Err(validation_failed("تعداد نقش‌ها بیش از حد مجاز است."));
    }
    Ok(found)
}

pub async fn create_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<StaffMemberDto>, AppError> {
    let session = guard(&state, &headers, "users.write").await?;
    let input: CreateStaffInput = parse_body(&body)?;
    let username = input.username.trim().to_lowercase();
    if !(3..=32).contains(&username.chars().count())
        || !username
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err(validation_failed(
            "نام کاربری باید ۳ تا ۳۲ نویسه و فقط شامل حروف انگلیسی، رقم، نقطه، خط تیره و زیرخط باشد.",
        ));
    }
    if !(2..=80).contains(&input.full_name.trim().chars().count()) {
        return Err(validation_failed("نام و نام خانوادگی الزامی است."));
    }
    if !(8..=128).contains(&input.password.chars().count()) {
        return Err(validation_failed("گذرواژه باید حداقل ۸ نویسه باشد."));
    }
    let existing = sqlx::query("SELECT id FROM users WHERE lower(username) = lower($1)")
        .bind(&username)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    if existing.is_some() {
        return Err(bad_request(
            "این نام کاربری قبلاً ثبت شده است.",
            "USERNAME_TAKEN",
        ));
    }
    let roles = role_rows(&state, &input.role_keys).await?;
    let hash = cafeflow_db::hash_password(&input.password)
        .map_err(|_| AppError::internal("رمزنگاری گذرواژه ناموفق بود."))?;
    let id = Uuid::new_v4().to_string();
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "INSERT INTO users (id, username, full_name, password_hash, is_active, must_change_password)
         VALUES ($1, $2, $3, $4, 1, 1)",
    )
    .bind(&id)
    .bind(&username)
    .bind(input.full_name.trim())
    .bind(&hash)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    for (role_id, _) in &roles {
        sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)")
            .bind(&id)
            .bind(role_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;

    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "staff.created".into(),
            entity_type: "user".into(),
            entity_id: Some(id.clone()),
            after_json: Some(
                json!({
                    "username": username,
                    "fullName": input.full_name.trim(),
                    "roleKeys": roles.iter().map(|(_, key)| key).collect::<Vec<_>>(),
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(member(&state, &id).await?))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct UpdateStaffInput {
    full_name: Option<String>,
    is_active: Option<bool>,
    role_keys: Option<Vec<String>>,
    new_password: Option<String>,
    reset_mfa: Option<bool>,
}

pub async fn update_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<StaffMemberDto>, AppError> {
    let session = guard(&state, &headers, "users.write").await?;
    let input: UpdateStaffInput = parse_body(&body)?;
    if input.full_name.is_none()
        && input.is_active.is_none()
        && input.role_keys.is_none()
        && input.new_password.is_none()
        && input.reset_mfa != Some(true)
    {
        return Err(validation_failed("حداقل یک تغییر لازم است."));
    }
    let before = member(&state, &id).await?;
    if id == session.user.id && input.is_active == Some(false) {
        return Err(bad_request(
            "نمی‌توانید حساب کاربری خودتان را غیرفعال کنید.",
            "CANNOT_DISABLE_SELF",
        ));
    }
    if let Some(name) = &input.full_name
        && !(2..=80).contains(&name.trim().chars().count())
    {
        return Err(validation_failed("نام و نام خانوادگی الزامی است."));
    }
    if let Some(password) = &input.new_password
        && !(8..=128).contains(&password.chars().count())
    {
        return Err(validation_failed("گذرواژه باید حداقل ۸ نویسه باشد."));
    }
    let roles = match &input.role_keys {
        Some(keys) => Some(role_rows(&state, keys).await?),
        None => None,
    };
    let hash = match &input.new_password {
        Some(password) => Some(
            cafeflow_db::hash_password(password)
                .map_err(|_| AppError::internal("رمزنگاری گذرواژه ناموفق بود."))?,
        ),
        None => None,
    };

    let now = now_iso_after_minutes(0);
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    if let Some(name) = &input.full_name {
        sqlx::query("UPDATE users SET full_name = $1 WHERE id = $2")
            .bind(name.trim())
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }
    if let Some(active) = input.is_active {
        sqlx::query("UPDATE users SET is_active = $1 WHERE id = $2")
            .bind(i64::from(active))
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        if !active {
            sqlx::query(
                "UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL",
            )
            .bind(&now)
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
    }
    if let Some(roles) = &roles {
        sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        for (role_id, _) in roles {
            sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)")
                .bind(&id)
                .bind(role_id)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
        }
    }
    if input.reset_mfa == Some(true) {
        sqlx::query(
            "UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_confirmed_at = NULL,
                    updated_at = $1 WHERE id = $2",
        )
        .bind(&now)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query("DELETE FROM mfa_recovery_codes WHERE user_id = $1")
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }
    if let Some(hash) = &hash {
        sqlx::query(
            "UPDATE users SET password_hash = $1, must_change_password = 1,
                    failed_login_attempts = 0, locked_until = NULL WHERE id = $2",
        )
        .bind(hash)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query(
            "UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL",
        )
        .bind(&now)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;

    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "staff.updated".into(),
            entity_type: "user".into(),
            entity_id: Some(id.clone()),
            before_json: Some(
                json!({
                    "fullName": before.full_name,
                    "isActive": before.is_active,
                    "roles": before.roles,
                })
                .to_string(),
            ),
            after_json: Some(
                json!({
                    "fullName": input.full_name.as_deref().unwrap_or(&before.full_name),
                    "isActive": input.is_active.unwrap_or(before.is_active),
                    "roles": roles.as_ref().map(|rows| rows.iter().map(|(_, k)| k.clone()).collect::<Vec<_>>()).unwrap_or(before.roles.clone()),
                    "passwordReset": hash.is_some(),
                    "mfaReset": input.reset_mfa == Some(true),
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(member(&state, &id).await?))
}

pub async fn list_roles(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "roles.read").await?;
    let rows = sqlx::query(
        "SELECT r.id, r.key, r.name_fa, r.description_fa, r.is_system,
                (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
                (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
           FROM roles r ORDER BY r.is_system DESC, r.key ASC",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "key": row.get::<String, _>("key"),
                "nameFa": row.get::<String, _>("name_fa"),
                "descriptionFa": row.get::<Option<String>, _>("description_fa"),
                "isSystem": row.get::<i64, _>("is_system") == 1,
                "permissionCount": row.get::<i64, _>("permission_count"),
                "userCount": row.get::<i64, _>("user_count"),
            })
        })
        .collect();
    Ok(Json(json!({ "items": items })))
}

fn permission_group_label(group: &str) -> &str {
    match group {
        "dashboard" => "داشبورد",
        "catalog" => "منو و محصولات",
        "layout" => "میزها و سالن",
        "orders" => "سفارش‌ها",
        "prep" => "آماده‌سازی",
        "payments" => "پرداخت‌ها",
        "reservations" => "رزروها",
        "discounts" => "تخفیف و QR",
        "users" => "کارکنان و نقش‌ها",
        "system" => "سیستم",
        "security" => "امنیت",
        "reports" => "گزارش‌ها",
        "inventory" => "انبار",
        "finance" => "مالی",
        "crm" => "باشگاه مشتریان",
        "shifts" => "شیفت‌ها",
        "messages" => "مرکز پیام",
        other => other,
    }
}

pub async fn list_permissions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "roles.read").await?;
    let rows =
        sqlx::query("SELECT key, name_fa, group_key FROM permissions ORDER BY group_key, key")
            .fetch_all(&state.db.pool)
            .await
            .map_err(db_error)?;
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            let group: String = row.get("group_key");
            json!({
                "key": row.get::<String, _>("key"),
                "nameFa": row.get::<String, _>("name_fa"),
                "group": group,
                "groupLabelFa": permission_group_label(&group),
            })
        })
        .collect();
    Ok(Json(json!({ "items": items })))
}

/* --------------------------------- audit ---------------------------------- */

pub async fn list_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "audit.read").await?;
    let page = query
        .get("page")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(1);
    let page_size = query
        .get("pageSize")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(20);
    if page < 1 {
        return Err(validation_failed("شماره صفحه باید حداقل ۱ باشد."));
    }
    if !(1..=100).contains(&page_size) {
        return Err(validation_failed(
            "تعداد سطر هر صفحه باید بین ۱ تا ۱۰۰ باشد.",
        ));
    }
    let mut clauses = Vec::new();
    let mut values: Vec<String> = Vec::new();
    if let Some(action) = query.get("action").filter(|value| !value.is_empty()) {
        values.push(format!("{action}%"));
        clauses.push(format!("action LIKE ${}", values.len()));
    }
    if let Some(actor) = query.get("actor").filter(|value| !value.is_empty()) {
        values.push(format!("%{actor}%"));
        clauses.push(format!("actor_username LIKE ${}", values.len()));
    }
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    let count_sql = format!("SELECT COUNT(*) AS n FROM audit_logs {where_sql}");
    let mut count_query = sqlx::query(&count_sql);
    for value in &values {
        count_query = count_query.bind(value);
    }
    let total: i64 = count_query
        .fetch_one(&state.db.pool)
        .await
        .map_err(db_error)?
        .get("n");
    let sql = format!(
        "SELECT * FROM audit_logs {where_sql} ORDER BY created_at DESC LIMIT ${} OFFSET ${}",
        values.len() + 1,
        values.len() + 2
    );
    let mut list_query = sqlx::query(&sql);
    for value in &values {
        list_query = list_query.bind(value);
    }
    let rows = list_query
        .bind(page_size)
        .bind((page - 1) * page_size)
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?;
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "action": row.get::<String, _>("action"),
                "actorUsername": row.get::<Option<String>, _>("actor_username"),
                "entityType": row.get::<String, _>("entity_type"),
                "entityId": row.get::<Option<String>, _>("entity_id"),
                "before": row.get::<Option<String>, _>("before_json").and_then(|v| serde_json::from_str::<Value>(&v).ok()),
                "after": row.get::<Option<String>, _>("after_json").and_then(|v| serde_json::from_str::<Value>(&v).ok()),
                "metadata": row.get::<Option<String>, _>("metadata_json").and_then(|v| serde_json::from_str::<Value>(&v).ok()),
                "ip": row.get::<Option<String>, _>("ip"),
                "createdAt": row.get::<String, _>("created_at"),
            })
        })
        .collect();
    let total_pages = (total + page_size - 1) / page_size;
    Ok(Json(json!({
        "items": items,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": total_pages,
    })))
}

/* -------------------------------- approvals -------------------------------- */

pub async fn list_approvals(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "approvals.read").await?;
    let status = query.get("status").filter(|value| {
        matches!(
            value.as_str(),
            "pending" | "approved" | "rejected" | "cancelled"
        )
    });
    let sql = if status.is_some() {
        "SELECT a.*, requester.full_name AS requester_name, decider.full_name AS decider_name
           FROM approval_requests a
           LEFT JOIN users requester ON requester.id = a.requested_by
           LEFT JOIN users decider ON decider.id = a.decided_by
          WHERE a.status = $1
          ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created_at DESC
          LIMIT 100"
    } else {
        "SELECT a.*, requester.full_name AS requester_name, decider.full_name AS decider_name
           FROM approval_requests a
           LEFT JOIN users requester ON requester.id = a.requested_by
           LEFT JOIN users decider ON decider.id = a.decided_by
          ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created_at DESC
          LIMIT 100"
    };
    let mut statement = sqlx::query(sql);
    if let Some(status) = status {
        statement = statement.bind(status);
    }
    let rows = statement
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?;
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "type": row.get::<String, _>("type"),
                "titleFa": row.get::<String, _>("title_fa"),
                "payload": row.get::<Option<String>, _>("payload_json").and_then(|v| serde_json::from_str::<Value>(&v).ok()),
                "status": row.get::<String, _>("status"),
                "requesterName": row.get::<Option<String>, _>("requester_name"),
                "deciderName": row.get::<Option<String>, _>("decider_name"),
                "decisionNote": row.get::<Option<String>, _>("decision_note"),
                "createdAt": row.get::<String, _>("created_at"),
                "decidedAt": row.get::<Option<String>, _>("decided_at"),
            })
        })
        .collect();
    Ok(Json(json!({ "items": items })))
}

#[derive(Debug, Deserialize)]
struct ApprovalDecisionInput {
    decision: String,
    note: Option<String>,
}

pub async fn decide_approval(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "approvals.decide").await?;
    let input: ApprovalDecisionInput = parse_body(&body)?;
    if !matches!(input.decision.as_str(), "approved" | "rejected") {
        return Err(validation_failed("تصمیم باید تأیید یا رد باشد."));
    }
    let note = input
        .note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if note.is_some_and(|value| value.chars().count() > 500) {
        return Err(validation_failed("توضیح بیش از حد طولانی است."));
    }
    if input.decision == "rejected" && note.is_none() {
        return Err(bad_request(
            "برای رد درخواست، ثبت دلیل الزامی است.",
            "REJECTION_NOTE_REQUIRED",
        ));
    }
    let row = sqlx::query("SELECT id, status, title_fa FROM approval_requests WHERE id = $1")
        .bind(&id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    let Some(row) = row else {
        return Err(not_found("درخواست تأیید یافت نشد.", "APPROVAL_NOT_FOUND"));
    };
    if row.get::<String, _>("status") != "pending" {
        return Err(conflict(
            "این درخواست قبلاً بررسی شده است.",
            "APPROVAL_ALREADY_DECIDED",
        ));
    }
    let title: String = row.get("title_fa");
    sqlx::query(
        "UPDATE approval_requests SET status = $1, decided_by = $2, decision_note = $3,
                decided_at = $4 WHERE id = $5 AND status = 'pending'",
    )
    .bind(&input.decision)
    .bind(&session.user.id)
    .bind(note)
    .bind(now_iso_after_minutes(0))
    .bind(&id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: format!("approval.{}", input.decision),
            entity_type: "approval_request".into(),
            entity_id: Some(id.clone()),
            before_json: Some(json!({ "status": "pending" }).to_string()),
            after_json: Some(json!({ "status": &input.decision }).to_string()),
            metadata_json: Some(json!({ "note": note, "titleFa": title }).to_string()),
            ip: client_ip(&headers),
            user_agent: user_agent(&headers),
        },
    )
    .await;
    Ok(Json(json!({ "id": id, "status": input.decision })))
}

/* ------------------------------- notifications ----------------------------- */

async fn audience(
    state: &AppState,
    session: &AuthSession,
) -> Result<(String, Vec<String>), AppError> {
    audience_from(state, session, 1).await
}

async fn audience_from(
    state: &AppState,
    session: &AuthSession,
    start: usize,
) -> Result<(String, Vec<String>), AppError> {
    let roles = state
        .db
        .roles_for_user(&session.user.id)
        .await
        .map_err(db_error)?;
    let mut clauses = vec![format!("n.user_id = ${start}")];
    for index in 0..roles.len() {
        clauses.push(format!("n.role_key = ${}", start + 1 + index));
    }
    Ok((format!("({})", clauses.join(" OR ")), roles))
}

async fn unread_count(state: &AppState, session: &AuthSession) -> Result<i64, AppError> {
    let (scope, roles) = audience(state, session).await?;
    let sql = format!(
        "SELECT COUNT(*) AS n FROM notifications n
           LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $1
          WHERE {scope} AND n.is_read = 0 AND r.notification_id IS NULL"
    );
    let mut query = sqlx::query(&sql).bind(&session.user.id);
    for role in &roles {
        query = query.bind(role);
    }
    Ok(query
        .fetch_one(&state.db.pool)
        .await
        .map_err(db_error)?
        .get("n"))
}

pub async fn list_notifications(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    let unread_only = matches!(query.get("unread").map(String::as_str), Some("1" | "true"));
    let (scope, roles) = audience(&state, &session).await?;
    let sql = format!(
        "SELECT n.id, n.type, n.title_fa, n.body_fa, n.role_key,
                CASE WHEN n.is_read = 1 OR r.notification_id IS NOT NULL THEN 1 ELSE 0 END AS is_read,
                n.created_at
           FROM notifications n
           LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $1
          WHERE {scope}{} ORDER BY n.created_at DESC LIMIT 50",
        if unread_only {
            " AND n.is_read = 0 AND r.notification_id IS NULL"
        } else {
            ""
        }
    );
    let mut statement = sqlx::query(&sql).bind(&session.user.id);
    for role in &roles {
        statement = statement.bind(role);
    }
    let rows = statement
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?;
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "type": row.get::<String, _>("type"),
                "titleFa": row.get::<String, _>("title_fa"),
                "bodyFa": row.get::<Option<String>, _>("body_fa"),
                "roleKey": row.get::<Option<String>, _>("role_key"),
                "isRead": row.get::<i64, _>("is_read") == 1,
                "createdAt": row.get::<String, _>("created_at"),
            })
        })
        .collect();
    let unread = unread_count(&state, &session).await?;
    Ok(Json(json!({ "items": items, "unreadCount": unread })))
}

pub async fn read_notification(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    let (scope, roles) = audience(&state, &session).await?;
    let sql = format!("SELECT n.user_id FROM notifications n WHERE n.id = $1 AND {scope}");
    let mut query = sqlx::query(&sql).bind(&id);
    for role in &roles {
        query = query.bind(role);
    }
    let row = query
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    let Some(row) = row else {
        return Err(not_found(
            "اعلان یافت نشد یا به شما تعلق ندارد.",
            "NOTIFICATION_NOT_FOUND",
        ));
    };
    sqlx::query(
        "INSERT INTO notification_reads (notification_id, user_id) VALUES ($1, $2)
         ON CONFLICT (notification_id, user_id) DO NOTHING",
    )
    .bind(&id)
    .bind(&session.user.id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    if row.get::<Option<String>, _>("user_id").is_some() {
        sqlx::query("UPDATE notifications SET is_read = 1 WHERE id = $1")
            .bind(&id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    let unread = unread_count(&state, &session).await?;
    Ok(Json(
        json!({ "id": id, "isRead": true, "unreadCount": unread }),
    ))
}

pub async fn read_all_notifications(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    let (scope, roles) = audience_from(&state, &session, 3).await?;
    let before = unread_count(&state, &session).await?;
    if before > 0 {
        let sql = format!(
            "INSERT INTO notification_reads (notification_id, user_id)
             SELECT n.id, $1 FROM notifications n
               LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $2
              WHERE {scope} AND n.is_read = 0 AND r.notification_id IS NULL
             ON CONFLICT (notification_id, user_id) DO NOTHING"
        );
        let mut query = sqlx::query(&sql)
            .bind(&session.user.id)
            .bind(&session.user.id);
        for role in &roles {
            query = query.bind(role);
        }
        query.execute(&state.db.pool).await.map_err(db_error)?;
        sqlx::query("UPDATE notifications SET is_read = 1 WHERE user_id = $1 AND is_read = 0")
            .bind(&session.user.id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    Ok(Json(json!({ "updated": before, "unreadCount": 0 })))
}

/* --------------------------------- messages -------------------------------- */

fn channel_label(channel: &str) -> &str {
    match channel {
        "sms" => "پیامک",
        "push" => "اعلان مرورگر",
        "inapp" => "درون‌برنامه",
        other => other,
    }
}

fn status_label(status: &str) -> &str {
    match status {
        "queued" => "در صف",
        "sending" => "در حال ارسال",
        "sent" => "ارسال‌شده",
        "failed" => "ناموفق",
        "skipped" => "رد شده",
        other => other,
    }
}

fn render_template(body: &str, variables: &HashMap<String, String>) -> String {
    let mut result = String::new();
    let mut rest = body;
    while let Some(start) = rest.find("{{") {
        result.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            result.push_str(&rest[start..]);
            return result;
        };
        let key = after[..end].trim();
        if let Some(value) = variables.get(key) {
            result.push_str(value);
        } else {
            result.push_str(&rest[start..start + 2 + end + 2]);
        }
        rest = &after[end + 2..];
    }
    result.push_str(rest);
    result
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDto {
    id: String,
    key: String,
    channel: String,
    channel_label_fa: String,
    title_fa: String,
    body_fa: String,
    is_active: bool,
}

async fn template_dto(state: &AppState, id: &str) -> Result<TemplateDto, AppError> {
    let row = sqlx::query(
        "SELECT id, key, channel, title_fa, body_fa, is_active
           FROM notification_templates WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    let Some(row) = row else {
        return Err(not_found("قالب یافت نشد.", "TEMPLATE_NOT_FOUND"));
    };
    template_from_row(&row)
}

fn template_from_row(row: &sqlx::any::AnyRow) -> Result<TemplateDto, AppError> {
    let channel: String = row.get("channel");
    Ok(TemplateDto {
        id: row.get("id"),
        key: row.get("key"),
        channel_label_fa: channel_label(&channel).to_string(),
        channel,
        title_fa: row.get("title_fa"),
        body_fa: row.get("body_fa"),
        is_active: row.get::<i64, _>("is_active") == 1,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxDto {
    id: String,
    channel: String,
    channel_label_fa: String,
    template_key: Option<String>,
    recipient: Option<String>,
    title_fa: Option<String>,
    body_fa: Option<String>,
    status: String,
    status_label_fa: String,
    attempts: i64,
    last_error: Option<String>,
    scheduled_at: String,
    sent_at: Option<String>,
}

fn outbox_from_row(row: &sqlx::any::AnyRow) -> OutboxDto {
    let channel: String = row.get("channel");
    let status: String = row.get("status");
    let payload: Option<String> = row.get("payload_json");
    let content: Option<Value> = payload.and_then(|value| serde_json::from_str(&value).ok());
    OutboxDto {
        id: row.get("id"),
        channel_label_fa: channel_label(&channel).to_string(),
        channel,
        template_key: row.get("template_key"),
        recipient: row.get("recipient"),
        title_fa: content
            .as_ref()
            .and_then(|value| value.get("titleFa"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        body_fa: content
            .as_ref()
            .and_then(|value| value.get("bodyFa"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        status_label_fa: status_label(&status).to_string(),
        status,
        attempts: row.get("attempts"),
        last_error: row.get("last_error"),
        scheduled_at: row.get("scheduled_at"),
        sent_at: row.get("sent_at"),
    }
}

async fn find_outbox(state: &AppState, id: &str) -> Result<OutboxDto, AppError> {
    let row = sqlx::query(
        "SELECT id, channel, template_key, recipient, payload_json, status, attempts,
                last_error, scheduled_at, created_at, sent_at
           FROM notification_outbox WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    row.map(|row| outbox_from_row(&row))
        .ok_or_else(|| not_found("پیام یافت نشد.", "MESSAGE_NOT_FOUND"))
}

pub async fn messages_overview(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "messages.read").await?;
    require_module(&state, ModuleKey::Notifications).await?;
    let status = query
        .get("status")
        .filter(|value| !value.is_empty())
        .cloned();
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .map(|value| value.clamp(1, 200))
        .unwrap_or(60);
    let sql = if status.is_some() {
        "SELECT id, channel, template_key, recipient, payload_json, status, attempts,
                last_error, scheduled_at, created_at, sent_at
           FROM notification_outbox WHERE status = $1 ORDER BY created_at DESC LIMIT $2"
    } else {
        "SELECT id, channel, template_key, recipient, payload_json, status, attempts,
                last_error, scheduled_at, created_at, sent_at
           FROM notification_outbox ORDER BY created_at DESC LIMIT $1"
    };
    let mut statement = sqlx::query(sql);
    if let Some(status) = &status {
        statement = statement.bind(status);
    }
    let rows = statement
        .bind(limit)
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?;
    let items: Vec<OutboxDto> = rows.iter().map(outbox_from_row).collect();
    let templates_rows = sqlx::query(
        "SELECT id, key, channel, title_fa, body_fa, is_active
           FROM notification_templates ORDER BY key ASC",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let templates: Vec<TemplateDto> = templates_rows
        .iter()
        .map(template_from_row)
        .collect::<Result<_, _>>()?;
    let summary = sqlx::query(
        "SELECT
           COALESCE(SUM(CASE WHEN status IN ('queued', 'sending') THEN 1 ELSE 0 END), 0) AS queued,
           COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
           COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
         FROM notification_outbox",
    )
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(Json(json!({
        "items": items,
        "templates": templates,
        "summary": {
            "queued": summary.get::<i64, _>("queued"),
            "sent": summary.get::<i64, _>("sent"),
            "failed": summary.get::<i64, _>("failed"),
        },
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTemplateInput {
    key: String,
    channel: String,
    title_fa: String,
    body_fa: String,
    #[serde(default)]
    is_active: Option<bool>,
}

pub async fn create_template(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<TemplateDto>, AppError> {
    let session = guard(&state, &headers, "messages.write").await?;
    require_module(&state, ModuleKey::Notifications).await?;
    let input: CreateTemplateInput = parse_body(&body)?;
    let key = input.key.trim().to_string();
    if !(2..=40).contains(&key.len())
        || !key
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
    {
        return Err(validation_failed(
            "کلید قالب فقط می‌تواند شامل حروف کوچک انگلیسی، رقم و زیرخط باشد.",
        ));
    }
    if !matches!(input.channel.as_str(), "sms" | "push" | "inapp") {
        return Err(validation_failed("کانال پیام نامعتبر است."));
    }
    if !(2..=120).contains(&input.title_fa.trim().chars().count()) {
        return Err(validation_failed("عنوان الزامی است."));
    }
    if !(2..=500).contains(&input.body_fa.trim().chars().count()) {
        return Err(validation_failed("متن پیام الزامی است."));
    }
    let existing = sqlx::query("SELECT id FROM notification_templates WHERE key = $1")
        .bind(&key)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    if existing.is_some() {
        return Err(conflict(
            "قالبی با این کلید از قبل وجود دارد.",
            "TEMPLATE_EXISTS",
        ));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO notification_templates (id, key, channel, title_fa, body_fa, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&id)
    .bind(&key)
    .bind(&input.channel)
    .bind(input.title_fa.trim())
    .bind(input.body_fa.trim())
    .bind(i64::from(input.is_active.unwrap_or(true)))
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "message.template_created".into(),
            entity_type: "notification_template".into(),
            entity_id: Some(id.clone()),
            after_json: Some(json!({ "key": key, "channel": input.channel }).to_string()),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(template_dto(&state, &id).await?))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct UpdateTemplateInput {
    title_fa: Option<String>,
    body_fa: Option<String>,
    is_active: Option<bool>,
}

pub async fn update_template(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<TemplateDto>, AppError> {
    let session = guard(&state, &headers, "messages.write").await?;
    require_module(&state, ModuleKey::Notifications).await?;
    let input: UpdateTemplateInput = parse_body(&body)?;
    if input.title_fa.is_none() && input.body_fa.is_none() && input.is_active.is_none() {
        return Err(validation_failed("حداقل یک تغییر لازم است."));
    }
    if let Some(title) = &input.title_fa
        && !(2..=120).contains(&title.trim().chars().count())
    {
        return Err(validation_failed("عنوان الزامی است."));
    }
    if let Some(text) = &input.body_fa
        && !(2..=500).contains(&text.trim().chars().count())
    {
        return Err(validation_failed("متن پیام الزامی است."));
    }
    let before = template_dto(&state, &id).await?;
    if let Some(title) = &input.title_fa {
        sqlx::query("UPDATE notification_templates SET title_fa = $1 WHERE id = $2")
            .bind(title.trim())
            .bind(&id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    if let Some(text) = &input.body_fa {
        sqlx::query("UPDATE notification_templates SET body_fa = $1 WHERE id = $2")
            .bind(text.trim())
            .bind(&id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    if let Some(active) = input.is_active {
        sqlx::query("UPDATE notification_templates SET is_active = $1 WHERE id = $2")
            .bind(i64::from(active))
            .bind(&id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "message.template_updated".into(),
            entity_type: "notification_template".into(),
            entity_id: Some(id.clone()),
            before_json: Some(
                json!({ "titleFa": before.title_fa, "isActive": before.is_active }).to_string(),
            ),
            after_json: Some(
                json!({
                    "titleFa": input.title_fa,
                    "bodyFa": input.body_fa,
                    "isActive": input.is_active,
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(template_dto(&state, &id).await?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageInput {
    channel: String,
    template_key: Option<String>,
    title_fa: Option<String>,
    body_fa: Option<String>,
    recipients: Vec<String>,
    variables: Option<HashMap<String, String>>,
}

pub async fn send_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "messages.write").await?;
    require_module(&state, ModuleKey::Notifications).await?;
    let input: SendMessageInput = parse_body(&body)?;
    if !matches!(input.channel.as_str(), "sms" | "push") {
        return Err(validation_failed("کانال ارسال نامعتبر است."));
    }
    if input.template_key.is_none() && input.body_fa.as_deref().unwrap_or("").trim().is_empty() {
        return Err(validation_failed("متن پیام یا یک قالب انتخاب کنید."));
    }
    let mut title = input.title_fa.unwrap_or_default();
    let mut text = input.body_fa.unwrap_or_default();
    let mut template_key = None;
    if let Some(key) = &input.template_key {
        let row = sqlx::query(
            "SELECT key, channel, title_fa, body_fa, is_active
               FROM notification_templates WHERE key = $1",
        )
        .bind(key)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
        let Some(row) = row else {
            return Err(not_found("قالب پیام یافت نشد.", "TEMPLATE_NOT_FOUND"));
        };
        if row.get::<i64, _>("is_active") != 1 {
            return Err(bad_request("این قالب غیرفعال است.", "TEMPLATE_INACTIVE"));
        }
        if row.get::<String, _>("channel") != input.channel {
            return Err(bad_request(
                "کانال ارسال با کانال قالب هم‌خوان نیست.",
                "TEMPLATE_CHANNEL_MISMATCH",
            ));
        }
        template_key = Some(row.get::<String, _>("key"));
        let variables = input.variables.clone().unwrap_or_default();
        title = render_template(&row.get::<String, _>("title_fa"), &variables);
        text = render_template(&row.get::<String, _>("body_fa"), &variables);
    }
    if title.chars().count() > 120 || text.chars().count() > 500 {
        return Err(validation_failed("متن یا عنوان پیام بیش از حد طولانی است."));
    }
    let mut recipients: Vec<String> = Vec::new();
    for recipient in &input.recipients {
        let value = recipient.trim();
        if !value.is_empty() && !recipients.iter().any(|item| item == value) {
            recipients.push(value.to_string());
        }
    }
    if recipients.is_empty() {
        return Err(bad_request("حداقل یک گیرنده لازم است.", "NO_RECIPIENTS"));
    }
    if recipients.len() > 200 {
        return Err(validation_failed("تعداد گیرندگان بیش از حد مجاز است."));
    }
    let now = now_iso_after_minutes(0);
    let mut ids = Vec::new();
    for recipient in &recipients {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO notification_outbox
               (id, channel, template_key, recipient, payload_json, status, scheduled_at)
             VALUES ($1, $2, $3, $4, $5, 'queued', $6)",
        )
        .bind(&id)
        .bind(&input.channel)
        .bind(&template_key)
        .bind(recipient)
        .bind(json!({ "titleFa": title, "bodyFa": text }).to_string())
        .bind(&now)
        .execute(&state.db.pool)
        .await
        .map_err(db_error)?;
        ids.push(id);
    }
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "message.queued".into(),
            entity_type: "notification_outbox".into(),
            entity_id: ids.first().cloned(),
            after_json: Some(
                json!({
                    "channel": input.channel,
                    "recipients": recipients.len(),
                    "templateKey": template_key,
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    let mut items = Vec::new();
    for id in &ids {
        items.push(find_outbox(&state, id).await?);
    }
    Ok(Json(json!({ "queued": items.len(), "items": items })))
}

pub async fn mark_message_sent(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<OutboxDto>, AppError> {
    let session = guard(&state, &headers, "messages.write").await?;
    require_module(&state, ModuleKey::Notifications).await?;
    let row = find_outbox(&state, &id).await?;
    if row.status == "sent" {
        return Err(conflict(
            "این پیام قبلاً ارسال‌شده ثبت شده است.",
            "MESSAGE_ALREADY_SENT",
        ));
    }
    sqlx::query(
        "UPDATE notification_outbox SET status = 'sent', sent_at = $1,
                attempts = attempts + 1, last_error = NULL WHERE id = $2",
    )
    .bind(now_iso_after_minutes(0))
    .bind(&id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "message.sent".into(),
            entity_type: "notification_outbox".into(),
            entity_id: Some(id.clone()),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(find_outbox(&state, &id).await?))
}

#[derive(Debug, Deserialize)]
struct FailedInput {
    error: String,
}

pub async fn mark_message_failed(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<OutboxDto>, AppError> {
    let session = guard(&state, &headers, "messages.write").await?;
    require_module(&state, ModuleKey::Notifications).await?;
    let input: FailedInput = parse_body(&body)?;
    let error = input.error.trim();
    if !(2..=300).contains(&error.chars().count()) {
        return Err(validation_failed("متن خطا الزامی است."));
    }
    find_outbox(&state, &id).await?;
    sqlx::query(
        "UPDATE notification_outbox SET status = 'failed', attempts = attempts + 1,
                last_error = $1 WHERE id = $2",
    )
    .bind(error)
    .bind(&id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "message.failed".into(),
            entity_type: "notification_outbox".into(),
            entity_id: Some(id.clone()),
            after_json: Some(json!({ "error": error }).to_string()),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(find_outbox(&state, &id).await?))
}
