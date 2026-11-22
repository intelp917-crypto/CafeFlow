//! Cash sessions, expenses and the finance summary.

use std::collections::{BTreeMap, HashMap};

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use cafeflow_db::AuditEntry;
use cafeflow_domain::ModuleKey;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::admin::{db_error, guard, parse_body, record, require_module};
use crate::error::{AppError, bad_request, conflict, not_found, validation_failed};
use crate::state::AppState;

fn now() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

fn expense_label(category: &str) -> &str {
    match category {
        "ingredients" => "مواد اولیه",
        "rent" => "اجاره",
        "salary" => "حقوق و دستمزد",
        "utilities" => "آب، برق و گاز",
        "marketing" => "بازاریابی",
        "maintenance" => "تعمیر و نگهداری",
        "equipment" => "تجهیزات",
        "other" => "سایر",
        other => other,
    }
}

const SESSION_SELECT: &str = "SELECT s.id, s.cash_register_id, c.name_fa AS register_name_fa,
       s.status, u.full_name AS opened_by_name, s.opened_at, s.opening_float,
       s.closed_at, s.closing_amount, s.expected_amount, s.difference
  FROM cash_sessions s
  JOIN cash_registers c ON c.id = s.cash_register_id
  LEFT JOIN users u ON u.id = s.opened_by_user_id";

/// Payment totals inside a window. When `register` is set the totals belong to
/// that cash register only, so two open drawers never share each other's cash.
async fn totals(
    state: &AppState,
    from: &str,
    to: &str,
    register: Option<&str>,
) -> Result<Value, AppError> {
    let row = sqlx::query(
        "SELECT
           COALESCE(SUM(CASE WHEN method = 'cash' AND status = 'confirmed' THEN amount
                             WHEN method = 'cash' AND status = 'refunded' THEN -amount ELSE 0 END), 0) AS cash_total,
           COALESCE(SUM(CASE WHEN method <> 'cash' AND status = 'confirmed' THEN amount
                             WHEN method <> 'cash' AND status = 'refunded' THEN -amount ELSE 0 END), 0) AS card_total,
           COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) AS payments_count,
           COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END), 0) AS refunds_total
         FROM payments
          WHERE paid_at >= $1 AND paid_at < $2
            AND ($3 = '' OR cash_register_id = $3)",
    )
    .bind(from)
    .bind(to)
    .bind(register.unwrap_or_default())
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(json!({
        "cashTotal": row.get::<i64, _>("cash_total"),
        "cardTotal": row.get::<i64, _>("card_total"),
        "paymentsCount": row.get::<i64, _>("payments_count"),
        "refundsTotal": row.get::<i64, _>("refunds_total"),
    }))
}

async fn session_json(state: &AppState, row: &sqlx::any::AnyRow) -> Result<Value, AppError> {
    let opened_at: String = row.get("opened_at");
    let closed_at: Option<String> = row.get("closed_at");
    let register_id: String = row.get("cash_register_id");
    let to = closed_at.clone().unwrap_or_else(now);
    let totals = totals(state, &opened_at, &to, Some(&register_id)).await?;
    let opening: i64 = row.get("opening_float");
    let expected_stored: Option<i64> = row.get("expected_amount");
    let expected = expected_stored.unwrap_or(opening + totals["cashTotal"].as_i64().unwrap_or(0));
    Ok(json!({
        "id": row.get::<String, _>("id"),
        "registerId": row.get::<String, _>("cash_register_id"),
        "registerNameFa": row.get::<String, _>("register_name_fa"),
        "status": row.get::<String, _>("status"),
        "openedByName": row.get::<Option<String>, _>("opened_by_name"),
        "openedAt": opened_at,
        "openingFloat": opening,
        "cashTotal": totals["cashTotal"],
        "cardTotal": totals["cardTotal"],
        "paymentsCount": totals["paymentsCount"],
        "refundsTotal": totals["refundsTotal"],
        "expectedAmount": expected,
        "closedAt": closed_at,
        "closingAmount": row.get::<Option<i64>, _>("closing_amount"),
        "difference": row.get::<Option<i64>, _>("difference"),
    }))
}

