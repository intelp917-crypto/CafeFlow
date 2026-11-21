use std::path::Path;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use cafeflow_api::{AppState, Config, build_router};
use cafeflow_db::{Database, DbConfig, DbDriver, SeedOptions};
use tower::ServiceExt;

fn config(root: &Path) -> Config {
    Config {
        host: "127.0.0.1".to_string(),
        port: 0,
        api_prefix: "/api/v1".to_string(),
        production: false,
        web_root: root.join("public"),
        data_directory: root.to_path_buf(),
        backup_directory: root.join("backups"),
        session_cookie_name: "cafe_session".to_string(),
        session_ttl_hours: 1,
        session_cookie_secure: false,
        login_max_attempts: 5,
        login_lock_minutes: 15,
        db: DbConfig {
            driver: DbDriver::Sqlite,
            database_path: root.join("cafeflow.db"),
            database_url: None,
            pool_max: 1,
            auto_migrate: true,
            data_directory: root.to_path_buf(),
        },
    }
}

async fn app_with_catalog() -> (axum::Router, tempfile::TempDir) {
    let directory = tempfile::tempdir().unwrap();
    let cfg = config(directory.path());
    let database = Database::connect(&cfg.db).await.unwrap();
    cafeflow_db::seed_database(
        &database,
        &SeedOptions {
            admin_username: "admin".to_string(),
            admin_password: "CafeFlow@1404".to_string(),
            demo_staff: false,
            demo_menu: false,
        },
    )
    .await
    .unwrap();

    let pool = &database.pool;
    for statement in [
        "INSERT INTO floors (id, name_fa) VALUES ('floor-1', 'سالن')",
        "INSERT INTO dining_tables (id, floor_id, code, name_fa) VALUES ('table-1', 'floor-1', 'T1', 'میز یک')",
        "INSERT INTO categories (id, name_fa, slug) VALUES ('cat-1', 'قهوه', 'coffee')",
        "INSERT INTO products (id, category_id, name_fa, search_key, base_price, prep_minutes) VALUES ('product-1', 'cat-1', 'اسپرسو', 'espresso', 120000, 4)",
        "INSERT INTO products (id, category_id, name_fa, search_key, base_price, prep_minutes) VALUES ('product-2', 'cat-1', 'کاپوچینو', 'cappuccino', 100000, 5)",
        "INSERT INTO option_groups (id, product_id, name_fa, min_select, max_select, is_required) VALUES ('group-1', 'product-2', 'شیر', 1, 1, 1)",
        "INSERT INTO product_options (id, option_group_id, name_fa, price_delta) VALUES ('option-1', 'group-1', 'شیر بادام', 10000)",
        "INSERT INTO extras (id, name_fa, price) VALUES ('extra-1', 'شات اضافه', 5000)",
        "INSERT INTO product_extras (product_id, extra_id) VALUES ('product-2', 'extra-1')",
        "INSERT INTO qr_codes (id, kind, token, table_id) VALUES ('qr-1', 'table', 'table-token-123', 'table-1')",
    ] {
        sqlx::query(statement).execute(pool).await.unwrap();
    }

    let state = AppState::new(database, cfg);
    (build_router(state), directory)
}

async fn body_of(response: axum::response::Response) -> (StatusCode, String, String) {
    let status = response.status();
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    (status, cookie, String::from_utf8(bytes.to_vec()).unwrap())
}

#[tokio::test]
async fn qr_menu_order_idempotency_and_tracking() {
    let (app, _directory) = app_with_catalog().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/public/menu?qr=table-token-123")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, cookie, menu_body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    assert!(cookie.starts_with("cafe_device="));
    let menu: serde_json::Value = serde_json::from_str(&menu_body).unwrap();
    assert_eq!(menu["table"]["code"], "T1");
    assert_eq!(menu["categories"][0]["products"][0]["price"], 120000);
    let device_cookie = cookie.split(';').next().unwrap().to_string();

    let order_body = r#"{
        "qrToken": "table-token-123",
        "clientRequestId": "client-request-123",
        "items": [{"productId": "product-1", "quantity": 2}]
    }"#;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/public/orders")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &device_cookie)
                .body(Body::from(order_body))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, first_body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let first: serde_json::Value = serde_json::from_str(&first_body).unwrap();
    assert_eq!(first["replayed"], false);
    assert_eq!(first["total"], 240000);
    assert_eq!(first["itemCount"], 2);
    let code = first["code"].as_str().unwrap().to_string();
    let token = first["statusToken"].as_str().unwrap().to_string();
    assert!(code.starts_with("CF-"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/public/orders")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &device_cookie)
                .body(Body::from(order_body))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, replay_body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let replay: serde_json::Value = serde_json::from_str(&replay_body).unwrap();
    assert_eq!(replay["replayed"], true);
    assert_eq!(replay["code"], code);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/public/orders/{code}?token={token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, tracking_body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let tracking: serde_json::Value = serde_json::from_str(&tracking_body).unwrap();
    assert_eq!(tracking["status"], "submitted");
    assert_eq!(tracking["items"][0]["quantity"], 2);
    assert_eq!(tracking["tableNameFa"], "میز یک");

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/public/orders/{code}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn server_prices_options_and_rejects_unknown_options() {
    let (app, _directory) = app_with_catalog().await;
    let valid = r#"{
        "qrToken":"table-token-123",
        "clientRequestId":"client-options-123",
        "items":[{"productId":"product-2","quantity":1,"optionIds":["option-1"],"extraIds":["extra-1"]}]
    }"#;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/public/orders")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(valid))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let order: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(order["total"], 115000);

    let invalid = r#"{
        "qrToken":"table-token-123",
        "clientRequestId":"client-options-bad",
        "items":[{"productId":"product-2","quantity":1,"optionIds":["not-an-option"]}]
    }"#;
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/public/orders")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(invalid))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("OPTION_INVALID"));
}

#[tokio::test]
async fn invalid_qr_is_a_real_404() {
    let (app, _directory) = app_with_catalog().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/public/menu?qr=not-a-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    assert!(String::from_utf8_lossy(&bytes).contains("QR_NOT_FOUND"));
}
