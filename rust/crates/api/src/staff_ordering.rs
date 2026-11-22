//! Waiter-entered orders and line edits. Every amount is recomputed by the
//! shared menu pricing engine; the browser only supplies product ids and counts.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use cafeflow_domain::{OrderStatus, is_terminal_status, percent_of};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::{require_auth, session_has_permission};
use crate::error::{AppError, bad_request, conflict, forbidden, not_found, validation_failed};
use crate::public_menu::settings;
use crate::public_orders::{
    LineInput, insert_priced_items, next_code, open_table_session, price_lines,
};
use crate::staff_orders::build_detail;
use crate::state::AppState;

const ACTIVE_STATUSES: &str = "'submitted','awaiting_confirmation','confirmed','preparing','partially_ready','ready','served','awaiting_payment'";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateOrderInput {
    table_id: Option<String>,
    note: Option<String>,
    items: Vec<LineInput>,
}

#[derive(Debug, Deserialize)]
struct AddItemsInput {
    items: Vec<LineInput>,
}

#[derive(Debug, Deserialize)]
struct UpdateItemInput {
    quantity: i64,
}

/// Waiter order: starts confirmed because the guest agreed at the table.
pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "orders.write").await? {
        return Err(forbidden("اجازهٔ ثبت سفارش را ندارید.", "FORBIDDEN"));
    }
    let input: CreateOrderInput = serde_json::from_slice(&body)
        .map_err(|_| validation_failed("اطلاعات سفارش دستی معتبر نیست."))?;
    validate_lines(&input.items, 30)?;
    let note = valid_note(input.note.as_deref(), 300, "یادداشت سفارش")?;
    let table_id = input
        .table_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(table_id) = table_id {
        let exists = sqlx::query(
            "SELECT 1 AS x FROM dining_tables
              WHERE id = $1 AND is_active = 1 AND deleted_at IS NULL",
        )
        .bind(table_id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
        if exists.is_none() {
            return Err(not_found("میزی با این شناسه یافت نشد.", "TABLE_NOT_FOUND"));
        }
    }

    let priced = price_lines(&state, &input.items).await?;
    let code = next_code(&state).await?;
    let order_id = Uuid::new_v4().to_string();
    let now = cafeflow_db::now_iso_after_minutes(0);
    let session_id = match table_id {
        Some(table_id) => Some(open_table_session(&state, table_id, &now).await?),
        None => None,
    };

    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "INSERT INTO orders
           (id, code, table_id, table_session_id, waiter_user_id, status, source,
            subtotal, discount_total, service_charge, tax_total, total, note,
            created_by_user_id, submitted_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'confirmed', 'waiter',
                 $6, 0, $7, $8, $9, $10, $5, $11, $11, $11)",
    )
    .bind(&order_id)
    .bind(&code)
    .bind(table_id)
    .bind(&session_id)
    .bind(&session.user.id)
    .bind(priced.subtotal)
    .bind(priced.service_charge)
    .bind(priced.tax_total)
    .bind(priced.total)
    .bind(note.as_deref())
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    insert_priced_items(&mut tx, &order_id, &priced).await?;

    insert_event(
        &mut tx,
        &order_id,
        "order.created",
        Some("draft"),
        "submitted",
        &session.user.id,
        json!({
            "source": "waiter",
            "itemCount": priced.items.len(),
            "total": priced.total,
            "tableId": table_id,
        }),
        &now,
    )
    .await?;
    insert_event(
        &mut tx,
        &order_id,
        "order.status_changed",
        Some("submitted"),
        "confirmed",
        &session.user.id,
        json!({}),
        &now,
    )
    .await?;
    insert_audit(
        &mut tx,
        &session.user.id,
        &session.user.username,
        "order.created_by_staff",
        &order_id,
        None,
        json!({
            "code": code,
            "tableId": table_id,
            "total": priced.total,
            "itemCount": priced.items.len(),
        }),
        &now,
    )
    .await?;
    tx.commit().await.map_err(db_error)?;

    Ok((
        StatusCode::CREATED,
        Json(build_detail(&state, &order_id).await?),
    )
        .into_response())
}

