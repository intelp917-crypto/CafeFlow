use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::routing::{delete, get, post};
use tower_http::compression::CompressionLayer;
use tower_http::trace::TraceLayer;

use crate::auth;
use crate::error::{AppError, not_found};
use crate::health;
use crate::middleware::{api_headers, request_id, static_headers};
use crate::public;
use crate::state::AppState;
use crate::static_files::static_router;

pub fn build_router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health::health))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/auth/mfa", get(auth::mfa_status))
        .route("/auth/mfa/enroll", post(auth::enroll_mfa))
        .route("/auth/mfa/activate", post(auth::activate_mfa))
        .route(
            "/auth/mfa/recovery-codes",
            post(auth::regenerate_recovery_codes),
        )
        .route("/auth/mfa/disable", post(auth::disable_mfa))
        .route("/auth/sessions", get(auth::sessions))
        .route("/auth/sessions/{id}", delete(auth::revoke_session))
        .route("/auth/password", post(auth::change_password))
        .route("/public/branding", get(public::branding))
        .route("/public/branding/manifest", get(public::branding_manifest))
        .route("/public/branding/icon/{size}", get(public::branding_icon))
        .fallback(api_not_found)
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), api_headers));

    let prefix = state.config.api_prefix.clone();
    Router::new()
        .route("/ws/games", get(ws_not_ready))
        .nest(&prefix, api)
        .merge(static_router(state.clone()))
        .layer(middleware::from_fn(request_id))
        .layer(middleware::from_fn(static_headers))
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        .with_state(state)
}

async fn api_not_found() -> AppError {
    not_found("مسیر درخواستی یافت نشد.", "NOT_FOUND")
}

async fn ws_not_ready() -> AppError {
    AppError::new(
        axum::http::StatusCode::NOT_IMPLEMENTED,
        "NOT_IMPLEMENTED",
        "WebSocket بازی‌ها در موج بازی‌ها فعال می‌شود.",
    )
}
