use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::routing::{delete, get, patch, post};
use tower_http::compression::CompressionLayer;
use tower_http::trace::TraceLayer;

use crate::auth;
use crate::dashboard;
use crate::error::{AppError, not_found};
use crate::health;
use crate::middleware::{api_headers, request_id, static_headers};
use crate::payments;
use crate::prep;
use crate::printing;
use crate::public;
use crate::public_menu;
use crate::public_orders;
use crate::requests;
use crate::staff_ordering;
use crate::staff_orders;
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
        .route("/dashboard/overview", get(dashboard::overview))
        .route(
            "/orders",
            get(staff_orders::list).post(staff_ordering::create),
        )
        .route("/orders/{id}", get(staff_orders::detail))
        .route("/orders/{id}/items", post(staff_ordering::add_items))
        .route(
            "/orders/{id}/items/{item_id}",
            patch(staff_ordering::update_item),
        )
        .route("/orders/{id}/receipt", post(printing::queue_receipt))
        .route("/orders/{id}/tickets", post(printing::queue_tickets))
        .route(
            "/orders/{id}/payments",
            get(payments::summary).post(payments::record),
        )
        .route(
            "/orders/{id}/splits",
            post(payments::split)
                .put(payments::split_custom)
                .delete(payments::clear_splits),
        )
        .route("/orders/{id}/discount", post(payments::discount))
        .route("/orders/{id}/refunds", post(payments::refund))
        .route(
            "/terminal-requests/{id}/complete",
            post(payments::complete_terminal),
        )
        .route("/orders/{id}/transition", post(staff_orders::transition))
        .route("/tables", get(staff_ordering::tables))
        .route("/tables/{id}/close", post(requests::close_table))
        .route("/service-requests", get(requests::list_service))
        .route(
            "/service-requests/{id}/status",
            post(requests::update_service),
        )
        .route("/terminal-requests", get(requests::list_terminal))
        .route("/prep/queue", get(prep::queue))
        .route("/prep/{id}/transition", post(prep::transition))
        .route("/public/branding", get(public::branding))
        .route("/public/branding/manifest", get(public::branding_manifest))
        .route("/public/requests", post(requests::create_public_request))
        .route(
            "/public/terminal-requests",
            post(requests::create_public_terminal),
        )
        .route("/public/branding/icon/{size}", get(public::branding_icon))
        .route("/public/menu", get(public_menu::menu))
        .route("/public/orders", post(public_orders::create_order))
        .route("/public/orders/{code}", get(public_orders::order_status))
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
