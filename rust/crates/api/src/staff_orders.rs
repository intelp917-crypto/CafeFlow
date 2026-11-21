//! Staff order list, detail and status transitions. Amounts are read from the
//! order snapshots; mutations only change the workflow state.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use cafeflow_domain::{OrderStatus, can_transition, is_terminal_status};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::auth::{require_auth, session_has_permission};
use crate::error::{AppError, bad_request, conflict, forbidden, not_found, validation_failed};
use crate::state::AppState;

const ACTIVE_STATUSES: [&str; 8] = [
    "submitted",
    "awaiting_confirmation",
    "confirmed",
    "preparing",
    "partially_ready",
    "ready",
    "served",
    "awaiting_payment",
];

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    scope: Option<String>,
    status: Option<String>,
    table_id: Option<String>,
    kind: Option<String>,
    q: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransitionInput {
    to: String,
    reason: Option<String>,
}

#[derive(Debug, Clone)]
struct OrderState {
    id: String,
    code: String,
    status: OrderStatus,
    table_id: Option<String>,
    session_id: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "orders.read").await? {
        return Err(forbidden("اجازهٔ مشاهدهٔ سفارش‌ها را ندارید.", "FORBIDDEN"));
    }
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(20).clamp(1, 100);
    let mut clauses = Vec::new();
    let mut values = Vec::new();
    let mut parameter = 0usize;

    if query.scope.as_deref().unwrap_or("active") == "active" {
        let placeholders = ACTIVE_STATUSES
            .iter()
            .map(|status| {
                parameter += 1;
                values.push((*status).to_string());
                format!("${parameter}")
            })
            .collect::<Vec<_>>();
        clauses.push(format!("o.status IN ({})", placeholders.join(", ")));
    }

    if let Some(status) = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let requested = status
            .split(',')
            .filter_map(|value| OrderStatus::parse_status(value.trim()))
            .map(|status| status.as_str().to_string())
            .collect::<Vec<_>>();
        if !requested.is_empty() {
            let placeholders = requested
                .iter()
                .map(|status| {
                    parameter += 1;
                    values.push(status.clone());
                    format!("${parameter}")
                })
                .collect::<Vec<_>>();
            clauses.push(format!("o.status IN ({})", placeholders.join(", ")));
        }
    }
    if let Some(table_id) = query
        .table_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parameter += 1;
        clauses.push(format!("o.table_id = ${parameter}"));
        values.push(table_id.to_string());
    }
    if let Some(q) = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parameter += 1;
        clauses.push(format!("UPPER(o.code) LIKE ${parameter}"));
        values.push(format!("%{}%", q.to_uppercase()));
    }
    if let Some(kind) = query
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|value| ["barista", "kitchen", "bar", "other"].contains(value))
    {
        parameter += 1;
        clauses.push(format!(
            "EXISTS (SELECT 1 FROM order_items oi2 JOIN departments d2 ON d2.id = oi2.department_id
                      WHERE oi2.order_id = o.id AND d2.kind = ${parameter})"
        ));
        values.push(kind.to_string());
    }

    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    let count_sql = format!("SELECT COUNT(*) AS n FROM orders o {where_sql}");
    let mut count_query = sqlx::query(&count_sql);
    for value in &values {
        count_query = count_query.bind(value);
    }
    let total: i64 = count_query
        .fetch_one(&state.db.pool)
        .await
        .map_err(db_error)?
        .get("n");

    let offset = (page - 1) * page_size;
    let limit_parameter = parameter + 1;
    let offset_parameter = parameter + 2;
    let list_sql = format!(
        "SELECT o.id, o.code, o.status, o.source, o.total, o.paid_total, o.note,
                o.created_at, o.updated_at, o.table_id, t.code AS table_code,
                t.name_fa AS table_name_fa,
                (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
                (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id) AS prep_total,
                (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id AND p.status = 'ready') AS prep_ready,
                (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id AND p.status = 'in_progress') AS prep_in_progress,
                (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id AND p.status = 'queued') AS prep_queued,
                (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id AND p.status = 'delayed') AS prep_delayed
           FROM orders o
           LEFT JOIN dining_tables t ON t.id = o.table_id
          {where_sql}
          ORDER BY o.created_at DESC
          LIMIT ${limit_parameter} OFFSET ${offset_parameter}"
    );
    let mut list_query = sqlx::query(&list_sql);
    for value in &values {
        list_query = list_query.bind(value);
    }
    let rows = list_query
        .bind(page_size)
        .bind(offset)
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?;

    let mut items = Vec::with_capacity(rows.len());
    let now = OffsetDateTime::now_utc();
    for row in rows {
        items.push(summary_json(&state, &row, now).await?);
    }
    Ok(Json(json!({
        "items": items,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": ((total + page_size - 1) / page_size).max(1),
    })))
}

