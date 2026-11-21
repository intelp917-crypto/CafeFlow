//! Public QR menu. Prices and availability are resolved on the server; the
//! browser only receives the menu snapshot it may render.

use std::collections::HashMap;

use axum::Json;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::{IntoResponse, Response};
use cafeflow_db::sha256_hex;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::{AppError, not_found};
use crate::state::AppState;

const DEVICE_COOKIE: &str = "cafe_device";
const DEVICE_COOKIE_MAX_AGE: i64 = 365 * 24 * 60 * 60;

#[derive(Debug, Deserialize)]
pub struct MenuQuery {
    qr: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct SettingsRow {
    pub(crate) name_fa: String,
    pub(crate) currency: String,
    pub(crate) digit_mode: String,
    pub(crate) service_charge_percent: i64,
    pub(crate) tax_percent: i64,
    pub(crate) logo_url: String,
    pub(crate) address_fa: String,
    pub(crate) phone: String,
    pub(crate) latitude: Option<f64>,
    pub(crate) longitude: Option<f64>,
}

#[derive(Debug, Clone)]
pub(crate) struct QrRow {
    pub(crate) kind: String,
    pub(crate) label: Option<String>,
    pub(crate) table_id: Option<String>,
    pub(crate) table_code: Option<String>,
    pub(crate) table_name_fa: Option<String>,
    pub(crate) floor_name_fa: Option<String>,
    pub(crate) is_active: i64,
}

#[derive(Debug, Clone)]
struct CategoryRow {
    id: String,
    name_fa: String,
    slug: String,
}

#[derive(Debug, Clone)]
struct ProductRow {
    id: String,
    category_id: String,
    name_fa: String,
    description_fa: Option<String>,
    base_price: i64,
    image_url: Option<String>,
    prep_minutes: i64,
    is_available: i64,
}

#[derive(Debug, Clone)]
struct OptionGroupRow {
    id: String,
    product_id: String,
    name_fa: String,
    min_select: i64,
    max_select: i64,
    is_required: i64,
}

#[derive(Debug, Clone)]
struct OptionRow {
    id: String,
    option_group_id: String,
    name_fa: String,
    price_delta: i64,
}

#[derive(Debug, Clone)]
struct ExtraRow {
    id: String,
    product_id: String,
    name_fa: String,
    price: i64,
}

#[derive(Debug, Clone)]
struct AvailabilityRow {
    product_id: String,
    weekday: Option<i64>,
    start_time: String,
    end_time: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuOption {
    id: String,
    name_fa: String,
    price_delta: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuOptionGroup {
    id: String,
    name_fa: String,
    min_select: i64,
    max_select: i64,
    is_required: bool,
    options: Vec<MenuOption>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuExtra {
    id: String,
    name_fa: String,
    price: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuProduct {
    id: String,
    category_id: String,
    name_fa: String,
    description_fa: Option<String>,
    price: i64,
    image_url: Option<String>,
    prep_minutes: i64,
    is_available: bool,
    unavailable_reason_fa: Option<String>,
    option_groups: Vec<MenuOptionGroup>,
    extras: Vec<MenuExtra>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuCategory {
    id: String,
    name_fa: String,
    slug: String,
    products: Vec<MenuProduct>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Restaurant {
    name_fa: String,
    currency: String,
    digit_mode: String,
    service_charge_percent: i64,
    tax_percent: i64,
    logo_url: String,
    address_fa: String,
    phone: String,
    latitude: Option<f64>,
    longitude: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct QrSummary {
    kind: String,
    label: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TableSummary {
    id: String,
    name_fa: String,
    code: String,
    floor_name_fa: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuResponse {
    restaurant: Restaurant,
    qr: Option<QrSummary>,
    table: Option<TableSummary>,
    games_enabled: bool,
    categories: Vec<MenuCategory>,
    server_time: String,
}

#[derive(Debug, Clone)]
pub struct Device {
    pub id: String,
    pub token: String,
    pub is_new: bool,
}

pub async fn menu(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MenuQuery>,
) -> Result<Response, AppError> {
    let device = resolve_device(&state, &headers).await?;
    let settings = settings(&state).await?;
    let qr = match query
        .qr
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(token) => Some(find_qr(&state, token).await?),
        None => None,
    };
    if let Some(qr) = &qr {
        if qr.is_active != 1 {
            return Err(not_found(
                "این کد QR معتبر نیست یا غیرفعال شده است.",
                "QR_NOT_FOUND",
            ));
        }
        if qr.kind == "table" && qr.table_id.is_none() {
            return Err(not_found(
                "میز مربوط به این کد QR دیگر فعال نیست.",
                "QR_TABLE_INACTIVE",
            ));
        }
    }

    let categories = build_categories(&state).await?;
    let table = qr.as_ref().and_then(|qr| {
        qr.table_id.as_ref().map(|id| TableSummary {
            id: id.clone(),
            name_fa: qr
                .table_name_fa
                .clone()
                .or_else(|| qr.table_code.clone())
                .unwrap_or_else(|| "میز".to_string()),
            code: qr.table_code.clone().unwrap_or_default(),
            floor_name_fa: qr.floor_name_fa.clone(),
        })
    });
    let games_enabled = module_enabled(&state, "games", true).await?;
    let body = MenuResponse {
        restaurant: Restaurant {
            name_fa: settings.name_fa,
            currency: settings.currency,
            digit_mode: settings.digit_mode,
            service_charge_percent: settings.service_charge_percent,
            tax_percent: settings.tax_percent,
            logo_url: settings.logo_url,
            address_fa: settings.address_fa,
            phone: settings.phone,
            latitude: settings.latitude,
            longitude: settings.longitude,
        },
        qr: qr.map(|qr| QrSummary {
            kind: qr.kind,
            label: qr.label,
        }),
        table,
        games_enabled,
        categories,
        server_time: cafeflow_domain::iso_utc(OffsetDateTime::now_utc()),
    };
    Ok(with_device_cookie(
        Json(body).into_response(),
        &device,
        &state,
    ))
}

pub(crate) async fn settings(state: &AppState) -> Result<SettingsRow, AppError> {
    let row = sqlx::query(
        "SELECT restaurant_name_fa, currency, digit_mode, service_charge_percent, tax_percent,
                logo_url, address_fa, phone, latitude, longitude
           FROM settings WHERE id = 'singleton'",
    )
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(row.map_or_else(
        || SettingsRow {
            name_fa: "کافه‌فلو".to_string(),
            currency: "IRR".to_string(),
            digit_mode: "fa".to_string(),
            service_charge_percent: 0,
            tax_percent: 0,
            logo_url: String::new(),
            address_fa: String::new(),
            phone: String::new(),
            latitude: None,
            longitude: None,
        },
        |row| SettingsRow {
            name_fa: row.get("restaurant_name_fa"),
            currency: row.get("currency"),
            digit_mode: row.get("digit_mode"),
            service_charge_percent: row.get("service_charge_percent"),
            tax_percent: row.get("tax_percent"),
            logo_url: row.get::<Option<String>, _>("logo_url").unwrap_or_default(),
            address_fa: row
                .get::<Option<String>, _>("address_fa")
                .unwrap_or_default(),
            phone: row.get::<Option<String>, _>("phone").unwrap_or_default(),
            latitude: row.get("latitude"),
            longitude: row.get("longitude"),
        },
    ))
}

pub(crate) async fn find_qr(state: &AppState, token: &str) -> Result<QrRow, AppError> {
    let row = sqlx::query(
        "SELECT q.kind, q.label, q.table_id, q.is_active,
                t.code AS table_code, t.name_fa AS table_name_fa, f.name_fa AS floor_name_fa
           FROM qr_codes q
           LEFT JOIN dining_tables t
             ON t.id = q.table_id AND t.deleted_at IS NULL AND t.is_active = 1
           LEFT JOIN floors f ON f.id = t.floor_id
          WHERE q.token = $1",
    )
    .bind(token)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    let Some(row) = row else {
        return Err(not_found(
            "این کد QR معتبر نیست یا غیرفعال شده است.",
            "QR_NOT_FOUND",
        ));
    };
    Ok(QrRow {
        kind: row.get("kind"),
        label: row.get("label"),
        table_id: row.get("table_id"),
        table_code: row.get("table_code"),
        table_name_fa: row.get("table_name_fa"),
        floor_name_fa: row.get("floor_name_fa"),
        is_active: row.get("is_active"),
    })
}

async fn build_categories(state: &AppState) -> Result<Vec<MenuCategory>, AppError> {
    let category_rows = sqlx::query(
        "SELECT id, name_fa, slug FROM categories
          WHERE is_active = 1 AND deleted_at IS NULL
          ORDER BY sort_order ASC, name_fa ASC",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let product_rows = sqlx::query(
        "SELECT p.id, p.category_id, p.name_fa, p.description_fa, p.base_price, p.image_url,
                p.prep_minutes, p.is_available
           FROM products p
           JOIN categories c ON c.id = p.category_id AND c.is_active = 1 AND c.deleted_at IS NULL
          WHERE p.is_active = 1 AND p.is_archived = 0 AND p.deleted_at IS NULL
          ORDER BY c.sort_order ASC, p.sort_order ASC, p.name_fa ASC",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let group_rows = sqlx::query(
        "SELECT id, product_id, name_fa, min_select, max_select, is_required, sort_order
           FROM option_groups ORDER BY sort_order ASC, name_fa ASC",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let option_rows = sqlx::query(
        "SELECT o.id, o.option_group_id, o.name_fa, o.price_delta, o.sort_order
           FROM product_options o
           JOIN option_groups g ON g.id = o.option_group_id
          WHERE o.is_active = 1
          ORDER BY o.sort_order ASC, o.name_fa ASC",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let extra_rows = sqlx::query(
        "SELECT pe.product_id, e.id, e.name_fa, e.price
           FROM product_extras pe
           JOIN extras e ON e.id = pe.extra_id AND e.is_active = 1
          ORDER BY e.name_fa ASC",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let availability_rows = sqlx::query(
        "SELECT product_id, weekday, start_time, end_time FROM availability_windows WHERE is_active = 1",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;

    let categories: Vec<CategoryRow> = category_rows
        .iter()
        .map(|row| CategoryRow {
            id: row.get("id"),
            name_fa: row.get("name_fa"),
            slug: row.get("slug"),
        })
        .collect();
    let products: Vec<ProductRow> = product_rows
        .iter()
        .map(|row| ProductRow {
            id: row.get("id"),
            category_id: row.get("category_id"),
            name_fa: row.get("name_fa"),
            description_fa: row.get("description_fa"),
            base_price: row.get("base_price"),
            image_url: row.get("image_url"),
            prep_minutes: row.get("prep_minutes"),
            is_available: row.get("is_available"),
        })
        .collect();
    let groups: Vec<OptionGroupRow> = group_rows
        .iter()
        .map(|row| OptionGroupRow {
            id: row.get("id"),
            product_id: row.get("product_id"),
            name_fa: row.get("name_fa"),
            min_select: row.get("min_select"),
            max_select: row.get("max_select"),
            is_required: row.get("is_required"),
        })
        .collect();
    let options: Vec<OptionRow> = option_rows
        .iter()
        .map(|row| OptionRow {
            id: row.get("id"),
            option_group_id: row.get("option_group_id"),
            name_fa: row.get("name_fa"),
            price_delta: row.get("price_delta"),
        })
        .collect();
    let extras: Vec<ExtraRow> = extra_rows
        .iter()
        .map(|row| ExtraRow {
            id: row.get("id"),
            product_id: row.get("product_id"),
            name_fa: row.get("name_fa"),
            price: row.get("price"),
        })
        .collect();
    let windows: Vec<AvailabilityRow> = availability_rows
        .iter()
        .map(|row| AvailabilityRow {
            product_id: row.get("product_id"),
            weekday: row.get("weekday"),
            start_time: row.get("start_time"),
            end_time: row.get("end_time"),
        })
        .collect();

    let mut options_by_group: HashMap<&str, Vec<&OptionRow>> = HashMap::new();
    for option in &options {
        options_by_group
            .entry(option.option_group_id.as_str())
            .or_default()
            .push(option);
    }
    let mut groups_by_product: HashMap<&str, Vec<&OptionGroupRow>> = HashMap::new();
    for group in &groups {
        groups_by_product
            .entry(group.product_id.as_str())
            .or_default()
            .push(group);
    }
    let mut extras_by_product: HashMap<&str, Vec<&ExtraRow>> = HashMap::new();
    for extra in &extras {
        extras_by_product
            .entry(extra.product_id.as_str())
            .or_default()
            .push(extra);
    }
    let mut windows_by_product: HashMap<&str, Vec<&AvailabilityRow>> = HashMap::new();
    for window in &windows {
        windows_by_product
            .entry(window.product_id.as_str())
            .or_default()
            .push(window);
    }
    let (weekday, minutes) = tehran_clock();

    let mut by_category: HashMap<&str, Vec<MenuProduct>> = HashMap::new();
    for product in &products {
        let product_windows = windows_by_product
            .get(product.id.as_str())
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let mut available = product.is_available == 1;
        let mut reason = if available {
            None
        } else {
            Some("این محصول موقتاً ناموجود است.".to_string())
        };
        if available && !product_windows.is_empty() {
            let inside = product_windows.iter().any(|window| {
                if window.weekday.is_some_and(|day| day != weekday) {
                    return false;
                }
                minutes >= parse_time(&window.start_time) && minutes < parse_time(&window.end_time)
            });
            if !inside {
                available = false;
                reason = Some("این محصول در این ساعت سرو نمی‌شود.".to_string());
            }
        }
        let option_groups = groups_by_product
            .get(product.id.as_str())
            .map(|groups| {
                groups
                    .iter()
                    .map(|group| MenuOptionGroup {
                        id: group.id.clone(),
                        name_fa: group.name_fa.clone(),
                        min_select: group.min_select,
                        max_select: group.max_select,
                        is_required: group.is_required == 1 || group.min_select > 0,
                        options: options_by_group
                            .get(group.id.as_str())
                            .map(|options| {
                                options
                                    .iter()
                                    .map(|option| MenuOption {
                                        id: option.id.clone(),
                                        name_fa: option.name_fa.clone(),
                                        price_delta: option.price_delta,
                                    })
                                    .collect()
                            })
                            .unwrap_or_default(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        by_category
            .entry(product.category_id.as_str())
            .or_default()
            .push(MenuProduct {
                id: product.id.clone(),
                category_id: product.category_id.clone(),
                name_fa: product.name_fa.clone(),
                description_fa: product.description_fa.clone(),
                price: product.base_price,
                image_url: product.image_url.clone(),
                prep_minutes: product.prep_minutes,
                is_available: available,
                unavailable_reason_fa: reason,
                option_groups,
                extras: extras_by_product
                    .get(product.id.as_str())
                    .map(|extras| {
                        extras
                            .iter()
                            .map(|extra| MenuExtra {
                                id: extra.id.clone(),
                                name_fa: extra.name_fa.clone(),
                                price: extra.price,
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            });
    }

    Ok(categories
        .into_iter()
        .filter_map(|category| {
            let products = by_category.remove(category.id.as_str())?;
            if products.is_empty() {
                return None;
            }
            Some(MenuCategory {
                id: category.id,
                name_fa: category.name_fa,
                slug: category.slug,
                products,
            })
        })
        .collect())
}

pub async fn module_enabled(state: &AppState, key: &str, fallback: bool) -> Result<bool, AppError> {
    let row = sqlx::query("SELECT is_enabled FROM module_settings WHERE key = $1")
        .bind(key)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    Ok(row.map_or(fallback, |row| row.get::<i64, _>("is_enabled") == 1))
}

pub async fn resolve_device(state: &AppState, headers: &HeaderMap) -> Result<Device, AppError> {
    if let Some(token) = cookie_value(headers, DEVICE_COOKIE)
        && token.len() >= 16
    {
        let hash = sha256_hex(&token);
        let row = sqlx::query("SELECT id FROM customer_devices WHERE token_hash = $1")
            .bind(&hash)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?;
        if let Some(row) = row {
            let id: String = row.get("id");
            let _ = sqlx::query("UPDATE customer_devices SET last_seen_at = $1 WHERE id = $2")
                .bind(cafeflow_domain::iso_utc(OffsetDateTime::now_utc()))
                .bind(&id)
                .execute(&state.db.pool)
                .await;
            return Ok(Device {
                id,
                token,
                is_new: false,
            });
        }
    }

    let token = cafeflow_db::create_token();
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO customer_devices (id, token_hash) VALUES ($1, $2)")
        .bind(&id)
        .bind(sha256_hex(&token))
        .execute(&state.db.pool)
        .await
        .map_err(db_error)?;
    Ok(Device {
        id,
        token,
        is_new: true,
    })
}

pub fn with_device_cookie(mut response: Response, device: &Device, state: &AppState) -> Response {
    if device.is_new
        && let Ok(value) = HeaderValue::from_str(&device_cookie(
            &device.token,
            state.config.session_cookie_secure,
        ))
    {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

fn device_cookie(token: &str, secure: bool) -> String {
    let mut cookie = format!(
        "{DEVICE_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={DEVICE_COOKIE_MAX_AGE}"
    );
    if secure {
        cookie.push_str("; Secure");
    }
    cookie
}

pub fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|header| {
            header.split(';').find_map(|part| {
                let (key, value) = part.trim().split_once('=')?;
                (key == name).then(|| value.to_string())
            })
        })
}

fn tehran_clock() -> (i64, i64) {
    let local = OffsetDateTime::now_utc() + time::Duration::minutes(210);
    (
        local.date().weekday().number_days_from_sunday() as i64,
        local.hour() as i64 * 60 + local.minute() as i64,
    )
}

fn parse_time(value: &str) -> i64 {
    let mut parts = value.split(':');
    let hours = parts
        .next()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let minutes = parts
        .next()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    hours * 60 + minutes
}

pub fn db_error(error: impl std::fmt::Display) -> AppError {
    tracing::error!("public database error: {error}");
    AppError::internal("خطای پایگاه داده رخ داد.")
}
