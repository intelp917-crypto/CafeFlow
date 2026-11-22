//! Customer service requests, terminal requests and table closing. The QR
//! token, device and permissions are resolved on the server.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::{require_auth, session_has_permission};
use crate::error::{AppError, conflict, forbidden, not_found, validation_failed};
use crate::public_menu::{db_error, find_qr, resolve_device, with_device_cookie};
use crate::state::AppState;

const REQUEST_TYPES: [&str; 7] = [
    "waiter",
    "water",
    "tissues",
    "bill",
    "terminal",
    "assistance",
    "custom",
];

#[derive(Debug, Deserialize, Default)]
pub struct StatusQuery {
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ServiceStatusInput {
    status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicRequestInput {
    qr_token: String,
    #[serde(rename = "type")]
    kind: String,
    note: Option<String>,
    order_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicTerminalInput {
    qr_token: String,
    note: Option<String>,
    order_code: Option<String>,
}

pub async fn create_public_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, AppError> {
    let input: PublicRequestInput = serde_json::from_slice(&body)
        .map_err(|_| validation_failed("اطلاعات درخواست معتبر نیست."))?;
    create_request(
        &state,
        &headers,
        input.qr_token,
        input.kind,
        input.note,
        input.order_code,
    )
    .await
}

pub async fn create_public_terminal(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, AppError> {
    let input: PublicTerminalInput = serde_json::from_slice(&body)
        .map_err(|_| validation_failed("اطلاعات درخواست کارت‌خوان معتبر نیست."))?;
    create_request(
        &state,
        &headers,
        input.qr_token,
        "terminal".to_string(),
        input.note,
        input.order_code,
    )
    .await
}

async fn create_request(
    state: &AppState,
    headers: &HeaderMap,
    qr_token: String,
    kind: String,
    note: Option<String>,
    order_code: Option<String>,
) -> Result<Response, AppError> {
    if !REQUEST_TYPES.contains(&kind.as_str()) {
        return Err(validation_failed("نوع درخواست نامعتبر است."));
    }
    let note = note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    if note
        .as_deref()
        .is_some_and(|value| value.chars().count() > 300)
    {
        return Err(validation_failed("توضیح درخواست بیش از حد طولانی است."));
    }
    let order_code = order_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_uppercase);

    let device = resolve_device(state, headers).await?;
    let allowed = {
        let mut limiter = state
            .request_limiter
            .lock()
            .map_err(|_| AppError::internal("request rate limiter"))?;
        limiter.hit(&device.id)
    };
    if !allowed {
        return Err(AppError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "تعداد درخواست‌های شما زیاد بوده است. کمی صبر کنید.",
        ));
    }

    let qr = find_qr(state, qr_token.trim()).await?;
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

    let order_id = if let Some(code) = order_code.as_deref() {
        sqlx::query("SELECT id FROM orders WHERE UPPER(code) = $1")
            .bind(code)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?
            .map(|row| row.get::<String, _>("id"))
    } else {
        None
    };

    let request_id = Uuid::new_v4().to_string();
    let terminal_id = (kind == "terminal").then(|| Uuid::new_v4().to_string());
    let now = cafeflow_db::now_iso_after_minutes(0);
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "INSERT INTO customer_requests
           (id, table_id, order_id, type, note, status, created_by_device_id, created_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)",
    )
    .bind(&request_id)
    .bind(&qr.table_id)
    .bind(&order_id)
    .bind(&kind)
    .bind(&note)
    .bind(&device.id)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    if let Some(terminal_id) = terminal_id.as_deref() {
        sqlx::query(
            "INSERT INTO terminal_requests (id, order_id, table_id, status, note, created_at)
             VALUES ($1, $2, $3, 'pending', $4, $5)",
        )
        .bind(terminal_id)
        .bind(&order_id)
        .bind(&qr.table_id)
        .bind(&note)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    let label = request_label(&kind);
    let table_label = qr
        .table_name_fa
        .as_deref()
        .or(qr.table_code.as_deref())
        .unwrap_or("بدون میز");
    sqlx::query(
        "INSERT INTO notifications (id, role_key, type, title_fa, body_fa, data_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(if matches!(kind.as_str(), "terminal" | "bill") {
        "cashier"
    } else {
        "waiter"
    })
    .bind(format!("customer_request.{kind}"))
    .bind(format!("{label} — {table_label}"))
    .bind(&note)
    .bind(
        json!({
            "requestId": request_id.clone(),
            "terminalRequestId": terminal_id,
            "tableId": qr.table_id,
            "orderCode": order_code
        })
        .to_string(),
    )
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    Ok(with_device_cookie(
        (
            StatusCode::CREATED,
            Json(json!({"id": request_id, "type": kind})),
        )
            .into_response(),
        &device,
        state,
    ))
}

pub async fn list_service(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<StatusQuery>,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "orders.read").await? {
        return Err(forbidden("اجازهٔ مشاهدهٔ درخواست‌ها را ندارید.", "FORBIDDEN"));
    }
    let pending = query.status.as_deref() != Some("all");
    let sql = if pending {
        "SELECT r.id, r.type, r.note, r.status, r.table_id, t.code AS table_code,
                t.name_fa AS table_name_fa, u.full_name AS handled_by_name,
                r.created_at, r.resolved_at
           FROM customer_requests r
           LEFT JOIN dining_tables t ON t.id = r.table_id
           LEFT JOIN users u ON u.id = r.handled_by_user_id
          WHERE r.status = 'pending'
          ORDER BY r.created_at DESC LIMIT 100"
    } else {
        "SELECT r.id, r.type, r.note, r.status, r.table_id, t.code AS table_code,
                t.name_fa AS table_name_fa, u.full_name AS handled_by_name,
                r.created_at, r.resolved_at
           FROM customer_requests r
           LEFT JOIN dining_tables t ON t.id = r.table_id
           LEFT JOIN users u ON u.id = r.handled_by_user_id
          ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
                   r.created_at DESC
          LIMIT 100"
    };
    let items = sqlx::query(sql)
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?
        .into_iter()
        .map(|row| {
            let kind: String = row.get("type");
            json!({
                "id": row.get::<String, _>("id"),
                "type": kind,
                "typeLabelFa": request_label(&kind),
                "note": row.get::<Option<String>, _>("note"),
                "status": row.get::<String, _>("status"),
                "tableId": row.get::<Option<String>, _>("table_id"),
                "tableCode": row.get::<Option<String>, _>("table_code"),
                "tableNameFa": row.get::<Option<String>, _>("table_name_fa"),
                "handledByName": row.get::<Option<String>, _>("handled_by_name"),
                "createdAt": row.get::<String, _>("created_at"),
                "resolvedAt": row.get::<Option<String>, _>("resolved_at"),
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({"items": items})))
}

pub async fn update_service(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "orders.write").await? {
        return Err(forbidden(
            "اجازهٔ رسیدگی به درخواست‌ها را ندارید.",
            "FORBIDDEN",
        ));
    }
    let input: ServiceStatusInput = serde_json::from_slice(&body)
        .map_err(|_| validation_failed("وضعیت درخواست نامعتبر است."))?;
    let status = input.status.trim();
    if !matches!(status, "accepted" | "done" | "cancelled") {
        return Err(validation_failed("وضعیت درخواست نامعتبر است."));
    }
    let request = sqlx::query("SELECT id, status, type FROM customer_requests WHERE id = $1")
        .bind(&id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?
        .ok_or_else(|| not_found("درخواست مشتری یافت نشد.", "REQUEST_NOT_FOUND"))?;
    let current: String = request.get("status");
    let kind: String = request.get("type");
    if matches!(current.as_str(), "done" | "cancelled") {
        return Err(conflict("این درخواست قبلاً بسته شده است.", "REQUEST_CLOSED"));
    }
    let now = cafeflow_db::now_iso_after_minutes(0);
    sqlx::query(
        "UPDATE customer_requests
            SET status = $1, handled_by_user_id = $2,
                resolved_at = CASE WHEN $1 IN ('done','cancelled') THEN $3 ELSE resolved_at END
          WHERE id = $4",
    )
    .bind(status)
    .bind(&session.user.id)
    .bind(&now)
    .bind(&id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    sqlx::query(
        "INSERT INTO audit_logs
           (id, actor_user_id, actor_username, action, entity_type, entity_id,
            before_json, after_json, created_at)
         VALUES ($1, $2, $3, $4, 'customer_request', $5, $6, $7, $8)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&session.user.id)
    .bind(&session.user.username)
    .bind(format!("customer_request.{status}"))
    .bind(&id)
    .bind(json!({"status": current, "type": kind}).to_string())
    .bind(json!({"status": status}).to_string())
    .bind(&now)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(Json(json!({"id": id, "status": status})))
}

pub async fn list_terminal(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<StatusQuery>,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "payments.read").await? {
        return Err(forbidden(
            "اجازهٔ مشاهدهٔ درخواست‌های کارت‌خوان را ندارید.",
            "FORBIDDEN",
        ));
    }
    let sql = if query.status.as_deref() == Some("all") {
        "SELECT tr.id, tr.status, tr.note, t.code AS table_code, t.name_fa AS table_name_fa,
                o.code AS order_code, tr.created_at, tr.completed_at
           FROM terminal_requests tr
           LEFT JOIN dining_tables t ON t.id = tr.table_id
           LEFT JOIN orders o ON o.id = tr.order_id
          ORDER BY tr.created_at DESC LIMIT 100"
    } else {
        "SELECT tr.id, tr.status, tr.note, t.code AS table_code, t.name_fa AS table_name_fa,
                o.code AS order_code, tr.created_at, tr.completed_at
           FROM terminal_requests tr
           LEFT JOIN dining_tables t ON t.id = tr.table_id
           LEFT JOIN orders o ON o.id = tr.order_id
          WHERE tr.status IN ('pending','assigned')
          ORDER BY tr.created_at DESC LIMIT 100"
    };
    let items = sqlx::query(sql)
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "status": row.get::<String, _>("status"),
                "note": row.get::<Option<String>, _>("note"),
                "tableCode": row.get::<Option<String>, _>("table_code"),
                "tableNameFa": row.get::<Option<String>, _>("table_name_fa"),
                "orderCode": row.get::<Option<String>, _>("order_code"),
                "createdAt": row.get::<String, _>("created_at"),
                "completedAt": row.get::<Option<String>, _>("completed_at"),
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({"items": items})))
}