pub async fn detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "orders.read").await? {
        return Err(forbidden("اجازهٔ مشاهدهٔ سفارش را ندارید.", "FORBIDDEN"));
    }
    Ok(Json(build_detail(&state, &id).await?))
}

pub async fn transition(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "orders.write").await? {
        return Err(forbidden("اجازهٔ تغییر سفارش را ندارید.", "FORBIDDEN"));
    }
    let input: TransitionInput = serde_json::from_slice(&body)
        .map_err(|_| validation_failed("وضعیت مقصد سفارش معتبر نیست."))?;
    let target = OrderStatus::parse_status(input.to.trim())
        .ok_or_else(|| validation_failed("وضعیت مقصد سفارش معتبر نیست."))?;
    let current = find_state(&state, &id)
        .await?
        .ok_or_else(|| not_found("سفارش یافت نشد.", "ORDER_NOT_FOUND"))?;
    if is_terminal_status(current.status) {
        return Err(conflict(
            "این سفارش بسته شده است و وضعیت آن قابل تغییر نیست.",
            "ORDER_CLOSED",
        ));
    }
    if target == OrderStatus::Paid {
        return Err(conflict(
            "وضعیت پرداخت‌شده فقط از پرداخت تأییدشده مشتق می‌شود.",
            "PAYMENT_REQUIRED",
        ));
    }
    if target == OrderStatus::PartiallyReady {
        return Err(bad_request(
            "وضعیت «بخشی آماده» فقط از پیشرفت آماده‌سازی مشتق می‌شود.",
            "DERIVED_STATUS",
        ));
    }
    if !can_transition(current.status, target) {
        return Err(conflict(
            format!(
                "تغییر وضعیت از «{}» به «{}» مجاز نیست.",
                current.status.label_fa(),
                target.label_fa()
            ),
            "ORDER_TRANSITION_INVALID",
        ));
    }
    let reason = input
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if target == OrderStatus::Cancelled {
        if !session_has_permission(&state, &session.user.id, "orders.cancel").await? {
            return Err(forbidden(
                "برای لغو سفارش مجوز «orders.cancel» لازم است.",
                "PERMISSION_DENIED",
            ));
        }
        if reason.is_none() {
            return Err(bad_request(
                "دلیل لغو سفارش الزامی است.",
                "CANCEL_REASON_REQUIRED",
            ));
        }
    }

    let now = cafeflow_db::now_iso_after_minutes(0);
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "UPDATE orders
            SET status = $1, updated_at = $2,
                served_at = CASE WHEN $1 = 'served' THEN $2 ELSE served_at END,
                closed_at = CASE WHEN $1 = 'cancelled' THEN $2 ELSE closed_at END,
                cancel_reason = CASE WHEN $1 = 'cancelled' THEN $3 ELSE cancel_reason END,
                cancelled_by_user_id = CASE WHEN $1 = 'cancelled' THEN $4 ELSE cancelled_by_user_id END
          WHERE id = $5",
    )
    .bind(target.as_str())
    .bind(&now)
    .bind(reason)
    .bind(if target == OrderStatus::Cancelled {
        Some(session.user.id.as_str())
    } else {
        None
    })
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;

    sqlx::query(
        "INSERT INTO order_events
           (id, order_id, type, from_status, to_status, actor_user_id, payload_json, created_at)
         VALUES ($1, $2, 'order.status_changed', $3, $4, $5, $6, $7)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&id)
    .bind(current.status.as_str())
    .bind(target.as_str())
    .bind(&session.user.id)
    .bind(
        reason
            .map(|reason| json!({"reason": reason}).to_string())
            .unwrap_or_else(|| "{}".to_string()),
    )
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;

    if target == OrderStatus::Cancelled {
        sqlx::query(
            "UPDATE prep_tasks SET status = 'cancelled'
              WHERE order_id = $1 AND status IN ('queued','in_progress','delayed')",
        )
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query(
            "UPDATE order_items SET status = 'cancelled'
              WHERE order_id = $1 AND status NOT IN ('ready','served','cancelled')",
        )
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        release_table_if_idle(&current, &mut tx).await?;
    }

    if target == OrderStatus::Ready {
        insert_notification(
            &mut tx,
            "waiter",
            "order.ready",
            "سفارش آماده تحویل است",
            &format!("سفارش {} آماده سرو است.", current.code),
            &id,
            &current.code,
        )
        .await?;
    }
    if target == OrderStatus::AwaitingPayment {
        if let Some(table_id) = current.table_id.as_deref() {
            sqlx::query("UPDATE dining_tables SET status = 'waiting_payment', updated_at = $1 WHERE id = $2")
                .bind(&now)
                .bind(table_id)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
        }
        insert_notification(
            &mut tx,
            "cashier",
            "order.awaiting_payment",
            "سفارش آماده تسویه است",
            &format!("سفارش {} در انتظار پرداخت است.", current.code),
            &id,
            &current.code,
        )
        .await?;
    }

    sqlx::query(
        "INSERT INTO audit_logs
           (id, actor_user_id, actor_username, action, entity_type, entity_id, before_json, after_json, created_at)
         VALUES ($1, $2, $3, $4, 'order', $5, $6, $7, $8)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&session.user.id)
    .bind(&session.user.username)
    .bind(if target == OrderStatus::Cancelled {
        "order.cancelled"
    } else {
        "order.status_changed"
    })
    .bind(&id)
    .bind(json!({"status": current.status.as_str()}).to_string())
    .bind(json!({"status": target.as_str(), "reason": reason}).to_string())
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;

    tx.commit().await.map_err(db_error)?;
    Ok(Json(build_detail(&state, &id).await?))
}

