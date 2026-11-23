use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::routing::{delete, get, patch, post, put};
use tower_http::compression::CompressionLayer;
use tower_http::trace::TraceLayer;

use crate::admin;
use crate::auth;
use crate::catalog;
use crate::catalog_import;
use crate::crm;
use crate::dashboard;
use crate::error::{AppError, not_found};
use crate::finance;
use crate::games;
use crate::health;
use crate::inventory;
use crate::layout;
use crate::management;
use crate::middleware::{api_headers, request_id, static_headers};
use crate::payments;
use crate::prep;
use crate::printing;
use crate::public;
use crate::public_menu;
use crate::public_orders;
use crate::reports;
use crate::requests;
use crate::staff_ordering;
use crate::staff_orders;
use crate::state::AppState;
use crate::static_files::static_router;

pub fn build_router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health::health))
        .route("/auth/setup", get(auth::setup_status).post(auth::setup))
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
            "/settings",
            get(admin::get_settings).patch(admin::update_settings),
        )
        .route("/modules", get(admin::list_modules))
        .route("/modules/{key}", patch(admin::set_module))
        .route("/users", get(admin::list_users).post(admin::create_user))
        .route("/users/{id}", patch(admin::update_user))
        .route("/roles", get(admin::list_roles))
        .route("/permissions", get(admin::list_permissions))
        .route("/audit", get(admin::list_audit))
        .route("/approvals", get(admin::list_approvals))
        .route(
            "/reservations",
            get(management::list_reservations).post(management::create_reservation),
        )
        .route(
            "/reservations/{id}/status",
            post(management::set_reservation_status),
        )
        .route(
            "/employees",
            get(management::list_employees).post(management::create_employee),
        )
        .route("/employees/{id}", patch(management::update_employee))
        .route("/employees/performance", get(management::performance))
        .route(
            "/shifts",
            get(management::list_shifts).post(management::create_shift),
        )
        .route("/shifts/{id}/check-in", post(management::check_in))
        .route("/shifts/{id}/check-out", post(management::check_out))
        .route("/shifts/{id}/cancel", post(management::cancel_shift))
        .route("/approvals/{id}/decision", post(admin::decide_approval))
        .route("/notifications", get(admin::list_notifications))
        .route(
            "/notifications/read-all",
            post(admin::read_all_notifications),
        )
        .route("/notifications/{id}/read", post(admin::read_notification))
        .route("/messages", get(admin::messages_overview))
        .route("/messages/templates", post(admin::create_template))
        .route("/messages/templates/{id}", patch(admin::update_template))
        .route("/messages/send", post(admin::send_message))
        .route("/messages/{id}/sent", post(admin::mark_message_sent))
        .route("/messages/{id}/failed", post(admin::mark_message_failed))
        .route("/catalog", get(catalog::get_catalog))
        .route("/catalog/categories", post(catalog::create_category))
        .route(
            "/catalog/categories/order",
            put(catalog::reorder_categories),
        )
        .route(
            "/catalog/categories/{id}",
            patch(catalog::update_category).delete(catalog::delete_category),
        )
        .route("/catalog/images", post(catalog::upload_image))
        .route("/catalog/import", post(catalog_import::import_catalog))
        .route("/catalog/products", post(catalog::create_product))
        .route("/catalog/products/order", put(catalog::reorder_products))
        .route(
            "/catalog/products/{id}",
            patch(catalog::update_product).delete(catalog::archive_product),
        )
        .route(
            "/catalog/products/{id}/options",
            put(catalog::replace_options),
        )
        .route(
            "/catalog/products/{id}/extras",
            put(catalog::replace_extras),
        )
        .route(
            "/catalog/products/{id}/availability",
            put(catalog::replace_availability),
        )
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
        .route("/print/jobs", get(printing::list_jobs))
        .route("/print/jobs/{id}/sent", post(printing::mark_sent))
        .route("/print/jobs/{id}/printed", post(printing::mark_printed))
        .route("/print/jobs/{id}/failed", post(printing::mark_failed))
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
        .route("/layout", get(layout::overview))
        .route("/layout/floors", post(layout::create_floor))
        .route(
            "/layout/floors/{id}",
            patch(layout::update_floor).delete(layout::delete_floor),
        )
        .route("/layout/floors/{id}/areas", post(layout::create_area))
        .route(
            "/layout/areas/{id}",
            patch(layout::update_area).delete(layout::delete_area),
        )
        .route("/layout/floors/{id}/plan", put(layout::save_plan))
        .route("/layout/floors/{id}/versions", get(layout::versions))
        .route(
            "/layout/floors/{floor_id}/versions/{version_id}/restore",
            post(layout::restore_version),
        )
        .route("/layout/tables", post(layout::create_table))
        .route(
            "/layout/tables/{id}",
            patch(layout::update_table).delete(layout::delete_table),
        )
        .route(
            "/layout/tables/{id}/qr",
            get(layout::table_qr).post(layout::regenerate_qr),
        )
        .route("/layout/tables/{id}/qr.png", get(layout::table_qr_png))
        .route("/layout/tables/{id}/qr.svg", get(layout::table_qr_svg))
        .route("/tables/{id}/close", post(requests::close_table))
        .route("/service-requests", get(requests::list_service))
        .route(
            "/service-requests/{id}/status",
            post(requests::update_service),
        )
        .route("/terminal-requests", get(requests::list_terminal))
        .route("/prep/queue", get(prep::queue))
        .route("/prep/{id}/transition", post(prep::transition))
        .route("/reports/summary", get(reports::summary))
        .route("/inventory/overview", get(inventory::overview))
        .route(
            "/inventory/ingredients",
            get(inventory::ingredients).post(inventory::create_ingredient),
        )
        .route(
            "/inventory/ingredients/{id}/adjustments",
            post(inventory::adjust_ingredient),
        )
        .route("/inventory/movements", get(inventory::movements))
        .route(
            "/inventory/suppliers",
            get(inventory::suppliers).post(inventory::create_supplier),
        )
        .route(
            "/inventory/purchases",
            get(inventory::purchases).post(inventory::create_purchase),
        )
        .route(
            "/inventory/waste",
            get(inventory::waste).post(inventory::create_waste),
        )
        .route("/inventory/recipes", get(inventory::recipes))
        .route("/inventory/recipes/{id}", post(inventory::set_recipe))
        .route("/cash-sessions", get(finance::cash_overview))
        .route("/cash-sessions/open", post(finance::open_cash_session))
        .route(
            "/cash-sessions/{id}/close",
            post(finance::close_cash_session),
        )
        .route("/finance/summary", get(finance::summary))
        .route(
            "/finance/expenses",
            get(finance::expenses).post(finance::create_expense),
        )
        .route(
            "/customers",
            get(crm::list_customers).post(crm::create_customer),
        )
        .route("/customers/{id}", get(crm::customer_detail))
        .route("/customers/{id}/loyalty", post(crm::adjust_loyalty))
        .route("/reports/payments.csv", get(reports::payments_csv))
        .route("/reports/payments.xlsx", get(reports::payments_xlsx))
        .route("/public/branding", get(public::branding))
        .route("/public/branding/manifest", get(public::branding_manifest))
        .route("/public/product-images/{file}", get(catalog::product_image))
        .route("/public/requests", post(requests::create_public_request))
        .route(
            "/public/terminal-requests",
            post(requests::create_public_terminal),
        )
        .route("/public/branding/icon/{size}", get(public::branding_icon))
        .route("/public/menu", get(public_menu::menu))
        .route("/public/games/catalog", get(games::catalog))
        .route("/public/games/join", post(games::join))
        .route("/public/orders", post(public_orders::create_order))
        .route("/public/orders/{code}", get(public_orders::order_status))
        .route(
            "/public/orders/{code}/items",
            post(public_orders::add_order_items),
        )
        .route(
            "/public/table/{qr_token}",
            get(public_orders::table_overview),
        )
        .fallback(api_not_found)
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), api_headers));

    let prefix = state.config.api_prefix.clone();
    Router::new()
        .route("/ws/games", get(games::ws_games))
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
