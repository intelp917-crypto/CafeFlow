//! Customer ordering and tracking. Every amount is recomputed from the live
//! catalog; the client never supplies a price, table identity, or total.

use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use cafeflow_db::{create_token, now_iso_after_minutes, sha256_hex};
use cafeflow_domain::{OrderStatus, percent_of};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::{AppError, bad_request, conflict, not_found, validation_failed};
use crate::public_menu::{
    SettingsRow, db_error, find_qr, resolve_device, settings, with_device_cookie,
};
use crate::state::AppState;

const MAX_ITEMS: usize = 30;
const MAX_LINE_QUANTITY: i64 = 20;
const CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderInput {
    qr_token: String,
    client_request_id: String,
    note: Option<String>,
    items: Vec<LineInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LineInput {
    product_id: String,
    quantity: i64,
    #[serde(default)]
    option_ids: Vec<String>,
    #[serde(default)]
    extra_ids: Vec<String>,
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StatusQuery {
    token: Option<String>,
}

#[derive(Debug, Clone)]
struct ProductRow {
    id: String,
    name_fa: String,
    base_price: i64,
    department_id: Option<String>,
    prep_minutes: i64,
    is_available: i64,
}

#[derive(Debug, Clone)]
struct GroupRow {
    id: String,
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
    name_fa: String,
    price: i64,
}

#[derive(Debug, Clone)]
struct AvailabilityRow {
    weekday: Option<i64>,
    start_time: String,
    end_time: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PricedOption {
    id: String,
    name_fa: String,
    price_delta: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PricedExtra {
    id: String,
    name_fa: String,
    price: i64,
}

#[derive(Debug, Clone)]
struct PricedItem {
    product: ProductRow,
    quantity: i64,
    options: Vec<PricedOption>,
    extras: Vec<PricedExtra>,
    unit_price: i64,
    total: i64,
    note: Option<String>,
}

#[derive(Debug)]
struct PricedOrder {
    items: Vec<PricedItem>,
    subtotal: i64,
    service_charge: i64,
    tax_total: i64,
    total: i64,
}

#[derive(Debug, Clone)]
struct OrderSummary {
    id: String,
    code: String,
    status: String,
    total: i64,
    subtotal: i64,
    service_charge: i64,
    tax_total: i64,
    note: Option<String>,
    cancel_reason: Option<String>,
    table_name_fa: Option<String>,
    table_code: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OrderResponse {
    id: String,
    code: String,
    status: String,
    status_label_fa: String,
    total: i64,
    item_count: i64,
    table_name_fa: Option<String>,
    created_at: String,
    replayed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    status_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackingItem {
    id: String,
    name_fa: String,
    quantity: i64,
    unit_price: i64,
    total: i64,
    status: String,
    note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackingResponse {
    code: String,
    status: String,
    status_label_fa: String,
    subtotal: i64,
    service_charge: i64,
    tax_total: i64,
    total: i64,
    note: Option<String>,
    cancel_reason: Option<String>,
    table_name_fa: Option<String>,
    table_code: Option<String>,
    created_at: String,
    updated_at: String,
    items: Vec<TrackingItem>,
}

#[axum::debug_handler]
pub async fn create_order(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, AppError> {
    let input: CreateOrderInput =
        serde_json::from_slice(&body).map_err(|_| validation_failed("اطلاعات سفارش معتبر نیست."))?;
    validate_order(&input)?;
    let device = resolve_device(&state, &headers).await?;
    let qr_token = input.qr_token.trim();
    let qr = find_qr(&state, qr_token).await?;
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

    if let Some(response) = replay_order(&state, &device.id, input.client_request_id.trim()).await?
    {
        return Ok(with_device_cookie(
            (StatusCode::CREATED, Json(response)).into_response(),
            &device,
            &state,
        ));
    }

    let priced = price_order(&state, &input.items, &settings(&state).await?).await?;
    let code = next_code(&state).await?;
    let order_id = Uuid::new_v4().to_string();
    let status_token = create_token();
    let now = now_iso_after_minutes(0);
    let table_session_id = if qr.kind == "table" {
        match qr.table_id.as_deref() {
            Some(table_id) => Some(open_table_session(&state, table_id, &now).await?),
            None => None,
        }
    } else {
        None
    };

    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    let inserted = sqlx::query(
        "INSERT INTO orders
           (id, code, table_id, table_session_id, guest_device_id, status, source,
            subtotal, discount_total, service_charge, tax_total, total, note,
            client_request_id, status_token_hash, submitted_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'submitted', 'qr',
                 $6, 0, $7, $8, $9, $10, $11, $12, $13, $13, $13)
         ON CONFLICT (guest_device_id, client_request_id)
           WHERE client_request_id IS NOT NULL DO NOTHING",
    )
    .bind(&order_id)
    .bind(&code)
    .bind(&qr.table_id)
    .bind(&table_session_id)
    .bind(&device.id)
    .bind(priced.subtotal)
    .bind(priced.service_charge)
    .bind(priced.tax_total)
    .bind(priced.total)
    .bind(
        input
            .note
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .bind(input.client_request_id.trim())
    .bind(sha256_hex(&status_token))
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    if inserted.rows_affected() == 0 {
        tx.rollback().await.map_err(db_error)?;
        if let Some(response) =
            replay_order(&state, &device.id, input.client_request_id.trim()).await?
        {
            return Ok(with_device_cookie(
                (StatusCode::CREATED, Json(response)).into_response(),
                &device,
                &state,
            ));
        }
        return Err(conflict(
            "این درخواست قبلاً ثبت شده است؛ لطفاً وضعیت سفارش را دوباره بارگذاری کنید.",
            "ORDER_REPLAY_RACE",
        ));
    }

    for item in &priced.items {
        let item_id = Uuid::new_v4().to_string();
        let options_json = if item.options.is_empty() {
            None
        } else {
            Some(
                serde_json::to_string(&item.options)
                    .map_err(|error| AppError::internal(format!("سریال‌سازی گزینه‌ها: {error}")))?,
            )
        };
        let extras_json = if item.extras.is_empty() {
            None
        } else {
            Some(
                serde_json::to_string(&item.extras)
                    .map_err(|error| AppError::internal(format!("سریال‌سازی افزودنی‌ها: {error}")))?,
            )
        };
        sqlx::query(
            "INSERT INTO order_items
               (id, order_id, product_id, product_name_snapshot, unit_price_snapshot,
                quantity, options_json, extras_json, note, department_id, status, total)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)",
        )
        .bind(&item_id)
        .bind(&order_id)
        .bind(&item.product.id)
        .bind(&item.product.name_fa)
        .bind(item.unit_price)
        .bind(item.quantity)
        .bind(options_json)
        .bind(extras_json)
        .bind(item.note.as_deref())
        .bind(&item.product.department_id)
        .bind(item.total)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;

        for option in &item.options {
            sqlx::query(
                "INSERT INTO order_item_options
                   (id, order_item_id, option_id, name_snapshot, price_snapshot)
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(&item_id)
            .bind(&option.id)
            .bind(&option.name_fa)
            .bind(option.price_delta)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }

        sqlx::query(
            "INSERT INTO prep_tasks
               (id, order_item_id, order_id, department_id, status, priority, target_minutes)
             VALUES ($1, $2, $3, $4, 'queued', 0, $5)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&item_id)
        .bind(&order_id)
        .bind(&item.product.department_id)
        .bind(item.product.prep_minutes)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }

    sqlx::query(
        "INSERT INTO order_events
           (id, order_id, type, from_status, to_status, payload_json, created_at)
         VALUES ($1, $2, 'order.submitted', 'draft', 'submitted', $3, $4)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&order_id)
    .bind(
        json!({
            "source": "qr",
            "tableId": qr.table_id,
            "itemCount": priced.items.len(),
            "total": priced.total,
        })
        .to_string(),
    )
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;

    let table_label = qr
        .table_name_fa
        .as_deref()
        .or(qr.table_code.as_deref())
        .unwrap_or("بدون میز");
    sqlx::query(
        "INSERT INTO notifications (id, role_key, type, title_fa, body_fa, data_json)
         VALUES ($1, 'waiter', 'order.created', $2, $3, $4)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(format!("سفارش جدید {code}"))
    .bind(format!("{table_label} — {} قلم", priced.items.len()))
    .bind(json!({"orderId": order_id, "code": code.clone(), "tableId": qr.table_id}).to_string())
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    let summary = find_summary(&state, &code)
        .await?
        .ok_or_else(|| AppError::internal("سفارش ایجاد شد اما خلاصه آن خوانده نشد."))?;
    let response = OrderResponse {
        id: summary.id,
        code: summary.code,
        status: summary.status.clone(),
        status_label_fa: status_label(&summary.status),
        total: summary.total,
        item_count: priced.items.iter().map(|item| item.quantity).sum::<i64>(),
        table_name_fa: summary.table_name_fa,
        created_at: summary.created_at,
        replayed: false,
        status_token: Some(status_token),
    };
    Ok(with_device_cookie(
        (StatusCode::CREATED, Json(response)).into_response(),
        &device,
        &state,
    ))
}

pub async fn order_status(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Query(query): Query<StatusQuery>,
) -> Result<Json<TrackingResponse>, AppError> {
    let code = code.trim().to_uppercase();
    let row = sqlx::query("SELECT status_token_hash FROM orders WHERE code = $1")
        .bind(&code)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    let Some(row) = row else {
        return Err(order_not_found());
    };
    let token_hash: Option<String> = row.get("status_token_hash");
    if let Some(expected) = token_hash
        && query.token.as_deref().map(sha256_hex).as_deref() != Some(expected.as_str())
    {
        return Err(order_not_found());
    }
    let summary = find_summary(&state, &code)
        .await?
        .ok_or_else(order_not_found)?;
    let items = sqlx::query(
        "SELECT id, product_name_snapshot, unit_price_snapshot, quantity, total, status, note
           FROM order_items WHERE order_id = $1 ORDER BY created_at ASC",
    )
    .bind(&summary.id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    .into_iter()
    .map(|row| TrackingItem {
        id: row.get("id"),
        name_fa: row.get("product_name_snapshot"),
        quantity: row.get("quantity"),
        unit_price: row.get("unit_price_snapshot"),
        total: row.get("total"),
        status: row.get("status"),
        note: row.get("note"),
    })
    .collect();
    Ok(Json(TrackingResponse {
        code: summary.code,
        status: summary.status.clone(),
        status_label_fa: status_label(&summary.status),
        subtotal: summary.subtotal,
        service_charge: summary.service_charge,
        tax_total: summary.tax_total,
        total: summary.total,
        note: summary.note,
        cancel_reason: summary.cancel_reason,
        table_name_fa: summary.table_name_fa,
        table_code: summary.table_code,
        created_at: summary.created_at,
        updated_at: summary.updated_at,
        items,
    }))
}

async fn price_order(
    state: &AppState,
    lines: &[LineInput],
    settings: &SettingsRow,
) -> Result<PricedOrder, AppError> {
    let mut priced = Vec::with_capacity(lines.len());
    for line in lines {
        let product = find_product(state, &line.product_id).await?;
        if product.is_available != 1 {
            return Err(conflict(
                format!("«{}» در حال حاضر ناموجود است.", product.name_fa),
                "PRODUCT_UNAVAILABLE",
            ));
        }
        check_availability(state, &product).await?;

        let groups = product_groups(state, &product.id).await?;
        let options = product_options(state, &product.id).await?;
        let extras_allowed = product_extras(state, &product.id).await?;
        let option_by_id: HashMap<&str, &OptionRow> = options
            .iter()
            .map(|option| (option.id.as_str(), option))
            .collect();
        let group_by_id: HashMap<&str, &GroupRow> = groups
            .iter()
            .map(|group| (group.id.as_str(), group))
            .collect();
        let mut selected_by_group: HashMap<&str, Vec<PricedOption>> = HashMap::new();
        let mut seen_options = HashSet::new();
        for option_id in &line.option_ids {
            if !seen_options.insert(option_id) {
                continue;
            }
            let option = option_by_id.get(option_id.as_str()).ok_or_else(|| {
                bad_request("یکی از گزینه‌های انتخاب‌شده معتبر نیست.", "OPTION_INVALID")
            })?;
            let group = group_by_id
                .get(option.option_group_id.as_str())
                .ok_or_else(|| {
                    bad_request(
                        "گزینه انتخاب‌شده برای این محصول مجاز نیست.",
                        "OPTION_INVALID",
                    )
                })?;
            selected_by_group
                .entry(group.id.as_str())
                .or_default()
                .push(PricedOption {
                    id: option.id.clone(),
                    name_fa: option.name_fa.clone(),
                    price_delta: option.price_delta,
                });
        }
        for group in &groups {
            let count = selected_by_group.get(group.id.as_str()).map_or(0, Vec::len) as i64;
            let minimum = if group.is_required == 1 {
                group.min_select.max(1)
            } else {
                group.min_select
            };
            if count < minimum {
                return Err(bad_request(
                    format!(
                        "برای «{}» انتخاب «{}» الزامی است.",
                        product.name_fa, group.name_fa
                    ),
                    "OPTION_REQUIRED",
                ));
            }
            if count > group.max_select {
                return Err(bad_request(
                    format!(
                        "حداکثر {} انتخاب برای «{}» مجاز است.",
                        group.max_select, group.name_fa
                    ),
                    "OPTION_LIMIT",
                ));
            }
        }
        let selected_options: Vec<PricedOption> =
            selected_by_group.into_values().flatten().collect();
        let mut selected_extras = Vec::new();
        let mut seen_extras = HashSet::new();
        for extra_id in &line.extra_ids {
            if !seen_extras.insert(extra_id) {
                continue;
            }
            let extra = extras_allowed
                .iter()
                .find(|extra| &extra.id == extra_id)
                .ok_or_else(|| {
                    bad_request(
                        format!("افزودنی انتخاب‌شده برای «{}» مجاز نیست.", product.name_fa),
                        "EXTRA_INVALID",
                    )
                })?;
            selected_extras.push(PricedExtra {
                id: extra.id.clone(),
                name_fa: extra.name_fa.clone(),
                price: extra.price,
            });
        }
        let unit_price = product.base_price
            + selected_options
                .iter()
                .map(|option| option.price_delta)
                .sum::<i64>()
            + selected_extras.iter().map(|extra| extra.price).sum::<i64>();
        if unit_price < 0 {
            return Err(bad_request(
                format!(
                    "قیمت نهایی «{}» با گزینه‌های انتخاب‌شده منفی می‌شود.",
                    product.name_fa
                ),
                "UNIT_PRICE_NEGATIVE",
            ));
        }
        let total = unit_price
            .checked_mul(line.quantity)
            .ok_or_else(|| bad_request("مبلغ سفارش از محدوده مجاز بیشتر است.", "INVALID_TOTAL"))?;
        priced.push(PricedItem {
            product,
            quantity: line.quantity,
            options: selected_options,
            extras: selected_extras,
            unit_price,
            total,
            note: line
                .note
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned),
        });
    }

    let subtotal = priced
        .iter()
        .try_fold(0i64, |sum, item| sum.checked_add(item.total))
        .ok_or_else(|| bad_request("مبلغ سفارش از محدوده مجاز بیشتر است.", "INVALID_TOTAL"))?;
    if subtotal <= 0 {
        return Err(bad_request("مبلغ سفارش نامعتبر است.", "INVALID_TOTAL"));
    }
    let service_charge = percent_of(subtotal, settings.service_charge_percent as f64)
        .map_err(|_| bad_request("مبلغ سفارش نامعتبر است.", "INVALID_TOTAL"))?;
    let tax_total = percent_of(subtotal + service_charge, settings.tax_percent as f64)
        .map_err(|_| bad_request("مبلغ سفارش نامعتبر است.", "INVALID_TOTAL"))?;
    let total = subtotal
        .checked_add(service_charge)
        .and_then(|value| value.checked_add(tax_total))
        .ok_or_else(|| bad_request("مبلغ سفارش از محدوده مجاز بیشتر است.", "INVALID_TOTAL"))?;
    Ok(PricedOrder {
        items: priced,
        subtotal,
        service_charge,
        tax_total,
        total,
    })
}

async fn find_product(state: &AppState, product_id: &str) -> Result<ProductRow, AppError> {
    let row = sqlx::query(
        "SELECT p.id, p.category_id, p.name_fa, p.base_price, p.department_id,
                p.prep_minutes, p.is_available
           FROM products p
           JOIN categories c ON c.id = p.category_id AND c.is_active = 1 AND c.deleted_at IS NULL
          WHERE p.id = $1 AND p.is_active = 1 AND p.is_archived = 0 AND p.deleted_at IS NULL",
    )
    .bind(product_id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    let Some(row) = row else {
        return Err(bad_request(
            "یکی از محصولات انتخاب‌شده دیگر در منو نیست.",
            "PRODUCT_UNAVAILABLE",
        ));
    };
    Ok(ProductRow {
        id: row.get("id"),
        name_fa: row.get("name_fa"),
        base_price: row.get("base_price"),
        department_id: row.get("department_id"),
        prep_minutes: row.get("prep_minutes"),
        is_available: row.get("is_available"),
    })
}

async fn product_groups(state: &AppState, product_id: &str) -> Result<Vec<GroupRow>, AppError> {
    let rows = sqlx::query(
        "SELECT id, name_fa, min_select, max_select, is_required
           FROM option_groups WHERE product_id = $1
          ORDER BY sort_order ASC, name_fa ASC",
    )
    .bind(product_id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(rows
        .into_iter()
        .map(|row| GroupRow {
            id: row.get("id"),
            name_fa: row.get("name_fa"),
            min_select: row.get("min_select"),
            max_select: row.get("max_select"),
            is_required: row.get("is_required"),
        })
        .collect())
}

async fn product_options(state: &AppState, product_id: &str) -> Result<Vec<OptionRow>, AppError> {
    let rows = sqlx::query(
        "SELECT o.id, o.option_group_id, o.name_fa, o.price_delta
           FROM product_options o
           JOIN option_groups g ON g.id = o.option_group_id
          WHERE g.product_id = $1 AND o.is_active = 1
          ORDER BY o.sort_order ASC, o.name_fa ASC",
    )
    .bind(product_id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(rows
        .into_iter()
        .map(|row| OptionRow {
            id: row.get("id"),
            option_group_id: row.get("option_group_id"),
            name_fa: row.get("name_fa"),
            price_delta: row.get("price_delta"),
        })
        .collect())
}

async fn product_extras(state: &AppState, product_id: &str) -> Result<Vec<ExtraRow>, AppError> {
    let rows = sqlx::query(
        "SELECT e.id, e.name_fa, e.price
           FROM product_extras pe
           JOIN extras e ON e.id = pe.extra_id AND e.is_active = 1
          WHERE pe.product_id = $1
          ORDER BY e.name_fa ASC",
    )
    .bind(product_id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(rows
        .into_iter()
        .map(|row| ExtraRow {
            id: row.get("id"),
            name_fa: row.get("name_fa"),
            price: row.get("price"),
        })
        .collect())
}

async fn check_availability(state: &AppState, product: &ProductRow) -> Result<(), AppError> {
    let rows = sqlx::query(
        "SELECT weekday, start_time, end_time FROM availability_windows
          WHERE product_id = $1 AND is_active = 1",
    )
    .bind(&product.id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    if rows.is_empty() {
        return Ok(());
    }
    let windows: Vec<AvailabilityRow> = rows
        .into_iter()
        .map(|row| AvailabilityRow {
            weekday: row.get("weekday"),
            start_time: row.get("start_time"),
            end_time: row.get("end_time"),
        })
        .collect();
    let local = OffsetDateTime::now_utc() + time::Duration::minutes(210);
    let weekday = local.date().weekday().number_days_from_sunday() as i64;
    let minutes = local.hour() as i64 * 60 + local.minute() as i64;
    let inside = windows.iter().any(|window| {
        if window.weekday.is_some_and(|day| day != weekday) {
            return false;
        }
        minutes >= parse_time(&window.start_time) && minutes < parse_time(&window.end_time)
    });
    if inside {
        Ok(())
    } else {
        Err(conflict(
            format!("«{}» در این ساعت سرو نمی‌شود.", product.name_fa),
            "PRODUCT_OUTSIDE_HOURS",
        ))
    }
}

async fn open_table_session(
    state: &AppState,
    table_id: &str,
    now: &str,
) -> Result<String, AppError> {
    if let Some(row) =
        sqlx::query("SELECT id FROM table_sessions WHERE table_id = $1 AND status = 'open'")
            .bind(table_id)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?
    {
        return Ok(row.get("id"));
    }
    let id = Uuid::new_v4().to_string();
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "INSERT INTO table_sessions (id, table_id, guest_count, status, opened_at)
         VALUES ($1, $2, NULL, 'open', $3)",
    )
    .bind(&id)
    .bind(table_id)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    sqlx::query(
        "UPDATE dining_tables SET status = 'occupied', updated_at = $1
          WHERE id = $2 AND status = 'available'",
    )
    .bind(now)
    .bind(table_id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    Ok(id)
}

async fn replay_order(
    state: &AppState,
    device_id: &str,
    client_request_id: &str,
) -> Result<Option<OrderResponse>, AppError> {
    let Some((_, code)) = find_replay(state, device_id, client_request_id).await? else {
        return Ok(None);
    };
    let summary = find_summary(state, &code)
        .await?
        .ok_or_else(|| AppError::internal("سفارش تکراری پیدا شد اما خلاصه آن خوانده نشد."))?;
    let item_count = item_count(state, &summary.id).await?;
    Ok(Some(OrderResponse {
        id: summary.id,
        code: summary.code,
        status: summary.status.clone(),
        status_label_fa: status_label(&summary.status),
        total: summary.total,
        item_count,
        table_name_fa: summary.table_name_fa,
        created_at: summary.created_at,
        replayed: true,
        status_token: None,
    }))
}

async fn find_replay(
    state: &AppState,
    device_id: &str,
    client_request_id: &str,
) -> Result<Option<(String, String)>, AppError> {
    let row = sqlx::query(
        "SELECT id, code FROM orders
          WHERE guest_device_id = $1 AND client_request_id = $2",
    )
    .bind(device_id)
    .bind(client_request_id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(row.map(|row| (row.get("id"), row.get("code"))))
}

async fn find_summary(state: &AppState, code: &str) -> Result<Option<OrderSummary>, AppError> {
    let row = sqlx::query(
        "SELECT o.id, o.code, o.status, o.total, o.subtotal, o.service_charge, o.tax_total,
                o.note, o.cancel_reason, o.created_at, o.updated_at,
                t.name_fa AS table_name_fa, t.code AS table_code
           FROM orders o
           LEFT JOIN dining_tables t ON t.id = o.table_id
          WHERE o.code = $1",
    )
    .bind(code)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(row.map(|row| OrderSummary {
        id: row.get("id"),
        code: row.get("code"),
        status: row.get("status"),
        total: row.get("total"),
        subtotal: row.get("subtotal"),
        service_charge: row.get("service_charge"),
        tax_total: row.get("tax_total"),
        note: row.get("note"),
        cancel_reason: row.get("cancel_reason"),
        table_name_fa: row.get("table_name_fa"),
        table_code: row.get("table_code"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }))
}

async fn item_count(state: &AppState, order_id: &str) -> Result<i64, AppError> {
    let row =
        sqlx::query("SELECT COALESCE(SUM(quantity), 0) AS n FROM order_items WHERE order_id = $1")
            .bind(order_id)
            .fetch_one(&state.db.pool)
            .await
            .map_err(db_error)?;
    Ok(row.get("n"))
}

async fn next_code(state: &AppState) -> Result<String, AppError> {
    for _ in 0..8 {
        let suffix: String = {
            let mut rng = rand::thread_rng();
            (0..6)
                .map(|_| CODE_ALPHABET[rng.gen_range(0..CODE_ALPHABET.len())] as char)
                .collect()
        };
        let code = format!("CF-{suffix}");
        let row = sqlx::query("SELECT 1 AS x FROM orders WHERE code = $1")
            .bind(&code)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?;
        if row.is_none() {
            return Ok(code);
        }
    }
    Err(AppError::internal(
        "تولید کد سفارش ناموفق بود. دوباره تلاش کنید.",
    ))
}

fn validate_order(input: &CreateOrderInput) -> Result<(), AppError> {
    if input.qr_token.trim().is_empty() {
        return Err(validation_failed("کد QR الزامی است."));
    }
    let request_id = input.client_request_id.trim();
    if request_id.len() < 8 || request_id.len() > 64 {
        return Err(validation_failed("شناسه درخواست نامعتبر است."));
    }
    if input
        .note
        .as_ref()
        .is_some_and(|note| note.trim().len() > 300)
    {
        return Err(validation_failed("یادداشت سفارش بیش از حد طولانی است."));
    }
    if input.items.is_empty() || input.items.len() > MAX_ITEMS {
        return Err(validation_failed("سبد خرید خالی یا بیش از حد بزرگ است."));
    }
    for line in &input.items {
        if line.product_id.trim().is_empty()
            || line.quantity < 1
            || line.quantity > MAX_LINE_QUANTITY
        {
            return Err(validation_failed("یکی از اقلام سفارش معتبر نیست."));
        }
        if line.option_ids.len() > 20 || line.extra_ids.len() > 20 {
            return Err(validation_failed(
                "تعداد گزینه‌های یک قلم بیش از حد مجاز است.",
            ));
        }
        if line
            .note
            .as_ref()
            .is_some_and(|note| note.trim().len() > 200)
        {
            return Err(validation_failed("یادداشت آیتم بیش از حد طولانی است."));
        }
    }
    Ok(())
}

fn status_label(status: &str) -> String {
    OrderStatus::parse_status(status)
        .map(|status| status.label_fa().to_string())
        .unwrap_or_else(|| status.to_string())
}

fn order_not_found() -> AppError {
    not_found("سفارشی با این کد یافت نشد.", "ORDER_NOT_FOUND")
}

fn parse_time(value: &str) -> i64 {
    let mut parts = value.split(':');
    let hours = parts
        .next()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    let minutes = parts
        .next()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    hours * 60 + minutes
}
