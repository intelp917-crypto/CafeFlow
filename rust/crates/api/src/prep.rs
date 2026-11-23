//! Preparation queue and automatic order progression. Prep units move through
//! their own state machine; the order follows the shortest legal path.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use cafeflow_domain::{OrderStatus, PrepStatus, can_prep_transition, is_terminal_status};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::auth::{require_auth, session_has_permission};
use crate::error::{AppError, conflict, forbidden, not_found, validation_failed};
use crate::staff_orders::{build_detail, push_notification};
use crate::state::AppState;

const DEPARTMENT_KINDS: [&str; 4] = ["barista", "kitchen", "bar", "other"];
const AUTO_NOTE: &str = "به‌روزرسانی خودکار بر اساس پیشرفت آماده‌سازی";

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueueQuery {
    kind: Option<String>,
    include_finished: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PrepTransitionInput {
    to: String,
}

#[derive(Debug, Clone)]
struct PrepTask {
    order_id: String,
    status: String,
    order_status: OrderStatus,
}

pub async fn queue(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueueQuery>,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "prep.read").await? {
        return Err(forbidden(
            "اجازهٔ مشاهدهٔ صف آماده‌سازی را ندارید.",
            "FORBIDDEN",
        ));
    }
    let kind = query
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(kind) = kind
        && !DEPARTMENT_KINDS.contains(&kind)
    {
        return Err(validation_failed("نوع دپارتمان نامعتبر است."));
    }
    let include_finished = matches!(
        query.include_finished.as_deref(),
        Some("true" | "1" | "yes" | "on")
    );

    let mut clauses = Vec::new();
    let mut values: Vec<String> = Vec::new();
    if !include_finished {
        clauses.push("p.status IN ('queued','in_progress','delayed')".to_string());
        clauses.push("o.status NOT IN ('cancelled','paid')".to_string());
    }
    if let Some(kind) = kind {
        clauses.push("d.kind = $1".to_string());
        values.push(kind.to_string());
    }
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    let sql = format!(
        "SELECT p.id, p.order_id, o.code AS order_code, t.code AS table_code,
                t.name_fa AS table_name_fa, oi.product_name_snapshot, oi.quantity,
                oi.note, p.status, oi.status AS item_status, d.kind AS department_kind,
                d.name_fa AS department_name, p.target_minutes, p.created_at
           FROM prep_tasks p
           JOIN orders o ON o.id = p.order_id
           JOIN order_items oi ON oi.id = p.order_item_id
           LEFT JOIN dining_tables t ON t.id = o.table_id
           LEFT JOIN departments d ON d.id = p.department_id
          {where_sql}
          ORDER BY CASE WHEN p.status = 'queued' THEN 0 ELSE 1 END, p.created_at ASC
          LIMIT 200"
    );
    let mut query_builder = sqlx::query(&sql);
    for value in &values {
        query_builder = query_builder.bind(value);
    }
    let rows = query_builder
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?;
    let now = OffsetDateTime::now_utc();
    let items = rows
        .into_iter()
        .map(|row| {
            let status: String = row.get("status");
            let target: i64 = row.get("target_minutes");
            let elapsed = elapsed_minutes(&row.get::<String, _>("created_at"), now);
            let is_delayed =
                ["queued", "in_progress", "delayed"].contains(&status.as_str()) && elapsed > target;
            json!({
                "id": row.get::<String, _>("id"),
                "orderId": row.get::<String, _>("order_id"),
                "orderCode": row.get::<String, _>("order_code"),
                "tableCode": row.get::<Option<String>, _>("table_code"),
                "tableNameFa": row.get::<Option<String>, _>("table_name_fa"),
                "productNameFa": row.get::<String, _>("product_name_snapshot"),
                "quantity": row.get::<i64, _>("quantity"),
                "note": row.get::<Option<String>, _>("note"),
                "status": status,
                "itemStatus": row.get::<String, _>("item_status"),
                "departmentKind": row.get::<Option<String>, _>("department_kind"),
                "departmentNameFa": row.get::<Option<String>, _>("department_name"),
                "targetMinutes": target,
                "elapsedMinutes": elapsed,
                "isDelayed": is_delayed,
                "createdAt": row.get::<String, _>("created_at"),
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({"items": items})))
}

pub async fn transition(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "prep.update").await? {
        return Err(forbidden(
            "اجازهٔ تغییر وضعیت آماده‌سازی را ندارید.",
            "FORBIDDEN",
        ));
    }
    let input: PrepTransitionInput = serde_json::from_slice(&body)
        .map_err(|_| validation_failed("وضعیت آماده‌سازی معتبر نیست."))?;
    let target = parse_prep_status(input.to.trim())
        .ok_or_else(|| validation_failed("وضعیت آماده‌سازی معتبر نیست."))?;
    let task = find_task(&state, &id)
        .await?
        .ok_or_else(|| not_found("آیتم آماده‌سازی یافت نشد.", "PREP_NOT_FOUND"))?;
    let current = parse_prep_status(&task.status)
        .ok_or_else(|| AppError::internal("وضعیت آماده‌سازی نامعتبر است."))?;
    if !can_prep_transition(current, target) {
        return Err(conflict(
            format!(
                "تغییر وضعیت آماده‌سازی از «{}» به «{}» مجاز نیست.",
                current.code(),
                target.code()
            ),
            "PREP_TRANSITION_INVALID",
        ));
    }
    if is_terminal_status(task.order_status) {
        return Err(conflict("این سفارش بسته شده است.", "ORDER_CLOSED"));
    }

    let now = cafeflow_db::now_iso_after_minutes(0);
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "UPDATE prep_tasks
            SET status = $1,
                started_at = CASE WHEN $1 = 'in_progress' AND started_at IS NULL THEN $2 ELSE started_at END,
                ready_at = CASE WHEN $1 = 'ready' THEN $2 ELSE ready_at END
          WHERE id = $3",
    )
    .bind(target.code())
    .bind(&now)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    let item_status = match target {
        PrepStatus::InProgress | PrepStatus::Delayed => "preparing",
        PrepStatus::Ready => "ready",
        PrepStatus::Cancelled => "cancelled",
        PrepStatus::Queued => "pending",
    };
    sqlx::query(
        "UPDATE order_items SET status = $1
          WHERE id = (SELECT order_item_id FROM prep_tasks WHERE id = $2)",
    )
    .bind(item_status)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    sqlx::query(
        "INSERT INTO order_events
           (id, order_id, type, from_status, to_status, actor_user_id, payload_json, created_at)
         VALUES ($1, $2, 'prep.status_changed', NULL, NULL, $3, $4, $5)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&task.order_id)
    .bind(&session.user.id)
    .bind(json!({"prepTaskId": id, "status": target.code()}).to_string())
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    if target == PrepStatus::Delayed {
        let code: Option<String> = sqlx::query("SELECT code FROM orders WHERE id = $1")
            .bind(&task.order_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?
            .map(|row| row.get("code"));
        if let Some(code) = code {
            push_notification(
                &mut tx,
                "waiter",
                "prep.delayed",
                "آماده‌سازی با تأخیر",
                &format!("آماده‌سازی یکی از آیتم‌های سفارش {code} به تأخیر افتاد."),
                &task.order_id,
                &code,
            )
            .await?;
        }
    }
    sync_order_progress(&mut tx, &task.order_id, &now).await?;
    tx.commit().await.map_err(db_error)?;
    Ok(Json(build_detail(&state, &task.order_id).await?))
}

async fn find_task(state: &AppState, id: &str) -> Result<Option<PrepTask>, AppError> {
    let row = sqlx::query(
        "SELECT p.order_id, p.status, o.status AS order_status
           FROM prep_tasks p JOIN orders o ON o.id = p.order_id
          WHERE p.id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let order_status: String = row.get("order_status");
    let Some(order_status) = OrderStatus::parse_status(&order_status) else {
        return Err(AppError::internal("وضعیت سفارش نامعتبر است."));
    };
    Ok(Some(PrepTask {
        order_id: row.get("order_id"),
        status: row.get("status"),
        order_status,
    }))
}

/// Derives the order status from the prep tasks and walks only legal edges.
async fn sync_order_progress(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    order_id: &str,
    now: &str,
) -> Result<(), AppError> {
    let row = sqlx::query(
        "SELECT o.status, o.code, o.table_id, o.table_session_id,
                COUNT(p.id) AS total,
                COALESCE(SUM(CASE WHEN p.status = 'ready' THEN 1 ELSE 0 END), 0) AS ready,
                COALESCE(SUM(CASE WHEN p.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
                COALESCE(SUM(CASE WHEN p.status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress,
                COALESCE(SUM(CASE WHEN p.status = 'delayed' THEN 1 ELSE 0 END), 0) AS delayed
           FROM orders o LEFT JOIN prep_tasks p ON p.order_id = o.id
          WHERE o.id = $1
          GROUP BY o.id",
    )
    .bind(order_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db_error)?;
    let status_text: String = row.get("status");
    let Some(mut status) = OrderStatus::parse_status(&status_text) else {
        return Err(AppError::internal("وضعیت سفارش نامعتبر است."));
    };
    if is_terminal_status(status) {
        return Ok(());
    }
    let total: i64 = row.get("total");
    if total == 0 {
        return Ok(());
    }
    let ready: i64 = row.get("ready");
    let cancelled: i64 = row.get("cancelled");
    let in_progress: i64 = row.get("in_progress");
    let delayed: i64 = row.get("delayed");
    let open = total - ready - cancelled;
    let target = if open == 0 {
        if cancelled == total {
            Some(OrderStatus::Cancelled)
        } else {
            Some(OrderStatus::Ready)
        }
    } else if ready > 0 {
        Some(OrderStatus::PartiallyReady)
    } else if in_progress > 0 || delayed > 0 {
        Some(OrderStatus::Preparing)
    } else {
        None
    };
    let Some(target) = target else {
        return Ok(());
    };
    if target == status {
        return Ok(());
    }
    if matches!(
        status,
        OrderStatus::Submitted | OrderStatus::AwaitingConfirmation
    ) && !(in_progress > 0 || delayed > 0 || ready > 0)
    {
        return Ok(());
    }
    let path = find_status_path(status, target);
    let Some(path) = path else {
        return Ok(());
    };
    let table_id: Option<String> = row.get("table_id");
    let session_id: Option<String> = row.get("table_session_id");
    for next in path {
        sqlx::query(
            "UPDATE orders
                SET status = $1, updated_at = $2,
                    served_at = CASE WHEN $1 = 'served' THEN $2 ELSE served_at END,
                    closed_at = CASE WHEN $1 = 'cancelled' THEN $2 ELSE closed_at END,
                    cancel_reason = CASE WHEN $1 = 'cancelled' THEN $3 ELSE cancel_reason END
              WHERE id = $4",
        )
        .bind(next.as_str())
        .bind(now)
        .bind(if next == OrderStatus::Cancelled {
            Some("همه اقلام سفارش لغو شد.")
        } else {
            None
        })
        .bind(order_id)
        .execute(&mut **tx)
        .await
        .map_err(db_error)?;
        sqlx::query(
            "INSERT INTO order_events
               (id, order_id, type, from_status, to_status, actor_user_id, payload_json, created_at)
             VALUES ($1, $2, 'order.status_auto', $3, $4, NULL, $5, $6)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(order_id)
        .bind(status.as_str())
        .bind(next.as_str())
        .bind(json!({"note": AUTO_NOTE}).to_string())
        .bind(now)
        .execute(&mut **tx)
        .await
        .map_err(db_error)?;
        if next == OrderStatus::Ready {
            let code: String = row.get("code");
            push_notification(
                &mut *tx,
                "waiter",
                "order.ready",
                "سفارش آماده تحویل است",
                &format!("سفارش {code} آماده سرو است."),
                order_id,
                &code,
            )
            .await?;
        }
        if next == OrderStatus::PartiallyReady {
            let code: String = row.get("code");
            push_notification(
                &mut *tx,
                "waiter",
                "order.partially_ready",
                "بخشی از سفارش آماده است",
                &format!("بخشی از سفارش {code} آماده است."),
                order_id,
                &code,
            )
            .await?;
        }
        if next == OrderStatus::Cancelled {
            sqlx::query(
                "UPDATE prep_tasks SET status = 'cancelled'
                  WHERE order_id = $1 AND status NOT IN ('ready','cancelled')",
            )
            .bind(order_id)
            .execute(&mut **tx)
            .await
            .map_err(db_error)?;
            sqlx::query(
                "UPDATE order_items SET status = 'cancelled'
                  WHERE order_id = $1 AND status NOT IN ('ready','cancelled')",
            )
            .bind(order_id)
            .execute(&mut **tx)
            .await
            .map_err(db_error)?;
            release_table(tx, table_id.as_deref(), session_id.as_deref(), now).await?;
        }
        status = next;
    }
    Ok(())
}

fn find_status_path(from: OrderStatus, to: OrderStatus) -> Option<Vec<OrderStatus>> {
    if from == to {
        return Some(Vec::new());
    }
    let mut queue = std::collections::VecDeque::from([(from, Vec::new())]);
    let mut seen = vec![from];
    while let Some((current, path)) = queue.pop_front() {
        for next in current.next() {
            let mut next_path = path.clone();
            next_path.push(*next);
            if *next == to {
                return Some(next_path);
            }
            if !seen.contains(next) {
                seen.push(*next);
                queue.push_back((*next, next_path));
            }
        }
    }
    None
}

async fn release_table(
    tx: &mut sqlx::Transaction<'_, sqlx::Any>,
    table_id: Option<&str>,
    session_id: Option<&str>,
    now: &str,
) -> Result<(), AppError> {
    let Some(session_id) = session_id else {
        return Ok(());
    };
    let row = sqlx::query(
        "SELECT COUNT(*) AS n FROM orders
          WHERE table_session_id = $1 AND status IN ('submitted','awaiting_confirmation',
                'confirmed','preparing','partially_ready','ready','served','awaiting_payment')",
    )
    .bind(session_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db_error)?;
    if row.get::<i64, _>("n") > 0 {
        return Ok(());
    }
    sqlx::query(
        "UPDATE table_sessions SET status = 'closed', closed_at = $1 WHERE id = $2 AND status = 'open'",
    )
    .bind(now)
    .bind(session_id)
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;
    if let Some(table_id) = table_id {
        sqlx::query("UPDATE dining_tables SET status = 'available', updated_at = $1 WHERE id = $2")
            .bind(now)
            .bind(table_id)
            .execute(&mut **tx)
            .await
            .map_err(db_error)?;
    }
    Ok(())
}

fn parse_prep_status(value: &str) -> Option<PrepStatus> {
    match value {
        "queued" => Some(PrepStatus::Queued),
        "in_progress" => Some(PrepStatus::InProgress),
        "ready" => Some(PrepStatus::Ready),
        "delayed" => Some(PrepStatus::Delayed),
        "cancelled" => Some(PrepStatus::Cancelled),
        _ => None,
    }
}

trait PrepLabel {
    fn code(self) -> &'static str;
}

impl PrepLabel for PrepStatus {
    fn code(self) -> &'static str {
        match self {
            PrepStatus::Queued => "queued",
            PrepStatus::InProgress => "in_progress",
            PrepStatus::Ready => "ready",
            PrepStatus::Delayed => "delayed",
            PrepStatus::Cancelled => "cancelled",
        }
    }
}

fn elapsed_minutes(created_at: &str, now: OffsetDateTime) -> i64 {
    OffsetDateTime::parse(created_at, &Rfc3339)
        .map(|created| (now - created).whole_minutes().max(0))
        .unwrap_or(0)
}

fn db_error(error: sqlx::Error) -> AppError {
    tracing::error!("prep database error: {error}");
    AppError::internal("خطای پایگاه داده رخ داد.")
}
