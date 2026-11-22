//! Reservations, employee profiles, shifts and staff performance.

use std::collections::HashMap;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use cafeflow_db::AuditEntry;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Row;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::admin::{db_error, guard, parse_body, record};
use crate::error::{AppError, bad_request, conflict, not_found, validation_failed};
use crate::state::AppState;

const STATUSES: [&str; 5] = ["pending", "confirmed", "seated", "cancelled", "no_show"];

fn status_label(status: &str) -> &str {
    match status {
        "pending" => "در انتظار تأیید",
        "confirmed" => "تأیید شده",
        "seated" => "حاضر شد",
        "cancelled" => "لغو شده",
        "no_show" => "عدم حضور",
        other => other,
    }
}

fn allowed_statuses(status: &str) -> &'static [&'static str] {
    match status {
        "pending" => &["confirmed", "cancelled", "no_show"],
        "confirmed" => &["seated", "cancelled", "no_show"],
        "seated" => &["cancelled"],
        _ => &[],
    }
}

fn parse_time(value: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(value.trim(), &Rfc3339).ok()
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReservationDto {
    id: String,
    customer_name: String,
    customer_phone: String,
    guest_count: i64,
    reserved_for: String,
    duration_minutes: i64,
    table_id: Option<String>,
    table_code: Option<String>,
    table_name_fa: Option<String>,
    table_capacity: Option<i64>,
    status: String,
    status_label_fa: String,
    note: Option<String>,
    created_by_name: Option<String>,
    created_at: String,
    allowed_statuses: Vec<Value>,
}

fn reservation_from_row(row: &sqlx::any::AnyRow) -> ReservationDto {
    let status: String = row.get("status");
    ReservationDto {
        id: row.get("id"),
        customer_name: row.get("customer_name"),
        customer_phone: row.get("customer_phone"),
        guest_count: row.get("guest_count"),
        reserved_for: row.get("reserved_for"),
        duration_minutes: row.get("duration_minutes"),
        table_id: row.get("table_id"),
        table_code: row.get("table_code"),
        table_name_fa: row.get("table_name_fa"),
        table_capacity: row.get("table_capacity"),
        status_label_fa: status_label(&status).to_string(),
        allowed_statuses: allowed_statuses(&status)
            .iter()
            .map(|value| json!({ "status": value, "labelFa": status_label(value) }))
            .collect(),
        status,
        note: row.get("note"),
        created_by_name: row.get("created_by_name"),
        created_at: row.get("created_at"),
    }
}

const RESERVATION_SELECT: &str = "SELECT r.id, r.customer_name, r.customer_phone, r.guest_count,
       r.reserved_for, r.duration_minutes, r.table_id, t.code AS table_code,
       t.name_fa AS table_name_fa, t.capacity AS table_capacity, r.status, r.note,
       u.full_name AS created_by_name, r.created_at
  FROM reservations r
  LEFT JOIN dining_tables t ON t.id = r.table_id
  LEFT JOIN users u ON u.id = r.created_by_user_id";

async fn find_reservation(state: &AppState, id: &str) -> Result<ReservationDto, AppError> {
    let row = sqlx::query(&format!("{RESERVATION_SELECT} WHERE r.id = $1"))
        .bind(id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    row.as_ref()
        .map(reservation_from_row)
        .ok_or_else(|| not_found("رزرو یافت نشد.", "RESERVATION_NOT_FOUND"))
}

pub async fn list_reservations(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "reservations.read").await?;
    crate::admin::require_module(&state, cafeflow_domain::ModuleKey::Reservations).await?;
    let mut clauses = Vec::new();
    let mut values: Vec<String> = Vec::new();
    if let Some(date) = query.get("date").filter(|value| !value.is_empty()) {
        let (start, end) = crate::dates::day_bounds(crate::dates::parse_day(date, "تاریخ")?)?;
        values.push(start);
        clauses.push(format!("r.reserved_for >= ${}", values.len()));
        values.push(end);
        clauses.push(format!("r.reserved_for < ${}", values.len()));
    }
    if let Some(status) = query.get("status").filter(|value| !value.is_empty()) {
        values.push(status.clone());
        clauses.push(format!("r.status = ${}", values.len()));
    }
    if let Some(table) = query.get("tableId").filter(|value| !value.is_empty()) {
        values.push(table.clone());
        clauses.push(format!("r.table_id = ${}", values.len()));
    }
    if query.get("scope").map(String::as_str).unwrap_or("upcoming") == "upcoming"
        && !query.contains_key("date")
    {
        values.push(
            (OffsetDateTime::now_utc() - time::Duration::hours(1))
                .format(&Rfc3339)
                .unwrap_or_default(),
        );
        clauses.push(format!("r.reserved_for >= ${}", values.len()));
    }
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    let limit_index = values.len() + 1;
    let sql = format!(
        "{RESERVATION_SELECT} {where_sql} ORDER BY r.reserved_for ASC LIMIT ${limit_index}"
    );
    let mut statement = sqlx::query(&sql);
    for value in &values {
        statement = statement.bind(value);
    }
    let rows = statement
        .bind(200_i64)
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?;
    let items: Vec<ReservationDto> = rows.iter().map(reservation_from_row).collect();

    let counts = sqlx::query(
        "SELECT status, COUNT(*) AS n FROM reservations
          WHERE status IN ('pending', 'confirmed', 'seated') GROUP BY status",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let mut summary = json!({ "pending": 0, "confirmed": 0, "seated": 0 });
    for row in counts {
        let status: String = row.get("status");
        summary[&status] = json!(row.get::<i64, _>("n"));
    }
    Ok(Json(json!({ "items": items, "summary": summary })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateReservationInput {
    customer_name: String,
    customer_phone: String,
    guest_count: i64,
    reserved_for: String,
    #[serde(default = "default_duration")]
    duration_minutes: i64,
    table_id: Option<String>,
    note: Option<String>,
}

fn default_duration() -> i64 {
    90
}

pub async fn create_reservation(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<ReservationDto>, AppError> {
    let session = guard(&state, &headers, "reservations.write").await?;
    crate::admin::require_module(&state, cafeflow_domain::ModuleKey::Reservations).await?;
    let input: CreateReservationInput = parse_body(&body)?;
    if !(2..=80).contains(&input.customer_name.trim().chars().count()) {
        return Err(validation_failed("نام مشتری الزامی است."));
    }
    let phone = normalize_phone(&input.customer_phone);
    if !(7..=15).contains(&phone.len()) {
        return Err(validation_failed("شماره تماس معتبر نیست."));
    }
    if !(1..=60).contains(&input.guest_count) {
        return Err(validation_failed("تعداد مهمان باید بین ۱ تا ۶۰ باشد."));
    }
    if !(15..=480).contains(&input.duration_minutes) {
        return Err(validation_failed(
            "مدت رزرو باید بین ۱۵ دقیقه تا ۸ ساعت باشد.",
        ));
    }
    if input
        .note
        .as_deref()
        .is_some_and(|value| value.chars().count() > 300)
    {
        return Err(validation_failed("یادداشت بیش از حد طولانی است."));
    }
    let reserved_for = parse_time(&input.reserved_for)
        .ok_or_else(|| validation_failed("زمان رزرو معتبر نیست."))?;
    let now = OffsetDateTime::now_utc();
    if reserved_for < now - time::Duration::hours(1) {
        return Err(bad_request(
            "زمان رزرو نمی‌تواند در گذشته باشد.",
            "RESERVATION_IN_PAST",
        ));
    }
    if reserved_for > now + time::Duration::days(365) {
        return Err(bad_request(
            "رزرو بیش از یک سال آینده ممکن نیست.",
            "RESERVATION_TOO_FAR",
        ));
    }
    if let Some(table_id) = &input.table_id {
        let table = sqlx::query(
            "SELECT id, name_fa, capacity FROM dining_tables
              WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(table_id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
        let Some(table) = table else {
            return Err(not_found("میز انتخابی یافت نشد.", "TABLE_NOT_FOUND"));
        };
        let capacity: i64 = table.get("capacity");
        if input.guest_count > capacity {
            let table_name: String = table.get("name_fa");
            return Err(bad_request(
                format!(
                    "ظرفیت {table_name} برابر {capacity} نفر است و برای {} مهمان کافی نیست.",
                    input.guest_count
                ),
                "CAPACITY_EXCEEDED",
            )
            .with_details(json!({
                "tableId": table_id,
                "capacity": capacity,
                "guestCount": input.guest_count,
            })));
        }
        let existing = sqlx::query(
            "SELECT r.id, r.reserved_for, r.duration_minutes FROM reservations r
              WHERE r.table_id = $1 AND r.status IN ('pending', 'confirmed', 'seated')",
        )
        .bind(table_id)
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?;
        let end = reserved_for + time::Duration::minutes(input.duration_minutes);
        for row in existing {
            let start: String = row.get("reserved_for");
            let duration: i64 = row.get("duration_minutes");
            if let Some(start) = parse_time(&start) {
                let existing_end = start + time::Duration::minutes(duration);
                if start < end && reserved_for < existing_end {
                    return Err(conflict(
                        "این میز در این بازه رزرو دیگری دارد.",
                        "RESERVATION_CONFLICT",
                    )
                    .with_details(json!({
                        "conflictId": row.get::<String, _>("id"),
                        "reservedFor": start.format(&Rfc3339).unwrap_or_default(),
                        "durationMinutes": duration,
                    })));
                }
            }
        }
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO reservations
           (id, customer_name, customer_phone, guest_count, reserved_for, duration_minutes,
            table_id, status, note, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)",
    )
    .bind(&id)
    .bind(input.customer_name.trim())
    .bind(&phone)
    .bind(input.guest_count)
    .bind(reserved_for.format(&Rfc3339).unwrap_or_default())
    .bind(input.duration_minutes)
    .bind(&input.table_id)
    .bind(input.note.as_deref().map(str::trim))
    .bind(&session.user.id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "reservation.created".into(),
            entity_type: "reservation".into(),
            entity_id: Some(id.clone()),
            after_json: Some(
                json!({
                    "customerName": input.customer_name.trim(),
                    "guestCount": input.guest_count,
                    "reservedFor": reserved_for.format(&Rfc3339).unwrap_or_default(),
                    "tableId": input.table_id,
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(find_reservation(&state, &id).await?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReservationStatusInput {
    status: String,
    reason: Option<String>,
}

pub async fn set_reservation_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<ReservationDto>, AppError> {
    let session = guard(&state, &headers, "reservations.write").await?;
    crate::admin::require_module(&state, cafeflow_domain::ModuleKey::Reservations).await?;
    let input: ReservationStatusInput = parse_body(&body)?;
    if !STATUSES.contains(&input.status.as_str()) {
        return Err(validation_failed("وضعیت رزرو نامعتبر است."));
    }
    let reservation = find_reservation(&state, &id).await?;
    if reservation.status == input.status {
        return Ok(Json(reservation));
    }
    if !allowed_statuses(&reservation.status).contains(&input.status.as_str()) {
        return Err(conflict(
            format!(
                "تغییر وضعیت از «{}» به «{}» مجاز نیست.",
                reservation.status_label_fa,
                status_label(&input.status)
            ),
            "RESERVATION_TRANSITION_INVALID",
        ));
    }
    if let Some(table_id) = &reservation.table_id {
        if input.status == "seated" {
            let open = sqlx::query(
                "SELECT COUNT(*) AS n FROM table_sessions
                  WHERE table_id = $1 AND closed_at IS NULL",
            )
            .bind(table_id)
            .fetch_one(&state.db.pool)
            .await
            .map_err(db_error)?
            .get::<i64, _>("n");
            if open > 0 {
                return Err(conflict("این میز هم‌اکنون نشست باز دارد.", "TABLE_OCCUPIED"));
            }
        }
        let table = sqlx::query("SELECT status FROM dining_tables WHERE id = $1")
            .bind(table_id)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?;
        let table_status: Option<String> = table.as_ref().map(|row| row.get("status"));
        let next = if input.status == "confirmed" && table_status.as_deref() == Some("available") {
            Some("reserved")
        } else if input.status == "seated" {
            Some("occupied")
        } else if matches!(input.status.as_str(), "cancelled" | "no_show")
            && table_status.as_deref() == Some("reserved")
        {
            Some("available")
        } else {
            None
        };
        if let Some(next) = next {
            sqlx::query("UPDATE dining_tables SET status = $1 WHERE id = $2")
                .bind(next)
                .bind(table_id)
                .execute(&state.db.pool)
                .await
                .map_err(db_error)?;
        }
    }
    sqlx::query(
        "UPDATE reservations SET status = $1, decided_by_user_id = $2, updated_at = $3
          WHERE id = $4",
    )
    .bind(&input.status)
    .bind(&session.user.id)
    .bind(
        OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_default(),
    )
    .bind(&id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "reservation.status_changed".into(),
            entity_type: "reservation".into(),
            entity_id: Some(id.clone()),
            before_json: Some(json!({ "status": reservation.status }).to_string()),
            after_json: Some(json!({ "status": input.status, "reason": input.reason }).to_string()),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(find_reservation(&state, &id).await?))
}

/* -------------------------------- employees ------------------------------- */

fn employee_status_label(status: &str) -> &str {
    match status {
        "active" => "فعال",
        "on_leave" => "مرخصی",
        "inactive" => "غیرفعال",
        other => other,
    }
}

fn shift_status_label(status: &str) -> &str {
    match status {
        "scheduled" => "برنامه‌ریزی‌شده",
        "completed" => "انجام‌شده",
        "cancelled" => "لغو‌شده",
        other => other,
    }
}

const EMPLOYEE_SELECT: &str =
    "SELECT e.id, e.user_id, u.full_name, u.username, u.is_active AS is_user_active,
       e.employee_code, e.department_id, d.name_fa AS department_name_fa,
       e.floor_id, f.name_fa AS floor_name_fa, e.position_fa, e.hired_at, e.status,
       (SELECT COUNT(*) FROM shifts s WHERE s.employee_id = e.id AND s.status <> 'cancelled'
          AND s.starts_at >= $1 AND s.starts_at < $2) AS shifts_this_week
  FROM employees e
  JOIN users u ON u.id = e.user_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN floors f ON f.id = e.floor_id";

fn employee_from_row(row: &sqlx::any::AnyRow) -> Value {
    let status: String = row.get("status");
    json!({
        "id": row.get::<String, _>("id"),
        "userId": row.get::<String, _>("user_id"),
        "fullName": row.get::<String, _>("full_name"),
        "username": row.get::<String, _>("username"),
        "employeeCode": row.get::<Option<String>, _>("employee_code"),
        "departmentId": row.get::<Option<String>, _>("department_id"),
        "departmentNameFa": row.get::<Option<String>, _>("department_name_fa"),
        "floorId": row.get::<Option<String>, _>("floor_id"),
        "floorNameFa": row.get::<Option<String>, _>("floor_name_fa"),
        "positionFa": row.get::<Option<String>, _>("position_fa"),
        "hiredAt": row.get::<Option<String>, _>("hired_at"),
        "status": status,
        "statusLabelFa": employee_status_label(&status),
        "isUserActive": row.get::<i64, _>("is_user_active") == 1,
        "shiftsThisWeek": row.get::<i64, _>("shifts_this_week"),
    })
}

pub async fn list_employees(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "users.read").await?;
    crate::admin::require_module(&state, cafeflow_domain::ModuleKey::Employees).await?;
    let now = OffsetDateTime::now_utc();
    let week_start = now.format(&Rfc3339).unwrap_or_default();
    let week_end = (now + time::Duration::days(7))
        .format(&Rfc3339)
        .unwrap_or_default();
    let rows = sqlx::query(&format!(
        "{EMPLOYEE_SELECT} WHERE u.deleted_at IS NULL
         ORDER BY CASE e.status WHEN 'active' THEN 0 WHEN 'on_leave' THEN 1 ELSE 2 END,
                  u.full_name ASC"
    ))
    .bind(&week_start)
    .bind(&week_end)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let items: Vec<Value> = rows.iter().map(employee_from_row).collect();
    let active = items
        .iter()
        .filter(|value| value["status"] == "active")
        .count();
    let on_leave = items
        .iter()
        .filter(|value| value["status"] == "on_leave")
        .count();
    let candidates = sqlx::query(
        "SELECT u.id, u.full_name, u.username FROM users u
           LEFT JOIN employees e ON e.user_id = u.id
          WHERE u.deleted_at IS NULL AND e.id IS NULL ORDER BY u.full_name",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let departments = sqlx::query("SELECT id, name_fa FROM departments ORDER BY name_fa")
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?;
    let floors = sqlx::query("SELECT id, name_fa FROM floors ORDER BY sort_order")
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?;
    Ok(Json(json!({
        "items": items,
        "summary": { "total": items.len(), "active": active, "onLeave": on_leave },
        "candidates": candidates.iter().map(|row| json!({
            "id": row.get::<String, _>("id"),
            "fullName": row.get::<String, _>("full_name"),
            "username": row.get::<String, _>("username"),
        })).collect::<Vec<_>>(),
        "departments": departments.iter().map(|row| json!({
            "id": row.get::<String, _>("id"),
            "nameFa": row.get::<String, _>("name_fa"),
        })).collect::<Vec<_>>(),
        "floors": floors.iter().map(|row| json!({
            "id": row.get::<String, _>("id"),
            "nameFa": row.get::<String, _>("name_fa"),
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateEmployeeInput {
    user_id: String,
    employee_code: Option<String>,
    department_id: Option<String>,
    floor_id: Option<String>,
    position_fa: Option<String>,
    hired_at: Option<String>,
    #[serde(default = "active_status")]
    status: String,
}

fn active_status() -> String {
    "active".into()
}

async fn find_employee(state: &AppState, id: &str) -> Result<Value, AppError> {
    let now = OffsetDateTime::now_utc();
    let row = sqlx::query(&format!("{EMPLOYEE_SELECT} WHERE e.id = $3"))
        .bind(now.format(&Rfc3339).unwrap_or_default())
        .bind(
            (now + time::Duration::days(7))
                .format(&Rfc3339)
                .unwrap_or_default(),
        )
        .bind(id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    row.as_ref()
        .map(employee_from_row)
        .ok_or_else(|| not_found("کارمند یافت نشد.", "EMPLOYEE_NOT_FOUND"))
}

pub async fn create_employee(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "users.write").await?;
    crate::admin::require_module(&state, cafeflow_domain::ModuleKey::Employees).await?;
    let input: CreateEmployeeInput = parse_body(&body)?;
    if !matches!(input.status.as_str(), "active" | "on_leave" | "inactive") {
        return Err(validation_failed("وضعیت کارمند نامعتبر است."));
    }
    let user = sqlx::query("SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL")
        .bind(&input.user_id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    if user.is_none() {
        return Err(not_found("کاربر انتخاب‌شده یافت نشد.", "USER_NOT_FOUND"));
    }
    let existing = sqlx::query("SELECT id FROM employees WHERE user_id = $1")
        .bind(&input.user_id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    if existing.is_some() {
        return Err(conflict(
            "برای این کاربر قبلاً پروفایل کارمند ساخته شده است.",
            "EMPLOYEE_EXISTS",
        ));
    }
    if let Some(code) = &input.employee_code {
        let taken = sqlx::query("SELECT id FROM employees WHERE employee_code = $1")
            .bind(code)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?;
        if taken.is_some() {
            return Err(conflict(
                "این کد پرسنلی قبلاً ثبت شده است.",
                "EMPLOYEE_CODE_TAKEN",
            ));
        }
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO employees
           (id, user_id, employee_code, department_id, floor_id, position_fa, hired_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(&id)
    .bind(&input.user_id)
    .bind(input.employee_code.as_deref())
    .bind(input.department_id.as_deref())
    .bind(input.floor_id.as_deref())
    .bind(input.position_fa.as_deref())
    .bind(input.hired_at.as_deref())
    .bind(&input.status)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "employee.created".into(),
            entity_type: "employee".into(),
            entity_id: Some(id.clone()),
            after_json: Some(
                json!({
                    "userId": input.user_id,
                    "positionFa": input.position_fa,
                    "status": input.status,
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(find_employee(&state, &id).await?))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct UpdateEmployeeInput {
    employee_code: Option<String>,
    department_id: Option<Option<String>>,
    floor_id: Option<Option<String>>,
    position_fa: Option<Option<String>>,
    hired_at: Option<Option<String>>,
    status: Option<String>,
}

pub async fn update_employee(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "users.write").await?;
    crate::admin::require_module(&state, cafeflow_domain::ModuleKey::Employees).await?;
    let input: UpdateEmployeeInput = parse_body(&body)?;
    let before = find_employee(&state, &id).await?;
    if input.employee_code.is_none()
        && input.department_id.is_none()
        && input.floor_id.is_none()
        && input.position_fa.is_none()
        && input.hired_at.is_none()
        && input.status.is_none()
    {
        return Err(validation_failed("حداقل یک تغییر لازم است."));
    }
    if let Some(status) = &input.status
        && !matches!(status.as_str(), "active" | "on_leave" | "inactive")
    {
        return Err(validation_failed("وضعیت کارمند نامعتبر است."));
    }
    if let Some(code) = &input.employee_code {
        let taken = sqlx::query("SELECT id FROM employees WHERE employee_code = $1 AND id <> $2")
            .bind(code)
            .bind(&id)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?;
        if taken.is_some() {
            return Err(conflict(
                "این کد پرسنلی قبلاً ثبت شده است.",
                "EMPLOYEE_CODE_TAKEN",
            ));
        }
    }
    macro_rules! set_opt {
        ($field:expr, $column:expr) => {
            if let Some(value) = &$field {
                sqlx::query(&format!(
                    "UPDATE employees SET {} = $1 WHERE id = $2",
                    $column
                ))
                .bind(value.as_deref())
                .bind(&id)
                .execute(&state.db.pool)
                .await
                .map_err(db_error)?;
            }
        };
    }
    if let Some(code) = &input.employee_code {
        sqlx::query("UPDATE employees SET employee_code = $1 WHERE id = $2")
            .bind(code.as_str())
            .bind(&id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    set_opt!(input.department_id, "department_id");
    set_opt!(input.floor_id, "floor_id");
    set_opt!(input.position_fa, "position_fa");
    set_opt!(input.hired_at, "hired_at");
    if let Some(status) = &input.status {
        sqlx::query("UPDATE employees SET status = $1 WHERE id = $2")
            .bind(status)
            .bind(&id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "employee.updated".into(),
            entity_type: "employee".into(),
            entity_id: Some(id.clone()),
            before_json: Some(before.to_string()),
            after_json: Some(
                json!({
                    "employeeCode": input.employee_code,
                    "status": input.status,
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(find_employee(&state, &id).await?))
}

/* ---------------------------------- shifts -------------------------------- */

const SHIFT_SELECT: &str = "SELECT s.id, s.employee_id, u.full_name AS employee_name,
       d.name_fa AS department_name_fa, s.starts_at, s.ends_at, s.status, s.note,
       s.checked_in_at, s.checked_out_at
  FROM shifts s
  JOIN employees e ON e.id = s.employee_id
  JOIN users u ON u.id = e.user_id
  LEFT JOIN departments d ON d.id = e.department_id";

fn hours_between(from: &str, to: &str) -> f64 {
    match (parse_time(from), parse_time(to)) {
        (Some(from), Some(to)) => ((to - from).as_seconds_f64() / 3600.0).max(0.0),
        _ => 0.0,
    }
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn shift_from_row(row: &sqlx::any::AnyRow) -> Value {
    let start: String = row.get("starts_at");
    let end: String = row.get("ends_at");
    let status: String = row.get("status");
    let checked_in: Option<String> = row.get("checked_in_at");
    let checked_out: Option<String> = row.get("checked_out_at");
    let worked = match (&checked_in, &checked_out) {
        (Some(from), Some(to)) => round2(hours_between(from, to)),
        _ => 0.0,
    };
    json!({
        "id": row.get::<String, _>("id"),
        "employeeId": row.get::<String, _>("employee_id"),
        "employeeName": row.get::<String, _>("employee_name"),
        "departmentNameFa": row.get::<Option<String>, _>("department_name_fa"),
        "startsAt": start,
        "endsAt": end,
        "durationHours": round2(hours_between(&start, &end)),
        "status": status,
        "statusLabelFa": shift_status_label(&status),
        "note": row.get::<Option<String>, _>("note"),
        "checkedInAt": checked_in,
        "checkedOutAt": checked_out,
        "workedHours": worked,
    })
}

async fn find_shift(state: &AppState, id: &str) -> Result<Value, AppError> {
    let row = sqlx::query(&format!("{SHIFT_SELECT} WHERE s.id = $1"))
        .bind(id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    row.as_ref()
        .map(shift_from_row)
        .ok_or_else(|| not_found("شیفت یافت نشد.", "SHIFT_NOT_FOUND"))
}

fn day_range(
    query: &HashMap<String, String>,
    default_days: i64,
) -> Result<(String, String, String, String), AppError> {
    let today = crate::dates::tehran_today();
    let from = query
        .get("from")
        .filter(|value| !value.trim().is_empty())
        .map(|value| crate::dates::parse_day(value, "تاریخ شروع"))
        .transpose()?
        .unwrap_or(today);
    let to = query
        .get("to")
        .filter(|value| !value.trim().is_empty())
        .map(|value| crate::dates::parse_day(value, "تاریخ پایان"))
        .transpose()?
        .unwrap_or(crate::dates::add_days(from, default_days)?);
    if from > to {
        return Err(bad_request(
            "تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.",
            "INVALID_DATE_RANGE",
        ));
    }
    let (start_iso, end_iso) = crate::dates::range_bounds(from, to)?;
    Ok((from.to_string(), to.to_string(), start_iso, end_iso))
}

pub async fn list_shifts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "shifts.read").await?;
    crate::admin::require_module(&state, cafeflow_domain::ModuleKey::Employees).await?;
    let (from, to, start_iso, end_iso) = day_range(&query, 14)?;
    let rows = sqlx::query(&format!(
        "{SHIFT_SELECT} WHERE s.starts_at >= $1 AND s.starts_at < $2 ORDER BY s.starts_at"
    ))
    .bind(&start_iso)
    .bind(&end_iso)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let items: Vec<Value> = rows.iter().map(shift_from_row).collect();
    let scheduled = items
        .iter()
        .filter(|value| value["status"] == "scheduled")
        .count();
    let completed = items
        .iter()
        .filter(|value| value["status"] == "completed")
        .count();
    let hours: f64 = items
        .iter()
        .filter_map(|value| value["durationHours"].as_f64())
        .sum();
    Ok(Json(json!({
        "from": from,
        "to": to,
        "items": items,
        "summary": {
            "scheduled": scheduled,
            "completed": completed,
            "hours": round2(hours),
        },
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateShiftInput {
    employee_id: String,
    starts_at: String,
    ends_at: String,
    note: Option<String>,
}

pub async fn create_shift(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "shifts.write").await?;
    crate::admin::require_module(&state, cafeflow_domain::ModuleKey::Employees).await?;
    let input: CreateShiftInput = parse_body(&body)?;
    let employee = sqlx::query("SELECT status FROM employees WHERE id = $1")
        .bind(&input.employee_id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    let Some(employee) = employee else {
        return Err(not_found("کارمند یافت نشد.", "EMPLOYEE_NOT_FOUND"));
    };
    if employee.get::<String, _>("status") == "inactive" {
        return Err(bad_request(
            "برای کارمند غیرفعال نمی‌توان شیفت ثبت کرد.",
            "EMPLOYEE_INACTIVE",
        ));
    }
    let starts =
        parse_time(&input.starts_at).ok_or_else(|| validation_failed("زمان شروع معتبر نیست."))?;
    let ends =
        parse_time(&input.ends_at).ok_or_else(|| validation_failed("زمان پایان معتبر نیست."))?;
    if ends <= starts || ends - starts > time::Duration::hours(24) {
        return Err(validation_failed("بازه شیفت معتبر نیست."));
    }
    let starts_iso = starts.format(&Rfc3339).unwrap_or_default();
    let ends_iso = ends.format(&Rfc3339).unwrap_or_default();
    let overlap = sqlx::query(
        "SELECT id FROM shifts WHERE employee_id = $1 AND status <> 'cancelled'
          AND starts_at < $2 AND ends_at > $3 LIMIT 1",
    )
    .bind(&input.employee_id)
    .bind(&ends_iso)
    .bind(&starts_iso)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    if overlap.is_some() {
        return Err(conflict(
            "این کارمند در این بازه شیفت دیگری دارد.",
            "SHIFT_CONFLICT",
        ));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO shifts (id, employee_id, starts_at, ends_at, note, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&id)
    .bind(&input.employee_id)
    .bind(&starts_iso)
    .bind(&ends_iso)
    .bind(input.note.as_deref().map(str::trim))
    .bind(&session.user.id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "shift.created".into(),
            entity_type: "shift".into(),
            entity_id: Some(id.clone()),
            after_json: Some(
                json!({ "employeeId": input.employee_id, "startsAt": starts_iso, "endsAt": ends_iso })
                    .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(find_shift(&state, &id).await?))
}

async fn shift_action(
    state: &AppState,
    headers: &HeaderMap,
    id: &str,
    action: &str,
) -> Result<Json<Value>, AppError> {
    let session = guard(state, headers, "shifts.write").await?;
    crate::admin::require_module(state, cafeflow_domain::ModuleKey::Employees).await?;
    let shift = find_shift(state, id).await?;
    let status = shift["status"].as_str().unwrap_or_default();
    let checked_in = shift["checkedInAt"].as_str();
    let checked_out = shift["checkedOutAt"].as_str();
    match action {
        "check-in" => {
            if status == "cancelled" {
                return Err(bad_request(
                    "شیفت لغو‌شده قابل ثبت حضور نیست.",
                    "SHIFT_CANCELLED",
                ));
            }
            if checked_in.is_some() {
                return Err(conflict(
                    "حضور این شیفت قبلاً ثبت شده است.",
                    "SHIFT_ALREADY_CHECKED_IN",
                ));
            }
            sqlx::query("UPDATE shifts SET checked_in_at = $1 WHERE id = $2")
                .bind(
                    OffsetDateTime::now_utc()
                        .format(&Rfc3339)
                        .unwrap_or_default(),
                )
                .bind(id)
                .execute(&state.db.pool)
                .await
                .map_err(db_error)?;
        }
        "check-out" => {
            if checked_in.is_none() {
                return Err(bad_request(
                    "ابتدا حضور را ثبت کنید.",
                    "SHIFT_NOT_CHECKED_IN",
                ));
            }
            if checked_out.is_some() {
                return Err(conflict(
                    "خروج این شیفت قبلاً ثبت شده است.",
                    "SHIFT_ALREADY_CHECKED_OUT",
                ));
            }
            sqlx::query(
                "UPDATE shifts SET checked_out_at = $1, status = 'completed' WHERE id = $2",
            )
            .bind(
                OffsetDateTime::now_utc()
                    .format(&Rfc3339)
                    .unwrap_or_default(),
            )
            .bind(id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
        }
        "cancel" => {
            if status != "scheduled" {
                return Err(bad_request(
                    "فقط شیفت برنامه‌ریزی‌شده قابل لغو است.",
                    "SHIFT_NOT_CANCELLABLE",
                ));
            }
            sqlx::query("UPDATE shifts SET status = 'cancelled' WHERE id = $1")
                .bind(id)
                .execute(&state.db.pool)
                .await
                .map_err(db_error)?;
        }
        _ => return Err(validation_failed("عملیات شیفت نامعتبر است.")),
    }
    record(
        state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: format!("shift.{}", action.replace('-', "_")),
            entity_type: "shift".into(),
            entity_id: Some(id.to_string()),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(find_shift(state, id).await?))
}

pub async fn check_in(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    shift_action(&state, &headers, &id, "check-in").await
}

pub async fn check_out(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    shift_action(&state, &headers, &id, "check-out").await
}

pub async fn cancel_shift(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    shift_action(&state, &headers, &id, "cancel").await
}

pub async fn performance(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "users.read").await?;
    crate::admin::require_module(&state, cafeflow_domain::ModuleKey::Employees).await?;
    let (from, to, start_iso, end_iso) = day_range(&query, 0)?;
    let employees = sqlx::query(
        "SELECT e.id AS employee_id, e.user_id, u.full_name, e.position_fa,
                d.name_fa AS department_name_fa
           FROM employees e
           JOIN users u ON u.id = e.user_id
           LEFT JOIN departments d ON d.id = e.department_id
          WHERE u.deleted_at IS NULL ORDER BY u.full_name",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let shifts = sqlx::query(
        "SELECT employee_id, starts_at, ends_at, checked_in_at, checked_out_at
           FROM shifts WHERE status <> 'cancelled' AND starts_at >= $1 AND starts_at < $2",
    )
    .bind(&start_iso)
    .bind(&end_iso)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let orders = sqlx::query(
        "SELECT user_id, COUNT(DISTINCT id) AS orders FROM (
           SELECT id, waiter_user_id AS user_id FROM orders
            WHERE status = 'paid' AND paid_at >= $1 AND paid_at < $2 AND waiter_user_id IS NOT NULL
           UNION ALL
           SELECT id, created_by_user_id AS user_id FROM orders
            WHERE status = 'paid' AND paid_at >= $1 AND paid_at < $2 AND created_by_user_id IS NOT NULL
         ) GROUP BY user_id",
    )
    .bind(&start_iso)
    .bind(&end_iso)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let revenue = sqlx::query(
        "SELECT received_by_user_id AS user_id,
                COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount
                                  WHEN status = 'refunded' THEN -amount ELSE 0 END), 0) AS total,
                COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) AS count
           FROM payments WHERE paid_at >= $1 AND paid_at < $2
             AND received_by_user_id IS NOT NULL GROUP BY received_by_user_id",
    )
    .bind(&start_iso)
    .bind(&end_iso)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let order_map: HashMap<String, i64> = orders
        .iter()
        .map(|row| (row.get("user_id"), row.get("orders")))
        .collect();
    let revenue_map: HashMap<String, (i64, i64)> = revenue
        .iter()
        .map(|row| (row.get("user_id"), (row.get("total"), row.get("count"))))
        .collect();
    let mut items = Vec::new();
    let mut total_worked = 0.0;
    let mut total_orders = 0i64;
    let mut total_revenue = 0i64;
    for employee in &employees {
        let employee_id: String = employee.get("employee_id");
        let user_id: String = employee.get("user_id");
        let mut count = 0i64;
        let mut scheduled = 0.0;
        let mut worked = 0.0;
        for row in &shifts {
            if row.get::<String, _>("employee_id") != employee_id {
                continue;
            }
            count += 1;
            let starts: String = row.get("starts_at");
            let ends: String = row.get("ends_at");
            scheduled += hours_between(&starts, &ends);
            if let (Some(start), Some(end)) = (
                row.get::<Option<String>, _>("checked_in_at"),
                row.get::<Option<String>, _>("checked_out_at"),
            ) {
                worked += hours_between(&start, &end);
            }
        }
        let order_count = *order_map.get(&user_id).unwrap_or(&0);
        let (revenue_total, payments_count) = *revenue_map.get(&user_id).unwrap_or(&(0, 0));
        total_worked += worked;
        total_orders += order_count;
        total_revenue += revenue_total;
        items.push(json!({
            "employeeId": employee_id,
            "fullName": employee.get::<String, _>("full_name"),
            "positionFa": employee.get::<Option<String>, _>("position_fa"),
            "departmentNameFa": employee.get::<Option<String>, _>("department_name_fa"),
            "shifts": count,
            "scheduledHours": round2(scheduled),
            "workedHours": round2(worked),
            "ordersServed": order_count,
            "paymentsCount": payments_count,
            "revenue": revenue_total,
        }));
    }
    Ok(Json(json!({
        "from": from,
        "to": to,
        "items": items,
        "totals": {
            "workedHours": round2(total_worked),
            "ordersServed": total_orders,
            "revenue": total_revenue,
        },
    })))
}
