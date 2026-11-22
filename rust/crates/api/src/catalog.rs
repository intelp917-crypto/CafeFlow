//! The write side of the QR menu: categories, products, option groups,
//! extras, availability windows and product images. Reads are one document.

use std::collections::HashMap;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use cafeflow_domain::persian::{normalize_for_search, normalize_persian};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::{require_auth, session_has_permission};
use crate::error::{AppError, bad_request, conflict, forbidden, not_found, validation_failed};
use crate::public_menu::db_error;
use crate::state::AppState;

const MAX_IMAGE_BYTES: usize = 400 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryOut {
    pub id: String,
    pub name_fa: String,
    pub slug: String,
    pub sort_order: i64,
    pub is_active: bool,
    pub product_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionOut {
    pub id: String,
    pub name_fa: String,
    pub price_delta: i64,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionGroupOut {
    pub id: String,
    pub name_fa: String,
    pub min_select: i64,
    pub max_select: i64,
    pub is_required: bool,
    pub options: Vec<OptionOut>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtraOut {
    pub id: String,
    pub name_fa: String,
    pub price: i64,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowOut {
    pub weekday: Option<i64>,
    pub start_time: String,
    pub end_time: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductOut {
    pub id: String,
    pub category_id: String,
    pub category_name_fa: String,
    pub sort_order: i64,
    pub name_fa: String,
    pub description_fa: Option<String>,
    pub base_price: i64,
    pub department_id: Option<String>,
    pub department_name_fa: Option<String>,
    pub prep_minutes: i64,
    pub image_url: Option<String>,
    pub is_available: bool,
    pub is_active: bool,
    pub is_archived: bool,
    pub updated_at: String,
    pub option_groups: Vec<OptionGroupOut>,
    pub extras: Vec<ExtraOut>,
    pub availability_windows: Vec<WindowOut>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepartmentOut {
    pub id: String,
    pub name_fa: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogResponse {
    pub categories: Vec<CategoryOut>,
    pub products: Vec<ProductOut>,
    pub departments: Vec<DepartmentOut>,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CategoryInput {
    name_fa: Option<String>,
    sort_order: Option<i64>,
    is_active: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReorderInput {
    ids: Vec<String>,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductInput {
    category_id: Option<String>,
    name_fa: Option<String>,
    description_fa: Option<Option<String>>,
    base_price: Option<i64>,
    department_id: Option<Option<String>>,
    prep_minutes: Option<i64>,
    image_url: Option<Option<String>>,
    is_available: Option<bool>,
    is_active: Option<bool>,
    is_archived: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductReorderInput {
    category_id: String,
    ids: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
struct ProductOptionsInput {
    groups: Vec<GroupInput>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupInput {
    name_fa: String,
    min_select: Option<i64>,
    max_select: Option<i64>,
    is_required: Option<bool>,
    options: Vec<ProductOptionInput>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductOptionInput {
    name_fa: String,
    price_delta: Option<i64>,
    is_active: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
struct ProductExtrasInput {
    extras: Vec<ExtraInput>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtraInput {
    name_fa: String,
    price: i64,
    is_active: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
struct ProductAvailabilityInput {
    windows: Vec<WindowInput>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowInput {
    weekday: Option<i64>,
    start_time: String,
    end_time: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadImageInput {
    data_url: String,
}

fn parse_body<T: DeserializeOwned>(body: &Bytes, message: &str) -> Result<T, AppError> {
    serde_json::from_slice(body).map_err(|_| validation_failed(message))
}

pub(crate) fn normalized_name(value: &str, label: &str, max: usize) -> Result<String, AppError> {
    let normalized = normalize_persian(value);
    if normalized.is_empty() {
        return Err(validation_failed(format!("{label} الزامی است.")));
    }
    if normalized.chars().count() > max {
        return Err(validation_failed(format!("{label} بیش از حد طولانی است.")));
    }
    Ok(normalized)
}

pub(crate) fn validate_price(
    value: i64,
    label: &str,
    allow_negative: bool,
) -> Result<i64, AppError> {
    if !allow_negative && value < 0 {
        return Err(validation_failed(format!("{label} نمی‌تواند منفی باشد.")));
    }
    if allow_negative && value < -100_000_000 {
        return Err(validation_failed(format!("{label} از حد مجاز کوچک‌تر است.")));
    }
    if value > 1_000_000_000 {
        return Err(validation_failed(format!("{label} بیش از حد بزرگ است.")));
    }
    Ok(value)
}

pub(crate) fn safe_image_url(value: &str) -> bool {
    let value = value.trim();
    if value.starts_with('/') && !value.starts_with("//") && !value.contains('\\') {
        return true;
    }
    let Some(rest) = value.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split('/').next().unwrap_or_default();
    !host.is_empty() && !host.contains('@') && !value.chars().any(char::is_whitespace)
}

pub(crate) fn slugify(name: &str, id: &str) -> String {
    let normalized = normalize_for_search(name);
    let mut slug = String::new();
    for ch in normalized.chars() {
        if ch.is_alphanumeric() {
            slug.push(ch);
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-');
    let slug: String = slug.chars().take(40).collect();
    let slug = slug.trim_end_matches('-');
    if slug.is_empty() {
        format!("category-{}", &id[..8.min(id.len())])
    } else {
        slug.to_string()
    }
}

pub(crate) async fn record(
    state: &AppState,
    actor: (&String, &String),
    action: &str,
    entity_type: &str,
    entity_id: &str,
    before: Value,
    after: Value,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO audit_logs
           (id, actor_user_id, actor_username, action, entity_type, entity_id,
            before_json, after_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(actor.0.as_str())
    .bind(actor.1.as_str())
    .bind(action)
    .bind(entity_type)
    .bind(entity_id)
    .bind(before.to_string())
    .bind(after.to_string())
    .bind(cafeflow_db::now_iso_after_minutes(0))
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(())
}

fn to_value<T: Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

pub async fn get_catalog(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<CatalogResponse>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "catalog.read").await? {
        return Err(forbidden("اجازهٔ مشاهدهٔ منو را ندارید.", "FORBIDDEN"));
    }
    Ok(Json(load_catalog(&state).await?))
}

pub(crate) async fn load_catalog(state: &AppState) -> Result<CatalogResponse, AppError> {
    let categories = sqlx::query(
        "SELECT c.id, c.name_fa, c.slug, c.sort_order, c.is_active,
                (SELECT COUNT(*) FROM products p
                  WHERE p.category_id = c.id AND p.deleted_at IS NULL
                    AND p.is_archived = 0) AS product_count
           FROM categories c
          WHERE c.deleted_at IS NULL
          ORDER BY c.sort_order ASC, c.name_fa ASC",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    .into_iter()
    .map(|row| CategoryOut {
        id: row.get("id"),
        name_fa: row.get("name_fa"),
        slug: row.get("slug"),
        sort_order: row.get("sort_order"),
        is_active: row.get::<i64, _>("is_active") == 1,
        product_count: row.get("product_count"),
    })
    .collect::<Vec<_>>();

    let products = sqlx::query(
        "SELECT p.id, p.category_id, c.name_fa AS category_name_fa, p.name_fa,
                p.description_fa, p.base_price, p.department_id,
                d.name_fa AS department_name_fa, p.prep_minutes, p.image_url,
                p.is_available, p.is_active, p.is_archived, p.sort_order, p.updated_at
           FROM products p
           JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL
           LEFT JOIN departments d ON d.id = p.department_id
          WHERE p.deleted_at IS NULL
          ORDER BY c.sort_order ASC, p.sort_order ASC, p.name_fa ASC",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;

    let mut options_by_group: HashMap<String, Vec<OptionOut>> = HashMap::new();
    for row in sqlx::query(
        "SELECT id, option_group_id, name_fa, price_delta, is_active
           FROM product_options ORDER BY sort_order ASC, name_fa ASC",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    {
        options_by_group
            .entry(row.get("option_group_id"))
            .or_default()
            .push(OptionOut {
                id: row.get("id"),
                name_fa: row.get("name_fa"),
                price_delta: row.get("price_delta"),
                is_active: row.get::<i64, _>("is_active") == 1,
            });
    }

    let mut groups_by_product: HashMap<String, Vec<OptionGroupOut>> = HashMap::new();
    for row in sqlx::query(
        "SELECT id, product_id, name_fa, min_select, max_select, is_required
           FROM option_groups ORDER BY sort_order ASC, name_fa ASC",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    {
        let group_id: String = row.get("id");
        groups_by_product
            .entry(row.get("product_id"))
            .or_default()
            .push(OptionGroupOut {
                options: options_by_group.remove(&group_id).unwrap_or_default(),
                id: group_id,
                name_fa: row.get("name_fa"),
                min_select: row.get("min_select"),
                max_select: row.get("max_select"),
                is_required: row.get::<i64, _>("is_required") == 1,
            });
    }

    let mut extras_by_product: HashMap<String, Vec<ExtraOut>> = HashMap::new();
    for row in sqlx::query(
        "SELECT pe.product_id, e.id, e.name_fa, e.price, e.is_active
           FROM product_extras pe JOIN extras e ON e.id = pe.extra_id
          ORDER BY pe.sort_order ASC, e.name_fa ASC",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    {
        extras_by_product
            .entry(row.get("product_id"))
            .or_default()
            .push(ExtraOut {
                id: row.get("id"),
                name_fa: row.get("name_fa"),
                price: row.get("price"),
                is_active: row.get::<i64, _>("is_active") == 1,
            });
    }

    let mut windows_by_product: HashMap<String, Vec<WindowOut>> = HashMap::new();
    for row in sqlx::query(
        "SELECT product_id, weekday, start_time, end_time
           FROM availability_windows WHERE is_active = 1
          ORDER BY product_id, sort_order ASC",
    )
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    {
        windows_by_product
            .entry(row.get("product_id"))
            .or_default()
            .push(WindowOut {
                weekday: row.get("weekday"),
                start_time: row.get("start_time"),
                end_time: row.get("end_time"),
            });
    }

    let products = products
        .into_iter()
        .map(|row| {
            let id: String = row.get("id");
            ProductOut {
                option_groups: groups_by_product.remove(&id).unwrap_or_default(),
                extras: extras_by_product.remove(&id).unwrap_or_default(),
                availability_windows: windows_by_product.remove(&id).unwrap_or_default(),
                id,
                category_id: row.get("category_id"),
                category_name_fa: row.get("category_name_fa"),
                sort_order: row.get("sort_order"),
                name_fa: row.get("name_fa"),
                description_fa: row.get("description_fa"),
                base_price: row.get("base_price"),
                department_id: row.get("department_id"),
                department_name_fa: row.get("department_name_fa"),
                prep_minutes: row.get("prep_minutes"),
                image_url: row.get("image_url"),
                is_available: row.get::<i64, _>("is_available") == 1,
                is_active: row.get::<i64, _>("is_active") == 1,
                is_archived: row.get::<i64, _>("is_archived") == 1,
                updated_at: row.get("updated_at"),
            }
        })
        .collect::<Vec<_>>();

    let departments = sqlx::query("SELECT id, name_fa FROM departments ORDER BY name_fa ASC")
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?
        .into_iter()
        .map(|row| DepartmentOut {
            id: row.get("id"),
            name_fa: row.get("name_fa"),
        })
        .collect::<Vec<_>>();

    Ok(CatalogResponse {
        categories,
        products,
        departments,
    })
}

async fn find_category(state: &AppState, id: &str) -> Result<CategoryOut, AppError> {
    load_catalog(state)
        .await?
        .categories
        .into_iter()
        .find(|row| row.id == id)
        .ok_or_else(|| not_found("این دسته یافت نشد.", "CATEGORY_NOT_FOUND"))
}

async fn require_category(state: &AppState, id: &str) -> Result<(), AppError> {
    if load_catalog(state)
        .await?
        .categories
        .iter()
        .any(|row| row.id == id)
    {
        Ok(())
    } else {
        Err(bad_request(
            "دستهٔ انتخاب‌شده وجود ندارد یا حذف شده است.",
            "CATEGORY_NOT_FOUND",
        ))
    }
}

async fn require_department(
    state: &AppState,
    id: Option<&str>,
) -> Result<Option<String>, AppError> {
    let Some(id) = id else {
        return Ok(None);
    };
    let exists = sqlx::query("SELECT 1 FROM departments WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?
        .is_some();
    if !exists {
        return Err(bad_request(
            "واحد آماده‌سازی انتخاب‌شده وجود ندارد.",
            "DEPARTMENT_NOT_FOUND",
        ));
    }
    Ok(Some(id.to_string()))
}

async fn find_product(state: &AppState, id: &str) -> Result<ProductOut, AppError> {
    load_catalog(state)
        .await?
        .products
        .into_iter()
        .find(|row| row.id == id)
        .ok_or_else(|| not_found("این محصول در منو نیست.", "PRODUCT_NOT_FOUND"))
}

pub async fn create_category(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<CategoryOut>), AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "catalog.write").await? {
        return Err(forbidden("اجازهٔ ویرایش منو را ندارید.", "FORBIDDEN"));
    }
    let input: CategoryInput = parse_body(&body, "اطلاعات دسته معتبر نیست.")?;
    let name_fa = normalized_name(input.name_fa.as_deref().unwrap_or_default(), "نام دسته", 60)?;
    let categories = load_catalog(&state).await?.categories;
    if let Some(duplicate) = categories
        .iter()
        .find(|row| normalize_for_search(&row.name_fa) == normalize_for_search(&name_fa))
    {
        return Err(conflict(
            format!("دستهٔ «{}» از قبل وجود دارد.", duplicate.name_fa),
            "CATEGORY_EXISTS",
        ));
    }
    let sort_order = input.sort_order.unwrap_or_else(|| {
        categories
            .iter()
            .map(|row| row.sort_order)
            .max()
            .unwrap_or(0)
            + 1
    });
    if !(0..=9999).contains(&sort_order) {
        return Err(validation_failed("ترتیب باید عدد صحیح بین ۰ تا ۹۹۹۹ باشد."));
    }
    let id = Uuid::new_v4().to_string();
    let mut slug = slugify(&name_fa, &id);
    while sqlx::query("SELECT 1 FROM categories WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?
        .is_some()
    {
        slug = format!("{}-{}", slug, &id[..6]);
    }
    sqlx::query(
        "INSERT INTO categories (id, name_fa, slug, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&id)
    .bind(&name_fa)
    .bind(&slug)
    .bind(sort_order)
    .bind(i64::from(input.is_active.unwrap_or(true)))
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    let created = find_category(&state, &id).await?;
    record(
        &state,
        (&session.user.id, &session.user.username),
        "catalog.category.create",
        "category",
        &id,
        Value::Null,
        to_value(&created),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(created)))
}

pub async fn update_category(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<CategoryOut>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "catalog.write").await? {
        return Err(forbidden("اجازهٔ ویرایش منو را ندارید.", "FORBIDDEN"));
    }
    let input: CategoryInput = parse_body(&body, "اطلاعات دسته معتبر نیست.")?;
    if input.name_fa.is_none() && input.sort_order.is_none() && input.is_active.is_none() {
        return Err(validation_failed("حداقل یک تغییر لازم است."));
    }
    let existing = find_category(&state, &id).await?;
    let name_fa = match input.name_fa {
        Some(value) => normalized_name(&value, "نام دسته", 60)?,
        None => existing.name_fa.clone(),
    };
    if let Some(duplicate) = load_catalog(&state).await?.categories.iter().find(|row| {
        row.id != id && normalize_for_search(&row.name_fa) == normalize_for_search(&name_fa)
    }) {
        return Err(conflict(
            format!("دستهٔ «{}» از قبل وجود دارد.", duplicate.name_fa),
            "CATEGORY_EXISTS",
        ));
    }
    let sort_order = input.sort_order.unwrap_or(existing.sort_order);
    if !(0..=9999).contains(&sort_order) {
        return Err(validation_failed("ترتیب باید عدد صحیح بین ۰ تا ۹۹۹۹ باشد."));
    }
    sqlx::query(
        "UPDATE categories SET name_fa = $1, sort_order = $2, is_active = $3 WHERE id = $4",
    )
    .bind(&name_fa)
    .bind(sort_order)
    .bind(i64::from(input.is_active.unwrap_or(existing.is_active)))
    .bind(&id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    let updated = find_category(&state, &id).await?;
    record(
        &state,
        (&session.user.id, &session.user.username),
        "catalog.category.update",
        "category",
        &id,
        to_value(&existing),
        to_value(&updated),
    )
    .await?;
    Ok(Json(updated))
}

pub async fn reorder_categories(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Vec<CategoryOut>>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "catalog.write").await? {
        return Err(forbidden("اجازهٔ ویرایش منو را ندارید.", "FORBIDDEN"));
    }
    let input: ReorderInput = parse_body(&body, "ترتیب دسته‌ها معتبر نیست.")?;
    if input.ids.is_empty() || input.ids.len() > 200 {
        return Err(validation_failed(
            "ترتیب دسته‌ها خالی یا بیش از حد بزرگ است.",
        ));
    }
    let current = load_catalog(&state).await?.categories;
    let known = current
        .iter()
        .map(|row| row.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let unique = input.ids.iter().collect::<std::collections::HashSet<_>>();
    if unique.len() != input.ids.len() || input.ids.iter().any(|id| !known.contains(id.as_str())) {
        return Err(bad_request(
            "فهرست دسته‌ها با ترتیب ذخیره‌شده هم‌خوان نیست؛ صفحه را تازه کنید.",
            "CATEGORY_ORDER_STALE",
        ));
    }
    if input.ids.len() != current.len() {
        return Err(bad_request(
            "برای تغییر ترتیب، همهٔ دسته‌های فعال را بفرستید.",
            "CATEGORY_ORDER_INCOMPLETE",
        ));
    }
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    for (index, id) in input.ids.iter().enumerate() {
        sqlx::query("UPDATE categories SET sort_order = $1 WHERE id = $2 AND deleted_at IS NULL")
            .bind((index + 1) as i64)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    let after = load_catalog(&state).await?.categories;
    record(
        &state,
        (&session.user.id, &session.user.username),
        "catalog.category.reorder",
        "category",
        "order",
        current
            .iter()
            .map(|row| json!({"id": row.id, "sortOrder": row.sort_order}))
            .collect(),
        after
            .iter()
            .map(|row| json!({"id": row.id, "sortOrder": row.sort_order}))
            .collect(),
    )
    .await?;
    Ok(Json(after))
}

pub async fn delete_category(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "catalog.write").await? {
        return Err(forbidden("اجازهٔ ویرایش منو را ندارید.", "FORBIDDEN"));
    }
    let existing = find_category(&state, &id).await?;
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM products WHERE category_id = $1 AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?;
    if count > 0 {
        return Err(conflict(
            format!("این دسته {count} محصول دارد؛ ابتدا محصولات را جابه‌جا یا بایگانی کنید."),
            "CATEGORY_NOT_EMPTY",
        ));
    }
    sqlx::query("UPDATE categories SET deleted_at = $1, is_active = 0 WHERE id = $2")
        .bind(cafeflow_db::now_iso_after_minutes(0))
        .bind(&id)
        .execute(&state.db.pool)
        .await
        .map_err(db_error)?;
    record(
        &state,
        (&session.user.id, &session.user.username),
        "catalog.category.delete",
        "category",
        &id,
        to_value(&existing),
        Value::Null,
    )
    .await?;
    Ok(Json(json!({"id": id})))
}

pub async fn create_product(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<ProductOut>), AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "catalog.write").await? {
        return Err(forbidden("اجازهٔ ویرایش منو را ندارید.", "FORBIDDEN"));
    }
    let input: ProductInput = parse_body(&body, "اطلاعات محصول معتبر نیست.")?;
    let category_id = input
        .category_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| validation_failed("دسته الزامی است."))?
        .to_string();
    require_category(&state, &category_id).await?;
    let name_fa = normalized_name(
        input.name_fa.as_deref().unwrap_or_default(),
        "نام محصول",
        80,
    )?;
    let search_key = normalize_for_search(&name_fa);
    if sqlx::query(
        "SELECT 1 FROM products
          WHERE category_id = $1 AND search_key = $2 AND deleted_at IS NULL",
    )
    .bind(&category_id)
    .bind(&search_key)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .is_some()
    {
        return Err(conflict(
            format!("محصول «{name_fa}» در این دسته از قبل وجود دارد."),
            "PRODUCT_EXISTS",
        ));
    }
    let base_price = validate_price(
        input
            .base_price
            .ok_or_else(|| validation_failed("قیمت الزامی است."))?,
        "قیمت",
        false,
    )?;
    let description_fa = input
        .description_fa
        .flatten()
        .map(|value| normalize_persian(&value))
        .filter(|value| !value.is_empty());
    if description_fa
        .as_deref()
        .is_some_and(|value| value.chars().count() > 400)
    {
        return Err(validation_failed("توضیح بیش از حد طولانی است."));
    }
    let department_id =
        require_department(&state, input.department_id.flatten().as_deref()).await?;
    let prep_minutes = input.prep_minutes.unwrap_or(10);
    if !(0..=240).contains(&prep_minutes) {
        return Err(validation_failed(
            "زمان آماده‌سازی باید بین ۰ تا ۲۴۰ دقیقه باشد.",
        ));
    }
    let image_url = input
        .image_url
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(url) = image_url.as_deref() {
        if url.chars().count() > 500 {
            return Err(validation_failed("نشانی تصویر بیش از حد طولانی است."));
        }
        if !safe_image_url(url) {
            return Err(validation_failed(
                "نشانی تصویر باید HTTPS یا مسیر محلی هم‌مبدأ باشد.",
            ));
        }
    }
    let sort_order: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products
          WHERE category_id = $1 AND deleted_at IS NULL",
    )
    .bind(&category_id)
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?;
    let id = Uuid::new_v4().to_string();
    let now = cafeflow_db::now_iso_after_minutes(0);
    sqlx::query(
        "INSERT INTO products
           (id, category_id, name_fa, search_key, description_fa, base_price,
            department_id, prep_minutes, sort_order, image_url, is_available,
            is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)",
    )
    .bind(&id)
    .bind(&category_id)
    .bind(&name_fa)
    .bind(&search_key)
    .bind(&description_fa)
    .bind(base_price)
    .bind(&department_id)
    .bind(prep_minutes)
    .bind(sort_order)
    .bind(&image_url)
    .bind(i64::from(input.is_available.unwrap_or(true)))
    .bind(i64::from(input.is_active.unwrap_or(true)))
    .bind(&now)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    let created = find_product(&state, &id).await?;
    record(
        &state,
        (&session.user.id, &session.user.username),
        "catalog.product.create",
        "product",
        &id,
        Value::Null,
        to_value(&created),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(created)))
}

pub async fn update_product(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<ProductOut>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "catalog.write").await? {
        return Err(forbidden("اجازهٔ ویرایش منو را ندارید.", "FORBIDDEN"));
    }
    let input: ProductInput = parse_body(&body, "اطلاعات محصول معتبر نیست.")?;
    if input.category_id.is_none()
        && input.name_fa.is_none()
        && input.description_fa.is_none()
        && input.base_price.is_none()
        && input.department_id.is_none()
        && input.prep_minutes.is_none()
        && input.image_url.is_none()
        && input.is_available.is_none()
        && input.is_active.is_none()
        && input.is_archived.is_none()
    {
        return Err(validation_failed("حداقل یک تغییر لازم است."));
    }
    let existing = find_product(&state, &id).await?;
    let mut category_id = existing.category_id.clone();
    let mut sort_order = existing.sort_order;
    if let Some(requested) = input.category_id.as_deref() {
        let requested = requested.trim();
        if !requested.is_empty() && requested != existing.category_id {
            require_category(&state, requested).await?;
            sort_order = sqlx::query_scalar(
                "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products
                  WHERE category_id = $1 AND deleted_at IS NULL",
            )
            .bind(requested)
            .fetch_one(&state.db.pool)
            .await
            .map_err(db_error)?;
            category_id = requested.to_string();
        }
    }
    let name_fa = match input.name_fa {
        Some(value) => normalized_name(&value, "نام محصول", 80)?,
        None => existing.name_fa.clone(),
    };
    let search_key = normalize_for_search(&name_fa);
    if sqlx::query(
        "SELECT 1 FROM products
          WHERE category_id = $1 AND search_key = $2 AND id <> $3 AND deleted_at IS NULL",
    )
    .bind(&category_id)
    .bind(&search_key)
    .bind(&id)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .is_some()
    {
        return Err(conflict(
            format!("محصول «{name_fa}» در این دسته از قبل وجود دارد."),
            "PRODUCT_EXISTS",
        ));
    }
    let description_fa = match input.description_fa {
        Some(value) => value
            .map(|text| normalize_persian(&text))
            .filter(|text| !text.is_empty()),
        None => existing.description_fa.clone(),
    };
    if description_fa
        .as_deref()
        .is_some_and(|value| value.chars().count() > 400)
    {
        return Err(validation_failed("توضیح بیش از حد طولانی است."));
    }
    let base_price = match input.base_price {
        Some(value) => validate_price(value, "قیمت", false)?,
        None => existing.base_price,
    };
    let department_id = match input.department_id {
        Some(value) => require_department(&state, value.as_deref()).await?,
        None => existing.department_id.clone(),
    };
    let prep_minutes = input.prep_minutes.unwrap_or(existing.prep_minutes);
    if !(0..=240).contains(&prep_minutes) {
        return Err(validation_failed(
            "زمان آماده‌سازی باید بین ۰ تا ۲۴۰ دقیقه باشد.",
        ));
    }
    let image_url = match input.image_url {
        Some(value) => value
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty()),
        None => existing.image_url.clone(),
    };
    if let Some(url) = image_url.as_deref() {
        if url.chars().count() > 500 {
            return Err(validation_failed("نشانی تصویر بیش از حد طولانی است."));
        }
        if !safe_image_url(url) {
            return Err(validation_failed(
                "نشانی تصویر باید HTTPS یا مسیر محلی هم‌مبدأ باشد.",
            ));
        }
    }
    let now = cafeflow_db::now_iso_after_minutes(0);
    sqlx::query(
        "UPDATE products SET category_id = $1, name_fa = $2, search_key = $3,
           description_fa = $4, base_price = $5, department_id = $6,
           prep_minutes = $7, sort_order = $8, image_url = $9, is_available = $10,
           is_active = $11, is_archived = $12, updated_at = $13 WHERE id = $14",
    )
    .bind(&category_id)
    .bind(&name_fa)
    .bind(&search_key)
    .bind(&description_fa)
    .bind(base_price)
    .bind(&department_id)
    .bind(prep_minutes)
    .bind(sort_order)
    .bind(&image_url)
    .bind(i64::from(
        input.is_available.unwrap_or(existing.is_available),
    ))
    .bind(i64::from(input.is_active.unwrap_or(existing.is_active)))
    .bind(i64::from(input.is_archived.unwrap_or(existing.is_archived)))
    .bind(&now)
    .bind(&id)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    let updated = find_product(&state, &id).await?;
    record(
        &state,
        (&session.user.id, &session.user.username),
        "catalog.product.update",
        "product",
        &id,
        to_value(&existing),
        to_value(&updated),
    )
    .await?;
    Ok(Json(updated))
}

pub async fn archive_product(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ProductOut>, AppError> {
    set_archived(state, headers, id).await
}

async fn set_archived(
    state: AppState,
    headers: HeaderMap,
    id: String,
) -> Result<Json<ProductOut>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "catalog.write").await? {
        return Err(forbidden("اجازهٔ ویرایش منو را ندارید.", "FORBIDDEN"));
    }
    let existing = find_product(&state, &id).await?;
    let now = cafeflow_db::now_iso_after_minutes(0);
    sqlx::query("UPDATE products SET is_archived = 1, updated_at = $1 WHERE id = $2")
        .bind(&now)
        .bind(&id)
        .execute(&state.db.pool)
        .await
        .map_err(db_error)?;
    let updated = find_product(&state, &id).await?;
    record(
        &state,
        (&session.user.id, &session.user.username),
        "catalog.product.update",
        "product",
        &id,
        to_value(&existing),
        to_value(&updated),
    )
    .await?;
    Ok(Json(updated))
}

pub async fn reorder_products(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Vec<ProductOut>>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "catalog.write").await? {
        return Err(forbidden("اجازهٔ ویرایش منو را ندارید.", "FORBIDDEN"));
    }
    let input: ProductReorderInput = parse_body(&body, "ترتیب محصولات معتبر نیست.")?;
    if input.ids.is_empty() || input.ids.len() > 500 {
        return Err(validation_failed(
            "فهرست محصولات خالی یا بیش از حد بزرگ است.",
        ));
    }
    let catalog = load_catalog(&state).await?;
    let current = catalog
        .products
        .iter()
        .filter(|row| row.category_id == input.category_id)
        .collect::<Vec<_>>();
    let known = current
        .iter()
        .map(|row| row.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let unique = input.ids.iter().collect::<std::collections::HashSet<_>>();
    if unique.len() != input.ids.len() || input.ids.iter().any(|id| !known.contains(id.as_str())) {
        return Err(bad_request(
            "فهرست محصولات با ترتیب ذخیره‌شده هم‌خوان نیست؛ صفحه را تازه کنید.",
            "PRODUCT_ORDER_STALE",
        ));
    }
    if input.ids.len() != current.len() {
        return Err(bad_request(
            "برای تغییر ترتیب، همهٔ محصولات این دسته را بفرستید.",
            "PRODUCT_ORDER_INCOMPLETE",
        ));
    }
    let now = cafeflow_db::now_iso_after_minutes(0);
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    for (index, id) in input.ids.iter().enumerate() {
        sqlx::query(
            "UPDATE products SET sort_order = $1, updated_at = $2
              WHERE id = $3 AND category_id = $4 AND deleted_at IS NULL",
        )
        .bind((index + 1) as i64)
        .bind(&now)
        .bind(id)
        .bind(&input.category_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    let after = load_catalog(&state)
        .await?
        .products
        .into_iter()
        .filter(|row| row.category_id == input.category_id)
        .collect::<Vec<_>>();
    record(
        &state,
        (&session.user.id, &session.user.username),
        "catalog.product.reorder",
        "product",
        &input.category_id,
        current
            .iter()
            .map(|row| json!({"id": row.id, "sortOrder": row.sort_order}))
            .collect(),
        after
            .iter()
            .map(|row| json!({"id": row.id, "sortOrder": row.sort_order}))
            .collect(),
    )
    .await?;
    Ok(Json(after))
}

pub async fn replace_options(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<ProductOut>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "catalog.write").await? {
        return Err(forbidden("اجازهٔ ویرایش منو را ندارید.", "FORBIDDEN"));
    }
    let input: ProductOptionsInput = parse_body(&body, "گزینه‌های محصول معتبر نیستند.")?;
    if input.groups.len() > 10 {
        return Err(validation_failed(
            "هر محصول حداکثر ۱۰ گروه گزینه می‌تواند داشته باشد.",
        ));
    }
    let existing = find_product(&state, &id).await?;
    let mut normalized = Vec::with_capacity(input.groups.len());
    for group in &input.groups {
        let name_fa = normalized_name(&group.name_fa, "نام گروه گزینه", 60)?;
        if group.options.is_empty() || group.options.len() > 20 {
            return Err(validation_failed(
                "هر گروه باید بین ۱ تا ۲۰ گزینه داشته باشد.",
            ));
        }
        let min_select = group.min_select.unwrap_or(0);
        let max_select = group.max_select.unwrap_or(1);
        if !(0..=20).contains(&min_select) || !(1..=20).contains(&max_select) {
            return Err(validation_failed("حداقل/حداکثر انتخاب معتبر نیست."));
        }
        if max_select < min_select {
            return Err(validation_failed(
                "حداکثر انتخاب نمی‌تواند از حداقل کمتر باشد.",
            ));
        }
        let mut options = Vec::with_capacity(group.options.len());
        for option in &group.options {
            let option_name = normalized_name(&option.name_fa, "نام گزینه", 60)?;
            let price_delta = validate_price(option.price_delta.unwrap_or(0), "اختلاف قیمت", true)?;
            options.push((option_name, price_delta, option.is_active.unwrap_or(true)));
        }
        normalized.push((
            name_fa,
            min_select,
            max_select,
            group.is_required.unwrap_or(false),
            options,
        ));
    }
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query("DELETE FROM option_groups WHERE product_id = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    for (group_index, (name_fa, min_select, max_select, is_required, options)) in
        normalized.into_iter().enumerate()
    {
        let group_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO option_groups
               (id, product_id, name_fa, min_select, max_select, is_required, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(&group_id)
        .bind(&id)
        .bind(&name_fa)
        .bind(min_select)
        .bind(max_select)
        .bind(i64::from(is_required))
        .bind(group_index as i64)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        for (option_index, (option_name, price_delta, is_active)) in options.into_iter().enumerate()
        {
            sqlx::query(
                "INSERT INTO product_options
                   (id, option_group_id, name_fa, price_delta, is_active, sort_order)
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(&group_id)
            .bind(&option_name)
            .bind(price_delta)
            .bind(i64::from(is_active))
            .bind(option_index as i64)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
    }
    tx.commit().await.map_err(db_error)?;
    let updated = find_product(&state, &id).await?;
    record(
        &state,
        (&session.user.id, &session.user.username),
        "catalog.product.options",
        "product",
        &id,
        to_value(&existing.option_groups),
        to_value(&updated.option_groups),
    )
    .await?;
    Ok(Json(updated))
}

pub async fn replace_extras(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<ProductOut>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "catalog.write").await? {
        return Err(forbidden("اجازهٔ ویرایش منو را ندارید.", "FORBIDDEN"));
    }
    let input: ProductExtrasInput = parse_body(&body, "افزودنی‌های محصول معتبر نیستند.")?;
    if input.extras.len() > 30 {
        return Err(validation_failed(
            "هر محصول حداکثر ۳۰ افزودنی می‌تواند داشته باشد.",
        ));
    }
    let existing = find_product(&state, &id).await?;
    let mut extras = Vec::with_capacity(input.extras.len());
    for extra in &input.extras {
        let name_fa = normalized_name(&extra.name_fa, "نام افزودنی", 60)?;
        let price = validate_price(extra.price, "قیمت افزودنی", false)?;
        extras.push((name_fa, price, extra.is_active.unwrap_or(true)));
    }
    let previous = sqlx::query("SELECT extra_id FROM product_extras WHERE product_id = $1")
        .bind(&id)
        .fetch_all(&state.db.pool)
        .await
        .map_err(db_error)?
        .into_iter()
        .map(|row| row.get::<String, _>("extra_id"))
        .collect::<Vec<_>>();
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query("DELETE FROM product_extras WHERE product_id = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    for (index, (name_fa, price, is_active)) in extras.into_iter().enumerate() {
        let extra_id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO extras (id, name_fa, price, is_active) VALUES ($1, $2, $3, $4)")
            .bind(&extra_id)
            .bind(&name_fa)
            .bind(price)
            .bind(i64::from(is_active))
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        sqlx::query(
            "INSERT INTO product_extras (product_id, extra_id, sort_order) VALUES ($1, $2, $3)",
        )
        .bind(&id)
        .bind(&extra_id)
        .bind(index as i64)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    for extra_id in previous {
        sqlx::query(
            "DELETE FROM extras WHERE id = $1
              AND NOT EXISTS (SELECT 1 FROM product_extras WHERE extra_id = $1)",
        )
        .bind(&extra_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    let updated = find_product(&state, &id).await?;
    record(
        &state,
        (&session.user.id, &session.user.username),
        "catalog.product.extras",
        "product",
        &id,
        to_value(&existing.extras),
        to_value(&updated.extras),
    )
    .await?;
    Ok(Json(updated))
}

pub async fn replace_availability(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<ProductOut>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "catalog.write").await? {
        return Err(forbidden("اجازهٔ ویرایش منو را ندارید.", "FORBIDDEN"));
    }
    let input: ProductAvailabilityInput = parse_body(&body, "بازه‌های سرو محصول معتبر نیستند.")?;
    if input.windows.len() > 30 {
        return Err(validation_failed(
            "هر محصول حداکثر ۳۰ بازهٔ سرو می‌تواند داشته باشد.",
        ));
    }
    let existing = find_product(&state, &id).await?;
    for window in &input.windows {
        if window.weekday.is_some_and(|day| !(0..=6).contains(&day)) {
            return Err(validation_failed("روز هفته باید بین ۰ تا ۶ باشد."));
        }
        let valid_time = |value: &str| {
            let bytes = value.as_bytes();
            bytes.len() == 5
                && bytes[2] == b':'
                && bytes[..2].iter().all(u8::is_ascii_digit)
                && bytes[3..].iter().all(u8::is_ascii_digit)
                && bytes[..2]
                    .iter()
                    .try_fold(0u32, |acc, d| Some(acc * 10 + u32::from(d - b'0')))
                    .is_some_and(|hour| hour <= 23)
                && bytes[3..]
                    .iter()
                    .try_fold(0u32, |acc, d| Some(acc * 10 + u32::from(d - b'0')))
                    .is_some_and(|minute| minute <= 59)
        };
        if !valid_time(&window.start_time) || !valid_time(&window.end_time) {
            return Err(validation_failed("ساعت باید به شکل HH:mm باشد."));
        }
        if window.start_time >= window.end_time {
            return Err(validation_failed(
                "ساعت پایان باید بعد از ساعت شروع باشد؛ بازهٔ عبوری از نیمه‌شب پشتیبانی نمی‌شود.",
            ));
        }
    }
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;
    sqlx::query("DELETE FROM availability_windows WHERE product_id = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    for (index, window) in input.windows.iter().enumerate() {
        sqlx::query(
            "INSERT INTO availability_windows
               (id, product_id, weekday, start_time, end_time, is_active, sort_order)
             VALUES ($1, $2, $3, $4, $5, 1, $6)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&id)
        .bind(window.weekday)
        .bind(&window.start_time)
        .bind(&window.end_time)
        .bind(index as i64)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    let updated = find_product(&state, &id).await?;
    record(
        &state,
        (&session.user.id, &session.user.username),
        "catalog.product.availability",
        "product",
        &id,
        to_value(&existing.availability_windows),
        to_value(&updated.availability_windows),
    )
    .await?;
    Ok(Json(updated))
}

fn signature_matches(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/png" => bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

pub async fn upload_image(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "catalog.write").await? {
        return Err(forbidden("اجازهٔ ویرایش منو را ندارید.", "FORBIDDEN"));
    }
    let input: UploadImageInput = parse_body(&body, "فرمت درخواست تصویر معتبر نیست.")?;
    if input.data_url.len() > 600_000 {
        return Err(validation_failed(
            "حجم تصویر بیش از حد بزرگ است (حداکثر حدود ۴۰۰ کیلوبایت).",
        ));
    }
    let (meta, payload) = input
        .data_url
        .trim()
        .strip_prefix("data:")
        .and_then(|value| value.split_once(','))
        .ok_or_else(|| bad_request("فرمت تصویر باید PNG، JPEG یا WebP باشد.", "IMAGE_FORMAT"))?;
    let mime = meta
        .strip_suffix(";base64")
        .ok_or_else(|| bad_request("فرمت تصویر باید PNG، JPEG یا WebP باشد.", "IMAGE_FORMAT"))?;
    let extension = match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => {
            return Err(bad_request(
                "فرمت تصویر باید PNG، JPEG یا WebP باشد.",
                "IMAGE_FORMAT",
            ));
        }
    };
    let bytes = STANDARD
        .decode(payload)
        .map_err(|_| bad_request("محتوای base64 تصویر معتبر نیست.", "IMAGE_FORMAT"))?;
    if bytes.is_empty() {
        return Err(bad_request("تصویر خالی است.", "IMAGE_EMPTY"));
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(bad_request(
            "حجم تصویر بیش از ۴۰۰ کیلوبایت است.",
            "IMAGE_TOO_LARGE",
        ));
    }
    if !signature_matches(mime, &bytes) {
        return Err(bad_request(
            "محتوای فایل با فرمت تصویر هم‌خوان نیست.",
            "IMAGE_SIGNATURE",
        ));
    }
    let directory = state.config.data_directory.join("uploads").join("products");
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| AppError::internal(format!("ساخت پوشهٔ تصاویر: {error}")))?;
    let file = format!("{}.{}", Uuid::new_v4(), extension);
    tokio::fs::write(directory.join(&file), &bytes)
        .await
        .map_err(|error| AppError::internal(format!("ذخیرهٔ تصویر: {error}")))?;
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "url": format!("{}/public/product-images/{file}", state.config.api_prefix),
            "bytes": bytes.len(),
            "mime": mime,
        })),
    ))
}

fn safe_image_file(file: &str) -> bool {
    let Some((stem, extension)) = file.rsplit_once('.') else {
        return false;
    };
    let stem_ok = stem.len() == 36
        && stem.chars().enumerate().all(|(index, ch)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                ch == '-'
            } else {
                ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase()
            }
        });
    stem_ok && matches!(extension, "png" | "jpg" | "webp")
}

pub async fn product_image(
    State(state): State<AppState>,
    Path(file): Path<String>,
) -> Result<Response, AppError> {
    if !safe_image_file(&file) {
        return Err(not_found("تصویر یافت نشد.", "IMAGE_NOT_FOUND"));
    }
    let path = state
        .config
        .data_directory
        .join("uploads")
        .join("products")
        .join(&file);
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| not_found("تصویر یافت نشد.", "IMAGE_NOT_FOUND"))?;
    let mime = if file.ends_with(".png") {
        "image/png"
    } else if file.ends_with(".webp") {
        "image/webp"
    } else {
        "image/jpeg"
    };
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(mime)),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=31536000, immutable"),
            ),
            (
                header::X_CONTENT_TYPE_OPTIONS,
                HeaderValue::from_static("nosniff"),
            ),
        ],
        bytes,
    )
        .into_response())
}
