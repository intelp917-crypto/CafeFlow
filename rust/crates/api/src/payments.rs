//! Bills, payments, splits, discounts and refunds. Every amount is derived
//! from order snapshots on the server; the `paid` status is never trusted from
//! a client and only follows confirmed payments.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use cafeflow_domain::OrderStatus;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::{require_auth, session_has_permission};
use crate::error::{AppError, bad_request, conflict, forbidden, not_found, validation_failed};
use crate::state::AppState;

const PAYABLE: [&str; 2] = ["served", "awaiting_payment"];
const METHODS: [&str; 5] = ["cash", "card", "online", "wallet", "other"];
const LARGE_DISCOUNT_PERCENT: f64 = 20.0;
const MAX_AMOUNT: i64 = 10_000_000_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaymentInput {
    method: String,
    amount: i64,
    reference: Option<String>,
    split_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SplitInput {
    parts: i64,
}

#[derive(Debug, Deserialize)]
struct CustomSplitInput {
    splits: Vec<ShareInput>,
}

#[derive(Debug, Deserialize)]
struct ShareInput {
    label: Option<String>,
    amount: i64,
}

#[derive(Debug, Deserialize)]
struct DiscountInput {
    amount: Option<i64>,
    percent: Option<f64>,
    reason: String,
}

#[derive(Debug, Deserialize)]
struct RefundInput {
    amount: i64,
    reason: String,
    method: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalInput {
    order_id: Option<String>,
    method: Option<String>,
    amount: Option<i64>,
}

#[derive(Debug, Clone)]
struct OrderRow {
    id: String,
    code: String,
    status: OrderStatus,
    total: i64,
    subtotal: i64,
    discount_total: i64,
    service_charge: i64,
    tax_total: i64,
    session_id: Option<String>,
}

pub async fn summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "payments.read").await? {
        return Err(forbidden("اجازهٔ مشاهدهٔ پرداخت‌ها را ندارید.", "FORBIDDEN"));
    }
    Ok(Json(summary_json(&state, &id).await?))
}

pub async fn record(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "payments.create").await? {
        return Err(forbidden("اجازهٔ ثبت پرداخت را ندارید.", "FORBIDDEN"));
    }
    let input: PaymentInput = serde_json::from_slice(&body)
        .map_err(|_| validation_failed("اطلاعات پرداخت معتبر نیست."))?;
    validate_payment_input(&input)?;

    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    apply_payment(&mut tx, &id, &input, &session.user.id).await?;
    tx.commit().await.map_err(db_error)?;
    Ok((StatusCode::CREATED, Json(summary_json(&state, &id).await?)))
}

pub async fn split(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "payments.create").await? {
        return Err(forbidden("اجازهٔ تقسیم فاکتور را ندارید.", "FORBIDDEN"));
    }
    let input: SplitInput =
        serde_json::from_slice(&body).map_err(|_| validation_failed("تعداد سهم‌ها معتبر نیست."))?;
    if !(2..=20).contains(&input.parts) {
        return Err(bad_request(
            "تقسیم فاکتور باید بین ۲ تا ۲۰ سهم باشد.",
            "SPLIT_PARTS_INVALID",
        ));
    }

    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    let order = find_order(&mut tx, &id).await?;
    ensure_split_allowed(&mut tx, &order).await?;
    if order.total < input.parts {
        return Err(bad_request(
            "هر سهم باید دست‌کم ۱ ریال باشد.",
            "SPLIT_TOO_SMALL",
        ));
    }
    let base = order.total / input.parts;
    let remainder = order.total - base * input.parts;
    let shares = (0..input.parts)
        .map(|index| Share {
            label: format!("سهم {}", fa_number(index + 1)),
            amount: base + if index < remainder { 1 } else { 0 },
        })
        .collect::<Vec<_>>();
    let bill_id = ensure_bill(&mut tx, &order).await?;
    replace_splits(&mut tx, &bill_id, &shares).await?;
    insert_event(
        &mut tx,
        &id,
        "order.split_created",
        &session.user.id,
        json!({"parts": input.parts, "total": order.total}),
    )
    .await?;
    audit(
        &mut tx,
        &session,
        "order.split_created",
        "order",
        Some(&id),
        None,
        json!({"parts": input.parts, "total": order.total, "code": order.code}),
    )
    .await?;
    tx.commit().await.map_err(db_error)?;
    Ok((StatusCode::CREATED, Json(summary_json(&state, &id).await?)))
}

