//! Customer club: profiles, loyalty points, wallet and reservation history.

use std::collections::HashMap;

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
use uuid::Uuid;

use crate::admin::{db_error, guard, parse_body, record, require_module};
use crate::error::{AppError, bad_request, conflict, not_found, validation_failed};
use crate::state::AppState;

fn tier_for_points(points: i64) -> &'static str {
    if points >= 1000 {
        "vip"
    } else if points >= 500 {
        "gold"
    } else if points >= 200 {
        "silver"
    } else {
        "regular"
    }
}

fn tier_label(tier: &str) -> &str {
    match tier {
        "silver" => "نقره‌ای",
        "gold" => "طلایی",
        "vip" => "ویژه",
        _ => "عادی",
    }
}

fn reservation_label(status: &str) -> &'static str {
    match status {
        "pending" => "در انتظار تأیید",
        "confirmed" => "تأیید شده",
        "seated" => "حاضر شد",
        "cancelled" => "لغو شده",
        "no_show" => "عدم حضور",
        _ => "نامشخص",
    }
}

fn normalize_phone(value: &str) -> String {
    let mut latin = String::new();
    for ch in value.chars() {
        let code = ch as u32;
        if (0x06F0..=0x06F9).contains(&code) {
            latin.push(char::from_digit(code - 0x06F0, 10).unwrap_or('0'));
        } else if (0x0660..=0x0669).contains(&code) {
            latin.push(char::from_digit(code - 0x0660, 10).unwrap_or('0'));
        } else {
            latin.push(ch);
        }
    }
    let digits: String = latin.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if let Some(rest) = digits.strip_prefix("0098") {
        return format!("0{rest}");
    }
    if digits.len() == 12
        && let Some(rest) = digits.strip_prefix("98")
    {
        return format!("0{rest}");
    }
    digits
}

const CUSTOMER_SELECT: &str = "SELECT c.id, c.name, c.phone, c.birth_date, c.notes,
       c.consent_marketing, c.created_at, COALESCE(l.points, 0) AS points,
       COALESCE(l.tier, 'regular') AS tier, COALESCE(l.wallet_balance, 0) AS wallet_balance
  FROM customers c LEFT JOIN loyalty_accounts l ON l.customer_id = c.id";

fn customer_json(row: &sqlx::any::AnyRow) -> Value {
    let tier: String = row.get("tier");
    json!({
        "id": row.get::<String, _>("id"),
        "name": row.get::<Option<String>, _>("name"),
        "phone": row.get::<String, _>("phone"),
        "birthDate": row.get::<Option<String>, _>("birth_date"),
        "notes": row.get::<Option<String>, _>("notes"),
        "consentMarketing": row.get::<i64, _>("consent_marketing") == 1,
        "points": row.get::<i64, _>("points"),
        "tier": tier,
        "tierLabelFa": tier_label(&tier),
        "walletBalance": row.get::<i64, _>("wallet_balance"),
        "createdAt": row.get::<String, _>("created_at"),
    })
}

