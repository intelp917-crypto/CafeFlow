//! Server-rendered receipt/proforma and department tickets. Jobs are queued
//! idempotently; a duplicate click can never create a second piece of paper.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use cafeflow_domain::format_jalali;
use cafeflow_domain::money::{DigitMode, format_rial};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::auth::{require_auth, session_has_permission};
use crate::error::{AppError, conflict, forbidden, not_found};
use crate::staff_orders::build_detail;
use crate::state::AppState;

const RECEIPT_STATUSES: [&str; 3] = ["served", "awaiting_payment", "paid"];
const PRINT_STATUSES: [&str; 5] = ["queued", "sent", "printed", "failed", "cancelled"];
const SEPARATOR: &str = "--------------------------------";

#[derive(Debug, Deserialize, Default)]
struct ReceiptInput {
    proforma: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
pub struct JobsQuery {
    status: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct FailedInput {
    error: Option<String>,
}

pub async fn list_jobs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<JobsQuery>,
) -> Result<Json<Value>, AppError> {
    authorize_print(&state, &headers).await?;
    let status = query.status.filter(|value| !value.is_empty());
    if let Some(status) = status.as_deref()
        && !PRINT_STATUSES.contains(&status)
    {
        return Err(crate::error::bad_request(
            "وضعیت کار چاپ نامعتبر است.",
            "INVALID_PRINT_STATUS",
        ));
    }

    let sql = if status.is_some() {
        "SELECT j.id, j.order_id, o.code AS order_code, j.kind, j.status, j.attempts,
                j.last_error, j.payload_json, j.created_at, j.printed_at
           FROM print_jobs j LEFT JOIN orders o ON o.id = j.order_id
          WHERE j.status = $1
          ORDER BY j.created_at ASC LIMIT 100"
    } else {
        "SELECT j.id, j.order_id, o.code AS order_code, j.kind, j.status, j.attempts,
                j.last_error, j.payload_json, j.created_at, j.printed_at
           FROM print_jobs j LEFT JOIN orders o ON o.id = j.order_id
          ORDER BY j.created_at ASC LIMIT 100"
    };
    let mut request = sqlx::query(sql);
    if let Some(status) = status.as_deref() {
        request = request.bind(status);
    }
    let rows = request
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?;
    Ok(Json(json!({
        "items": rows.iter().map(job_json).collect::<Vec<_>>()
    })))
}

pub async fn mark_sent(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    authorize_print(&state, &headers).await?;
    let job = find_job(&state, &id).await?;
    let status = job["status"].as_str().unwrap_or_default();
    if status == "sent" {
        return Ok(Json(job));
    }
    if status == "printed" {
        return Err(conflict(
            "این کار قبلاً چاپ شده است.",
            "PRINT_JOB_ALREADY_PRINTED",
        ));
    }
    if status == "cancelled" {
        return Err(conflict("این کار چاپ لغو شده است.", "PRINT_JOB_CLOSED"));
    }
    let result = sqlx::query(
        "UPDATE print_jobs SET status = 'sent', last_error = NULL
          WHERE id = $1 AND status = 'queued'",
    )
    .bind(&id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    if result.rows_affected() != 1 {
        return Err(conflict(
            "این کار دیگر در صف نیست؛ پل دیگری آن را برداشته است.",
            "PRINT_JOB_NOT_QUEUED",
        ));
    }
    Ok(Json(find_job(&state, &id).await?))
}

pub async fn mark_printed(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    authorize_print(&state, &headers).await?;
    find_job(&state, &id).await?;
    let now = cafeflow_db::now_iso_after_minutes(0);
    sqlx::query(
        "UPDATE print_jobs
            SET status = 'printed', last_error = NULL, attempts = attempts + 1,
                printed_at = $2
          WHERE id = $1",
    )
    .bind(&id)
    .bind(&now)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(Json(find_job(&state, &id).await?))
}

pub async fn mark_failed(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    authorize_print(&state, &headers).await?;
    find_job(&state, &id).await?;
    let input = serde_json::from_slice::<FailedInput>(&body).unwrap_or_default();
    let message = input
        .error
        .map(|value| value.trim().chars().take(200).collect::<String>())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown error".to_string());
    sqlx::query(
        "UPDATE print_jobs
            SET status = 'failed', last_error = $2, attempts = attempts + 1
          WHERE id = $1",
    )
    .bind(&id)
    .bind(&message)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(Json(find_job(&state, &id).await?))
}

async fn authorize_print(state: &AppState, headers: &HeaderMap) -> Result<(), AppError> {
    let session = require_auth(state, headers).await?;
    if !session_has_permission(state, &session.user.id, "orders.read").await? {
        return Err(forbidden("اجازهٔ مدیریت صف چاپ را ندارید.", "FORBIDDEN"));
    }
    Ok(())
}

async fn find_job(state: &AppState, id: &str) -> Result<Value, AppError> {
    let row = sqlx::query(
        "SELECT j.id, j.order_id, o.code AS order_code, j.kind, j.status, j.attempts,
                j.last_error, j.payload_json, j.created_at, j.printed_at
           FROM print_jobs j LEFT JOIN orders o ON o.id = j.order_id
          WHERE j.id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .ok_or_else(|| not_found("کار چاپ یافت نشد.", "PRINT_JOB_NOT_FOUND"))?;
    Ok(job_json(&row))
}

pub async fn queue_receipt(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Response, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "orders.read").await? {
        return Err(forbidden("اجازهٔ چاپ رسید را ندارید.", "FORBIDDEN"));
    }
    let input = if body.is_empty() {
        ReceiptInput::default()
    } else {
        serde_json::from_slice(&body).unwrap_or_default()
    };
    let order = build_detail(&state, &id).await?;
    let status = order["status"].as_str().unwrap_or_default();
    let proforma = input.proforma.unwrap_or(false);
    if proforma {
        if status == "cancelled" {
            return Err(conflict("سفارش لغو شده پیش‌فاکتور نمی‌گیرد.", "ORDER_CLOSED"));
        }
    } else if !RECEIPT_STATUSES.contains(&status) {
        return Err(conflict(
            "برای چاپ رسید، سفارش باید سرو شده یا تسویه شده باشد؛ برای پیش از سرو از پیش‌فاکتور استفاده کنید.",
            "RECEIPT_NOT_AVAILABLE",
        ));
    }

    let paid_total = order["paidTotal"].as_i64().unwrap_or(0);
    let total = order["total"].as_i64().unwrap_or(0);
    let dedupe_key = if proforma {
        format!("proforma:{id}:{total}")
    } else {
        format!("receipt:{id}:{paid_total}")
    };
    if let Some(job) = find_job_by_key(&state, &dedupe_key).await? {
        return Ok((
            StatusCode::CREATED,
            Json(json!({"job": job, "existed": true})),
        )
            .into_response());
    }

    let lines = build_receipt_lines(&state, &id, proforma).await?;
    let payload = json!({
        "lines": lines,
        "createdByUserId": session.user.id,
    });
    let job_id = Uuid::new_v4().to_string();
    let now = cafeflow_db::now_iso_after_minutes(0);
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "INSERT INTO print_jobs (id, order_id, kind, job_key, payload_json, status, attempts, created_at)
         VALUES ($1, $2, $3, $4, $5, 'queued', 0, $6)",
    )
    .bind(&job_id)
    .bind(&id)
    .bind(if proforma { "proforma" } else { "receipt" })
    .bind(&dedupe_key)
    .bind(payload.to_string())
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    let job = find_job_by_id(&mut tx, &job_id).await?;
    tx.commit().await.map_err(db_error)?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"job": job, "existed": false})),
    )
        .into_response())
}