pub async fn close_table(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    let can_layout = session_has_permission(&state, &session.user.id, "layout.write").await?;
    let can_pay = session_has_permission(&state, &session.user.id, "payments.create").await?;
    if !can_layout && !can_pay {
        return Err(forbidden(
            "برای بستن میز مجوز «layout.write» یا «payments.create» لازم است.",
            "PERMISSION_DENIED",
        ));
    }
    let table = sqlx::query(
        "SELECT t.id, t.code, t.status, s.id AS session_id
           FROM dining_tables t
           LEFT JOIN table_sessions s ON s.table_id = t.id AND s.status = 'open'
          WHERE t.id = $1 AND t.deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .ok_or_else(|| not_found("میز یافت نشد.", "TABLE_NOT_FOUND"))?;
    let session_id: Option<String> = table.get("session_id");
    let Some(session_id) = session_id else {
        return Err(conflict("این میز نشست باز ندارد.", "TABLE_NO_OPEN_SESSION"));
    };
    let orders = sqlx::query(
        "SELECT id, code, status, total, paid_total FROM orders
          WHERE table_session_id = $1 ORDER BY created_at ASC",
    )
    .bind(&session_id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let unpaid = orders
        .iter()
        .filter(|order| {
            !matches!(
                order.get::<String, _>("status").as_str(),
                "paid" | "cancelled"
            )
        })
        .count();
    if unpaid > 0 {
        return Err(conflict(
            format!("برای بستن میز ابتدا {unpaid} سفارش تسویه‌نشده را تسویه یا لغو کنید."),
            "TABLE_HAS_UNPAID_ORDERS",
        ));
    }
    let now = cafeflow_db::now_iso_after_minutes(0);
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "UPDATE table_sessions SET status = 'closed', closed_at = $1
          WHERE id = $2 AND status = 'open'",
    )
    .bind(&now)
    .bind(&session_id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    sqlx::query("UPDATE dining_tables SET status = 'available', updated_at = $1 WHERE id = $2")
        .bind(&now)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query(
        "INSERT INTO audit_logs
           (id, actor_user_id, actor_username, action, entity_type, entity_id,
            before_json, after_json, created_at)
         VALUES ($1, $2, $3, 'table.closed', 'dining_table', $4, $5, $6, $7)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&session.user.id)
    .bind(&session.user.username)
    .bind(&id)
    .bind(json!({"status": table.get::<String, _>("status"), "sessionId": session_id}).to_string())
    .bind(json!({"status": "available", "closedOrders": orders.len()}).to_string())
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    Ok(Json(json!({
        "tableId": id,
        "code": table.get::<String, _>("code"),
        "sessionId": session_id,
        "closedAt": now,
        "closedOrders": orders.len(),
    })))
}

fn request_label(kind: &str) -> &'static str {
    match kind {
        "waiter" => "درخواست گارسون",
        "water" => "درخواست آب",
        "tissues" => "درخواست دستمال",
        "bill" => "درخواست صورتحساب",
        "terminal" => "درخواست کارت‌خوان",
        "assistance" => "درخواست کمک",
        _ => "درخواست دیگر",
    }
}
