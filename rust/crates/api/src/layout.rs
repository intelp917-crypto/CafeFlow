//! Floor-plan designer, tables and table QR codes.

use std::collections::{HashMap, HashSet};
use std::io::Cursor;

use axum::Json;
use axum::body::{Body, Bytes};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use cafeflow_db::AuditEntry;
use image::{ImageFormat, Rgba};
use qrcode::QrCode;
use qrcode::render::svg;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Row;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::admin::{db_error, guard, parse_body, record};
use crate::error::{AppError, bad_request, conflict, not_found, validation_failed};
use crate::state::AppState;

const FLOOR_KINDS: [&str; 7] = [
    "indoor", "vip", "family", "roof", "outdoor", "kitchen", "other",
];
const SHAPES: [&str; 3] = ["square", "round", "rectangle"];
const OBJECT_TYPES: [&str; 10] = [
    "table", "chair", "bar", "kitchen", "sofa", "service", "entrance", "exit", "zone", "other",
];

fn now() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

async fn require_floor(state: &AppState, id: &str) -> Result<sqlx::any::AnyRow, AppError> {
    sqlx::query("SELECT id, name_fa, kind, sort_order, is_active FROM floors WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?
        .ok_or_else(|| not_found("طبقه یافت نشد.", "FLOOR_NOT_FOUND"))
}

async fn find_table(state: &AppState, id: &str) -> Result<sqlx::any::AnyRow, AppError> {
    sqlx::query(
        "SELECT id, floor_id, area_id, code, name_fa, capacity, shape, status,
                waiter_user_id, qr_token, is_active
           FROM dining_tables WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .ok_or_else(|| not_found("میز یافت نشد.", "TABLE_NOT_FOUND"))
}

fn table_json(row: &sqlx::any::AnyRow) -> Value {
    let shape: String = row.get("shape");
    json!({
        "id": row.get::<String, _>("id"),
        "code": row.get::<String, _>("code"),
        "nameFa": row.get::<String, _>("name_fa"),
        "capacity": row.get::<i64, _>("capacity"),
        "shape": if SHAPES.contains(&shape.as_str()) { shape.as_str() } else { "square" },
        "status": row.get::<String, _>("status"),
        "areaId": row.get::<Option<String>, _>("area_id"),
        "waiterUserId": row.get::<Option<String>, _>("waiter_user_id"),
        "isActive": row.get::<i64, _>("is_active") == 1,
        "hasQr": row.get::<Option<String>, _>("qr_token").is_some(),
    })
}

fn object_json(row: &sqlx::any::AnyRow) -> Value {
    let object_type: String = row.get("type");
    let props: Option<String> = row.get("props_json");
    json!({
        "id": row.get::<String, _>("id"),
        "type": if OBJECT_TYPES.contains(&object_type.as_str()) { object_type.as_str() } else { "other" },
        "tableId": row.get::<Option<String>, _>("ref_table_id"),
        "x": row.get::<f64, _>("x"),
        "y": row.get::<f64, _>("y"),
        "width": row.get::<f64, _>("width"),
        "height": row.get::<f64, _>("height"),
        "rotation": row.get::<f64, _>("rotation"),
        "zIndex": row.get::<i64, _>("z_index"),
        "layer": row.get::<String, _>("layer"),
        "locked": row.get::<i64, _>("is_locked") == 1,
        "groupId": row.get::<Option<String>, _>("group_id"),
        "props": props.and_then(|value| serde_json::from_str::<Value>(&value).ok())
            .filter(Value::is_object).unwrap_or_else(|| json!({})),
    })
}

async fn ensure_plan(state: &AppState, floor_id: &str) -> Result<Value, AppError> {
    require_floor(state, floor_id).await?;
    let existing =
        sqlx::query("SELECT id, width, height, grid_size FROM floorplans WHERE floor_id = $1")
            .bind(floor_id)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?;
    let plan_id = match existing {
        Some(row) => row.get::<String, _>("id"),
        None => {
            let plan_id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO floorplans (id, floor_id, width, height, grid_size)
                 VALUES ($1, $2, 1600, 1000, 20)",
            )
            .bind(&plan_id)
            .bind(floor_id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
            let tables = sqlx::query(
                "SELECT id, shape FROM dining_tables
                  WHERE floor_id = $1 AND deleted_at IS NULL ORDER BY code",
            )
            .bind(floor_id)
            .fetch_all(&state.db.pool)
            .await
            .map_err(db_error)?;
            for (index, table) in tables.iter().enumerate() {
                let shape: String = table.get("shape");
                let (width, height) = match shape.as_str() {
                    "round" => (110.0, 110.0),
                    "rectangle" => (130.0, 90.0),
                    _ => (130.0, 110.0),
                };
                sqlx::query(
                    "INSERT INTO floorplan_objects
                       (id, floorplan_id, type, ref_table_id, x, y, width, height, z_index, layer)
                     VALUES ($1, $2, 'table', $3, $4, $5, $6, $7, 10, 'tables')",
                )
                .bind(Uuid::new_v4().to_string())
                .bind(&plan_id)
                .bind(table.get::<String, _>("id"))
                .bind(90.0 + (index % 4) as f64 * 220.0)
                .bind(90.0 + (index / 4) as f64 * 200.0)
                .bind(width)
                .bind(height)
                .execute(&state.db.pool)
                .await
                .map_err(db_error)?;
            }
            plan_id
        }
    };
    let plan = sqlx::query("SELECT id, width, height, grid_size FROM floorplans WHERE id = $1")
        .bind(&plan_id)
        .fetch_one(&state.db.pool)
        .await
        .map_err(db_error)?;
    let objects =
        sqlx::query("SELECT * FROM floorplan_objects WHERE floorplan_id = $1 ORDER BY z_index, id")
            .bind(&plan_id)
            .fetch_all(&state.db.pool)
            .await
            .map_err(db_error)?;
    Ok(json!({
        "width": plan.get::<i64, _>("width"),
        "height": plan.get::<i64, _>("height"),
        "gridSize": plan.get::<i64, _>("grid_size"),
        "objects": objects.iter().map(object_json).collect::<Vec<_>>(),
    }))
}

pub async fn overview(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "layout.read").await?;
    let floors = sqlx::query(
        "SELECT id, name_fa, kind, sort_order, is_active FROM floors
          ORDER BY sort_order, name_fa",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let areas = sqlx::query(
        "SELECT id, floor_id, name_fa, is_active FROM areas ORDER BY sort_order, name_fa",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let tables = sqlx::query(
        "SELECT id, floor_id, area_id, code, name_fa, capacity, shape, status,
                waiter_user_id, qr_token, is_active
           FROM dining_tables WHERE deleted_at IS NULL ORDER BY code",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let mut items = Vec::new();
    for floor in &floors {
        let floor_id: String = floor.get("id");
        let plan = ensure_plan(&state, &floor_id).await?;
        let kind: String = floor.get("kind");
        items.push(json!({
            "id": floor_id,
            "nameFa": floor.get::<String, _>("name_fa"),
            "kind": if FLOOR_KINDS.contains(&kind.as_str()) { kind.as_str() } else { "indoor" },
            "sortOrder": floor.get::<i64, _>("sort_order"),
            "isActive": floor.get::<i64, _>("is_active") == 1,
            "areas": areas.iter().filter(|area| area.get::<String, _>("floor_id") == floor_id)
                .map(|area| json!({
                    "id": area.get::<String, _>("id"),
                    "nameFa": area.get::<String, _>("name_fa"),
                    "isActive": area.get::<i64, _>("is_active") == 1,
                })).collect::<Vec<_>>(),
            "plan": plan,
            "tables": tables.iter().filter(|table| table.get::<String, _>("floor_id") == floor_id)
                .map(table_json).collect::<Vec<_>>(),
        }));
    }
    let waiters = sqlx::query(
        "SELECT DISTINCT u.id, u.full_name FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
          WHERE u.deleted_at IS NULL AND u.is_active = 1
            AND r.key IN ('waiter', 'manager', 'super_admin')
          ORDER BY u.full_name",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(Json(json!({
        "floors": items,
        "waiters": waiters.iter().map(|row| json!({
            "id": row.get::<String, _>("id"),
            "fullName": row.get::<String, _>("full_name"),
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateFloorInput {
    name_fa: String,
    #[serde(default = "default_kind")]
    kind: String,
    sort_order: Option<i64>,
}

fn default_kind() -> String {
    "indoor".into()
}

pub async fn create_floor(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "layout.write").await?;
    let input: CreateFloorInput = parse_body(&body)?;
    if input.name_fa.trim().is_empty() || input.name_fa.chars().count() > 60 {
        return Err(validation_failed("نام طبقه را وارد کنید."));
    }
    if !FLOOR_KINDS.contains(&input.kind.as_str()) {
        return Err(validation_failed("نوع طبقه نامعتبر است."));
    }
    if input
        .sort_order
        .is_some_and(|value| !(0..=999).contains(&value))
    {
        return Err(validation_failed("ترتیب طبقه معتبر نیست."));
    }
    let count: i64 = sqlx::query("SELECT COUNT(*) AS n FROM floors")
        .fetch_one(&state.db.pool)
        .await
        .map_err(db_error)?
        .get("n");
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO floors (id, name_fa, kind, sort_order) VALUES ($1, $2, $3, $4)")
        .bind(&id)
        .bind(input.name_fa.trim())
        .bind(&input.kind)
        .bind(input.sort_order.unwrap_or(count))
        .execute(&state.db.pool)
        .await
        .map_err(db_error)?;
    sqlx::query(
        "INSERT INTO floorplans (id, floor_id, width, height, grid_size)
         VALUES ($1, $2, 1600, 1000, 20)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "layout.floor_created".into(),
            entity_type: "floor".into(),
            entity_id: Some(id.clone()),
            after_json: Some(
                json!({ "nameFa": input.name_fa.trim(), "kind": input.kind }).to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({ "id": id })))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct UpdateFloorInput {
    name_fa: Option<String>,
    kind: Option<String>,
    sort_order: Option<i64>,
    is_active: Option<bool>,
}

pub async fn update_floor(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(floor_id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "layout.write").await?;
    let input: UpdateFloorInput = parse_body(&body)?;
    let before = require_floor(&state, &floor_id).await?;
    if input.name_fa.is_none()
        && input.kind.is_none()
        && input.sort_order.is_none()
        && input.is_active.is_none()
    {
        return Err(validation_failed("حداقل یک تغییر لازم است."));
    }
    if let Some(name) = &input.name_fa
        && (name.trim().is_empty() || name.chars().count() > 60)
    {
        return Err(validation_failed("نام طبقه معتبر نیست."));
    }
    if let Some(kind) = &input.kind
        && !FLOOR_KINDS.contains(&kind.as_str())
    {
        return Err(validation_failed("نوع طبقه نامعتبر است."));
    }
    if let Some(order) = input.sort_order
        && !(0..=999).contains(&order)
    {
        return Err(validation_failed("ترتیب طبقه معتبر نیست."));
    }
    if let Some(name) = &input.name_fa {
        sqlx::query("UPDATE floors SET name_fa = $1 WHERE id = $2")
            .bind(name.trim())
            .bind(&floor_id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    if let Some(kind) = &input.kind {
        sqlx::query("UPDATE floors SET kind = $1 WHERE id = $2")
            .bind(kind)
            .bind(&floor_id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    if let Some(order) = input.sort_order {
        sqlx::query("UPDATE floors SET sort_order = $1 WHERE id = $2")
            .bind(order)
            .bind(&floor_id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    if let Some(active) = input.is_active {
        sqlx::query("UPDATE floors SET is_active = $1 WHERE id = $2")
            .bind(i64::from(active))
            .bind(&floor_id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "layout.floor_updated".into(),
            entity_type: "floor".into(),
            entity_id: Some(floor_id.clone()),
            before_json: Some(
                json!({
                    "nameFa": before.get::<String, _>("name_fa"),
                    "kind": before.get::<String, _>("kind"),
                    "sortOrder": before.get::<i64, _>("sort_order"),
                    "isActive": before.get::<i64, _>("is_active") == 1,
                })
                .to_string(),
            ),
            after_json: Some(
                json!({
                    "nameFa": input.name_fa,
                    "kind": input.kind,
                    "sortOrder": input.sort_order,
                    "isActive": input.is_active,
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({ "id": floor_id })))
}

pub async fn delete_floor(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(floor_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "layout.write").await?;
    let before = require_floor(&state, &floor_id).await?;
    let floors: i64 = sqlx::query("SELECT COUNT(*) AS n FROM floors")
        .fetch_one(&state.db.pool)
        .await
        .map_err(db_error)?
        .get("n");
    if floors <= 1 {
        return Err(conflict("دست‌کم یک طبقه باید باقی بماند.", "LAST_FLOOR"));
    }
    let tables: i64 = sqlx::query(
        "SELECT COUNT(*) AS n FROM dining_tables WHERE floor_id = $1 AND deleted_at IS NULL",
    )
    .bind(&floor_id)
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?
    .get("n");
    if tables > 0 {
        return Err(conflict(
            "این طبقه میز دارد؛ ابتدا میزها را جابه‌جا یا حذف کنید.",
            "FLOOR_HAS_TABLES",
        ));
    }
    sqlx::query("DELETE FROM floors WHERE id = $1")
        .bind(&floor_id)
        .execute(&state.db.pool)
        .await
        .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "layout.floor_deleted".into(),
            entity_type: "floor".into(),
            entity_id: Some(floor_id.clone()),
            before_json: Some(json!({ "nameFa": before.get::<String, _>("name_fa") }).to_string()),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({ "id": floor_id })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AreaInput {
    name_fa: String,
}

pub async fn create_area(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(floor_id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "layout.write").await?;
    let input: AreaInput = parse_body(&body)?;
    require_floor(&state, &floor_id).await?;
    if input.name_fa.trim().is_empty() || input.name_fa.chars().count() > 60 {
        return Err(validation_failed("نام بخش را وارد کنید."));
    }
    let next: i64 =
        sqlx::query("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM areas WHERE floor_id = $1")
            .bind(&floor_id)
            .fetch_one(&state.db.pool)
            .await
            .map_err(db_error)?
            .get("n");
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO areas (id, floor_id, name_fa, sort_order) VALUES ($1, $2, $3, $4)")
        .bind(&id)
        .bind(&floor_id)
        .bind(input.name_fa.trim())
        .bind(next)
        .execute(&state.db.pool)
        .await
        .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "layout.area_created".into(),
            entity_type: "area".into(),
            entity_id: Some(id.clone()),
            after_json: Some(
                json!({ "floorId": floor_id, "nameFa": input.name_fa.trim() }).to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({ "id": id })))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct UpdateAreaInput {
    name_fa: Option<String>,
    is_active: Option<bool>,
}

pub async fn update_area(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(area_id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "layout.write").await?;
    let input: UpdateAreaInput = parse_body(&body)?;
    let area = sqlx::query("SELECT id, name_fa, is_active FROM areas WHERE id = $1")
        .bind(&area_id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?
        .ok_or_else(|| not_found("بخش یافت نشد.", "AREA_NOT_FOUND"))?;
    if input.name_fa.is_none() && input.is_active.is_none() {
        return Err(validation_failed("حداقل یک تغییر لازم است."));
    }
    if let Some(name) = &input.name_fa {
        if name.trim().is_empty() || name.chars().count() > 60 {
            return Err(validation_failed("نام بخش معتبر نیست."));
        }
        sqlx::query("UPDATE areas SET name_fa = $1 WHERE id = $2")
            .bind(name.trim())
            .bind(&area_id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    if let Some(active) = input.is_active {
        sqlx::query("UPDATE areas SET is_active = $1 WHERE id = $2")
            .bind(i64::from(active))
            .bind(&area_id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "layout.area_updated".into(),
            entity_type: "area".into(),
            entity_id: Some(area_id.clone()),
            before_json: Some(
                json!({
                    "nameFa": area.get::<String, _>("name_fa"),
                    "isActive": area.get::<i64, _>("is_active") == 1,
                })
                .to_string(),
            ),
            after_json: Some(
                json!({ "nameFa": input.name_fa, "isActive": input.is_active }).to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({ "id": area_id })))
}

pub async fn delete_area(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(area_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "layout.write").await?;
    let area = sqlx::query("SELECT id, name_fa FROM areas WHERE id = $1")
        .bind(&area_id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?
        .ok_or_else(|| not_found("بخش یافت نشد.", "AREA_NOT_FOUND"))?;
    sqlx::query("DELETE FROM areas WHERE id = $1")
        .bind(&area_id)
        .execute(&state.db.pool)
        .await
        .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "layout.area_deleted".into(),
            entity_type: "area".into(),
            entity_id: Some(area_id.clone()),
            before_json: Some(json!({ "nameFa": area.get::<String, _>("name_fa") }).to_string()),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({ "id": area_id })))
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PlanObject {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    table_id: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(default)]
    rotation: f64,
    #[serde(default)]
    z_index: i64,
    #[serde(default = "default_layer")]
    layer: String,
    #[serde(default)]
    locked: bool,
    group_id: Option<String>,
    #[serde(default)]
    props: Value,
}

fn default_layer() -> String {
    "default".into()
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SavePlanInput {
    width: f64,
    height: f64,
    grid_size: f64,
    objects: Vec<PlanObject>,
}

async fn plan_id_for(state: &AppState, floor_id: &str) -> Result<String, AppError> {
    require_floor(state, floor_id).await?;
    ensure_plan(state, floor_id).await?;
    Ok(sqlx::query("SELECT id FROM floorplans WHERE floor_id = $1")
        .bind(floor_id)
        .fetch_one(&state.db.pool)
        .await
        .map_err(db_error)?
        .get("id"))
}

async fn save_plan_inner(
    state: &AppState,
    floor_id: &str,
    input: &SavePlanInput,
    user_id: &str,
) -> Result<(String, Option<i64>), AppError> {
    if !(400.0..=6000.0).contains(&input.width) || !(300.0..=6000.0).contains(&input.height) {
        return Err(validation_failed("ابعاد پلان معتبر نیست."));
    }
    if !(4.0..=100.0).contains(&input.grid_size) || input.objects.len() > 400 {
        return Err(validation_failed("تنظیمات پلان معتبر نیست."));
    }
    let tables =
        sqlx::query("SELECT id FROM dining_tables WHERE floor_id = $1 AND deleted_at IS NULL")
            .bind(floor_id)
            .fetch_all(&state.db.pool)
            .await
            .map_err(db_error)?;
    let table_ids: HashSet<String> = tables.iter().map(|row| row.get("id")).collect();
    let mut seen = HashSet::new();
    for object in &input.objects {
        if !seen.insert(object.id.clone()) {
            return Err(bad_request("شناسه یک شیء تکراری است.", "DUPLICATE_OBJECT"));
        }
        if !OBJECT_TYPES.contains(&object.kind.as_str()) {
            return Err(validation_failed("نوع شیء نامعتبر است."));
        }
        if object.kind == "table"
            && !object
                .table_id
                .as_ref()
                .is_some_and(|id| table_ids.contains(id))
        {
            return Err(bad_request(
                "میز انتخاب‌شده به این طبقه تعلق ندارد.",
                "TABLE_FLOOR_MISMATCH",
            ));
        }
    }
    let plan_id = plan_id_for(state, floor_id).await?;
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "UPDATE floorplans SET width = $1, height = $2, grid_size = $3, updated_at = $4
          WHERE id = $5",
    )
    .bind(input.width)
    .bind(input.height)
    .bind(input.grid_size)
    .bind(now())
    .bind(&plan_id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    sqlx::query("DELETE FROM floorplan_objects WHERE floorplan_id = $1")
        .bind(&plan_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    for object in &input.objects {
        sqlx::query(
            "INSERT INTO floorplan_objects
               (id, floorplan_id, type, ref_table_id, x, y, width, height, rotation,
                z_index, layer, is_locked, group_id, props_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
        )
        .bind(&object.id)
        .bind(&plan_id)
        .bind(&object.kind)
        .bind(&object.table_id)
        .bind(object.x)
        .bind(object.y)
        .bind(object.width)
        .bind(object.height)
        .bind(object.rotation)
        .bind(object.z_index)
        .bind(&object.layer)
        .bind(i64::from(object.locked))
        .bind(&object.group_id)
        .bind(
            object
                .props
                .as_object()
                .filter(|props| !props.is_empty())
                .map(|props| Value::Object(props.clone()).to_string()),
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;

    let snapshot = serde_json::to_string(input).unwrap_or_else(|_| "{}".into());
    let latest = sqlx::query(
        "SELECT version, snapshot_json FROM floorplan_versions
          WHERE floorplan_id = $1 ORDER BY version DESC LIMIT 1",
    )
    .bind(&plan_id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?;
    let version = if let Some(latest) = latest {
        if latest.get::<String, _>("snapshot_json") == snapshot {
            Some(latest.get::<i64, _>("version"))
        } else {
            let next: i64 = latest.get::<i64, _>("version") + 1;
            insert_version(state, &plan_id, next, &snapshot, user_id).await?;
            prune_versions(state, &plan_id).await?;
            Some(next)
        }
    } else {
        insert_version(state, &plan_id, 1, &snapshot, user_id).await?;
        Some(1)
    };
    let _ = user_id;
    Ok((now(), version))
}

async fn insert_version(
    state: &AppState,
    plan_id: &str,
    version: i64,
    snapshot: &str,
    user_id: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO floorplan_versions (id, floorplan_id, version, snapshot_json, created_by)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(plan_id)
    .bind(version)
    .bind(snapshot)
    .bind(user_id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(())
}

async fn prune_versions(state: &AppState, plan_id: &str) -> Result<(), AppError> {
    sqlx::query(
        "DELETE FROM floorplan_versions WHERE floorplan_id = $1 AND id NOT IN (
           SELECT id FROM floorplan_versions WHERE floorplan_id = $2
            ORDER BY version DESC LIMIT 25
         )",
    )
    .bind(plan_id)
    .bind(plan_id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(())
}

pub async fn save_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(floor_id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "layout.write").await?;
    let input: SavePlanInput = parse_body(&body)?;
    let (saved_at, version) = save_plan_inner(&state, &floor_id, &input, &session.user.id).await?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "layout.plan_saved".into(),
            entity_type: "floorplan".into(),
            entity_id: Some(floor_id.clone()),
            after_json: Some(
                json!({ "floorId": floor_id, "objectCount": input.objects.len(), "version": version })
                    .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({ "savedAt": saved_at, "version": version })))
}

pub async fn versions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(floor_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "layout.read").await?;
    let plan_id = plan_id_for(&state, &floor_id).await?;
    let rows = sqlx::query(
        "SELECT v.id, v.version, v.snapshot_json, v.created_at, u.full_name AS created_by_name
           FROM floorplan_versions v LEFT JOIN users u ON u.id = v.created_by
          WHERE v.floorplan_id = $1 ORDER BY v.version DESC LIMIT 25",
    )
    .bind(&plan_id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            let count = row
                .get::<String, _>("snapshot_json")
                .parse::<Value>()
                .ok()
                .and_then(|value| value.get("objects").and_then(Value::as_array).map(Vec::len))
                .unwrap_or(0);
            json!({
                "id": row.get::<String, _>("id"),
                "version": row.get::<i64, _>("version"),
                "createdAt": row.get::<String, _>("created_at"),
                "createdByName": row.get::<Option<String>, _>("created_by_name"),
                "objectCount": count,
            })
        })
        .collect();
    Ok(Json(json!({ "items": items })))
}

pub async fn restore_version(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((floor_id, version_id)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "layout.write").await?;
    let plan_id = plan_id_for(&state, &floor_id).await?;
    let row = sqlx::query(
        "SELECT version, snapshot_json FROM floorplan_versions
          WHERE id = $1 AND floorplan_id = $2",
    )
    .bind(&version_id)
    .bind(&plan_id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .ok_or_else(|| not_found("نسخه یافت نشد.", "VERSION_NOT_FOUND"))?;
    let input: SavePlanInput = serde_json::from_str(&row.get::<String, _>("snapshot_json"))
        .map_err(|_| bad_request("نسخه ذخیره‌شده معتبر نیست.", "VERSION_CORRUPT"))?;
    let (saved_at, _) = save_plan_inner(&state, &floor_id, &input, &session.user.id).await?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "layout.version_restored".into(),
            entity_type: "floorplan".into(),
            entity_id: Some(plan_id),
            after_json: Some(
                json!({ "floorId": floor_id, "version": row.get::<i64, _>("version") }).to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({ "savedAt": saved_at })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTableInput {
    floor_id: String,
    area_id: Option<String>,
    name_fa: Option<String>,
    code: Option<String>,
    capacity: i64,
    #[serde(default = "default_shape")]
    shape: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(default)]
    rotation: f64,
    waiter_user_id: Option<String>,
    #[serde(default = "default_true")]
    is_active: bool,
}

fn default_shape() -> String {
    "square".into()
}

fn default_true() -> bool {
    true
}

async fn area_belongs(state: &AppState, area_id: &str, floor_id: &str) -> Result<(), AppError> {
    let row = sqlx::query("SELECT floor_id FROM areas WHERE id = $1")
        .bind(area_id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?
        .ok_or_else(|| not_found("بخش یافت نشد.", "AREA_NOT_FOUND"))?;
    if row.get::<String, _>("floor_id") != floor_id {
        return Err(bad_request(
            "بخش انتخاب‌شده به این طبقه تعلق ندارد.",
            "AREA_FLOOR_MISMATCH",
        ));
    }
    Ok(())
}

async fn table_codes(state: &AppState) -> Result<Vec<String>, AppError> {
    Ok(sqlx::query("SELECT code FROM dining_tables")
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?
        .iter()
        .map(|row| row.get::<String, _>("code"))
        .collect())
}

fn next_table_code(codes: &[String]) -> String {
    let upper: HashSet<String> = codes.iter().map(|code| code.to_uppercase()).collect();
    let mut index = 1;
    loop {
        let candidate = format!("T{index}");
        if !upper.contains(&candidate) {
            return candidate;
        }
        index += 1;
    }
}

pub async fn create_table(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "layout.write").await?;
    let input: CreateTableInput = parse_body(&body)?;
    require_floor(&state, &input.floor_id).await?;
    if let Some(area_id) = &input.area_id {
        area_belongs(&state, area_id, &input.floor_id).await?;
    }
    if !(1..=60).contains(&input.capacity) {
        return Err(validation_failed("ظرفیت میز باید دست‌کم یک نفر باشد."));
    }
    if !SHAPES.contains(&input.shape.as_str()) {
        return Err(validation_failed("شکل میز نامعتبر است."));
    }
    if input
        .name_fa
        .as_ref()
        .is_some_and(|value| value.chars().count() > 60)
        || input
            .code
            .as_ref()
            .is_some_and(|value| value.chars().count() > 12)
    {
        return Err(validation_failed("اطلاعات میز معتبر نیست."));
    }
    let codes = table_codes(&state).await?;
    let code = input
        .code
        .clone()
        .unwrap_or_else(|| next_table_code(&codes));
    if codes.iter().any(|value| value.eq_ignore_ascii_case(&code)) {
        return Err(conflict(
            "این کد میز قبلاً استفاده شده است.",
            "TABLE_CODE_EXISTS",
        ));
    }
    let name = input
        .name_fa
        .clone()
        .unwrap_or_else(|| format!("میز {}", code.trim_start_matches('T')));
    let plan_id = plan_id_for(&state, &input.floor_id).await?;
    let id = Uuid::new_v4().to_string();
    let token = Uuid::new_v4().simple().to_string()[..12].to_string();
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "INSERT INTO dining_tables
           (id, floor_id, area_id, code, name_fa, capacity, shape, status,
            waiter_user_id, qr_token, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'available', $8, $9, $10)",
    )
    .bind(&id)
    .bind(&input.floor_id)
    .bind(&input.area_id)
    .bind(&code)
    .bind(&name)
    .bind(input.capacity)
    .bind(&input.shape)
    .bind(&input.waiter_user_id)
    .bind(&token)
    .bind(i64::from(input.is_active))
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    sqlx::query(
        "INSERT INTO qr_codes (id, kind, token, table_id, label, is_active)
         VALUES ($1, 'table', $2, $3, $4, 1)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&token)
    .bind(&id)
    .bind(&name)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    sqlx::query(
        "INSERT INTO floorplan_objects
           (id, floorplan_id, type, ref_table_id, x, y, width, height, rotation, z_index, layer)
         VALUES ($1, $2, 'table', $3, $4, $5, $6, $7, $8, 10, 'tables')",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&plan_id)
    .bind(&id)
    .bind(input.x)
    .bind(input.y)
    .bind(input.width)
    .bind(input.height)
    .bind(input.rotation)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "layout.table_created".into(),
            entity_type: "dining_table".into(),
            entity_id: Some(id.clone()),
            after_json: Some(
                json!({
                    "code": code,
                    "nameFa": name,
                    "capacity": input.capacity,
                    "floorId": input.floor_id,
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({
        "id": id,
        "plan": ensure_plan(&state, &input.floor_id).await?,
    })))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct UpdateTableInput {
    name_fa: Option<String>,
    code: Option<String>,
    capacity: Option<i64>,
    shape: Option<String>,
    area_id: Option<Option<String>>,
    waiter_user_id: Option<Option<String>>,
    is_active: Option<bool>,
    note: Option<Option<String>>,
}

pub async fn update_table(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(table_id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "layout.write").await?;
    let input: UpdateTableInput = parse_body(&body)?;
    let table = find_table(&state, &table_id).await?;
    let floor_id: String = table.get("floor_id");
    if let Some(Some(area_id)) = &input.area_id {
        area_belongs(&state, area_id, &floor_id).await?;
    }
    if let Some(capacity) = input.capacity
        && !(1..=60).contains(&capacity)
    {
        return Err(validation_failed("ظرفیت میز معتبر نیست."));
    }
    if let Some(shape) = &input.shape
        && !SHAPES.contains(&shape.as_str())
    {
        return Err(validation_failed("شکل میز نامعتبر است."));
    }
    if let Some(code) = &input.code {
        if code.trim().is_empty() || code.chars().count() > 12 {
            return Err(validation_failed("کد میز معتبر نیست."));
        }
        let codes = table_codes(&state).await?;
        if codes.iter().any(|value| {
            value.eq_ignore_ascii_case(code) && value != &table.get::<String, _>("code")
        }) {
            return Err(conflict(
                "این کد میز قبلاً استفاده شده است.",
                "TABLE_CODE_EXISTS",
            ));
        }
        sqlx::query("UPDATE dining_tables SET code = $1 WHERE id = $2")
            .bind(code.trim())
            .bind(&table_id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    if let Some(name) = &input.name_fa {
        if name.trim().is_empty() || name.chars().count() > 60 {
            return Err(validation_failed("نام میز معتبر نیست."));
        }
        sqlx::query("UPDATE dining_tables SET name_fa = $1 WHERE id = $2")
            .bind(name.trim())
            .bind(&table_id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    if let Some(capacity) = input.capacity {
        sqlx::query("UPDATE dining_tables SET capacity = $1 WHERE id = $2")
            .bind(capacity)
            .bind(&table_id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    if let Some(shape) = &input.shape {
        sqlx::query("UPDATE dining_tables SET shape = $1 WHERE id = $2")
            .bind(shape)
            .bind(&table_id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    if let Some(area) = &input.area_id {
        sqlx::query("UPDATE dining_tables SET area_id = $1 WHERE id = $2")
            .bind(area.as_deref())
            .bind(&table_id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    if let Some(waiter) = &input.waiter_user_id {
        sqlx::query("UPDATE dining_tables SET waiter_user_id = $1 WHERE id = $2")
            .bind(waiter.as_deref())
            .bind(&table_id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    if let Some(active) = input.is_active {
        sqlx::query("UPDATE dining_tables SET is_active = $1 WHERE id = $2")
            .bind(i64::from(active))
            .bind(&table_id)
            .execute(&state.db.pool)
            .await
            .map_err(db_error)?;
    }
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "layout.table_updated".into(),
            entity_type: "dining_table".into(),
            entity_id: Some(table_id.clone()),
            before_json: Some(table_json(&table).to_string()),
            after_json: Some(
                json!({
                    "nameFa": input.name_fa,
                    "code": input.code,
                    "capacity": input.capacity,
                    "shape": input.shape,
                    "areaId": input.area_id,
                    "waiterUserId": input.waiter_user_id,
                    "isActive": input.is_active,
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({ "id": table_id })))
}

pub async fn delete_table(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(table_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "layout.write").await?;
    let table = find_table(&state, &table_id).await?;
    let open: i64 = sqlx::query(
        "SELECT COUNT(*) AS n FROM table_sessions WHERE table_id = $1 AND status = 'open'",
    )
    .bind(&table_id)
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?
    .get("n");
    if open > 0 {
        return Err(conflict(
            "این میز نشست باز دارد؛ ابتدا میز را ببندید.",
            "TABLE_HAS_OPEN_SESSION",
        ));
    }
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query("DELETE FROM floorplan_objects WHERE ref_table_id = $1")
        .bind(&table_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("UPDATE qr_codes SET is_active = 0 WHERE table_id = $1")
        .bind(&table_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("UPDATE dining_tables SET deleted_at = $1, is_active = 0 WHERE id = $2")
        .bind(now())
        .bind(&table_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "layout.table_deleted".into(),
            entity_type: "dining_table".into(),
            entity_id: Some(table_id.clone()),
            before_json: Some(
                json!({
                    "code": table.get::<String, _>("code"),
                    "nameFa": table.get::<String, _>("name_fa"),
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({ "id": table_id })))
}

fn menu_base(headers: &HeaderMap, query: &HashMap<String, String>) -> String {
    let candidate = query
        .get("base")
        .cloned()
        .or_else(|| {
            headers
                .get(header::ORIGIN)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned)
        })
        .or_else(|| std::env::var("PUBLIC_APP_URL").ok());
    candidate
        .and_then(|value| normalize_base(&value))
        .unwrap_or_else(|| "http://localhost:5173".into())
}

fn normalize_base(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let rest = trimmed
            .split_once("://")
            .map(|(_, rest)| rest)
            .unwrap_or_default();
        if rest.is_empty() {
            return None;
        }
        Some(trimmed.to_string())
    } else {
        None
    }
}

async fn qr_for(
    state: &AppState,
    headers: &HeaderMap,
    table_id: &str,
    query: &HashMap<String, String>,
) -> Result<Value, AppError> {
    let table = find_table(state, table_id).await?;
    let token: Option<String> = table.get("qr_token");
    let token = token.ok_or_else(|| conflict("این میز توکن QR ندارد.", "TABLE_WITHOUT_QR"))?;
    Ok(json!({
        "tableId": table.get::<String, _>("id"),
        "tableNameFa": table.get::<String, _>("name_fa"),
        "token": token,
        "menuUrl": format!("{}/menu/{token}", menu_base(headers, query)),
    }))
}

pub async fn table_qr(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(table_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "layout.read").await?;
    Ok(Json(qr_for(&state, &headers, &table_id, &query).await?))
}

pub async fn regenerate_qr(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(table_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "layout.write").await?;
    let table = find_table(&state, &table_id).await?;
    let before: Option<String> = table.get("qr_token");
    let token = Uuid::new_v4().simple().to_string()[..12].to_string();
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query("UPDATE dining_tables SET qr_token = $1, updated_at = $2 WHERE id = $3")
        .bind(&token)
        .bind(now())
        .bind(&table_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("UPDATE qr_codes SET is_active = 0 WHERE table_id = $1")
        .bind(&table_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query(
        "INSERT INTO qr_codes (id, kind, token, table_id, label, is_active)
         SELECT $1, 'table', $2, $3, name_fa, 1 FROM dining_tables WHERE id = $4",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&token)
    .bind(&table_id)
    .bind(&table_id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "layout.qr_regenerated".into(),
            entity_type: "dining_table".into(),
            entity_id: Some(table_id.clone()),
            before_json: Some(json!({ "token": before }).to_string()),
            after_json: Some(json!({ "token": token }).to_string()),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({ "tableId": table_id, "token": token })))
}

fn qr_width(query: &HashMap<String, String>) -> u32 {
    query
        .get("size")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(512)
        .clamp(128, 1200) as u32
}

pub async fn table_qr_png(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(table_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Response, AppError> {
    guard(&state, &headers, "layout.read").await?;
    let qr = qr_for(&state, &headers, &table_id, &query).await?;
    let url = qr["menuUrl"].as_str().unwrap_or_default();
    let width = qr_width(&query);
    let code = QrCode::with_error_correction_level(url.as_bytes(), qrcode::EcLevel::M)
        .map_err(|_| AppError::internal("ساخت QR ناموفق بود."))?;
    let image = code
        .render::<Rgba<u8>>()
        .min_dimensions(width, width)
        .dark_color(Rgba([36, 22, 17, 255]))
        .light_color(Rgba([255, 252, 246, 255]))
        .build();
    let mut buffer = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut buffer, ImageFormat::Png)
        .map_err(|_| AppError::internal("ساخت تصویر QR ناموفق بود."))?;
    let mut response = (StatusCode::OK, Body::from(buffer.into_inner())).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        "image/png"
            .parse()
            .unwrap_or_else(|_| "image/png".parse().unwrap()),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        "private, max-age=0, no-store"
            .parse()
            .unwrap_or_else(|_| "no-store".parse().unwrap()),
    );
    Ok(response)
}

pub async fn table_qr_svg(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(table_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Response, AppError> {
    guard(&state, &headers, "layout.read").await?;
    let qr = qr_for(&state, &headers, &table_id, &query).await?;
    let url = qr["menuUrl"].as_str().unwrap_or_default();
    let width = qr_width(&query);
    let code = QrCode::with_error_correction_level(url.as_bytes(), qrcode::EcLevel::M)
        .map_err(|_| AppError::internal("ساخت QR ناموفق بود."))?;
    let svg = code
        .render()
        .min_dimensions(width, width)
        .dark_color(svg::Color("#241611"))
        .light_color(svg::Color("#fffcf6"))
        .build();
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "image/svg+xml; charset=utf-8"),
            (header::CACHE_CONTROL, "private, max-age=0, no-store"),
        ],
        svg,
    )
        .into_response())
}