pub async fn queue_tickets(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "orders.read").await? {
        return Err(forbidden("اجازهٔ چاپ بلیت را ندارید.", "FORBIDDEN"));
    }
    let order = build_detail(&state, &id).await?;
    if order["status"] == "cancelled" {
        return Err(conflict("سفارش لغو شده بلیت چاپ نمی‌خواهد.", "ORDER_CLOSED"));
    }
    let restaurant = restaurant_name(&state).await?;
    let items = order["items"].as_array().cloned().unwrap_or_default();
    let mut groups: Vec<TicketGroup> = Vec::new();
    for item in items {
        if item["itemStatus"] == "cancelled" {
            continue;
        }
        let kind = item["departmentKind"]
            .as_str()
            .unwrap_or("other")
            .to_string();
        let label = item["departmentNameFa"]
            .as_str()
            .unwrap_or("بدون واحد")
            .to_string();
        if let Some(group) = groups
            .iter_mut()
            .find(|group| group.kind == kind && group.label == label)
        {
            group.items.push(item);
        } else {
            groups.push(TicketGroup {
                kind,
                label,
                items: vec![item],
            });
        }
    }

    let now = cafeflow_db::now_iso_after_minutes(0);
    let mut jobs = Vec::new();
    let mut created = 0;
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    for group in groups {
        let quantity: i64 = group
            .items
            .iter()
            .map(|item| item["quantity"].as_i64().unwrap_or(0))
            .sum();
        let dedupe_key = format!("ticket:{id}:{}|{}:{quantity}", group.kind, group.label);
        if let Some(job) = find_job_by_key_tx(&mut tx, &dedupe_key).await? {
            jobs.push(job);
            continue;
        }
        let lines = build_ticket_lines(&order, &restaurant, &group, quantity);
        let payload = json!({
            "lines": lines,
            "createdByUserId": session.user.id,
        });
        let job_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO print_jobs (id, order_id, kind, job_key, payload_json, status, attempts, created_at)
             VALUES ($1, $2, $3, $4, $5, 'queued', 0, $6)",
        )
        .bind(&job_id)
        .bind(&id)
        .bind(&group.kind)
        .bind(&dedupe_key)
        .bind(payload.to_string())
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        jobs.push(find_job_by_id(&mut tx, &job_id).await?);
        created += 1;
    }
    tx.commit().await.map_err(db_error)?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"jobs": jobs, "created": created})),
    )
        .into_response())
}

