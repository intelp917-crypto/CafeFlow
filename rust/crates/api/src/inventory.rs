//! Inventory: ingredients, stock movements, recipes, suppliers, purchases and waste.

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
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::admin::{db_error, guard, parse_body, record, require_module};
use crate::error::{AppError, bad_request, not_found, validation_failed};
use crate::state::AppState;

fn now() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn limit(query: &HashMap<String, String>, default: i64) -> i64 {
    query
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .map(|value| value.clamp(1, 200))
        .unwrap_or(default)
}

async fn ingredient_json(state: &AppState, id: &str) -> Result<Value, AppError> {
    let row = sqlx::query(
        "SELECT i.id, i.name_fa, u.symbol, i.current_qty, i.min_qty, i.cost_per_unit, i.is_active
           FROM ingredients i LEFT JOIN measurement_units u ON u.id = i.unit_id
          WHERE i.id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .ok_or_else(|| not_found("ماده اولیه یافت نشد.", "INGREDIENT_NOT_FOUND"))?;
    let current: f64 = row.get("current_qty");
    let minimum: f64 = row.get("min_qty");
    Ok(json!({
        "id": row.get::<String, _>("id"),
        "nameFa": row.get::<String, _>("name_fa"),
        "unitSymbol": row.get::<Option<String>, _>("symbol"),
        "currentQty": round3(current),
        "minQty": minimum,
        "costPerUnit": row.get::<i64, _>("cost_per_unit"),
        "isActive": row.get::<i64, _>("is_active") == 1,
        "isLow": current <= minimum,
    }))
}

pub async fn overview(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "inventory.read").await?;
    require_module(&state, ModuleKey::Inventory).await?;
    let ingredients: i64 = sqlx::query("SELECT COUNT(*) AS n FROM ingredients WHERE is_active = 1")
        .fetch_one(&state.db.pool)
        .await
        .map_err(db_error)?
        .get("n");
    let low_stock: i64 = sqlx::query(
        "SELECT COUNT(*) AS n FROM ingredients WHERE is_active = 1 AND current_qty <= min_qty",
    )
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?
    .get("n");
    let suppliers: i64 = sqlx::query("SELECT COUNT(*) AS n FROM suppliers WHERE is_active = 1")
        .fetch_one(&state.db.pool)
        .await
        .map_err(db_error)?
        .get("n");
    let (today_start, _) = crate::dates::day_bounds(crate::dates::tehran_today())?;
    let movements_today: i64 =
        sqlx::query("SELECT COUNT(*) AS n FROM stock_movements WHERE created_at >= $1")
            .bind(today_start)
            .fetch_one(&state.db.pool)
            .await
            .map_err(db_error)?
            .get("n");
    Ok(Json(json!({
        "ingredients": ingredients,
        "lowStock": low_stock,
        "suppliers": suppliers,
        "movementsToday": movements_today,
    })))
}