/// Extra round on an existing order; one bill and one prep stream.
pub async fn add_items(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "orders.write").await? {
        return Err(forbidden("اجازهٔ تغییر سفارش را ندارید.", "FORBIDDEN"));
    }
    let input: AddItemsInput = serde_json::from_slice(&body)
        .map_err(|_| validation_failed("اقلام جدید سفارش معتبر نیستند."))?;
    validate_lines(&input.items, 30)?;
    let state_row = find_state(&state, &id).await?;
    if is_terminal_status(state_row.status) {
        return Err(conflict(
            "این سفارش بسته شده است و افزودن قلم ممکن نیست.",
            "ORDER_CLOSED",
        ));
    }
    let totals = sqlx::query("SELECT subtotal, discount_total FROM orders WHERE id = $1")
        .bind(&id)
        .fetch_one(&state.db.pool)
        .await
        .map_err(db_error)?;
    let old_subtotal: i64 = totals.get("subtotal");
    let discount: i64 = totals.get("discount_total");
    let priced = price_lines(&state, &input.items).await?;
    let settings = settings(&state).await?;
    let subtotal = old_subtotal + priced.subtotal;
    let service_charge = percent_of(subtotal, settings.service_charge_percent as f64)
        .map_err(|_| bad_request("مبلغ سفارش نامعتبر است.", "INVALID_TOTAL"))?;
    let tax_total = percent_of(subtotal + service_charge, settings.tax_percent as f64)
        .map_err(|_| bad_request("مبلغ سفارش نامعتبر است.", "INVALID_TOTAL"))?;
    let total = (subtotal - discount + service_charge + tax_total).max(0);
    let now = cafeflow_db::now_iso_after_minutes(0);

    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    insert_priced_items(&mut tx, &id, &priced).await?;
    sqlx::query(
        "UPDATE orders SET subtotal = $1, service_charge = $2, tax_total = $3,
                total = $4, updated_at = $5 WHERE id = $6",
    )
    .bind(subtotal)
    .bind(service_charge)
    .bind(tax_total)
    .bind(total)
    .bind(&now)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    insert_event(
        &mut tx,
        &id,
        "order.items_added",
        Some(state_row.status.as_str()),
        state_row.status.as_str(),
        &session.user.id,
        json!({"itemCount": priced.items.len(), "addedSubtotal": priced.subtotal}),
        &now,
    )
    .await?;
    insert_audit(
        &mut tx,
        &session.user.id,
        &session.user.username,
        "order.items_added",
        &id,
        Some(json!({"subtotal": old_subtotal})),
        json!({
            "subtotal": subtotal,
            "serviceCharge": service_charge,
            "taxTotal": tax_total,
            "total": total,
            "addedItemCount": priced.items.len(),
        }),
        &now,
    )
    .await?;
    tx.commit().await.map_err(db_error)?;
    Ok(Json(build_detail(&state, &id).await?))
}