pub(crate) async fn build_detail(state: &AppState, id: &str) -> Result<Value, AppError> {
    let row = sqlx::query(
        "SELECT o.id, o.code, o.status, o.source, o.total, o.paid_total, o.note,
                o.created_at, o.updated_at, o.subtotal, o.discount_total, o.service_charge,
                o.tax_total, o.cancel_reason, o.table_id, o.table_session_id,
                o.submitted_at, o.served_at, t.code AS table_code, t.name_fa AS table_name_fa,
                (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
                (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id) AS prep_total,
                (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id AND p.status = 'ready') AS prep_ready,
                (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id AND p.status = 'in_progress') AS prep_in_progress,
                (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id AND p.status = 'queued') AS prep_queued,
                (SELECT COUNT(*) FROM prep_tasks p WHERE p.order_id = o.id AND p.status = 'delayed') AS prep_delayed
           FROM orders o LEFT JOIN dining_tables t ON t.id = o.table_id
          WHERE o.id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .ok_or_else(|| not_found("سفارش یافت نشد.", "ORDER_NOT_FOUND"))?;

    let status: String = row.get("status");
    let parsed = OrderStatus::parse_status(&status)
        .ok_or_else(|| AppError::internal("وضعیت سفارش نامعتبر است."))?;
    let items = sqlx::query(
        "SELECT oi.id, oi.product_name_snapshot, oi.quantity, oi.unit_price_snapshot, oi.total,
                oi.note, oi.status, oi.options_json, oi.extras_json,
                d.kind AS department_kind, d.name_fa AS department_name,
                p.id AS prep_id, p.status AS prep_status, p.target_minutes
           FROM order_items oi
           LEFT JOIN departments d ON d.id = oi.department_id
           LEFT JOIN prep_tasks p ON p.order_item_id = oi.id
          WHERE oi.order_id = $1
          ORDER BY oi.created_at ASC",
    )
    .bind(id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    .into_iter()
    .map(|item| {
        json!({
            "id": item.get::<String, _>("id"),
            "productNameFa": item.get::<String, _>("product_name_snapshot"),
            "quantity": item.get::<i64, _>("quantity"),
            "unitPrice": item.get::<i64, _>("unit_price_snapshot"),
            "total": item.get::<i64, _>("total"),
            "note": item.get::<Option<String>, _>("note"),
            "itemStatus": item.get::<String, _>("status"),
            "departmentKind": item.get::<Option<String>, _>("department_kind"),
            "departmentNameFa": item.get::<Option<String>, _>("department_name"),
            "prepId": item.get::<Option<String>, _>("prep_id"),
            "prepStatus": item.get::<Option<String>, _>("prep_status"),
            "targetMinutes": item.get::<Option<i64>, _>("target_minutes"),
            "options": parse_names(item.get::<Option<String>, _>("options_json")),
            "extras": parse_names(item.get::<Option<String>, _>("extras_json")),
        })
    })
    .collect::<Vec<_>>();

    let events = sqlx::query(
        "SELECT e.id, e.type, e.from_status, e.to_status, e.created_at, u.full_name AS actor_name
           FROM order_events e LEFT JOIN users u ON u.id = e.actor_user_id
          WHERE e.order_id = $1 ORDER BY e.created_at ASC",
    )
    .bind(id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    .into_iter()
    .map(|event| {
        json!({
            "id": event.get::<String, _>("id"),
            "type": event.get::<String, _>("type"),
            "fromStatus": event.get::<Option<String>, _>("from_status"),
            "toStatus": event.get::<Option<String>, _>("to_status"),
            "actorName": event.get::<Option<String>, _>("actor_name"),
            "createdAt": event.get::<String, _>("created_at"),
        })
    })
    .collect::<Vec<_>>();

    let bill = sqlx::query(
        "SELECT id, status, total, paid_total, settled_at FROM bills
          WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .map(|bill| {
        json!({
            "id": bill.get::<String, _>("id"),
            "status": bill.get::<String, _>("status"),
            "total": bill.get::<i64, _>("total"),
            "paidTotal": bill.get::<i64, _>("paid_total"),
            "settledAt": bill.get::<Option<String>, _>("settled_at"),
        })
    });

    let payments = sqlx::query(
        "SELECT p.id, p.method, p.amount, p.status, p.reference, p.paid_at,
                u.full_name AS receiver, s.label AS split_label
           FROM payments p LEFT JOIN users u ON u.id = p.received_by_user_id
           LEFT JOIN bill_splits s ON s.id = p.bill_split_id
          WHERE p.order_id = $1 ORDER BY p.paid_at ASC",
    )
    .bind(id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    .into_iter()
    .map(|payment| {
        let method: String = payment.get("method");
        json!({
            "id": payment.get::<String, _>("id"),
            "method": method,
            "methodLabelFa": payment_method_label(&method),
            "amount": payment.get::<i64, _>("amount"),
            "status": payment.get::<String, _>("status"),
            "reference": payment.get::<Option<String>, _>("reference"),
            "receivedByName": payment.get::<Option<String>, _>("receiver"),
            "paidAt": payment.get::<String, _>("paid_at"),
            "splitLabelFa": payment.get::<Option<String>, _>("split_label"),
        })
    })
    .collect::<Vec<_>>();

    let allowed = parsed
        .next()
        .iter()
        .filter(|status| **status != OrderStatus::Paid && **status != OrderStatus::PartiallyReady)
        .map(|status| {
            json!({
                "status": status.as_str(),
                "labelFa": if *status == OrderStatus::Cancelled {
                    "لغو سفارش".to_string()
                } else {
                    format!("تغییر به {}", status.label_fa())
                },
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "id": row.get::<String, _>("id"),
        "code": row.get::<String, _>("code"),
        "status": status,
        "statusLabelFa": parsed.label_fa(),
        "source": row.get::<String, _>("source"),
        "tableId": row.get::<Option<String>, _>("table_id"),
        "tableCode": row.get::<Option<String>, _>("table_code"),
        "tableNameFa": row.get::<Option<String>, _>("table_name_fa"),
        "total": row.get::<i64, _>("total"),
        "paidTotal": row.get::<i64, _>("paid_total"),
        "itemCount": row.get::<i64, _>("item_count"),
        "note": row.get::<Option<String>, _>("note"),
        "prep": {
            "total": row.get::<i64, _>("prep_total"),
            "ready": row.get::<i64, _>("prep_ready"),
            "inProgress": row.get::<i64, _>("prep_in_progress"),
            "queued": row.get::<i64, _>("prep_queued"),
            "delayed": row.get::<i64, _>("prep_delayed"),
        },
        "isDelayed": has_delayed_prep(state, id).await?,
        "createdAt": row.get::<String, _>("created_at"),
        "updatedAt": row.get::<String, _>("updated_at"),
        "subtotal": row.get::<i64, _>("subtotal"),
        "discountTotal": row.get::<i64, _>("discount_total"),
        "serviceCharge": row.get::<i64, _>("service_charge"),
        "taxTotal": row.get::<i64, _>("tax_total"),
        "cancelReason": row.get::<Option<String>, _>("cancel_reason"),
        "sessionId": row.get::<Option<String>, _>("table_session_id"),
        "submittedAt": row.get::<Option<String>, _>("submitted_at"),
        "servedAt": row.get::<Option<String>, _>("served_at"),
        "items": items,
        "events": events,
        "bill": bill,
        "payments": payments,
        "allowedTransitions": allowed,
    }))
}

async fn summary_json(
    state: &AppState,
    row: &sqlx::any::AnyRow,
    _now: OffsetDateTime,
) -> Result<Value, AppError> {
    let id: String = row.get("id");
    let status: String = row.get("status");
    let label = OrderStatus::parse_status(&status)
        .map(|value| value.label_fa())
        .unwrap_or(status.as_str());
    Ok(json!({
        "id": id,
        "code": row.get::<String, _>("code"),
        "statusLabelFa": label,
        "status": status,
        "source": row.get::<String, _>("source"),
        "tableId": row.get::<Option<String>, _>("table_id"),
        "tableCode": row.get::<Option<String>, _>("table_code"),
        "tableNameFa": row.get::<Option<String>, _>("table_name_fa"),
        "total": row.get::<i64, _>("total"),
        "paidTotal": row.get::<i64, _>("paid_total"),
        "itemCount": row.get::<i64, _>("item_count"),
        "note": row.get::<Option<String>, _>("note"),
        "prep": {
            "total": row.get::<i64, _>("prep_total"),
            "ready": row.get::<i64, _>("prep_ready"),
            "inProgress": row.get::<i64, _>("prep_in_progress"),
            "queued": row.get::<i64, _>("prep_queued"),
            "delayed": row.get::<i64, _>("prep_delayed"),
        },
        "isDelayed": has_delayed_prep(state, &id).await?,
        "createdAt": row.get::<String, _>("created_at"),
        "updatedAt": row.get::<String, _>("updated_at"),
    }))
}

async fn find_state(state: &AppState, id: &str) -> Result<Option<OrderState>, AppError> {
    let row = sqlx::query(
        "SELECT id, code, status, table_id, table_session_id FROM orders WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let status: String = row.get("status");
    let Some(status) = OrderStatus::parse_status(&status) else {
        return Err(AppError::internal("وضعیت سفارش نامعتبر است."));
    };
    Ok(Some(OrderState {
        id: row.get("id"),
        code: row.get("code"),
        status,
        table_id: row.get("table_id"),
        session_id: row.get("table_session_id"),
    }))
}

async fn has_delayed_prep(state: &AppState, order_id: &str) -> Result<bool, AppError> {
    let rows = sqlx::query(
        "SELECT created_at, target_minutes FROM prep_tasks
          WHERE order_id = $1 AND status IN ('queued','in_progress','delayed')",
    )
    .bind(order_id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let now = OffsetDateTime::now_utc();
    Ok(rows.into_iter().any(|row| {
        OffsetDateTime::parse(&row.get::<String, _>("created_at"), &Rfc3339)
            .map(|created| (now - created).whole_minutes() > row.get::<i64, _>("target_minutes"))
            .unwrap_or(false)
    }))
}

async fn release_table_if_idle(
    current: &OrderState,
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
) -> Result<(), AppError> {
    let Some(session_id) = current.session_id.as_deref() else {
        return Ok(());
    };
    let row = sqlx::query(
        "SELECT COUNT(*) AS n FROM orders
          WHERE table_session_id = $1 AND id <> $2
            AND status IN ('submitted','awaiting_confirmation','confirmed','preparing','partially_ready','ready','served','awaiting_payment')",
    )
    .bind(session_id)
    .bind(&current.id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db_error)?;
    if row.get::<i64, _>("n") > 0 {
        return Ok(());
    }
    sqlx::query(
        "UPDATE table_sessions SET status = 'closed', closed_at = $1 WHERE id = $2 AND status = 'open'",
    )
    .bind(cafeflow_db::now_iso_after_minutes(0))
    .bind(session_id)
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;
    if let Some(table_id) = current.table_id.as_deref() {
        sqlx::query("UPDATE dining_tables SET status = 'available', updated_at = $1 WHERE id = $2")
            .bind(cafeflow_db::now_iso_after_minutes(0))
            .bind(table_id)
            .execute(&mut **tx)
            .await
            .map_err(db_error)?;
    }
    Ok(())
}

async fn insert_notification(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    role_key: &str,
    kind: &str,
    title: &str,
    body: &str,
    order_id: &str,
    code: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO notifications (id, role_key, type, title_fa, body_fa, data_json)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(role_key)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(json!({"orderId": order_id, "code": code}).to_string())
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(())
}

fn parse_names(value: Option<String>) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<Value>>(&value)
        .map(|items| {
            items
                .into_iter()
                .filter_map(|item| {
                    item.get("nameFa")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn payment_method_label(method: &str) -> &'static str {
    match method {
        "cash" => "نقدی",
        "card" => "کارت‌خوان",
        "online" => "آنلاین",
        "wallet" => "کیف پول",
        _ => "سایر",
    }
}

fn db_error(error: sqlx::Error) -> AppError {
    tracing::error!("staff orders database error: {error}");
    AppError::internal("خطای پایگاه داده رخ داد.")
}
