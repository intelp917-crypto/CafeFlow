use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Redirect, Response};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};
use sqlx::Row;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Clone)]
struct BrandingRow {
    name_fa: String,
    logo_url: Option<String>,
    address_fa: Option<String>,
    phone: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
}

async fn branding_row(state: &AppState) -> Result<BrandingRow, AppError> {
    let row = sqlx::query(
        "SELECT restaurant_name_fa, logo_url, address_fa, phone, latitude, longitude
           FROM settings WHERE id = 'singleton'",
    )
    .fetch_optional(&state.db.pool)
    .await
    .map_err(|error| {
        tracing::error!("settings query: {error}");
        AppError::internal("خواندن تنظیمات ناموفق بود.")
    })?;
    Ok(row.map_or_else(
        || BrandingRow {
            name_fa: "کافه‌فلو".to_string(),
            logo_url: None,
            address_fa: None,
            phone: None,
            latitude: None,
            longitude: None,
        },
        |row| BrandingRow {
            name_fa: row.get("restaurant_name_fa"),
            logo_url: row.get("logo_url"),
            address_fa: row.get("address_fa"),
            phone: row.get("phone"),
            latitude: row.get("latitude"),
            longitude: row.get("longitude"),
        },
    ))
}

pub async fn branding(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let row = branding_row(&state).await?;
    Ok(Json(json!({
        "nameFa": row.name_fa,
        "logoUrl": row.logo_url,
        "addressFa": row.address_fa,
        "phone": row.phone,
        "latitude": row.latitude,
        "longitude": row.longitude,
    })))
}

pub async fn branding_manifest(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let row = branding_row(&state).await?;
    let icon = |size: u16| {
        if row.logo_url.as_deref().and_then(parse_logo).is_some() {
            format!("/api/v1/public/branding/icon/{size}")
        } else {
            format!("/icon-{size}.png")
        }
    };
    Ok(Json(json!({
        "name": format!("{} — مدیریت کافه و رستوران", row.name_fa),
        "short_name": row.name_fa,
        "description": "منوی QR، سفارش، آماده‌سازی، صندوق، رزرو و گزارش‌های کافه و رستوران",
        "lang": "fa-IR",
        "dir": "rtl",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "orientation": "portrait-primary",
        "background_color": "#f8f5f2",
        "theme_color": "#aa472b",
        "icons": [
            {"src": icon(192), "sizes": "192x192", "purpose": "any"},
            {"src": icon(512), "sizes": "512x512", "purpose": "any"}
        ]
    })))
}

pub async fn branding_icon(
    State(state): State<AppState>,
    Path(size): Path<String>,
) -> Result<Response, AppError> {
    let size = if size == "512" { "512" } else { "192" };
    let row = branding_row(&state).await?;
    let Some((mime, bytes)) = row.logo_url.as_deref().and_then(parse_logo) else {
        return Ok(Redirect::temporary(&format!("/icon-{size}.png")).into_response());
    };
    let content_type =
        HeaderValue::from_str(mime).unwrap_or(HeaderValue::from_static("application/octet-stream"));
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-cache")),
            (
                header::X_CONTENT_TYPE_OPTIONS,
                HeaderValue::from_static("nosniff"),
            ),
        ],
        bytes,
    )
        .into_response())
}

/// The existing settings screen stores the logo as a base64 data URL, which is
/// exactly what the manifest icon endpoint needs. Only png/jpeg/webp are
/// accepted so an uploaded SVG can never become an executable document.
fn parse_logo(value: &str) -> Option<(&'static str, Vec<u8>)> {
    let (meta, payload) = value.strip_prefix("data:")?.split_once(',')?;
    let mime = meta.strip_suffix(";base64")?;
    let mime = match mime {
        "image/png" => "image/png",
        "image/jpeg" => "image/jpeg",
        "image/webp" => "image/webp",
        _ => return None,
    };
    let bytes = STANDARD.decode(payload).ok()?;
    Some((mime, bytes))
}