pub async fn split_custom(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "payments.create").await? {
        return Err(forbidden("اجازهٔ تقسیم فاکتور را ندارید.", "FORBIDDEN"));
    }
    let input: CustomSplitInput = serde_json::from_slice(&body)
        .map_err(|_| validation_failed("سهم‌های فاکتور معتبر نیستند."))?;
    if !(2..=20).contains(&input.splits.len()) {
        return Err(bad_request(
            "تقسیم فاکتور باید بین ۲ تا ۲۰ سهم باشد.",
            "SPLIT_PARTS_INVALID",
        ));
    }
    let mut shares = Vec::with_capacity(input.splits.len());
    for (index, share) in input.splits.iter().enumerate() {
        if !(1..=MAX_AMOUNT).contains(&share.amount) {
            return Err(bad_request(
                "مبلغ هر سهم باید بیشتر از صفر باشد.",
                "SPLIT_AMOUNT_INVALID",
            ));
        }
        let label = share
            .label
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("سهم {}", fa_number(index as i64 + 1)));
        if label.chars().count() > 40 {
            return Err(bad_request(
                "برچسب سهم بیش از حد طولانی است.",
                "SPLIT_LABEL_TOO_LONG",
            ));
        }
        shares.push(Share {
            label,
            amount: share.amount,
        });
    }
    for (index, share) in shares.iter().enumerate() {
        if shares[..index]
            .iter()
            .any(|other| other.label == share.label)
        {
            return Err(bad_request(
                format!("برچسب «{}» دو بار استفاده شده است.", share.label),
                "SPLIT_LABEL_DUPLICATE",
            ));
        }
    }
    let sum = shares.iter().map(|share| share.amount).sum::<i64>();

    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    let order = find_order(&mut tx, &id).await?;
    ensure_split_allowed(&mut tx, &order).await?;
    if sum != order.total {
        return Err(bad_request(
            format!(
                "جمع سهم‌ها ({sum} ریال) باید دقیقاً برابر مبلغ فاکتور ({} ریال) باشد.",
                order.total
            ),
            "SPLIT_TOTAL_MISMATCH",
        ));
    }
    let bill_id = ensure_bill(&mut tx, &order).await?;
    replace_splits(&mut tx, &bill_id, &shares).await?;
    insert_event(
        &mut tx,
        &id,
        "order.split_created",
        &session.user.id,
        json!({"mode": "custom", "shares": shares, "total": order.total}),
    )
    .await?;
    audit(
        &mut tx,
        &session,
        "order.split_created",
        "order",
        Some(&id),
        None,
        json!({"mode": "custom", "shares": shares, "total": order.total, "code": order.code}),
    )
    .await?;
    tx.commit().await.map_err(db_error)?;
    Ok(Json(summary_json(&state, &id).await?))
}

pub async fn clear_splits(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "payments.create").await? {
        return Err(forbidden("اجازهٔ لغو تقسیم فاکتور را ندارید.", "FORBIDDEN"));
    }
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    let order = find_order(&mut tx, &id).await?;
    if net_paid(&mut tx, &id).await? > 0 {
        return Err(conflict(
            "پس از ثبت پرداخت تقسیم فاکتور قابل لغو نیست.",
            "SPLITS_AFTER_PAYMENT",
        ));
    }
    let result = sqlx::query(
        "DELETE FROM bill_splits
          WHERE bill_id IN (SELECT id FROM bills WHERE order_id = $1 AND status = 'open')",
    )
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    if result.rows_affected() == 0 {
        return Err(not_found(
            "تقسیمی برای این سفارش ثبت نشده است.",
            "SPLITS_NOT_FOUND",
        ));
    }
    insert_event(
        &mut tx,
        &id,
        "order.split_cleared",
        &session.user.id,
        Value::Null,
    )
    .await?;
    audit(
        &mut tx,
        &session,
        "order.split_cleared",
        "order",
        Some(&id),
        None,
        json!({"code": order.code}),
    )
    .await?;
    tx.commit().await.map_err(db_error)?;
    Ok(Json(summary_json(&state, &id).await?))
}

