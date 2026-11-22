//! Bulk menu import. The whole CSV is validated first, invalid rows are
//! reported, and valid rows are written in one transaction.

use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use cafeflow_domain::persian::{normalize_for_search, normalize_persian};
use serde::{Deserialize, Serialize};
use sqlx::{Any, QueryBuilder, Row};
use uuid::Uuid;

use crate::auth::{require_auth, session_has_permission};
use crate::catalog::{
    load_catalog, normalized_name, record, safe_image_url, slugify, validate_price,
};
use crate::error::{AppError, bad_request, forbidden, validation_failed};
use crate::public_menu::db_error;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
struct ImportInput {
    csv: String,
    #[serde(rename = "dryRun")]
    dry_run: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportRow {
    line: usize,
    action: &'static str,
    name_fa: String,
    category_name_fa: String,
    message_fa: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ImportSummary {
    created: usize,
    updated: usize,
    errors: usize,
    #[serde(rename = "categoriesCreated")]
    categories_created: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    dry_run: bool,
    rows: Vec<ImportRow>,
    summary: ImportSummary,
}

struct Plan {
    line: usize,
    action: &'static str,
    name_fa: String,
    category_name_fa: String,
    message_fa: Option<String>,
    category_key: String,
    category_id: String,
    existing_product_id: Option<String>,
    search_key: String,
    price: Option<i64>,
    description_fa: Option<String>,
    department_id: Option<String>,
    prep_minutes: Option<i64>,
    image_url: Option<String>,
    is_available: Option<bool>,
    is_active: Option<bool>,
}

fn parse_csv(text: &str) -> Result<Vec<Vec<String>>, AppError> {
    let chars = text.chars().collect::<Vec<_>>();
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut index = 0;

    while index < chars.len() {
        let ch = chars[index];
        if quoted {
            if ch == '"' {
                if chars.get(index + 1) == Some(&'"') {
                    field.push('"');
                    index += 1;
                } else {
                    quoted = false;
                }
            } else {
                field.push(ch);
            }
        } else if ch == '"' {
            quoted = true;
        } else if ch == ',' {
            row.push(std::mem::take(&mut field));
        } else if ch == '\n' {
            row.push(std::mem::take(&mut field));
            rows.push(std::mem::take(&mut row));
        } else if ch != '\r' {
            field.push(ch);
        }
        index += 1;
    }

    if quoted {
        return Err(bad_request(
            "نقل‌قول در فایل CSV بسته نشده است.",
            "CSV_UNTERMINATED_QUOTE",
        ));
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    Ok(rows)
}

fn parse_integer_cell(value: &str) -> Option<i64> {
    let normalized = normalize_persian(value);
    let digits = normalized
        .chars()
        .filter(|ch| ch.is_ascii_digit() || *ch == '-')
        .collect::<String>();
    if digits.is_empty() || digits == "-" {
        return None;
    }
    digits.parse::<i64>().ok()
}

fn parse_flag_cell(value: &str) -> Option<Option<bool>> {
    let normalized = value.trim().to_lowercase();
    if normalized.is_empty() {
        return Some(None);
    }
    if ["true", "1", "yes", "y", "فعال", "بله", "دارد"].contains(&normalized.as_str()) {
        return Some(Some(true));
    }
    if ["false", "0", "no", "n", "غیرفعال", "نه", "ندارد"].contains(&normalized.as_str())
    {
        return Some(Some(false));
    }
    None
}

fn empty_plan(line: usize, name_fa: String, category_name_fa: String, message_fa: String) -> Plan {
    Plan {
        line,
        action: "error",
        name_fa: if name_fa.is_empty() {
            format!("سطر {line}")
        } else {
            name_fa
        },
        category_name_fa,
        message_fa: Some(message_fa),
        category_key: String::new(),
        category_id: String::new(),
        existing_product_id: None,
        search_key: String::new(),
        price: None,
        description_fa: None,
        department_id: None,
        prep_minutes: None,
        image_url: None,
        is_available: None,
        is_active: None,
    }
}

pub async fn import_catalog(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<ImportResult>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if !session_has_permission(&state, &session.user.id, "catalog.write").await? {
        return Err(forbidden("اجازهٔ ویرایش منو را ندارید.", "FORBIDDEN"));
    }
    let input: ImportInput = serde_json::from_slice(&body)
        .map_err(|_| validation_failed("محتوای فایل CSV معتبر نیست."))?;
    if input.csv.is_empty() {
        return Err(validation_failed("محتوای فایل CSV الزامی است."));
    }
    if input.csv.len() > 300_000 {
        return Err(validation_failed(
            "حجم فایل CSV بیش از حد بزرگ است (حداکثر ۳۰۰ کیلوبایت).",
        ));
    }

    let text = input.csv.trim_start_matches('\u{feff}');
    let table = parse_csv(text)?
        .into_iter()
        .filter(|row| row.iter().any(|cell| !cell.trim().is_empty()))
        .collect::<Vec<_>>();
    if table.len() < 2 {
        return Err(bad_request(
            "فایل باید یک سطر سرستون و حداقل یک محصول داشته باشد.",
            "CSV_EMPTY",
        ));
    }
    let header = table[0]
        .iter()
        .map(|cell| cell.trim().to_lowercase())
        .collect::<Vec<_>>();
    let column = |key: &str| {
        let key = key.to_lowercase();
        header.iter().position(|cell| cell == &key)
    };
    if column("category").is_none() || column("name").is_none() || column("price").is_none() {
        return Err(bad_request(
            "سرستون‌های category، name و price در سطر اول الزامی‌اند.",
            "CSV_HEADER",
        ));
    }
    if table.len() - 1 > 1000 {
        return Err(bad_request(
            "حداکثر ۱۰۰۰ محصول در هر ایمپورت مجاز است.",
            "CSV_TOO_LARGE",
        ));
    }

    let catalog = load_catalog(&state).await?;
    let mut categories = catalog
        .categories
        .iter()
        .map(|row| {
            (
                normalize_for_search(&row.name_fa),
                (row.id.clone(), row.sort_order),
            )
        })
        .collect::<HashMap<_, _>>();
    let base_sort = categories
        .values()
        .map(|(_, sort)| *sort)
        .max()
        .unwrap_or(0);
    let departments = catalog
        .departments
        .iter()
        .map(|row| (normalize_for_search(&row.name_fa), row.id.clone()))
        .collect::<HashMap<_, _>>();
    let mut new_category_ids = HashMap::new();
    let mut seen_products = HashSet::new();
    let mut plans = Vec::new();

    for (offset, cells) in table.iter().skip(1).enumerate() {
        let line = offset + 2;
        let cell = |key: &str| {
            column(key)
                .and_then(|index| cells.get(index))
                .map(|value| value.trim().to_string())
                .unwrap_or_default()
        };
        let category_name_fa = normalize_persian(&cell("category"));
        let name_fa = normalize_persian(&cell("name"));
        if category_name_fa.is_empty() || name_fa.is_empty() {
            plans.push(empty_plan(
                line,
                name_fa,
                category_name_fa,
                "نام دسته و نام محصول الزامی است.".to_string(),
            ));
            continue;
        }
        let category_key = normalize_for_search(&category_name_fa);
        let existing_category = categories.get(&category_key).cloned();
        let category_id = existing_category
            .as_ref()
            .map(|(id, _)| id.clone())
            .or_else(|| new_category_ids.get(&category_key).cloned())
            .unwrap_or_else(|| {
                let id = Uuid::new_v4().to_string();
                new_category_ids.insert(category_key.clone(), id.clone());
                id
            });
        let search_key = normalize_for_search(&name_fa);
        let product_key = format!("{category_id}|{search_key}");
        if !seen_products.insert(product_key) {
            plans.push(empty_plan(
                line,
                name_fa,
                category_name_fa,
                "این محصول در همین فایل تکرار شده است.".to_string(),
            ));
            continue;
        }

        let existing_product_id = if let Some((existing_id, _)) = &existing_category {
            sqlx::query(
                "SELECT id FROM products
                  WHERE category_id = $1 AND search_key = $2 AND deleted_at IS NULL",
            )
            .bind(existing_id)
            .bind(&search_key)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?
            .map(|row| row.get::<String, _>("id"))
        } else {
            None
        };

        let price_text = cell("price");
        let price = if price_text.is_empty() {
            None
        } else {
            let parsed = parse_integer_cell(&price_text);
            if parsed.is_none() {
                plans.push(empty_plan(
                    line,
                    name_fa,
                    category_name_fa,
                    "قیمت باید عدد صحیح ریال باشد.".to_string(),
                ));
                continue;
            }
            parsed
        };
        if price.is_some_and(|value| value < 0) {
            plans.push(empty_plan(
                line,
                name_fa,
                category_name_fa,
                "قیمت نمی‌تواند منفی باشد.".to_string(),
            ));
            continue;
        }
        if existing_product_id.is_none() && price.is_none() {
            plans.push(empty_plan(
                line,
                name_fa,
                category_name_fa,
                "برای محصول تازه، قیمت الزامی است.".to_string(),
            ));
            continue;
        }

        let department_name = normalize_persian(&cell("department"));
        let department_id = if department_name.is_empty() {
            None
        } else {
            let found = departments
                .get(&normalize_for_search(&department_name))
                .cloned();
            if found.is_none() {
                plans.push(empty_plan(
                    line,
                    name_fa,
                    category_name_fa,
                    format!("واحد آماده‌سازی «{department_name}» پیدا نشد."),
                ));
                continue;
            }
            found
        };

        let prep_text = cell("prepMinutes");
        let prep_minutes = if prep_text.is_empty() {
            None
        } else {
            let parsed = parse_integer_cell(&prep_text);
            if parsed.is_none_or(|value| !(0..=240).contains(&value)) {
                plans.push(empty_plan(
                    line,
                    name_fa,
                    category_name_fa,
                    "زمان آماده‌سازی باید عدد صحیح بین ۰ و ۲۴۰ دقیقه باشد.".to_string(),
                ));
                continue;
            }
            parsed
        };

        let image_url = cell("imageUrl");
        if !image_url.is_empty() && !safe_image_url(&image_url) {
            plans.push(empty_plan(
                line,
                name_fa,
                category_name_fa,
                "نشانی تصویر باید HTTPS یا مسیر هم‌مبدأ باشد.".to_string(),
            ));
            continue;
        }

        let available = parse_flag_cell(&cell("isAvailable"));
        let active = parse_flag_cell(&cell("isActive"));
        if available.is_none() {
            plans.push(empty_plan(
                line,
                name_fa,
                category_name_fa,
                "مقدار isAvailable باید true یا false باشد.".to_string(),
            ));
            continue;
        }
        if active.is_none() {
            plans.push(empty_plan(
                line,
                name_fa,
                category_name_fa,
                "مقدار isActive باید true یا false باشد.".to_string(),
            ));
            continue;
        }

        plans.push(Plan {
            line,
            action: if existing_product_id.is_some() {
                "updated"
            } else {
                "created"
            },
            name_fa,
            category_name_fa,
            message_fa: None,
            category_key,
            category_id,
            existing_product_id,
            search_key,
            price,
            description_fa: {
                let description = cell("description");
                (!description.is_empty()).then(|| normalize_persian(&description))
            },
            department_id,
            prep_minutes,
            image_url: (!image_url.is_empty()).then_some(image_url),
            is_available: available.flatten(),
            is_active: active.flatten(),
        });
    }

    let writable = plans
        .iter()
        .filter(|plan| plan.action != "error")
        .collect::<Vec<_>>();
    let planned_categories = writable
        .iter()
        .filter(|plan| !categories.contains_key(&plan.category_key))
        .map(|plan| plan.category_key.clone())
        .collect::<HashSet<_>>();
    let dry_run = input.dry_run.unwrap_or(false);
    let categories_created = if !dry_run && !writable.is_empty() {
        apply_import(&state, &writable, &mut categories, base_sort).await?
    } else {
        planned_categories.len()
    };
    let summary = ImportSummary {
        created: writable
            .iter()
            .filter(|plan| plan.action == "created")
            .count(),
        updated: writable
            .iter()
            .filter(|plan| plan.action == "updated")
            .count(),
        errors: plans.len() - writable.len(),
        categories_created,
    };
    if !dry_run && !writable.is_empty() {
        record(
            &state,
            (&session.user.id, &session.user.username),
            "catalog.import",
            "catalog",
            "menu",
            serde_json::Value::Null,
            serde_json::to_value(&summary).unwrap_or(serde_json::Value::Null),
        )
        .await?;
    }
    Ok(Json(ImportResult {
        dry_run,
        rows: plans
            .into_iter()
            .map(|plan| ImportRow {
                line: plan.line,
                action: plan.action,
                name_fa: plan.name_fa,
                category_name_fa: plan.category_name_fa,
                message_fa: plan.message_fa,
            })
            .collect(),
        summary,
    }))
}

async fn apply_import(
    state: &AppState,
    plans: &[&Plan],
    categories: &mut HashMap<String, (String, i64)>,
    base_sort: i64,
) -> Result<usize, AppError> {
    let mut created_categories = 0usize;
    let mut sort_cursor = base_sort;
    let now = cafeflow_db::now_iso_after_minutes(0);
    let mut tx = state.db.pool.begin().await.map_err(db_error)?;

    for plan in plans {
        if !categories.contains_key(&plan.category_key) {
            sort_cursor += 1;
            created_categories += 1;
            let mut slug = slugify(&plan.category_name_fa, &plan.category_id);
            while sqlx::query("SELECT 1 FROM categories WHERE slug = $1")
                .bind(&slug)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_error)?
                .is_some()
            {
                slug = format!("{}-{}", slug, &plan.category_id[..6]);
            }
            normalized_name(&plan.category_name_fa, "نام دسته", 60)?;
            sqlx::query(
                "INSERT INTO categories (id, name_fa, slug, sort_order, is_active)
                 VALUES ($1, $2, $3, $4, 1)",
            )
            .bind(&plan.category_id)
            .bind(&plan.category_name_fa)
            .bind(&slug)
            .bind(sort_cursor)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
            categories.insert(
                plan.category_key.clone(),
                (plan.category_id.clone(), sort_cursor),
            );
        }

        if let Some(product_id) = plan.existing_product_id.as_deref() {
            let mut builder: QueryBuilder<Any> = QueryBuilder::new("UPDATE products SET ");
            {
                let mut separated = builder.separated(", ");
                if let Some(price) = plan.price {
                    separated.push("base_price = ");
                    separated.push_bind_unseparated(validate_price(price, "قیمت", false)?);
                }
                if let Some(description) = plan.description_fa.as_deref() {
                    separated.push("description_fa = ");
                    separated.push_bind_unseparated(description.to_string());
                }
                if let Some(department) = plan.department_id.as_deref() {
                    separated.push("department_id = ");
                    separated.push_bind_unseparated(department.to_string());
                }
                if let Some(prep) = plan.prep_minutes {
                    separated.push("prep_minutes = ");
                    separated.push_bind_unseparated(prep);
                }
                if let Some(image) = plan.image_url.as_deref() {
                    separated.push("image_url = ");
                    separated.push_bind_unseparated(image.to_string());
                }
                if let Some(available) = plan.is_available {
                    separated.push("is_available = ");
                    separated.push_bind_unseparated(i64::from(available));
                }
                if let Some(active) = plan.is_active {
                    separated.push("is_active = ");
                    separated.push_bind_unseparated(i64::from(active));
                }
                separated.push("updated_at = ");
                separated.push_bind_unseparated(now.clone());
            }
            builder
                .push(" WHERE id = ")
                .push_bind(product_id.to_string());
            builder.build().execute(&mut *tx).await.map_err(db_error)?;
            continue;
        }

        let sort_order: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products
              WHERE category_id = $1 AND deleted_at IS NULL",
        )
        .bind(&plan.category_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query(
            "INSERT INTO products
               (id, category_id, name_fa, search_key, description_fa, base_price,
                department_id, prep_minutes, sort_order, image_url, is_available,
                is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&plan.category_id)
        .bind(&plan.name_fa)
        .bind(&plan.search_key)
        .bind(&plan.description_fa)
        .bind(plan.price.unwrap_or(0))
        .bind(&plan.department_id)
        .bind(plan.prep_minutes.unwrap_or(10))
        .bind(sort_order)
        .bind(&plan.image_url)
        .bind(i64::from(plan.is_available.unwrap_or(true)))
        .bind(i64::from(plan.is_active.unwrap_or(true)))
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    Ok(created_categories)
}