/// Shrink, grow or remove a line until the order is served.
pub async fn update_item(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, item_id)): Path<(String, String)>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "orders.write").await? {
        return Err(forbidden("اجازهٔ تغییر سفارش را ندارید.", "FORBIDDEN"));
    }
    let input: UpdateItemInput = serde_json::from_slice(&body)
        .map_err(|_| validation_failed("تعداد قلم سفارش معتبر نیست."))?;
    if !(0..=99).contains(&input.quantity) {
        return Err(validation_failed("تعداد باید بین ۰ و ۹۹ باشد."));
    }
    let state_row = find_state(&state, &id).await?;
    if is_terminal_status(state_row.status) || state_row.status == OrderStatus::AwaitingPayment {
        return Err(conflict(
            "این سفارش بسته شده است و اقلام آن قابل تغییر نیست.",
            "ORDER_CLOSED",
        ));
    }
    if state_row.status == OrderStatus::Served {
        return Err(conflict(
            "سفارش سرو شده است و اقلام آن قابل کاهش نیست.",
            "ORDER_ALREADY_SERVED",
        ));
    }
    let item = sqlx::query(
        "SELECT product_name_snapshot, unit_price_snapshot, quantity, status
           FROM order_items WHERE id = $1 AND order_id = $2",
    )
    .bind(&item_id)
    .bind(&id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .ok_or_else(|| not_found("قلم سفارش یافت نشد.", "ORDER_ITEM_NOT_FOUND"))?;
    let item_status: String = item.get("status");
    if item_status == "cancelled" {
        return Err(conflict("این قلم قبلاً حذف شده است.", "ITEM_CANCELLED"));
    }
    if item_status == "served" {
        return Err(conflict(
            "این قلم سرو شده است و قابل تغییر نیست.",
            "ITEM_SERVED",
        ));
    }
    let totals = sqlx::query("SELECT discount_total FROM orders WHERE id = $1")
        .bind(&id)
        .fetch_one(&state.db.pool)
        .await
        .map_err(db_error)?;
    let discount: i64 = totals.get("discount_total");
    let product_name: String = item.get("product_name_snapshot");
    let unit_price: i64 = item.get("unit_price_snapshot");
    let old_quantity: i64 = item.get("quantity");
    let settings = settings(&state).await?;
    let now = cafeflow_db::now_iso_after_minutes(0);

    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    if input.quantity == 0 {
        sqlx::query("UPDATE order_items SET status = 'cancelled' WHERE id = $1")
            .bind(&item_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        sqlx::query(
            "UPDATE prep_tasks SET status = 'cancelled' WHERE order_item_id = $1
              AND status NOT IN ('ready','cancelled')",
        )
        .bind(&item_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    } else {
        sqlx::query("UPDATE order_items SET quantity = $1, total = $2 WHERE id = $3")
            .bind(input.quantity)
            .bind(unit_price * input.quantity)
            .bind(&item_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }
    let row = sqlx::query(
        "SELECT COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END), 0) AS subtotal
           FROM order_items WHERE order_id = $1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_error)?;
    let subtotal: i64 = row.get("subtotal");
    let service_charge = percent_of(subtotal, settings.service_charge_percent as f64)
        .map_err(|_| bad_request("مبلغ سفارش نامعتبر است.", "INVALID_TOTAL"))?;
    let tax_total = percent_of(subtotal + service_charge, settings.tax_percent as f64)
        .map_err(|_| bad_request("مبلغ سفارش نامعتبر است.", "INVALID_TOTAL"))?;
    let total = (subtotal - discount + service_charge + tax_total).max(0);
    sqlx::query(
        "UPDATE orders SET subtotal = $1, service_charge = $2, tax_total = $3,
                total = $4, updated_at = $5 WHERE id = $6",
    )
    .bind(subtotal)
    .bind(service_charge)
    .bind(tax_total)
    .bind(total)
    .bind(&now)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    let event_type = if input.quantity == 0 {
        "order.item_removed"
    } else {
        "order.item_updated"
    };
    insert_event(
        &mut tx,
        &id,
        event_type,
        Some(state_row.status.as_str()),
        state_row.status.as_str(),
        &session.user.id,
        json!({
            "itemId": item_id,
            "productNameFa": product_name,
            "fromQuantity": old_quantity,
            "toQuantity": input.quantity,
        }),
        &now,
    )
    .await?;
    insert_audit(
        &mut tx,
        &session.user.id,
        &session.user.username,
        event_type,
        &id,
        None,
        json!({
            "itemId": item_id,
            "productNameFa": product_name,
            "fromQuantity": old_quantity,
            "toQuantity": input.quantity,
            "subtotal": subtotal,
            "total": total,
        }),
        &now,
    )
    .await?;
    tx.commit().await.map_err(db_error)?;
    Ok(Json(build_detail(&state, &id).await?))
}

pub async fn tables(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "layout.read").await? {
        return Err(forbidden("اجازهٔ مشاهدهٔ میزها را ندارید.", "FORBIDDEN"));
    }
    let rows = sqlx::query(&format!(
        "SELECT t.id, t.code, t.name_fa, t.capacity, t.shape, t.status,
                f.name_fa AS floor_name_fa, a.name_fa AS area_name_fa, u.full_name AS waiter_name,
                s.id AS session_id, s.opened_at,
                (SELECT COUNT(*) FROM orders o
                  WHERE o.table_id = t.id AND o.status IN ({ACTIVE_STATUSES})) AS active_orders,
                (SELECT COALESCE(SUM(o.total), 0) FROM orders o
                  WHERE o.table_id = t.id AND o.status IN ({ACTIVE_STATUSES})) AS open_total,
                (SELECT COUNT(*) FROM customer_requests r
                  WHERE r.table_id = t.id AND r.status = 'pending') AS pending_requests
           FROM dining_tables t
           LEFT JOIN floors f ON f.id = t.floor_id
           LEFT JOIN areas a ON a.id = t.area_id
           LEFT JOIN users u ON u.id = t.waiter_user_id
           LEFT JOIN table_sessions s ON s.table_id = t.id AND s.status = 'open'
          WHERE t.deleted_at IS NULL AND t.is_active = 1
          ORDER BY f.sort_order ASC, t.code ASC"
    ))
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        items.push(json!({
            "id": row.get::<String, _>("id"),
            "code": row.get::<String, _>("code"),
            "nameFa": row.get::<String, _>("name_fa"),
            "capacity": row.get::<i64, _>("capacity"),
            "shape": row.get::<String, _>("shape"),
            "status": row.get::<String, _>("status"),
            "floorNameFa": row.get::<Option<String>, _>("floor_name_fa"),
            "areaNameFa": row.get::<Option<String>, _>("area_name_fa"),
            "waiterName": row.get::<Option<String>, _>("waiter_name"),
            "sessionId": row.get::<Option<String>, _>("session_id"),
            "openedAt": row.get::<Option<String>, _>("opened_at"),
            "activeOrders": row.get::<i64, _>("active_orders"),
            "openTotal": row.get::<i64, _>("open_total"),
            "pendingRequests": row.get::<i64, _>("pending_requests"),
        }));
    }
    let occupied = items
        .iter()
        .filter(|item| {
            matches!(
                item["status"].as_str(),
                Some("occupied" | "waiting_service" | "waiting_payment")
            )
        })
        .count();
    let available = items
        .iter()
        .filter(|item| item["status"] == "available")
        .count();
    let reserved = items
        .iter()
        .filter(|item| item["status"] == "reserved")
        .count();
    Ok(Json(json!({
        "items": items,
        "summary": {
            "total": items.len(),
            "occupied": occupied,
            "available": available,
            "reserved": reserved,
        },
    })))
}

struct OrderState {
    status: OrderStatus,
}

async fn find_state(state: &AppState, id: &str) -> Result<OrderState, AppError> {
    let row = sqlx::query("SELECT status FROM orders WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?
        .ok_or_else(|| not_found("سفارش یافت نشد.", "ORDER_NOT_FOUND"))?;
    let status: String = row.get("status");
    let status = OrderStatus::parse_status(&status)
        .ok_or_else(|| AppError::internal("وضعیت سفارش نامعتبر است."))?;
    Ok(OrderState { status })
}

fn validate_lines(lines: &[LineInput], max_quantity: i64) -> Result<(), AppError> {
    if lines.is_empty() || lines.len() > 30 {
        return Err(validation_failed("تعداد اقلام سفارش باید بین ۱ و ۳۰ باشد."));
    }
    for line in lines {
        if line.product_id.trim().is_empty() || line.quantity < 1 || line.quantity > max_quantity {
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

fn valid_note(note: Option<&str>, max: usize, label: &str) -> Result<Option<String>, AppError> {
    let note = note.map(str::trim).filter(|value| !value.is_empty());
    if note.is_some_and(|value| value.len() > max) {
        return Err(validation_failed(format!("{label} بیش از حد طولانی است.")));
    }
    Ok(note.map(str::to_owned))
}

#[allow(clippy::too_many_arguments)]
async fn insert_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    order_id: &str,
    event_type: &str,
    from_status: Option<&str>,
    to_status: &str,
    actor_user_id: &str,
    payload: Value,
    now: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO order_events
           (id, order_id, type, from_status, to_status, actor_user_id, payload_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(order_id)
    .bind(event_type)
    .bind(from_status)
    .bind(to_status)
    .bind(actor_user_id)
    .bind(payload.to_string())
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn insert_audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    actor_user_id: &str,
    actor_username: &str,
    action: &str,
    entity_id: &str,
    before: Option<Value>,
    after: Value,
    now: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO audit_logs
           (id, actor_user_id, actor_username, action, entity_type, entity_id,
            before_json, after_json, created_at)
         VALUES ($1, $2, $3, $4, 'order', $5, $6, $7, $8)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(actor_user_id)
    .bind(actor_username)
    .bind(action)
    .bind(entity_id)
    .bind(before.map(|value| value.to_string()))
    .bind(after.to_string())
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(())
}

fn db_error(error: sqlx::Error) -> AppError {
    tracing::error!("staff ordering database error: {error}");
    AppError::internal("خطای پایگاه داده رخ داد.")
}