async fn find_session(state: &AppState, id: &str) -> Result<Value, AppError> {
    let row = sqlx::query(&format!("{SESSION_SELECT} WHERE s.id = $1"))
        .bind(id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?
        .ok_or_else(|| not_found("جلسه صندوق یافت نشد.", "CASH_SESSION_NOT_FOUND"))?;
    session_json(state, &row).await
}

pub async fn cash_overview(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "finance.read").await?;
    require_module(&state, ModuleKey::Finance).await?;
    let register = query.get("registerId").filter(|value| !value.is_empty());
    let current = match register {
        Some(register) => sqlx::query(&format!(
            "{SESSION_SELECT} WHERE s.status = 'open' AND s.cash_register_id = $1
             ORDER BY s.opened_at DESC LIMIT 1"
        ))
        .bind(register)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?,
        None => sqlx::query(&format!(
            "{SESSION_SELECT} WHERE s.status = 'open' ORDER BY s.opened_at DESC LIMIT 1"
        ))
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?,
    };
    let current = match current {
        Some(row) => Some(session_json(&state, &row).await?),
        None => None,
    };
    let history = sqlx::query(&format!(
        "{SESSION_SELECT} WHERE s.status = 'closed' ORDER BY s.closed_at DESC LIMIT 20"
    ))
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let mut history_items = Vec::new();
    for row in &history {
        history_items.push(session_json(&state, row).await?);
    }
    let registers = sqlx::query(
        "SELECT id, name_fa, is_active FROM cash_registers ORDER BY is_active DESC, name_fa",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(Json(json!({
        "registers": registers.iter().map(|row| json!({
            "id": row.get::<String, _>("id"),
            "nameFa": row.get::<String, _>("name_fa"),
            "isActive": row.get::<i64, _>("is_active") == 1,
        })).collect::<Vec<_>>(),
        "current": current,
        "history": history_items,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenSessionInput {
    register_id: String,
    #[serde(default)]
    opening_float: i64,
}

pub async fn open_cash_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "finance.write").await?;
    require_module(&state, ModuleKey::Finance).await?;
    let input: OpenSessionInput = parse_body(&body)?;
    if !(0..=10_000_000_000).contains(&input.opening_float) {
        return Err(validation_failed("موجودی اولیه معتبر نیست."));
    }
    let register = sqlx::query("SELECT is_active FROM cash_registers WHERE id = $1")
        .bind(&input.register_id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?
        .ok_or_else(|| not_found("صندوق یافت نشد.", "REGISTER_NOT_FOUND"))?;
    if register.get::<i64, _>("is_active") != 1 {
        return Err(bad_request("این صندوق غیرفعال است.", "REGISTER_INACTIVE"));
    }
    let open = sqlx::query(
        "SELECT id FROM cash_sessions WHERE status = 'open' AND cash_register_id = $1 LIMIT 1",
    )
    .bind(&input.register_id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    if open.is_some() {
        return Err(conflict(
            "این صندوق از قبل یک جلسه باز دارد.",
            "CASH_SESSION_ALREADY_OPEN",
        ));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO cash_sessions
           (id, cash_register_id, opened_by_user_id, opening_float, status)
         VALUES ($1, $2, $3, $4, 'open')",
    )
    .bind(&id)
    .bind(&input.register_id)
    .bind(&session.user.id)
    .bind(input.opening_float)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "cash_session.opened".into(),
            entity_type: "cash_session".into(),
            entity_id: Some(id.clone()),
            after_json: Some(
                json!({
                    "registerId": input.register_id,
                    "openingFloat": input.opening_float,
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(find_session(&state, &id).await?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloseSessionInput {
    closing_amount: i64,
}

pub async fn close_cash_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "finance.write").await?;
    require_module(&state, ModuleKey::Finance).await?;
    let input: CloseSessionInput = parse_body(&body)?;
    if !(0..=10_000_000_000).contains(&input.closing_amount) {
        return Err(validation_failed("مبلغ شمارش‌شده معتبر نیست."));
    }
    let existing = sqlx::query(
        "SELECT status, opened_at, opening_float, cash_register_id
           FROM cash_sessions WHERE id = $1",
    )
    .bind(&id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .ok_or_else(|| not_found("جلسه صندوق یافت نشد.", "CASH_SESSION_NOT_FOUND"))?;
    if existing.get::<String, _>("status") == "closed" {
        return Err(conflict(
            "این جلسه قبلاً بسته شده است.",
            "CASH_SESSION_CLOSED",
        ));
    }
    let closed_at = now();
    let totals = totals(
        &state,
        &existing.get::<String, _>("opened_at"),
        &closed_at,
        Some(&existing.get::<String, _>("cash_register_id")),
    )
    .await?;
    let opening: i64 = existing.get("opening_float");
    let expected = opening + totals["cashTotal"].as_i64().unwrap_or(0);
    let difference = input.closing_amount - expected;
    sqlx::query(
        "UPDATE cash_sessions SET status = 'closed', closed_at = $1, closing_amount = $2,
                expected_amount = $3, difference = $4 WHERE id = $5 AND status = 'open'",
    )
    .bind(&closed_at)
    .bind(input.closing_amount)
    .bind(expected)
    .bind(difference)
    .bind(&id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "cash_session.closed".into(),
            entity_type: "cash_session".into(),
            entity_id: Some(id.clone()),
            before_json: Some(json!({ "status": "open", "openingFloat": opening }).to_string()),
            after_json: Some(
                json!({
                    "status": "closed",
                    "expectedAmount": expected,
                    "closingAmount": input.closing_amount,
                    "difference": difference,
                    "cashTotal": totals["cashTotal"],
                    "cardTotal": totals["cardTotal"],
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(find_session(&state, &id).await?))
}

async fn expense_rows(
    state: &AppState,
    from: Option<&str>,
    to: Option<&str>,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    let rows = if from.is_some() {
        sqlx::query(
            "SELECT e.id, e.category, e.amount, e.description, e.spent_at,
                    u.full_name AS created_by_name
               FROM expenses e LEFT JOIN users u ON u.id = e.created_by_user_id
              WHERE e.spent_at >= $1 AND e.spent_at < $2
              ORDER BY e.spent_at DESC LIMIT $3",
        )
        .bind(from)
        .bind(to)
        .bind(limit)
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?
    } else {
        sqlx::query(
            "SELECT e.id, e.category, e.amount, e.description, e.spent_at,
                    u.full_name AS created_by_name
               FROM expenses e LEFT JOIN users u ON u.id = e.created_by_user_id
              ORDER BY e.spent_at DESC LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?
    };
    Ok(rows
        .iter()
        .map(|row| {
            let category: String = row.get("category");
            json!({
                "id": row.get::<String, _>("id"),
                "category": category,
                "categoryLabelFa": expense_label(&category),
                "amount": row.get::<i64, _>("amount"),
                "description": row.get::<Option<String>, _>("description"),
                "spentAt": row.get::<String, _>("spent_at"),
                "createdByName": row.get::<Option<String>, _>("created_by_name"),
            })
        })
        .collect())
}

pub async fn expenses(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "finance.read").await?;
    require_module(&state, ModuleKey::Finance).await?;
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .map(|value| value.clamp(1, 200))
        .unwrap_or(60);
    Ok(Json(json!({
        "items": expense_rows(&state, None, None, limit).await?,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpenseInput {
    category: String,
    amount: i64,
    description: Option<String>,
    spent_at: Option<String>,
}

pub async fn create_expense(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "finance.write").await?;
    require_module(&state, ModuleKey::Finance).await?;
    let input: ExpenseInput = parse_body(&body)?;
    if ![
        "ingredients",
        "rent",
        "salary",
        "utilities",
        "marketing",
        "maintenance",
        "equipment",
        "other",
    ]
    .contains(&input.category.as_str())
    {
        return Err(validation_failed("دسته هزینه نامعتبر است."));
    }
    if !(1..=100_000_000_000).contains(&input.amount) {
        return Err(validation_failed("مبلغ هزینه باید بیشتر از صفر باشد."));
    }
    if input
        .description
        .as_ref()
        .is_some_and(|value| value.chars().count() > 200)
    {
        return Err(validation_failed("شرح بیش از حد طولانی است."));
    }
    let spent_at = input
        .spent_at
        .as_deref()
        .and_then(|value| OffsetDateTime::parse(value, &Rfc3339).ok())
        .map(|value| value.format(&Rfc3339).unwrap_or_default())
        .unwrap_or_else(now);
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO expenses (id, category, amount, description, spent_at, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&id)
    .bind(&input.category)
    .bind(input.amount)
    .bind(input.description.as_deref())
    .bind(&spent_at)
    .bind(&session.user.id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "finance.expense_recorded".into(),
            entity_type: "expense".into(),
            entity_id: Some(id.clone()),
            after_json: Some(
                json!({
                    "category": input.category,
                    "amount": input.amount,
                    "spentAt": spent_at,
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({
        "id": id,
        "category": input.category,
        "categoryLabelFa": expense_label(&input.category),
        "amount": input.amount,
        "description": input.description,
        "spentAt": spent_at,
        "createdByName": session.user.full_name,
    })))
}

fn day_range(
    query: &HashMap<String, String>,
) -> Result<(String, String, String, String), AppError> {
    let now_local = OffsetDateTime::now_utc().to_offset(crate::dates::tehran_offset());
    let default_to = now_local.date();
    let default_from = (now_local - time::Duration::days(29)).date();
    let from = query
        .get("from")
        .filter(|value| !value.trim().is_empty())
        .map(|value| crate::dates::parse_day(value, "تاریخ شروع"))
        .transpose()?
        .unwrap_or(default_from);
    let to = query
        .get("to")
        .filter(|value| !value.trim().is_empty())
        .map(|value| crate::dates::parse_day(value, "تاریخ پایان"))
        .transpose()?
        .unwrap_or(default_to);
    if from > to {
        return Err(bad_request(
            "تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.",
            "INVALID_DATE_RANGE",
        ));
    }
    let (start, end) = crate::dates::range_bounds(from, to)?;
    Ok((from.to_string(), to.to_string(), start, end))
}

fn tehran_date(value: &str) -> String {
    OffsetDateTime::parse(value, &Rfc3339)
        .map(|date| (date + time::Duration::minutes(210)).date().to_string())
        .unwrap_or_else(|_| value.chars().take(10).collect())
}

pub async fn summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "finance.read").await?;
    require_module(&state, ModuleKey::Finance).await?;
    let (from, to, start, end) = day_range(&query)?;
    let revenue_row = sqlx::query(
        "SELECT COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount ELSE 0 END), 0) AS confirmed,
                COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END), 0) AS refunded
           FROM payments WHERE paid_at >= $1 AND paid_at < $2",
    )
    .bind(&start)
    .bind(&end)
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?;
    let expense_row = sqlx::query(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
          WHERE spent_at >= $1 AND spent_at < $2",
    )
    .bind(&start)
    .bind(&end)
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?;
    let revenue: i64 = revenue_row.get("confirmed");
    let refunds: i64 = revenue_row.get("refunded");
    let net = revenue - refunds;
    let expenses_total: i64 = expense_row.get("total");
    let profit = net - expenses_total;

    let categories = sqlx::query(
        "SELECT category, COALESCE(SUM(amount), 0) AS total FROM expenses
          WHERE spent_at >= $1 AND spent_at < $2 GROUP BY category ORDER BY total DESC",
    )
    .bind(&start)
    .bind(&end)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let by_category: Vec<Value> = categories
        .iter()
        .map(|row| {
            let category: String = row.get("category");
            json!({
                "category": category,
                "labelFa": expense_label(&category),
                "total": row.get::<i64, _>("total"),
            })
        })
        .collect();

    let payment_rows = sqlx::query(
        "SELECT paid_at, CASE WHEN status = 'confirmed' THEN amount
                              WHEN status = 'refunded' THEN -amount ELSE 0 END AS amount
           FROM payments WHERE paid_at >= $1 AND paid_at < $2",
    )
    .bind(&start)
    .bind(&end)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let expense_daily =
        sqlx::query("SELECT spent_at, amount FROM expenses WHERE spent_at >= $1 AND spent_at < $2")
            .bind(&start)
            .bind(&end)
            .fetch_all(&state.db.pool)
            .await
            .map_err(db_error)?;
    let mut daily: BTreeMap<String, (i64, i64)> = BTreeMap::new();
    for row in payment_rows {
        let key = tehran_date(&row.get::<String, _>("paid_at"));
        daily.entry(key).or_default().0 += row.get::<i64, _>("amount");
    }
    for row in expense_daily {
        let key = tehran_date(&row.get::<String, _>("spent_at"));
        daily.entry(key).or_default().1 += row.get::<i64, _>("amount");
    }
    let daily: Vec<Value> = daily
        .into_iter()
        .map(|(date, (revenue, expenses))| {
            json!({
                "date": date,
                "revenue": revenue,
                "expenses": expenses,
                "profit": revenue - expenses,
            })
        })
        .collect();
    Ok(Json(json!({
        "from": from,
        "to": to,
        "revenue": revenue,
        "refunds": refunds,
        "netRevenue": net,
        "expenses": expenses_total,
        "profit": profit,
        "marginPercent": if net > 0 { ((profit as f64 / net as f64) * 1000.0).round() / 10.0 } else { 0.0 },
        "expensesByCategory": by_category,
        "daily": daily,
        "expensesList": expense_rows(&state, Some(&start), Some(&end), 60).await?,
    })))
}