struct TicketGroup {
    kind: String,
    label: String,
    items: Vec<Value>,
}

async fn build_receipt_lines(
    state: &AppState,
    id: &str,
    proforma: bool,
) -> Result<Vec<String>, AppError> {
    let order = build_detail(state, id).await?;
    let restaurant = restaurant_name(state).await?;
    let mut lines = vec![
        restaurant,
        if proforma {
            "پیش‌فاکتور".to_string()
        } else {
            "رسید فروش".to_string()
        },
        String::new(),
        format!(
            "شماره سفارش: {}",
            order["code"].as_str().unwrap_or_default()
        ),
        format!(
            "میز: {}",
            order["tableNameFa"].as_str().unwrap_or("بدون میز")
        ),
        format!(
            "تاریخ: {}",
            format_date(order["createdAt"].as_str().unwrap_or_default())
        ),
        SEPARATOR.to_string(),
    ];
    for item in order["items"].as_array().cloned().unwrap_or_default() {
        let amount = item["total"].as_i64().unwrap_or(0);
        lines.push(format!(
            "{} × {} — {} ریال",
            item["productNameFa"].as_str().unwrap_or_default(),
            item["quantity"].as_i64().unwrap_or(0),
            money(amount),
        ));
        push_item_details(&mut lines, &item);
    }
    lines.push(SEPARATOR.to_string());
    lines.push(format!(
        "جمع اقلام: {} ریال",
        money(order["subtotal"].as_i64().unwrap_or(0))
    ));
    let discount = order["discountTotal"].as_i64().unwrap_or(0);
    if discount > 0 {
        lines.push(format!("تخفیف: -{} ریال", money(discount)));
    }
    let service = order["serviceCharge"].as_i64().unwrap_or(0);
    if service > 0 {
        lines.push(format!("حق سرویس: {} ریال", money(service)));
    }
    let tax = order["taxTotal"].as_i64().unwrap_or(0);
    if tax > 0 {
        lines.push(format!("مالیات: {} ریال", money(tax)));
    }
    lines.push(format!(
        "مبلغ کل: {} ریال",
        money(order["total"].as_i64().unwrap_or(0))
    ));
    lines.push(format!(
        "پرداخت‌شده: {} ریال",
        money(order["paidTotal"].as_i64().unwrap_or(0))
    ));
    let payments = order["payments"].as_array().cloned().unwrap_or_default();
    let confirmed = payments
        .iter()
        .filter(|payment| payment["status"] == "confirmed")
        .collect::<Vec<_>>();
    if !confirmed.is_empty() {
        lines.push("پرداخت‌ها:".to_string());
        for payment in confirmed {
            lines.push(format!(
                "  {}: {} ریال",
                payment["methodLabelFa"].as_str().unwrap_or_default(),
                money(payment["amount"].as_i64().unwrap_or(0))
            ));
        }
    }
    lines.push(String::new());
    lines.push(
        if proforma {
            "این پیش‌فاکتور است و رسید نهایی نیست."
        } else {
            "از انتخاب شما سپاسگزاریم."
        }
        .to_string(),
    );
    Ok(lines)
}

fn build_ticket_lines(
    order: &Value,
    restaurant: &str,
    group: &TicketGroup,
    quantity: i64,
) -> Vec<String> {
    let mut lines = vec![
        restaurant.to_string(),
        format!("بلیت {}", group.label),
        String::new(),
        format!("سفارش: {}", order["code"].as_str().unwrap_or_default()),
        format!(
            "میز: {}",
            order["tableNameFa"].as_str().unwrap_or("بدون میز")
        ),
        format!(
            "تاریخ: {}",
            format_date(order["createdAt"].as_str().unwrap_or_default())
        ),
        SEPARATOR.to_string(),
    ];
    for item in &group.items {
        lines.push(format!(
            "{} × {}",
            item["quantity"].as_i64().unwrap_or(0),
            item["productNameFa"].as_str().unwrap_or_default()
        ));
        push_item_details(&mut lines, item);
    }
    lines.push(SEPARATOR.to_string());
    lines.push(format!("جمع: {} قلم", persian_number(quantity)));
    lines
}