pub async fn ingredients(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "inventory.read").await?;
    require_module(&state, ModuleKey::Inventory).await?;
    let rows = sqlx::query(
        "SELECT i.id, i.name_fa, u.symbol, i.current_qty, i.min_qty, i.cost_per_unit, i.is_active
           FROM ingredients i LEFT JOIN measurement_units u ON u.id = i.unit_id
          WHERE i.is_active = 1 ORDER BY i.name_fa",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            let current: f64 = row.get("current_qty");
            let minimum: f64 = row.get("min_qty");
            json!({
                "id": row.get::<String, _>("id"),
                "nameFa": row.get::<String, _>("name_fa"),
                "unitSymbol": row.get::<Option<String>, _>("symbol"),
                "currentQty": round3(current),
                "minQty": minimum,
                "costPerUnit": row.get::<i64, _>("cost_per_unit"),
                "isActive": row.get::<i64, _>("is_active") == 1,
                "isLow": current <= minimum,
            })
        })
        .collect();
    let low = items
        .iter()
        .filter(|item| item["isLow"] == true && item["currentQty"].as_f64().unwrap_or(0.0) > 0.0)
        .count();
    let out = items
        .iter()
        .filter(|item| item["currentQty"].as_f64().unwrap_or(0.0) <= 0.0)
        .count();
    Ok(Json(json!({
        "items": items,
        "summary": { "total": items.len(), "low": low, "out": out },
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateIngredientInput {
    name_fa: String,
    unit_symbol: Option<String>,
    #[serde(default)]
    current_qty: f64,
    #[serde(default)]
    min_qty: f64,
    #[serde(default)]
    cost_per_unit: i64,
}

async fn unit_for(state: &AppState, symbol: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(symbol) = symbol else {
        return Ok(None);
    };
    if let Some(row) = sqlx::query("SELECT id FROM measurement_units WHERE symbol = $1")
        .bind(symbol)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?
    {
        return Ok(Some(row.get("id")));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO measurement_units (id, name_fa, symbol) VALUES ($1, $2, $3)")
        .bind(&id)
        .bind(symbol)
        .bind(symbol)
        .execute(&state.db.pool)
        .await
        .map_err(db_error)?;
    Ok(Some(id))
}

pub async fn create_ingredient(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "inventory.write").await?;
    require_module(&state, ModuleKey::Inventory).await?;
    let input: CreateIngredientInput = parse_body(&body)?;
    if !(2..=80).contains(&input.name_fa.trim().chars().count()) {
        return Err(validation_failed("نام ماده اولیه الزامی است."));
    }
    if input
        .unit_symbol
        .as_ref()
        .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 12)
    {
        return Err(validation_failed("واحد معتبر نیست."));
    }
    if !(0.0..=1_000_000.0).contains(&input.current_qty)
        || !(0.0..=1_000_000.0).contains(&input.min_qty)
        || input.cost_per_unit < 0
    {
        return Err(validation_failed("مقادیر انبار معتبر نیستند."));
    }
    let unit_id = unit_for(&state, input.unit_symbol.as_deref()).await?;
    let id = Uuid::new_v4().to_string();
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "INSERT INTO ingredients
           (id, name_fa, unit_id, current_qty, min_qty, cost_per_unit)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&id)
    .bind(input.name_fa.trim())
    .bind(&unit_id)
    .bind(input.current_qty)
    .bind(input.min_qty)
    .bind(input.cost_per_unit)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    if input.current_qty > 0.0 {
        sqlx::query(
            "INSERT INTO stock_movements
               (id, ingredient_id, type, qty, note, created_by_user_id)
             VALUES ($1, $2, 'adjustment', $3, 'موجودی اولیه', $4)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&id)
        .bind(input.current_qty)
        .bind(&session.user.id)
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
            action: "inventory.ingredient_created".into(),
            entity_type: "ingredient".into(),
            entity_id: Some(id.clone()),
            after_json: Some(
                json!({
                    "nameFa": input.name_fa.trim(),
                    "currentQty": input.current_qty,
                    "unitSymbol": input.unit_symbol,
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(ingredient_json(&state, &id).await?))
}

#[derive(Debug, Deserialize)]
struct AdjustInput {
    delta: f64,
    reason: String,
}

pub async fn adjust_ingredient(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "inventory.write").await?;
    require_module(&state, ModuleKey::Inventory).await?;
    let input: AdjustInput = parse_body(&body)?;
    if input.delta == 0.0 || input.delta.abs() > 1_000_000.0 {
        return Err(validation_failed("مقدار اصلاح معتبر نیست."));
    }
    if !(2..=200).contains(&input.reason.trim().chars().count()) {
        return Err(validation_failed("دلیل اصلاح الزامی است."));
    }
    let row = sqlx::query("SELECT name_fa, current_qty FROM ingredients WHERE id = $1")
        .bind(&id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?
        .ok_or_else(|| not_found("ماده اولیه یافت نشد.", "INGREDIENT_NOT_FOUND"))?;
    let current: f64 = row.get("current_qty");
    let next = round3(current + input.delta);
    if next < 0.0 {
        return Err(bad_request(
            format!(
                "موجودی «{}» کافی نیست؛ موجودی فعلی {} است.",
                row.get::<String, _>("name_fa"),
                round3(current)
            ),
            "INSUFFICIENT_STOCK",
        )
        .with_details(json!({ "currentQty": round3(current), "delta": input.delta })));
    }
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query("UPDATE ingredients SET current_qty = $1 WHERE id = $2")
        .bind(next)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query(
        "INSERT INTO stock_movements
           (id, ingredient_id, type, qty, note, created_by_user_id)
         VALUES ($1, $2, 'adjustment', $3, $4, $5)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&id)
    .bind(input.delta)
    .bind(input.reason.trim())
    .bind(&session.user.id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "inventory.stock_adjusted".into(),
            entity_type: "ingredient".into(),
            entity_id: Some(id.clone()),
            before_json: Some(json!({ "currentQty": round3(current) }).to_string()),
            after_json: Some(
                json!({ "currentQty": next, "delta": input.delta, "reason": input.reason.trim() })
                    .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(ingredient_json(&state, &id).await?))
}

fn movement_label(kind: &str) -> &str {
    match kind {
        "purchase" => "خرید",
        "sale_deduction" => "کسر بابت فروش",
        "adjustment" => "اصلاح موجودی",
        "waste" => "ضایعات",
        "restore" => "بازگردانی",
        other => other,
    }
}

pub async fn movements(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "inventory.read").await?;
    require_module(&state, ModuleKey::Inventory).await?;
    let rows = sqlx::query(
        "SELECT m.id, m.ingredient_id, i.name_fa, m.type, m.qty, u.symbol, m.ref_type,
                m.ref_id, o.code AS order_code, m.note, us.full_name AS created_by_name,
                m.created_at
           FROM stock_movements m
           JOIN ingredients i ON i.id = m.ingredient_id
           LEFT JOIN measurement_units u ON u.id = i.unit_id
           LEFT JOIN orders o ON m.ref_type = 'order' AND o.id = m.ref_id
           LEFT JOIN users us ON us.id = m.created_by_user_id
          ORDER BY m.created_at DESC LIMIT $1",
    )
    .bind(limit(&query, 80))
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            let kind: String = row.get("type");
            json!({
                "id": row.get::<String, _>("id"),
                "ingredientId": row.get::<String, _>("ingredient_id"),
                "ingredientNameFa": row.get::<String, _>("name_fa"),
                "type": kind,
                "typeLabelFa": movement_label(&kind),
                "qty": round3(row.get::<f64, _>("qty")),
                "unitSymbol": row.get::<Option<String>, _>("symbol"),
                "refType": row.get::<Option<String>, _>("ref_type"),
                "refId": row.get::<Option<String>, _>("ref_id"),
                "orderCode": row.get::<Option<String>, _>("order_code"),
                "note": row.get::<Option<String>, _>("note"),
                "createdByName": row.get::<Option<String>, _>("created_by_name"),
                "createdAt": row.get::<String, _>("created_at"),
            })
        })
        .collect();
    Ok(Json(json!({ "items": items })))
}

pub async fn recipes(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "inventory.read").await?;
    require_module(&state, ModuleKey::Inventory).await?;
    let rows = sqlx::query(
        "SELECT r.id, r.product_id, p.name_fa, r.yield_qty
           FROM recipes r JOIN products p ON p.id = r.product_id
          ORDER BY p.name_fa",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let mut items = Vec::new();
    for row in &rows {
        let recipe_id: String = row.get("id");
        let ingredients = sqlx::query(
            "SELECT ri.ingredient_id, i.name_fa, u.symbol, ri.qty
               FROM recipe_items ri JOIN ingredients i ON i.id = ri.ingredient_id
               LEFT JOIN measurement_units u ON u.id = i.unit_id
              WHERE ri.recipe_id = $1 ORDER BY i.name_fa",
        )
        .bind(&recipe_id)
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?;
        items.push(json!({
            "productId": row.get::<String, _>("product_id"),
            "productNameFa": row.get::<String, _>("name_fa"),
            "yieldQty": row.get::<f64, _>("yield_qty"),
            "items": ingredients.iter().map(|item| json!({
                "ingredientId": item.get::<String, _>("ingredient_id"),
                "ingredientNameFa": item.get::<String, _>("name_fa"),
                "unitSymbol": item.get::<Option<String>, _>("symbol"),
                "qty": item.get::<f64, _>("qty"),
            })).collect::<Vec<_>>(),
        }));
    }
    Ok(Json(json!({ "items": items })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecipeInput {
    #[serde(default = "one")]
    yield_qty: f64,
    items: Vec<RecipeItemInput>,
}

fn one() -> f64 {
    1.0
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecipeItemInput {
    ingredient_id: String,
    qty: f64,
}

pub async fn set_recipe(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(product_id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "inventory.write").await?;
    require_module(&state, ModuleKey::Inventory).await?;
    let input: RecipeInput = parse_body(&body)?;
    if input.yield_qty <= 0.0 || input.yield_qty > 10_000.0 || input.items.len() > 60 {
        return Err(validation_failed("دستور پخت معتبر نیست."));
    }
    let product = sqlx::query("SELECT name_fa FROM products WHERE id = $1")
        .bind(&product_id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?
        .ok_or_else(|| not_found("محصول یافت نشد.", "PRODUCT_NOT_FOUND"))?;
    for item in &input.items {
        let exists = sqlx::query("SELECT id FROM ingredients WHERE id = $1")
            .bind(&item.ingredient_id)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?;
        if exists.is_none() {
            return Err(bad_request(
                "یکی از مواد اولیه انتخاب‌شده یافت نشد.",
                "INGREDIENT_NOT_FOUND",
            ));
        }
        if item.qty <= 0.0 {
            return Err(validation_failed(
                "مقدار مواد اولیه باید بیشتر از صفر باشد.",
            ));
        }
    }
    let existing = sqlx::query("SELECT id FROM recipes WHERE product_id = $1")
        .bind(&product_id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    let recipe_id = existing
        .as_ref()
        .map(|row| row.get::<String, _>("id"))
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    if existing.is_none() {
        sqlx::query("INSERT INTO recipes (id, product_id, yield_qty) VALUES ($1, $2, $3)")
            .bind(&recipe_id)
            .bind(&product_id)
            .bind(input.yield_qty)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    } else {
        sqlx::query("UPDATE recipes SET yield_qty = $1 WHERE id = $2")
            .bind(input.yield_qty)
            .bind(&recipe_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        sqlx::query("DELETE FROM recipe_items WHERE recipe_id = $1")
            .bind(&recipe_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }
    for item in &input.items {
        sqlx::query(
            "INSERT INTO recipe_items (id, recipe_id, ingredient_id, qty) VALUES ($1, $2, $3, $4)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&recipe_id)
        .bind(&item.ingredient_id)
        .bind(item.qty)
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
            action: "inventory.recipe_updated".into(),
            entity_type: "product".into(),
            entity_id: Some(product_id.clone()),
            after_json: Some(
                json!({ "yieldQty": input.yield_qty, "itemCount": input.items.len() }).to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    let stored = sqlx::query(
        "SELECT ri.ingredient_id, i.name_fa, u.symbol, ri.qty
           FROM recipe_items ri JOIN ingredients i ON i.id = ri.ingredient_id
           LEFT JOIN measurement_units u ON u.id = i.unit_id
          WHERE ri.recipe_id = $1 ORDER BY i.name_fa",
    )
    .bind(&recipe_id)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(Json(json!({
        "productId": product_id,
        "productNameFa": product.get::<String, _>("name_fa"),
        "yieldQty": input.yield_qty,
        "items": stored.iter().map(|item| json!({
            "ingredientId": item.get::<String, _>("ingredient_id"),
            "ingredientNameFa": item.get::<String, _>("name_fa"),
            "unitSymbol": item.get::<Option<String>, _>("symbol"),
            "qty": item.get::<f64, _>("qty"),
        })).collect::<Vec<_>>(),
    })))
}

pub async fn suppliers(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "inventory.read").await?;
    require_module(&state, ModuleKey::Inventory).await?;
    let rows = sqlx::query(
        "SELECT s.id, s.name_fa, s.phone, s.address, s.is_active,
                (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS purchase_count,
                (SELECT MAX(purchased_at) FROM purchases p WHERE p.supplier_id = s.id) AS last_purchase_at
           FROM suppliers s ORDER BY s.is_active DESC, s.name_fa",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "nameFa": row.get::<String, _>("name_fa"),
                "phone": row.get::<Option<String>, _>("phone"),
                "address": row.get::<Option<String>, _>("address"),
                "isActive": row.get::<i64, _>("is_active") == 1,
                "purchaseCount": row.get::<i64, _>("purchase_count"),
                "lastPurchaseAt": row.get::<Option<String>, _>("last_purchase_at"),
            })
        })
        .collect();
    Ok(Json(json!({ "items": items })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupplierInput {
    name_fa: String,
    phone: Option<String>,
    address: Option<String>,
}

pub async fn create_supplier(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "inventory.write").await?;
    require_module(&state, ModuleKey::Inventory).await?;
    let input: SupplierInput = parse_body(&body)?;
    if !(2..=80).contains(&input.name_fa.trim().chars().count()) {
        return Err(validation_failed("نام تأمین‌کننده الزامی است."));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO suppliers (id, name_fa, phone, address) VALUES ($1, $2, $3, $4)")
        .bind(&id)
        .bind(input.name_fa.trim())
        .bind(input.phone.as_deref())
        .bind(input.address.as_deref())
        .execute(&state.db.pool)
        .await
        .map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "inventory.supplier_created".into(),
            entity_type: "supplier".into(),
            entity_id: Some(id.clone()),
            after_json: Some(
                json!({ "nameFa": input.name_fa.trim(), "phone": input.phone }).to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({
        "id": id,
        "nameFa": input.name_fa.trim(),
        "phone": input.phone,
        "address": input.address,
        "isActive": true,
        "purchaseCount": 0,
        "lastPurchaseAt": null,
    })))
}

pub async fn purchases(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "inventory.read").await?;
    require_module(&state, ModuleKey::Inventory).await?;
    let rows = sqlx::query(
        "SELECT p.id, p.supplier_id, s.name_fa AS supplier_name_fa, p.invoice_no, p.total,
                p.purchased_at,
                (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count,
                u.full_name AS created_by_name
           FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
           LEFT JOIN users u ON u.id = p.created_by_user_id
          ORDER BY p.purchased_at DESC LIMIT $1",
    )
    .bind(limit(&query, 40))
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "supplierId": row.get::<Option<String>, _>("supplier_id"),
                "supplierNameFa": row.get::<Option<String>, _>("supplier_name_fa"),
                "invoiceNo": row.get::<Option<String>, _>("invoice_no"),
                "total": row.get::<i64, _>("total"),
                "purchasedAt": row.get::<String, _>("purchased_at"),
                "itemCount": row.get::<i64, _>("item_count"),
                "createdByName": row.get::<Option<String>, _>("created_by_name"),
            })
        })
        .collect();
    Ok(Json(json!({ "items": items })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PurchaseInput {
    supplier_id: Option<String>,
    invoice_no: Option<String>,
    purchased_at: Option<String>,
    items: Vec<PurchaseItemInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PurchaseItemInput {
    ingredient_id: String,
    qty: f64,
    unit_cost: i64,
}

pub async fn create_purchase(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "inventory.write").await?;
    require_module(&state, ModuleKey::Inventory).await?;
    let input: PurchaseInput = parse_body(&body)?;
    if input.items.is_empty() || input.items.len() > 60 {
        return Err(validation_failed("حداقل یک قلم کالا لازم است."));
    }
    let mut supplier_name = None;
    if let Some(supplier_id) = &input.supplier_id {
        let supplier = sqlx::query("SELECT name_fa, is_active FROM suppliers WHERE id = $1")
            .bind(supplier_id)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?
            .ok_or_else(|| not_found("تأمین‌کننده یافت نشد.", "SUPPLIER_NOT_FOUND"))?;
        if supplier.get::<i64, _>("is_active") != 1 {
            return Err(bad_request(
                "این تأمین‌کننده غیرفعال است.",
                "SUPPLIER_INACTIVE",
            ));
        }
        supplier_name = Some(supplier.get::<String, _>("name_fa"));
    }
    for item in &input.items {
        if item.qty <= 0.0 || item.qty > 1_000_000.0 || !(0..=100_000_000).contains(&item.unit_cost)
        {
            return Err(validation_failed("قلم خرید معتبر نیست."));
        }
        let exists = sqlx::query("SELECT id FROM ingredients WHERE id = $1")
            .bind(&item.ingredient_id)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?;
        if exists.is_none() {
            return Err(bad_request(
                "یکی از مواد اولیه انتخاب‌شده یافت نشد.",
                "INGREDIENT_NOT_FOUND",
            ));
        }
    }
    let purchased_at = input
        .purchased_at
        .as_deref()
        .and_then(|value| OffsetDateTime::parse(value, &Rfc3339).ok())
        .map(|value| value.format(&Rfc3339).unwrap_or_default())
        .unwrap_or_else(now);
    let total: i64 = input
        .items
        .iter()
        .map(|item| (item.qty * item.unit_cost as f64).round() as i64)
        .sum();
    let id = Uuid::new_v4().to_string();
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "INSERT INTO purchases
           (id, supplier_id, invoice_no, total, purchased_at, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&id)
    .bind(&input.supplier_id)
    .bind(&input.invoice_no)
    .bind(total)
    .bind(&purchased_at)
    .bind(&session.user.id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    for item in &input.items {
        let qty = round3(item.qty);
        sqlx::query(
            "INSERT INTO purchase_items (id, purchase_id, ingredient_id, qty, unit_cost)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&id)
        .bind(&item.ingredient_id)
        .bind(qty)
        .bind(item.unit_cost)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query("UPDATE ingredients SET current_qty = current_qty + $1, cost_per_unit = $2 WHERE id = $3")
            .bind(qty)
            .bind(item.unit_cost)
            .bind(&item.ingredient_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        sqlx::query(
            "INSERT INTO stock_movements
               (id, ingredient_id, type, qty, ref_type, ref_id, note, created_by_user_id)
             VALUES ($1, $2, 'purchase', $3, 'purchase', $4, $5, $6)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&item.ingredient_id)
        .bind(qty)
        .bind(&id)
        .bind(
            input
                .invoice_no
                .as_deref()
                .map(|invoice| format!("خرید — فاکتور {invoice}"))
                .unwrap_or_else(|| "خرید کالا".into()),
        )
        .bind(&session.user.id)
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
            action: "inventory.purchase_created".into(),
            entity_type: "purchase".into(),
            entity_id: Some(id.clone()),
            after_json: Some(
                json!({
                    "supplierId": input.supplier_id,
                    "total": total,
                    "itemCount": input.items.len(),
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({
        "id": id,
        "supplierId": input.supplier_id,
        "supplierNameFa": supplier_name,
        "invoiceNo": input.invoice_no,
        "total": total,
        "purchasedAt": purchased_at,
        "itemCount": input.items.len(),
        "createdByName": session.user.full_name,
    })))
}

pub async fn waste(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    guard(&state, &headers, "inventory.read").await?;
    require_module(&state, ModuleKey::Inventory).await?;
    let rows = sqlx::query(
        "SELECT w.id, w.ingredient_id, i.name_fa, w.qty, u.symbol, w.reason,
                us.full_name AS recorded_by_name, w.created_at
           FROM waste_records w JOIN ingredients i ON i.id = w.ingredient_id
           LEFT JOIN measurement_units u ON u.id = i.unit_id
           LEFT JOIN users us ON us.id = w.recorded_by_user_id
          ORDER BY w.created_at DESC LIMIT $1",
    )
    .bind(limit(&query, 40))
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "ingredientId": row.get::<String, _>("ingredient_id"),
                "ingredientNameFa": row.get::<String, _>("name_fa"),
                "qty": round3(row.get::<f64, _>("qty")),
                "unitSymbol": row.get::<Option<String>, _>("symbol"),
                "reason": row.get::<Option<String>, _>("reason"),
                "recordedByName": row.get::<Option<String>, _>("recorded_by_name"),
                "createdAt": row.get::<String, _>("created_at"),
            })
        })
        .collect();
    Ok(Json(json!({ "items": items })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WasteInput {
    ingredient_id: String,
    qty: f64,
    reason: String,
}

pub async fn create_waste(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = guard(&state, &headers, "inventory.write").await?;
    require_module(&state, ModuleKey::Inventory).await?;
    let input: WasteInput = parse_body(&body)?;
    if input.qty <= 0.0 || input.qty > 1_000_000.0 {
        return Err(validation_failed("مقدار ضایعات معتبر نیست."));
    }
    if !(2..=200).contains(&input.reason.trim().chars().count()) {
        return Err(validation_failed("دلیل ضایعات الزامی است."));
    }
    let ingredient = sqlx::query(
        "SELECT i.name_fa, i.current_qty, u.symbol FROM ingredients i
           LEFT JOIN measurement_units u ON u.id = i.unit_id WHERE i.id = $1",
    )
    .bind(&input.ingredient_id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .ok_or_else(|| not_found("ماده اولیه یافت نشد.", "INGREDIENT_NOT_FOUND"))?;
    let current: f64 = ingredient.get("current_qty");
    let qty = round3(input.qty);
    if current < qty {
        return Err(bad_request(
            format!(
                "موجودی «{}» برای ثبت این ضایعات کافی نیست؛ موجودی فعلی {} است.",
                ingredient.get::<String, _>("name_fa"),
                round3(current)
            ),
            "INSUFFICIENT_STOCK",
        )
        .with_details(json!({ "currentQty": round3(current), "qty": qty })));
    }
    let id = Uuid::new_v4().to_string();
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query(
        "INSERT INTO waste_records (id, ingredient_id, qty, reason, recorded_by_user_id)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&id)
    .bind(&input.ingredient_id)
    .bind(qty)
    .bind(input.reason.trim())
    .bind(&session.user.id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    sqlx::query("UPDATE ingredients SET current_qty = current_qty - $1 WHERE id = $2")
        .bind(qty)
        .bind(&input.ingredient_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query(
        "INSERT INTO stock_movements
           (id, ingredient_id, type, qty, ref_type, ref_id, note, created_by_user_id)
         VALUES ($1, $2, 'waste', $3, 'waste', $4, $5, $6)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&input.ingredient_id)
    .bind(-qty)
    .bind(&id)
    .bind(input.reason.trim())
    .bind(&session.user.id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    record(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "inventory.waste_recorded".into(),
            entity_type: "waste_record".into(),
            entity_id: Some(id.clone()),
            after_json: Some(
                json!({
                    "ingredientId": input.ingredient_id,
                    "qty": qty,
                    "reason": input.reason.trim(),
                })
                .to_string(),
            ),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({
        "id": id,
        "ingredientId": input.ingredient_id,
        "ingredientNameFa": ingredient.get::<String, _>("name_fa"),
        "qty": qty,
        "unitSymbol": ingredient.get::<Option<String>, _>("symbol"),
        "reason": input.reason.trim(),
        "recordedByName": session.user.full_name,
        "createdAt": now(),
    })))
}