pub async fn discount(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "orders.discount").await? {
        return Err(forbidden("اجازهٔ اعمال تخفیف را ندارید.", "FORBIDDEN"));
    }
    let input: DiscountInput =
        serde_json::from_slice(&body).map_err(|_| validation_failed("اطلاعات تخفیف معتبر نیست."))?;
    if input.amount.is_some() == input.percent.is_some() {
        return Err(bad_request(
            "دقیقاً یکی از مبلغ یا درصد تخفیف را بفرستید.",
            "DISCOUNT_MODE_INVALID",
        ));
    }
    if input.reason.trim().chars().count() < 3 {
        return Err(bad_request(
            "دلیل تخفیف الزامی است.",
            "DISCOUNT_REASON_REQUIRED",
        ));
    }
    if input.reason.chars().count() > 200 {
        return Err(bad_request(
            "دلیل تخفیف بیش از حد طولانی است.",
            "DISCOUNT_REASON_TOO_LONG",
        ));
    }

    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    let order = find_order(&mut tx, &id).await?;
    if matches!(order.status, OrderStatus::Paid | OrderStatus::Cancelled) {
        return Err(conflict(
            "این سفارش بسته شده است و تخفیف نمی‌پذیرد.",
            "ORDER_CLOSED",
        ));
    }
    if net_paid(&mut tx, &id).await? > 0 {
        return Err(conflict(
            "پس از ثبت پرداخت امکان اعمال تخفیف نیست؛ ابتدا بازپرداخت کنید.",
            "DISCOUNT_AFTER_PAYMENT",
        ));
    }
    if has_open_splits(&mut tx, &id).await? {
        return Err(conflict(
            "فاکتور تقسیم شده است؛ ابتدا تقسیم را لغو کنید.",
            "SPLITS_EXIST",
        ));
    }
    let requested = match (input.amount, input.percent) {
        (Some(amount), None) => amount,
        (None, Some(percent)) => {
            if !(0.0..=100.0).contains(&percent) {
                return Err(bad_request(
                    "درصد تخفیف باید بین ۰ تا ۱۰۰ باشد.",
                    "DISCOUNT_PERCENT_INVALID",
                ));
            }
            ((order.subtotal as f64) * percent / 100.0).round() as i64
        }
        _ => unreachable!(),
    };
    if requested < 0 {
        return Err(bad_request(
            "مبلغ تخفیف نمی‌تواند منفی باشد.",
            "DISCOUNT_INVALID",
        ));
    }
    if requested > order.subtotal {
        return Err(bad_request(
            "تخفیف نمی‌تواند از جمع اقلام بیشتر باشد.",
            "DISCOUNT_EXCEEDS_SUBTOTAL",
        ));
    }
    let share = if order.subtotal > 0 {
        (requested as f64 / order.subtotal as f64) * 100.0
    } else {
        0.0
    };
    if share > LARGE_DISCOUNT_PERCENT
        && !session_has_permission(&state, &session.user.id, "approvals.decide").await?
    {
        return Err(forbidden(
            "تخفیف بیش از ۲۰٪ نیازمند تأیید مدیر است.",
            "APPROVAL_REQUIRED",
        ));
    }
    let total = (order.subtotal - requested).max(0) + order.service_charge + order.tax_total;
    let now = cafeflow_db::now_iso_after_minutes(0);
    sqlx::query("UPDATE orders SET discount_total = $1, total = $2, updated_at = $3 WHERE id = $4")
        .bind(requested)
        .bind(total)
        .bind(&now)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("UPDATE bills SET total = $1 WHERE order_id = $2 AND status = 'open'")
        .bind(total)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    insert_event(
        &mut tx,
        &id,
        "order.discount_applied",
        &session.user.id,
        json!({
            "discount": requested,
            "total": total,
            "percent": share.round() as i64,
            "reason": input.reason.trim()
        }),
    )
    .await?;
    audit(
        &mut tx,
        &session,
        "order.discount_applied",
        "order",
        Some(&id),
        Some(json!({"discount": order.discount_total, "total": order.total})),
        json!({"discount": requested, "total": total, "code": order.code}),
    )
    .await?;
    tx.commit().await.map_err(db_error)?;
    Ok(Json(summary_json(&state, &id).await?))
}

pub async fn refund(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "payments.refund").await? {
        return Err(forbidden("اجازهٔ بازپرداخت را ندارید.", "FORBIDDEN"));
    }
    let input: RefundInput = serde_json::from_slice(&body)
        .map_err(|_| validation_failed("اطلاعات بازپرداخت معتبر نیست."))?;
    if input.amount < 1 || input.amount > MAX_AMOUNT {
        return Err(bad_request(
            "مبلغ بازپرداخت باید بیشتر از صفر باشد.",
            "REFUND_AMOUNT_INVALID",
        ));
    }
    if input.reason.trim().chars().count() < 3 {
        return Err(bad_request(
            "دلیل بازپرداخت را بنویسید (حداقل ۳ نویسه).",
            "REFUND_REASON_REQUIRED",
        ));
    }
    if input.reason.chars().count() > 200 {
        return Err(bad_request(
            "دلیل بازپرداخت بیش از حد طولانی است.",
            "REFUND_REASON_TOO_LONG",
        ));
    }
    let method = input.method.as_deref().unwrap_or("cash");
    if !METHODS.contains(&method) {
        return Err(validation_failed("روش پرداخت نامعتبر است."));
    }

    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    let order = find_order(&mut tx, &id).await?;
    if order.status != OrderStatus::Paid {
        return Err(conflict(
            "بازپرداخت فقط برای سفارش تسویه‌شده امکان‌پذیر است.",
            "ORDER_NOT_PAID",
        ));
    }
    let net = net_paid(&mut tx, &id).await?;
    if input.amount > net {
        return Err(bad_request(
            format!("مبلغ بازپرداخت از مبلغ پرداخت‌شده ({net} ریال) بیشتر است."),
            "REFUND_EXCEEDS_PAID",
        ));
    }
    let bill = latest_bill(&mut tx, &id).await?;
    let bill_id = bill.as_ref().map(|row| row.0.clone());
    let register = cash_register_for(&mut tx, &session.user.id).await?;
    let refund_id = Uuid::new_v4().to_string();
    let now = cafeflow_db::now_iso_after_minutes(0);
    let reference = format!("refund:{}", truncate(&input.reason, 60));
    sqlx::query(
        "INSERT INTO payments
           (id, bill_id, order_id, method, amount, status, received_by_user_id,
            cash_register_id, reference, paid_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 'refunded', $6, $7, $8, $9, $9)",
    )
    .bind(&refund_id)
    .bind(&bill_id)
    .bind(&id)
    .bind(method)
    .bind(input.amount)
    .bind(&session.user.id)
    .bind(&register)
    .bind(&reference)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;

    let paid_after = net_paid(&mut tx, &id).await?;
    sqlx::query("UPDATE orders SET paid_total = $1, updated_at = $2 WHERE id = $3")
        .bind(paid_after)
        .bind(&now)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    if let Some((bill_id, _, _, settled_at)) = &bill {
        sqlx::query("UPDATE bills SET paid_total = $1, settled_at = $2 WHERE id = $3")
            .bind(paid_after)
            .bind(settled_at)
            .bind(bill_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }
    insert_event(
        &mut tx,
        &id,
        "payment.refunded",
        &session.user.id,
        json!({"amount": input.amount, "reason": input.reason.trim(), "refundId": refund_id}),
    )
    .await?;
    audit(
        &mut tx,
        &session,
        "payment.refunded",
        "order",
        Some(&id),
        Some(json!({"paidTotal": net})),
        json!({"paidTotal": paid_after, "refundId": refund_id, "code": order.code}),
    )
    .await?;
    tx.commit().await.map_err(db_error)?;
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "refundId": refund_id,
            "amount": input.amount,
            "paidTotal": paid_after,
            "remaining": (order.total - paid_after).max(0),
            "status": order.status.as_str(),
        })),
    ))
}