fn push_item_details(lines: &mut Vec<String>, item: &Value) {
    let options = names(item["options"].as_array());
    if !options.is_empty() {
        lines.push(format!("  گزینه: {}", options.join("، ")));
    }
    let extras = names(item["extras"].as_array());
    if !extras.is_empty() {
        lines.push(format!("  افزودنی: {}", extras.join("، ")));
    }
    if let Some(note) = item["note"].as_str().filter(|value| !value.is_empty()) {
        lines.push(format!("  یادداشت: {note}"));
    }
}

fn names(values: Option<&Vec<Value>>) -> Vec<String> {
    values
        .into_iter()
        .flatten()
        .filter_map(|value| value.as_str().map(str::to_owned))
        .collect()
}

async fn restaurant_name(state: &AppState) -> Result<String, AppError> {
    let row = sqlx::query("SELECT restaurant_name_fa FROM settings WHERE id = 'singleton'")
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    Ok(row
        .map(|row| row.get::<String, _>("restaurant_name_fa"))
        .unwrap_or_else(|| "کافه‌فلو".to_string()))
}

async fn find_job_by_key(state: &AppState, key: &str) -> Result<Option<Value>, AppError> {
    let row = sqlx::query(
        "SELECT j.id, j.order_id, o.code AS order_code, j.kind, j.status, j.attempts,
                j.last_error, j.payload_json, j.created_at, j.printed_at
           FROM print_jobs j LEFT JOIN orders o ON o.id = j.order_id
          WHERE j.job_key = $1",
    )
    .bind(key)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(row.map(|row| job_json(&row)))
}

async fn find_job_by_key_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    key: &str,
) -> Result<Option<Value>, AppError> {
    let row = sqlx::query(
        "SELECT j.id, j.order_id, o.code AS order_code, j.kind, j.status, j.attempts,
                j.last_error, j.payload_json, j.created_at, j.printed_at
           FROM print_jobs j LEFT JOIN orders o ON o.id = j.order_id
          WHERE j.job_key = $1",
    )
    .bind(key)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(row.map(|row| job_json(&row)))
}

async fn find_job_by_id(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    id: &str,
) -> Result<Value, AppError> {
    let row = sqlx::query(
        "SELECT j.id, j.order_id, o.code AS order_code, j.kind, j.status, j.attempts,
                j.last_error, j.payload_json, j.created_at, j.printed_at
           FROM print_jobs j LEFT JOIN orders o ON o.id = j.order_id
          WHERE j.id = $1",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db_error)?
    .ok_or_else(|| not_found("کار چاپ ساخته نشد.", "PRINT_JOB_NOT_FOUND"))?;
    Ok(job_json(&row))
}

fn job_json(row: &sqlx::any::AnyRow) -> Value {
    let receipt = row
        .get::<Option<String>, _>("payload_json")
        .and_then(|payload| serde_json::from_str::<Value>(&payload).ok())
        .and_then(|payload| payload["lines"].as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|line| line.as_str().map(str::to_owned))
        .collect::<Vec<_>>();
    json!({
        "id": row.get::<String, _>("id"),
        "orderId": row.get::<Option<String>, _>("order_id"),
        "orderCode": row.get::<Option<String>, _>("order_code"),
        "kind": row.get::<String, _>("kind"),
        "status": row.get::<String, _>("status"),
        "attempts": row.get::<i64, _>("attempts"),
        "error": row.get::<Option<String>, _>("last_error"),
        "createdAt": row.get::<String, _>("created_at"),
        "printedAt": row.get::<Option<String>, _>("printed_at"),
        "receipt": receipt,
    })
}

fn format_date(value: &str) -> String {
    OffsetDateTime::parse(value, &Rfc3339)
        .ok()
        .and_then(|moment| format_jalali(moment, true, false, true).ok())
        .unwrap_or_else(|| value.to_string())
}

fn money(value: i64) -> String {
    format_rial(value, DigitMode::Fa, None).unwrap_or_else(|_| value.to_string())
}

fn persian_number(value: i64) -> String {
    cafeflow_domain::money::to_persian_digits(&value.to_string())
}

fn db_error(error: sqlx::Error) -> AppError {
    tracing::error!("print job database error: {error}");
    AppError::internal("خطای پایگاه داده رخ داد.")
}