async fn find_customer(state: &AppState, id: &str) -> Result<Value, AppError> {
    let row = sqlx::query(&format!(
        "{CUSTOMER_SELECT} WHERE c.id = $1 AND c.deleted_at IS NULL"
    ))
    .bind(id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .ok_or_else(|| not_found("مشتری یافت نشد.", "CUSTOMER_NOT_FOUND"))?;
    let mut customer = customer_json(&row);
    let ledger = sqlx::query(
        "SELECT id, 'points' AS kind, delta, reason, created_at FROM loyalty_ledger
          WHERE customer_id = $1
         UNION ALL
         SELECT id, 'wallet' AS kind, delta, reason, created_at FROM wallet_ledger
          WHERE customer_id = $2
         ORDER BY created_at DESC LIMIT 50",
    )
    .bind(id)
    .bind(id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let reservations = sqlx::query(
        "SELECT r.id, r.reserved_for, r.guest_count, r.status, t.name_fa AS table_name_fa
           FROM reservations r LEFT JOIN dining_tables t ON t.id = r.table_id
          WHERE r.customer_phone = $1 ORDER BY r.reserved_for DESC LIMIT 20",
    )
    .bind(row.get::<String, _>("phone"))
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    customer["ledger"] = json!(
        ledger
            .iter()
            .map(|entry| json!({
                "id": entry.get::<String, _>("id"),
                "kind": entry.get::<String, _>("kind"),
                "delta": entry.get::<i64, _>("delta"),
                "reason": entry.get::<String, _>("reason"),
                "createdAt": entry.get::<String, _>("created_at"),
            }))
            .collect::<Vec<_>>()
    );
    customer["reservations"] = json!(
        reservations
            .iter()
            .map(|entry| {
                let status: String = entry.get("status");
                json!({
                    "id": entry.get::<String, _>("id"),
                    "reservedFor": entry.get::<String, _>("reserved_for"),
                    "guestCount": entry.get::<i64, _>("guest_count"),
                    "status": status,
                    "statusLabelFa": reservation_label(&status),
                    "tableNameFa": entry.get::<Option<String>, _>("table_name_fa"),
                })
            })
            .collect::<Vec<_>>()
    );
    Ok(customer)
}

pub async fn list_customers(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "crm.read").await?;
    require_module(&state, ModuleKey::Crm).await?;
    let term = query.get("q").map(|value| value.trim()).unwrap_or("");
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .map(|value| value.clamp(1, 100))
        .unwrap_or(50);
    let rows = sqlx::query(&format!(
        "{CUSTOMER_SELECT}
          WHERE c.deleted_at IS NULL
            AND ($1 = '' OR c.name LIKE $2 OR c.phone LIKE $3)
          ORDER BY c.created_at DESC LIMIT $4"
    ))
    .bind(term)
    .bind(format!("%{term}%"))
    .bind(format!("%{term}%"))
    .bind(limit)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let items: Vec<Value> = rows.iter().map(customer_json).collect();
    Ok(Json(json!({ "items": items, "total": items.len() })))
}

pub async fn customer_detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "crm.read").await?;
    require_module(&state, ModuleKey::Crm).await?;
    Ok(Json(find_customer(&state, &id).await?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCustomerInput {
    name: Option<String>,
    phone: String,
    birth_date: Option<String>,
    notes: Option<String>,
    #[serde(default)]
    consent_marketing: bool,
}

pub async fn create_customer(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "crm.write").await?;
    require_module(&state, ModuleKey::Crm).await?;
    let input: CreateCustomerInput = parse_body(&body)?;
    let phone = normalize_phone(&input.phone);
    if !(7..=15).contains(&phone.len()) {
        return Err(validation_failed("شماره تماس معتبر نیست."));
    }
    if input
        .name
        .as_ref()
        .is_some_and(|value| value.chars().count() > 80)
        || input
            .notes
            .as_ref()
            .is_some_and(|value| value.chars().count() > 300)
        || input
            .birth_date
            .as_ref()
            .is_some_and(|value| value.len() != 10)
    {
        return Err(validation_failed("اطلاعات مشتری معتبر نیست."));
    }
    let existing =
        sqlx::query("SELECT id FROM customers WHERE phone = $1 AND deleted_at IS NULL LIMIT 1")
            .bind(&phone)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?;
    if let Some(existing) = existing {
        return Err(conflict(
            "مشتری با این شماره تماس قبلاً ثبت شده است.",
            "CUSTOMER_EXISTS",
        )
        .with_details(json!({ "customerId": existing.get::<String, _>("id") })));
    }
    let id = Uuid::new_v4().to_string();
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "INSERT INTO customers (id, name, phone, birth_date, notes, consent_marketing)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&id)
    .bind(input.name.as_deref().map(str::trim))
    .bind(&phone)
    .bind(input.birth_date.as_deref())
    .bind(input.notes.as_deref().map(str::trim))
    .bind(i64::from(input.consent_marketing))
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    sqlx::query(
        "INSERT INTO loyalty_accounts (customer_id, points, tier, wallet_balance)
         VALUES ($1, 0, 'regular', 0)",
    )
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "crm.customer_created".into(),
            entity_type: "customer".into(),
            entity_id: Some(id.clone()),
            after_json: Some(
                json!({
                    "phone": phone,
                    "name": input.name,
                    "consentMarketing": input.consent_marketing,
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    let row = sqlx::query(&format!(
        "{CUSTOMER_SELECT} WHERE c.id = $1 AND c.deleted_at IS NULL"
    ))
    .bind(&id)
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(Json(customer_json(&row)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoyaltyInput {
    points: Option<i64>,
    wallet: Option<i64>,
    reason: String,
}

pub async fn adjust_loyalty(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "crm.write").await?;
    require_module(&state, ModuleKey::Crm).await?;
    let input: LoyaltyInput = parse_body(&body)?;
    let points_delta = input.points.unwrap_or(0);
    let wallet_delta = input.wallet.unwrap_or(0);
    if points_delta == 0 && wallet_delta == 0 {
        return Err(validation_failed(
            "حداقل یکی از امتیاز یا کیف پول باید تغییر کند.",
        ));
    }
    if points_delta.abs() > 100_000 || wallet_delta.abs() > 10_000_000_000 {
        return Err(validation_failed("مقدار تغییر بیش از حد مجاز است."));
    }
    if !(2..=200).contains(&input.reason.trim().chars().count()) {
        return Err(validation_failed("دلیل تغییر الزامی است."));
    }
    let row = sqlx::query(
        "SELECT COALESCE(l.points, 0) AS points, COALESCE(l.tier, 'regular') AS tier,
                COALESCE(l.wallet_balance, 0) AS wallet_balance
           FROM customers c LEFT JOIN loyalty_accounts l ON l.customer_id = c.id
          WHERE c.id = $1 AND c.deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .ok_or_else(|| not_found("مشتری یافت نشد.", "CUSTOMER_NOT_FOUND"))?;
    let current_points: i64 = row.get("points");
    let current_wallet: i64 = row.get("wallet_balance");
    let next_points = current_points + points_delta;
    let next_wallet = current_wallet + wallet_delta;
    if next_points < 0 {
        return Err(
            bad_request("امتیاز مشتری نمی‌تواند منفی شود.", "INSUFFICIENT_POINTS")
                .with_details(json!({ "current": current_points, "delta": points_delta })),
        );
    }
    if next_wallet < 0 {
        return Err(
            bad_request("موجودی کیف پول مشتری کافی نیست.", "INSUFFICIENT_WALLET")
                .with_details(json!({ "current": current_wallet, "delta": wallet_delta })),
        );
    }
    let tier = tier_for_points(next_points);
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "INSERT INTO loyalty_accounts (customer_id, points, tier, wallet_balance, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (customer_id) DO UPDATE SET points = excluded.points,
           tier = excluded.tier, wallet_balance = excluded.wallet_balance,
           updated_at = excluded.updated_at",
    )
    .bind(&id)
    .bind(next_points)
    .bind(tier)
    .bind(next_wallet)
    .bind(OffsetDateTime::now_utc().to_string())
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    if points_delta != 0 {
        sqlx::query(
            "INSERT INTO loyalty_ledger (id, customer_id, delta, reason) VALUES ($1, $2, $3, $4)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&id)
        .bind(points_delta)
        .bind(input.reason.trim())
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    if wallet_delta != 0 {
        sqlx::query(
            "INSERT INTO wallet_ledger (id, customer_id, delta, reason) VALUES ($1, $2, $3, $4)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&id)
        .bind(wallet_delta)
        .bind(input.reason.trim())
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "crm.loyalty_adjusted".into(),
            entity_type: "customer".into(),
            entity_id: Some(id.clone()),
            before_json: Some(
                json!({
                    "points": current_points,
                    "walletBalance": current_wallet,
                    "tier": row.get::<String, _>("tier"),
                })
                .to_string(),
            ),
            after_json: Some(
                json!({
                    "points": next_points,
                    "walletBalance": next_wallet,
                    "tier": tier,
                    "reason": input.reason.trim(),
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(find_customer(&state, &id).await?))
}