pub async fn complete_terminal(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "payments.create").await? {
        return Err(forbidden("اجازهٔ تسویهٔ کارت‌خوان را ندارید.", "FORBIDDEN"));
    }
    let input: TerminalInput = if body.is_empty() {
        TerminalInput::default()
    } else {
        serde_json::from_slice(&body)
            .map_err(|_| validation_failed("اطلاعات کارت‌خوان معتبر نیست."))?
    };
    let method = input.method.as_deref().unwrap_or("card");
    if !METHODS.contains(&method) {
        return Err(validation_failed("روش پرداخت نامعتبر است."));
    }
    if let Some(amount) = input.amount
        && !(1..=MAX_AMOUNT).contains(&amount)
    {
        return Err(bad_request(
            "مبلغ پرداخت معتبر نیست.",
            "PAYMENT_AMOUNT_INVALID",
        ));
    }

    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    let request =
        sqlx::query("SELECT status, order_id, table_id FROM terminal_requests WHERE id = $1")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?
            .ok_or_else(|| not_found("درخواست کارت‌خوان یافت نشد.", "TERMINAL_REQUEST_NOT_FOUND"))?;
    let request_status: String = request.get("status");
    if matches!(request_status.as_str(), "completed" | "cancelled") {
        return Err(conflict("این درخواست قبلاً بسته شده است.", "REQUEST_CLOSED"));
    }
    let request_order: Option<String> = request.get("order_id");
    let table_id: Option<String> = request.get("table_id");
    let mut target = input
        .order_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or(request_order);
    if target.is_none()
        && let Some(table_id) = table_id.as_deref()
    {
        let row = sqlx::query(
            "SELECT id FROM orders
              WHERE table_id = $1 AND status NOT IN ('paid','cancelled')
              ORDER BY created_at ASC LIMIT 1",
        )
        .bind(table_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        target = row.map(|row| row.get("id"));
    }

    let mut result_order = Value::Null;
    let mut result_payment = Value::Null;
    if let Some(order_id) = target.as_deref() {
        let order = find_order(&mut tx, order_id).await?;
        let net = net_paid(&mut tx, order_id).await?;
        let remaining = (order.total - net).max(0);
        if remaining > 0 {
            let amount = input.amount.unwrap_or(remaining);
            apply_payment(
                &mut tx,
                order_id,
                &PaymentInput {
                    method: method.to_string(),
                    amount,
                    reference: None,
                    split_id: None,
                },
                &session.user.id,
            )
            .await?;
        }
        let after = find_order(&mut tx, order_id).await?;
        let after_paid = net_paid(&mut tx, order_id).await?;
        let payment = latest_payment(&mut tx, order_id).await?;
        result_payment = payment.unwrap_or(Value::Null);
        result_order = json!({
            "id": after.id,
            "code": after.code,
            "status": after.status.as_str(),
            "total": after.total,
            "paidTotal": after_paid,
            "remaining": (after.total - after_paid).max(0),
        });
    }
    let now = cafeflow_db::now_iso_after_minutes(0);
    sqlx::query(
        "UPDATE terminal_requests
            SET status = 'completed', completed_at = $1, order_id = COALESCE($2, order_id)
          WHERE id = $3 AND status IN ('pending','assigned')",
    )
    .bind(&now)
    .bind(target.as_deref())
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    audit(
        &mut tx,
        &session,
        "terminal_request.completed",
        "terminal_request",
        Some(&id),
        None,
        json!({"orderId": target, "requestId": id}),
    )
    .await?;
    tx.commit().await.map_err(db_error)?;
    Ok(Json(json!({
        "request": {"id": id, "status": "completed"},
        "order": result_order,
        "payment": result_payment,
    })))
}

