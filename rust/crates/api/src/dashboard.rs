//! Live operational counters for the staff dashboard. Every number comes from
//! the database, matching the NestJS dashboard contract.

use axum::Json;
use axum::extract::State;
use axum::http::HeaderMap;
use serde::Serialize;
use sqlx::Row;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::auth::{require_auth, session_has_permission};
use crate::error::{AppError, forbidden};
use crate::state::AppState;

const ACTIVE_ORDER_STATUSES: &str = "('submitted','awaiting_confirmation','confirmed','preparing','partially_ready','ready','served','awaiting_payment')";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardOverview {
    today: Today,
    orders: Orders,
    tables: Tables,
    requests: Requests,
    reservations: Reservations,
    catalog: Catalog,
    staff: Staff,
    payments_by_method: Vec<PaymentMethodTotal>,
    recent_orders: Vec<RecentOrder>,
    recent_activity: Vec<RecentActivity>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Today {
    jalali_label: String,
    weekday_fa: String,
    sales_total: i64,
    payment_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Orders {
    active: i64,
    preparing: i64,
    delayed: i64,
    awaiting_payment: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Tables {
    total: i64,
    occupied: i64,
    available: i64,
    reserved: i64,
}

#[derive(Debug, Serialize)]
struct Requests {
    pending: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Reservations {
    upcoming: i64,
    pending_approval: i64,
}

#[derive(Debug, Serialize)]
struct Catalog {
    products: i64,
    categories: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Staff {
    active_users: i64,
}

#[derive(Debug, Serialize)]
struct PaymentMethodTotal {
    method: String,
    total: i64,
    count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentOrder {
    id: String,
    code: String,
    status: String,
    total: i64,
    table_code: Option<String>,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentActivity {
    id: String,
    action: String,
    actor_username: Option<String>,
    entity_type: String,
    created_at: String,
}

pub async fn overview(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<DashboardOverview>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "dashboard.read").await? {
        return Err(forbidden("اجازهٔ مشاهدهٔ داشبورد را ندارید.", "FORBIDDEN"));
    }

    let range = cafeflow_domain::tehran_day_range(OffsetDateTime::now_utc())
        .map_err(|_| AppError::internal("محاسبهٔ بازهٔ امروز ناموفق بود."))?;
    let now_iso = cafeflow_db::now_iso_after_minutes(0);
    let now = OffsetDateTime::now_utc();

    let sales = sqlx::query(
        "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
           FROM payments
          WHERE status = 'confirmed' AND paid_at >= $1 AND paid_at < $2",
    )
    .bind(&range.start_iso)
    .bind(&range.end_iso)
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?;

    let active = count(
        &state,
        format!("SELECT COUNT(*) AS n FROM orders WHERE status IN {ACTIVE_ORDER_STATUSES}"),
    )
    .await?;
    let preparing = count(
        &state,
        "SELECT COUNT(*) AS n FROM orders WHERE status IN ('confirmed','preparing','partially_ready')"
            .to_string(),
    )
    .await?;
    let awaiting_payment = count(
        &state,
        "SELECT COUNT(*) AS n FROM orders WHERE status IN ('served','awaiting_payment')"
            .to_string(),
    )
    .await?;
    let delayed = delayed_prep_tasks(&state, now).await?;

    let tables_total = count(
        &state,
        "SELECT COUNT(*) AS n FROM dining_tables WHERE is_active = 1 AND deleted_at IS NULL"
            .to_string(),
    )
    .await?;
    let tables_occupied = count(
        &state,
        "SELECT COUNT(*) AS n FROM dining_tables WHERE is_active = 1 AND deleted_at IS NULL AND status = 'occupied'".to_string(),
    )
    .await?;
    let tables_reserved = count(
        &state,
        "SELECT COUNT(*) AS n FROM dining_tables WHERE is_active = 1 AND deleted_at IS NULL AND status = 'reserved'".to_string(),
    )
    .await?;

    let pending_requests = count(
        &state,
        "SELECT COUNT(*) AS n FROM customer_requests WHERE status = 'pending'".to_string(),
    )
    .await?;
    let reservations_upcoming = sqlx::query(
        "SELECT COUNT(*) AS n FROM reservations
          WHERE status IN ('pending','confirmed') AND reserved_for >= $1",
    )
    .bind(&now_iso)
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?
    .get::<i64, _>("n");
    let reservations_pending = count(
        &state,
        "SELECT COUNT(*) AS n FROM reservations WHERE status = 'pending'".to_string(),
    )
    .await?;
    let products = count(
        &state,
        "SELECT COUNT(*) AS n FROM products WHERE is_active = 1 AND is_archived = 0 AND deleted_at IS NULL".to_string(),
    )
    .await?;
    let categories = count(
        &state,
        "SELECT COUNT(*) AS n FROM categories WHERE is_active = 1 AND deleted_at IS NULL"
            .to_string(),
    )
    .await?;
    let active_users = count(
        &state,
        "SELECT COUNT(*) AS n FROM users WHERE is_active = 1 AND deleted_at IS NULL".to_string(),
    )
    .await?;

    let payments_by_method = sqlx::query(
        "SELECT method, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
           FROM payments
          WHERE status = 'confirmed' AND paid_at >= $1 AND paid_at < $2
          GROUP BY method
          ORDER BY total DESC",
    )
    .bind(&range.start_iso)
    .bind(&range.end_iso)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    .into_iter()
    .map(|row| PaymentMethodTotal {
        method: row.get("method"),
        total: row.get("total"),
        count: row.get("count"),
    })
    .collect();

    let recent_orders = sqlx::query(
        "SELECT o.id, o.code, o.status, o.total, t.code AS table_code, o.created_at
           FROM orders o
           LEFT JOIN dining_tables t ON t.id = o.table_id
          ORDER BY o.created_at DESC
          LIMIT 8",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    .into_iter()
    .map(|row| RecentOrder {
        id: row.get("id"),
        code: row.get("code"),
        status: row.get("status"),
        total: row.get("total"),
        table_code: row.get("table_code"),
        created_at: row.get("created_at"),
    })
    .collect();

    let recent_activity = sqlx::query(
        "SELECT id, action, actor_username, entity_type, created_at
           FROM audit_logs
          ORDER BY created_at DESC
          LIMIT 6",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    .into_iter()
    .map(|row| RecentActivity {
        id: row.get("id"),
        action: row.get("action"),
        actor_username: row.get("actor_username"),
        entity_type: row.get("entity_type"),
        created_at: row.get("created_at"),
    })
    .collect();

    Ok(Json(DashboardOverview {
        today: Today {
            jalali_label: range.jalali_label,
            weekday_fa: range.weekday_fa,
            sales_total: sales.get("total"),
            payment_count: sales.get("count"),
        },
        orders: Orders {
            active,
            preparing,
            delayed,
            awaiting_payment,
        },
        tables: Tables {
            total: tables_total,
            occupied: tables_occupied,
            available: (tables_total - tables_occupied - tables_reserved).max(0),
            reserved: tables_reserved,
        },
        requests: Requests {
            pending: pending_requests,
        },
        reservations: Reservations {
            upcoming: reservations_upcoming,
            pending_approval: reservations_pending,
        },
        catalog: Catalog {
            products,
            categories,
        },
        staff: Staff { active_users },
        payments_by_method,
        recent_orders,
        recent_activity,
    }))
}

async fn count(state: &AppState, query: String) -> Result<i64, AppError> {
    let row = sqlx::query(&query)
        .fetch_one(&state.db.pool)
        .await
        .map_err(db_error)?;
    Ok(row.get("n"))
}

async fn delayed_prep_tasks(state: &AppState, now: OffsetDateTime) -> Result<i64, AppError> {
    let rows = sqlx::query(
        "SELECT created_at, target_minutes FROM prep_tasks
          WHERE status IN ('queued','in_progress','delayed')",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(rows
        .into_iter()
        .filter(|row| {
            let created_at: String = row.get("created_at");
            let target: i64 = row.get("target_minutes");
            OffsetDateTime::parse(&created_at, &Rfc3339)
                .map(|created| (now - created).whole_minutes() > target)
                .unwrap_or(false)
        })
        .count() as i64)
}

fn db_error(error: sqlx::Error) -> AppError {
    tracing::error!("dashboard database error: {error}");
    AppError::internal("خطای پایگاه داده رخ داد.")
}