/* ------------------------------- internals ------------------------------- */

fn validate_payment_input(input: &PaymentInput) -> Result<(), AppError> {
    if !METHODS.contains(&input.method.as_str()) {
        return Err(validation_failed("روش پرداخت نامعتبر است."));
    }
    if input.amount < 1 {
        return Err(bad_request(
            "مبلغ پرداخت باید بیشتر از صفر باشد.",
            "PAYMENT_AMOUNT_INVALID",
        ));
    }
    if input.amount > MAX_AMOUNT {
        return Err(bad_request(
            "مبلغ بیش از حد مجاز است.",
            "PAYMENT_AMOUNT_INVALID",
        ));
    }
    if input
        .reference
        .as_ref()
        .is_some_and(|value| value.chars().count() > 80)
    {
        return Err(bad_request(
            "شماره پیگیری بیش از حد طولانی است.",
            "PAYMENT_REFERENCE_TOO_LONG",
        ));
    }
    if input
        .split_id
        .as_ref()
        .is_some_and(|value| value.chars().count() > 64)
    {
        return Err(bad_request("شناسهٔ سهم معتبر نیست.", "SPLIT_NOT_FOUND"));
    }
    Ok(())
}

async fn apply_payment(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    order_id: &str,
    input: &PaymentInput,
    actor_id: &str,
) -> Result<(), AppError> {
    validate_payment_input(input)?;
    let order = find_order(tx, order_id).await?;
    if order.status == OrderStatus::Paid {
        return Err(conflict(
            "این سفارش قبلاً تسویه شده است.",
            "ORDER_ALREADY_PAID",
        ));
    }
    if order.status == OrderStatus::Cancelled {
        return Err(conflict(
            "سفارش لغو شده است و پرداخت نمی‌پذیرد.",
            "ORDER_CLOSED",
        ));
    }
    if !PAYABLE.contains(&order.status.as_str()) {
        return Err(conflict(
            format!(
                "سفارش در وضعیت «{}» قابل تسویه نیست؛ ابتدا آن را سرو کنید.",
                order.status.label_fa()
            ),
            "ORDER_NOT_PAYABLE",
        ));
    }
    let paid_before = net_paid(tx, order_id).await?;
    let remaining = (order.total - paid_before).max(0);
    if remaining == 0 {
        return Err(conflict(
            "مانده‌ای برای پرداخت وجود ندارد.",
            "ORDER_ALREADY_PAID",
        ));
    }
    if input.amount > remaining {
        return Err(bad_request(
            format!("مبلغ پرداخت از باقیمانده ({remaining} ریال) بیشتر است."),
            "PAYMENT_EXCEEDS_REMAINING",
        ));
    }

    let bill_id = ensure_bill(tx, &order).await?;
    let split = if let Some(split_id) = input.split_id.as_deref() {
        let row = sqlx::query(
            "SELECT s.id, s.bill_id, s.label, s.amount, s.is_paid
               FROM bill_splits s JOIN bills b ON b.id = s.bill_id
              WHERE s.id = $1 AND b.order_id = $2
              ORDER BY b.created_at DESC LIMIT 1",
        )
        .bind(split_id)
        .bind(order_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db_error)?;
        let Some(row) = row else {
            return Err(bad_request(
                "سهم انتخاب‌شده متعلق به این فاکتور نیست.",
                "SPLIT_NOT_FOUND",
            ));
        };
        let split_bill: String = row.get("bill_id");
        if split_bill != bill_id {
            return Err(bad_request(
                "سهم انتخاب‌شده متعلق به این فاکتور نیست.",
                "SPLIT_NOT_FOUND",
            ));
        }
        if row.get::<i64, _>("is_paid") == 1 {
            return Err(conflict(
                "این سهم قبلاً پرداخت شده است.",
                "SPLIT_ALREADY_PAID",
            ));
        }
        let split_amount: i64 = row.get("amount");
        if input.amount != split_amount {
            return Err(bad_request(
                format!(
                    "مبلغ پرداخت باید دقیقاً برابر سهم «{}» ({} ریال) باشد.",
                    row.get::<String, _>("label"),
                    split_amount
                ),
                "SPLIT_AMOUNT_MISMATCH",
            ));
        }
        Some(row.get::<String, _>("id"))
    } else {
        None
    };

    let register = cash_register_for(tx, actor_id).await?;
    let now = cafeflow_db::now_iso_after_minutes(0);
    sqlx::query(
        "INSERT INTO payments
           (id, bill_id, order_id, method, amount, status, received_by_user_id,
            cash_register_id, bill_split_id, reference, paid_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7, $8, $9, $10, $10)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&bill_id)
    .bind(order_id)
    .bind(&input.method)
    .bind(input.amount)
    .bind(actor_id)
    .bind(&register)
    .bind(split.as_deref())
    .bind(
        input
            .reference
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .bind(&now)
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;

    let paid_total = net_paid(tx, order_id).await?;
    let settled = paid_total >= order.total;
    sqlx::query("UPDATE bills SET paid_total = $1, status = $2, settled_at = $3 WHERE id = $4")
        .bind(paid_total)
        .bind(if settled { "settled" } else { "open" })
        .bind(if settled { Some(now.as_str()) } else { None })
        .bind(&bill_id)
        .execute(&mut **tx)
        .await
        .map_err(db_error)?;
    if let Some(split_id) = split.as_deref() {
        sqlx::query("UPDATE bill_splits SET is_paid = 1 WHERE id = $1")
            .bind(split_id)
            .execute(&mut **tx)
            .await
            .map_err(db_error)?;
    } else {
        sync_splits(tx, &bill_id, paid_total).await?;
    }
    sqlx::query("UPDATE orders SET paid_total = $1, updated_at = $2 WHERE id = $3")
        .bind(paid_total)
        .bind(&now)
        .bind(order_id)
        .execute(&mut **tx)
        .await
        .map_err(db_error)?;

    let from = order.status;
    let target = if settled {
        OrderStatus::Paid
    } else {
        OrderStatus::AwaitingPayment
    };
    if target != from {
        sqlx::query(
            "UPDATE orders
                SET status = $1, updated_at = $2,
                    paid_at = CASE WHEN $1 = 'paid' THEN $2 ELSE paid_at END
              WHERE id = $3",
        )
        .bind(target.as_str())
        .bind(&now)
        .bind(order_id)
        .execute(&mut **tx)
        .await
        .map_err(db_error)?;
        sqlx::query(
            "INSERT INTO order_events
               (id, order_id, type, from_status, to_status, actor_user_id, created_at)
             VALUES ($1, $2, 'order.status_changed', $3, $4, $5, $6)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(order_id)
        .bind(from.as_str())
        .bind(target.as_str())
        .bind(actor_id)
        .bind(&now)
        .execute(&mut **tx)
        .await
        .map_err(db_error)?;
    }
    if target == OrderStatus::AwaitingPayment && from == OrderStatus::Served {
        if let Some(session_id) = order.session_id.as_deref() {
            sqlx::query(
                "UPDATE dining_tables SET status = 'waiting_payment', updated_at = $1
                  WHERE id = (SELECT table_id FROM table_sessions WHERE id = $2)",
            )
            .bind(&now)
            .bind(session_id)
            .execute(&mut **tx)
            .await
            .map_err(db_error)?;
        }
        sqlx::query(
            "INSERT INTO notifications (id, role_key, type, title_fa, body_fa, data_json)
             VALUES ($1, 'cashier', 'order.awaiting_payment', 'سفارش آماده تسویه است', $2, $3)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(format!("سفارش {} در انتظار پرداخت است.", order.code))
        .bind(json!({"orderId": order_id, "code": order.code}).to_string())
        .execute(&mut **tx)
        .await
        .map_err(db_error)?;
    }
    sqlx::query(
        "INSERT INTO audit_logs
           (id, actor_user_id, actor_username, action, entity_type, entity_id,
            before_json, after_json, created_at)
         VALUES ($1, $2, $3, $4, 'order', $5, $6, $7, $8)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(actor_id)
    .bind(
        sqlx::query("SELECT username FROM users WHERE id = $1")
            .bind(actor_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(db_error)?
            .get::<String, _>("username"),
    )
    .bind(if settled {
        "payment.settled"
    } else {
        "payment.recorded"
    })
    .bind(order_id)
    .bind(json!({"paidTotal": paid_before, "status": from.as_str()}).to_string())
    .bind(
        json!({
            "paidTotal": paid_total,
            "status": target.as_str(),
            "method": input.method,
            "amount": input.amount
        })
        .to_string(),
    )
    .bind(&now)
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(())
}

async fn ensure_split_allowed(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    order: &OrderRow,
) -> Result<(), AppError> {
    if matches!(order.status, OrderStatus::Paid | OrderStatus::Cancelled) {
        return Err(conflict(
            "این سفارش بسته شده است و تقسیم نمی‌پذیرد.",
            "ORDER_CLOSED",
        ));
    }
    if !PAYABLE.contains(&order.status.as_str()) {
        return Err(conflict(
            "سفارش هنوز قابل تسویه نیست؛ ابتدا آن را سرو کنید.",
            "ORDER_NOT_PAYABLE",
        ));
    }
    if net_paid(tx, &order.id).await? > 0 {
        return Err(conflict(
            "پس از ثبت پرداخت نمی‌توان فاکتور را دوباره تقسیم کرد.",
            "SPLITS_AFTER_PAYMENT",
        ));
    }
    Ok(())
}

async fn find_order(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    id: &str,
) -> Result<OrderRow, AppError> {
    let row = sqlx::query(
        "SELECT id, code, status, total, subtotal, discount_total, service_charge,
                tax_total, table_session_id
           FROM orders WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db_error)?
    .ok_or_else(|| not_found("سفارش یافت نشد.", "ORDER_NOT_FOUND"))?;
    let status: String = row.get("status");
    let status = OrderStatus::parse_status(&status)
        .ok_or_else(|| AppError::internal("وضعیت سفارش نامعتبر است."))?;
    Ok(OrderRow {
        id: row.get("id"),
        code: row.get("code"),
        status,
        total: row.get("total"),
        subtotal: row.get("subtotal"),
        discount_total: row.get("discount_total"),
        service_charge: row.get("service_charge"),
        tax_total: row.get("tax_total"),
        session_id: row.get("table_session_id"),
    })
}

async fn ensure_bill(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    order: &OrderRow,
) -> Result<String, AppError> {
    let existing = sqlx::query(
        "SELECT id FROM bills WHERE order_id = $1 AND status = 'open'
          ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&order.id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db_error)?;
    if let Some(row) = existing {
        return Ok(row.get("id"));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO bills (id, order_id, table_session_id, status, total, paid_total, created_at)
         VALUES ($1, $2, $3, 'open', $4, 0, $5)",
    )
    .bind(&id)
    .bind(&order.id)
    .bind(&order.session_id)
    .bind(order.total)
    .bind(cafeflow_db::now_iso_after_minutes(0))
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(id)
}

async fn latest_bill(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    order_id: &str,
) -> Result<Option<(String, String, i64, Option<String>)>, AppError> {
    let row = sqlx::query(
        "SELECT id, status, paid_total, settled_at FROM bills
          WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(order_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(row.map(|row| {
        (
            row.get("id"),
            row.get("status"),
            row.get("paid_total"),
            row.get("settled_at"),
        )
    }))
}

#[derive(serde::Serialize)]
struct Share {
    label: String,
    amount: i64,
}

async fn replace_splits(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    bill_id: &str,
    shares: &[Share],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM bill_splits WHERE bill_id = $1")
        .bind(bill_id)
        .execute(&mut **tx)
        .await
        .map_err(db_error)?;
    for (index, share) in shares.iter().enumerate() {
        sqlx::query(
            "INSERT INTO bill_splits (id, bill_id, label, amount, is_paid, sort_order)
             VALUES ($1, $2, $3, $4, 0, $5)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(bill_id)
        .bind(&share.label)
        .bind(share.amount)
        .bind(index as i64)
        .execute(&mut **tx)
        .await
        .map_err(db_error)?;
    }
    Ok(())
}

async fn sync_splits(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    bill_id: &str,
    paid_total: i64,
) -> Result<(), AppError> {
    let rows = sqlx::query(
        "SELECT id, amount, is_paid FROM bill_splits WHERE bill_id = $1 ORDER BY sort_order, label, id",
    )
    .bind(bill_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(db_error)?;
    let mut covered = paid_total;
    for row in &rows {
        if row.get::<i64, _>("is_paid") == 1 {
            covered -= row.get::<i64, _>("amount");
        }
    }
    let mut cumulative = 0i64;
    for row in rows {
        if row.get::<i64, _>("is_paid") == 1 {
            continue;
        }
        cumulative += row.get::<i64, _>("amount");
        let is_paid = i64::from(cumulative <= covered);
        sqlx::query("UPDATE bill_splits SET is_paid = $1 WHERE id = $2")
            .bind(is_paid)
            .bind(row.get::<String, _>("id"))
            .execute(&mut **tx)
            .await
            .map_err(db_error)?;
    }
    Ok(())
}

async fn has_open_splits(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    order_id: &str,
) -> Result<bool, AppError> {
    let row = sqlx::query(
        "SELECT COUNT(*) AS n FROM bill_splits s
           JOIN bills b ON b.id = s.bill_id
          WHERE b.order_id = $1 AND b.status = 'open'",
    )
    .bind(order_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(row.get::<i64, _>("n") > 0)
}

async fn net_paid(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    order_id: &str,
) -> Result<i64, AppError> {
    let row = sqlx::query(
        "SELECT COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END), 0) AS net
           FROM payments WHERE order_id = $1",
    )
    .bind(order_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(row.get("net"))
}

async fn cash_register_for(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    user_id: &str,
) -> Result<Option<String>, AppError> {
    let rows = sqlx::query(
        "SELECT cash_register_id, opened_by_user_id FROM cash_sessions
          WHERE status = 'open' ORDER BY opened_at DESC",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(db_error)?;
    if rows.is_empty() {
        return Ok(None);
    }
    if rows.len() == 1 {
        return Ok(Some(rows[0].get("cash_register_id")));
    }
    Ok(rows
        .into_iter()
        .find(|row| row.get::<String, _>("opened_by_user_id") == user_id)
        .map(|row| row.get("cash_register_id")))
}

async fn latest_payment(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    order_id: &str,
) -> Result<Option<Value>, AppError> {
    let row = sqlx::query(
        "SELECT p.id, p.method, p.amount, p.status, p.reference, p.paid_at,
                u.full_name AS receiver, s.label AS split_label
           FROM payments p
           LEFT JOIN users u ON u.id = p.received_by_user_id
           LEFT JOIN bill_splits s ON s.id = p.bill_split_id
          WHERE p.order_id = $1 ORDER BY p.paid_at DESC, p.id DESC LIMIT 1",
    )
    .bind(order_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(row.map(payment_json))
}

async fn summary_json(state: &AppState, order_id: &str) -> Result<Value, AppError> {
    let order =
        sqlx::query("SELECT id, code, status, total, discount_total FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?
            .ok_or_else(|| not_found("سفارش یافت نشد.", "ORDER_NOT_FOUND"))?;
    let status: String = order.get("status");
    let paid_total: i64 = sqlx::query(
        "SELECT COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END), 0) AS net
           FROM payments WHERE order_id = $1",
    )
    .bind(order_id)
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?
    .get("net");
    let total: i64 = order.get("total");
    let bill = sqlx::query(
        "SELECT id, status, total, paid_total, settled_at FROM bills
          WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(order_id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .map(|row| {
        json!({
            "id": row.get::<String, _>("id"),
            "status": row.get::<String, _>("status"),
            "total": row.get::<i64, _>("total"),
            "paidTotal": row.get::<i64, _>("paid_total"),
            "settledAt": row.get::<Option<String>, _>("settled_at"),
        })
    });
    let splits = sqlx::query(
        "SELECT s.id, s.label, s.amount, s.is_paid FROM bill_splits s
          WHERE s.bill_id = (SELECT id FROM bills WHERE order_id = $1
                              ORDER BY created_at DESC LIMIT 1)
          ORDER BY s.sort_order, s.label, s.id",
    )
    .bind(order_id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    .into_iter()
    .map(|row| {
        json!({
            "id": row.get::<String, _>("id"),
            "label": row.get::<String, _>("label"),
            "amount": row.get::<i64, _>("amount"),
            "isPaid": row.get::<i64, _>("is_paid") == 1,
        })
    })
    .collect::<Vec<_>>();
    let payments = sqlx::query(
        "SELECT p.id, p.method, p.amount, p.status, p.reference, p.paid_at,
                u.full_name AS receiver, s.label AS split_label
           FROM payments p
           LEFT JOIN users u ON u.id = p.received_by_user_id
           LEFT JOIN bill_splits s ON s.id = p.bill_split_id
          WHERE p.order_id = $1 ORDER BY p.paid_at ASC, p.id ASC",
    )
    .bind(order_id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    .into_iter()
    .map(payment_json)
    .collect::<Vec<_>>();
    Ok(json!({
        "orderId": order_id,
        "code": order.get::<String, _>("code"),
        "status": status,
        "total": total,
        "discountTotal": order.get::<i64, _>("discount_total"),
        "paidTotal": paid_total,
        "remaining": (total - paid_total).max(0),
        "payable": PAYABLE.contains(&status.as_str()),
        "bill": bill,
        "splits": splits,
        "payments": payments,
    }))
}

fn payment_json(row: sqlx::any::AnyRow) -> Value {
    let method: String = row.get("method");
    json!({
        "id": row.get::<String, _>("id"),
        "method": method,
        "methodLabelFa": method_label(&method),
        "amount": row.get::<i64, _>("amount"),
        "status": row.get::<String, _>("status"),
        "reference": row.get::<Option<String>, _>("reference"),
        "receivedByName": row.get::<Option<String>, _>("receiver"),
        "paidAt": row.get::<String, _>("paid_at"),
        "splitLabelFa": row.get::<Option<String>, _>("split_label"),
    })
}

async fn insert_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    order_id: &str,
    kind: &str,
    actor_id: &str,
    payload: Value,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO order_events
           (id, order_id, type, actor_user_id, payload_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(order_id)
    .bind(kind)
    .bind(actor_id)
    .bind(if payload.is_null() {
        None
    } else {
        Some(payload.to_string())
    })
    .bind(cafeflow_db::now_iso_after_minutes(0))
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(())
}

async fn audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    session: &cafeflow_db::AuthSession,
    action: &str,
    entity_type: &str,
    entity_id: Option<&str>,
    before: Option<Value>,
    after: Value,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO audit_logs
           (id, actor_user_id, actor_username, action, entity_type, entity_id,
            before_json, after_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&session.user.id)
    .bind(&session.user.username)
    .bind(action)
    .bind(entity_type)
    .bind(entity_id)
    .bind(before.map(|value| value.to_string()))
    .bind(after.to_string())
    .bind(cafeflow_db::now_iso_after_minutes(0))
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(())
}

fn method_label(method: &str) -> &'static str {
    match method {
        "cash" => "نقدی",
        "card" => "کارت‌خوان",
        "online" => "آنلاین",
        "wallet" => "کیف پول",
        _ => "سایر",
    }
}

fn fa_number(value: i64) -> String {
    value
        .to_string()
        .chars()
        .map(|digit| match digit {
            '0' => '۰',
            '1' => '۱',
            '2' => '۲',
            '3' => '۳',
            '4' => '۴',
            '5' => '۵',
            '6' => '۶',
            '7' => '۷',
            '8' => '۸',
            '9' => '۹',
            _ => digit,
        })
        .collect()
}

fn truncate(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

fn db_error(error: sqlx::Error) -> AppError {
    tracing::error!("payments database error: {error}");
    AppError::internal("خطای پایگاه داده رخ داد.")
}
