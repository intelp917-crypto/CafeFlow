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
async fn dashboard_requires_login_and_returns_live_counters() {
    let (app, _directory) = app_with_catalog().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/dashboard/overview")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"username":"admin","password":"CafeFlow@1404"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, cookie, _) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let session_cookie = cookie.split(';').next().unwrap().to_string();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/dashboard/overview")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let dashboard: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert!(dashboard["today"]["jalaliLabel"].is_string());
    assert!(dashboard["orders"]["active"].is_number());
    assert_eq!(dashboard["catalog"]["products"], 2);
    assert_eq!(dashboard["tables"]["total"], 1);
    assert!(dashboard["recentActivity"].is_array());
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

#[tokio::test]
async fn staff_can_list_inspect_and_transition_orders() {
    let (app, _directory) = app_with_catalog().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/public/orders")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"qrToken":"table-token-123","clientRequestId":"staff-flow-123","items":[{"productId":"product-1","quantity":2}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let created: serde_json::Value = serde_json::from_str(&body).unwrap();
    let order_id = created["id"].as_str().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"username":"admin","password":"CafeFlow@1404"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, cookie, _) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let session_cookie = cookie.split(';').next().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/orders?scope=all&pageSize=10")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let list: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(list["total"], 1);
    assert_eq!(list["items"][0]["id"], order_id);
    assert_eq!(list["items"][0]["status"], "submitted");
    assert_eq!(list["items"][0]["prep"]["total"], 1);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/orders/{order_id}"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let detail: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(detail["items"][0]["quantity"], 2);
    assert_eq!(detail["items"][0]["prepStatus"], "queued");
    assert_eq!(detail["events"][0]["type"], "order.submitted");
    assert!(
        detail["allowedTransitions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|transition| transition["status"] == "confirmed")
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/transition"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"to":"confirmed"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let updated: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(updated["status"], "confirmed");
    assert_eq!(updated["events"][1]["fromStatus"], "submitted");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/transition"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"to":"served"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("ORDER_TRANSITION_INVALID"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/transition"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"to":"cancelled"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("CANCEL_REASON_REQUIRED"));

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/transition"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"to":"cancelled","reason":"درخواست مشتری"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let cancelled: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(cancelled["status"], "cancelled");
    assert_eq!(cancelled["cancelReason"], "درخواست مشتری");
    assert_eq!(cancelled["items"][0]["itemStatus"], "cancelled");
}

#[tokio::test]
async fn staff_can_create_edit_and_print_an_order() {
    let (app, _directory) = app_with_catalog().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"username":"admin","password":"CafeFlow@1404"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, cookie, _) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let session_cookie = cookie.split(';').next().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/orders")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(
                    r#"{"tableId":"table-1","note":"سفارش حضوری","items":[{"productId":"product-1","quantity":2}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let created: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(created["status"], "confirmed");
    assert_eq!(created["source"], "waiter");
    assert_eq!(created["tableNameFa"], "میز یک");
    assert_eq!(created["subtotal"], 240000);
    assert_eq!(created["total"], 240000);
    assert_eq!(created["events"][0]["type"], "order.created");
    let order_id = created["id"].as_str().unwrap().to_string();
    let item_id = created["items"][0]["id"].as_str().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/tables")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let tables: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(tables["items"][0]["status"], "occupied");
    assert_eq!(tables["items"][0]["activeOrders"], 1);
    assert_eq!(tables["summary"]["occupied"], 1);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/v1/orders/{order_id}/items/{item_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"quantity":1}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let updated: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(updated["items"][0]["quantity"], 1);
    assert_eq!(updated["subtotal"], 120000);
    assert_eq!(updated["total"], 120000);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/tickets"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let tickets: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(tickets["created"], 1);
    assert!(
        tickets["jobs"][0]["receipt"]
            .as_array()
            .unwrap()
            .iter()
            .any(|line| line.as_str().unwrap_or_default().contains("بلیت"))
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/tickets"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let tickets_again: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(tickets_again["created"], 0);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/receipt"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"proforma":true}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let proforma: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(proforma["existed"], false);
    assert!(
        proforma["job"]["receipt"]
            .as_array()
            .unwrap()
            .iter()
            .any(|line| line.as_str().unwrap_or_default() == "پیش‌فاکتور")
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/receipt"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"proforma":true}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let proforma_again: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(proforma_again["existed"], true);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/v1/orders/{order_id}/items/{item_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"quantity":0}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let removed: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(removed["items"][0]["itemStatus"], "cancelled");
    assert_eq!(removed["subtotal"], 0);
    assert_eq!(removed["total"], 0);
}

#[tokio::test]
async fn prep_queue_advances_the_order_along_legal_paths() {
    let (app, _directory) = app_with_catalog().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/public/orders")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"qrToken":"table-token-123","clientRequestId":"prep-flow-123","items":[{"productId":"product-1","quantity":1},{"productId":"product-2","quantity":1,"optionIds":["option-1"]}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let _created: serde_json::Value = serde_json::from_str(&body).unwrap();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"username":"admin","password":"CafeFlow@1404"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, cookie, _) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let session_cookie = cookie.split(';').next().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/prep/queue")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let queue: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(queue["items"].as_array().unwrap().len(), 2);
    let first = queue["items"][0]["id"].as_str().unwrap().to_string();
    let second = queue["items"][1]["id"].as_str().unwrap().to_string();
    assert_eq!(queue["items"][0]["status"], "queued");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/prep/{first}/transition"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"to":"in_progress"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let started: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(started["status"], "preparing");
    assert!(
        started["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| { item["prepId"] == first && item["prepStatus"] == "in_progress" })
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/prep/{first}/transition"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"to":"ready"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let partial: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(partial["status"], "partially_ready");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/prep/{second}/transition"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"to":"ready"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let ready: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(ready["status"], "ready");
    assert!(
        ready["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["prepStatus"] == "ready")
    );
    assert!(
        ready["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| event["type"] == "order.status_auto")
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/prep/queue")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let empty: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(empty["items"].as_array().unwrap().len(), 0);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/prep/queue?includeFinished=true")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let finished: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(finished["items"].as_array().unwrap().len(), 2);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/prep/{first}/transition"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"to":"in_progress"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("PREP_TRANSITION_INVALID"));
}

#[tokio::test]
async fn cashier_records_partial_and_full_payments_then_refunds() {
    let (app, _directory) = app_with_catalog().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"username":"admin","password":"CafeFlow@1404"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, cookie, _) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let session_cookie = cookie.split(';').next().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/orders")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(
                    r#"{"tableId":"table-1","items":[{"productId":"product-1","quantity":1}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let created: serde_json::Value = serde_json::from_str(&body).unwrap();
    let order_id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["total"], 120000);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/orders/{order_id}/payments"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let before: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(before["payable"], false);
    assert_eq!(before["remaining"], 120000);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/payments"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"method":"cash","amount":1000}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("ORDER_NOT_PAYABLE"));

    for target in ["preparing", "ready", "served"] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/orders/{order_id}/transition"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::COOKIE, &session_cookie)
                    .body(Body::from(format!(r#"{{"to":"{target}"}}"#)))
                    .unwrap(),
            )
            .await
            .unwrap();
        let (status, _, body) = body_of(response).await;
        assert_eq!(status, StatusCode::OK, "{target}: {body}");
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/payments"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"method":"cash","amount":50000}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let partial: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(partial["status"], "awaiting_payment");
    assert_eq!(partial["paidTotal"], 50000);
    assert_eq!(partial["remaining"], 70000);
    assert_eq!(partial["bill"]["status"], "open");
    assert_eq!(partial["payments"].as_array().unwrap().len(), 1);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/payments"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"method":"card","amount":80000}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("PAYMENT_EXCEEDS_REMAINING"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/payments"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(
                    r#"{"method":"card","amount":70000,"reference":"POS-42"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let settled: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(settled["status"], "paid");
    assert_eq!(settled["paidTotal"], 120000);
    assert_eq!(settled["remaining"], 0);
    assert_eq!(settled["bill"]["status"], "settled");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/orders/{order_id}"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let detail: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(detail["status"], "paid");
    assert_eq!(detail["paidTotal"], 120000);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/refunds"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(
                    r#"{"amount":20000,"reason":"اشتباه در سفارش","method":"cash"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let refund: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(refund["paidTotal"], 100000);
    assert_eq!(refund["remaining"], 20000);
    assert_eq!(refund["status"], "paid");

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/orders/{order_id}/payments"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let after: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(after["paidTotal"], 100000);
    assert_eq!(after["payments"].as_array().unwrap().len(), 3);
    assert_eq!(after["payments"][2]["status"], "refunded");
}

#[tokio::test]
async fn cashier_splits_bills_and_applies_a_discount() {
    let (app, _directory) = app_with_catalog().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"username":"admin","password":"CafeFlow@1404"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, cookie, _) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let session_cookie = cookie.split(';').next().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/orders")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(
                    r#"{"tableId":"table-1","items":[{"productId":"product-1","quantity":1}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let created: serde_json::Value = serde_json::from_str(&body).unwrap();
    let order_id = created["id"].as_str().unwrap().to_string();

    for target in ["preparing", "ready", "served"] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/orders/{order_id}/transition"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::COOKIE, &session_cookie)
                    .body(Body::from(format!(r#"{{"to":"{target}"}}"#)))
                    .unwrap(),
            )
            .await
            .unwrap();
        let (status, _, body) = body_of(response).await;
        assert_eq!(status, StatusCode::OK, "{target}: {body}");
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/splits"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"parts":3}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let split: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(split["splits"].as_array().unwrap().len(), 3);
    let sum = split["splits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|share| share["amount"].as_i64().unwrap())
        .sum::<i64>();
    assert_eq!(sum, 120000);
    let first_split = split["splits"][0]["id"].as_str().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/payments"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(format!(
                    r#"{{"method":"cash","amount":40000,"splitId":"{first_split}"}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let paid_share: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(paid_share["paidTotal"], 40000);
    assert_eq!(paid_share["splits"][0]["isPaid"], true);
    assert_eq!(paid_share["payments"][0]["splitLabelFa"], "سهم ۱");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/orders/{order_id}/splits"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("SPLITS_AFTER_PAYMENT"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/orders")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(
                    r#"{"tableId":"table-1","items":[{"productId":"product-1","quantity":1}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let second: serde_json::Value = serde_json::from_str(&body).unwrap();
    let second_id = second["id"].as_str().unwrap().to_string();
    for target in ["preparing", "ready", "served"] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/orders/{second_id}/transition"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::COOKIE, &session_cookie)
                    .body(Body::from(format!(r#"{{"to":"{target}"}}"#)))
                    .unwrap(),
            )
            .await
            .unwrap();
        let (status, _, body) = body_of(response).await;
        assert_eq!(status, StatusCode::OK, "{target}: {body}");
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/orders/{second_id}/splits"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(
                    r#"{"splits":[{"label":"الف","amount":50000},{"label":"ب","amount":50000}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("SPLIT_TOTAL_MISMATCH"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/orders/{second_id}/splits"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(
                    r#"{"splits":[{"label":"الف","amount":50000},{"label":"ب","amount":70000}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let custom: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(custom["splits"].as_array().unwrap().len(), 2);
    assert_eq!(custom["splits"][0]["label"], "الف");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/orders/{second_id}/splits"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let cleared: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(cleared["splits"].as_array().unwrap().len(), 0);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{second_id}/discount"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"amount":12000,"reason":"مشتری باشگاه"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let discounted: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(discounted["discountTotal"], 12000);
    assert_eq!(discounted["total"], 108000);
    assert_eq!(discounted["remaining"], 108000);
}

#[tokio::test]
async fn customer_requests_are_created_and_handled_once() {
    let (app, _directory) = app_with_catalog().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/public/requests")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"qrToken":"table-token-123","type":"waiter","note":"یک لیوان آب"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, cookie, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert!(cookie.starts_with("cafe_device="));
    let created: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(created["type"], "waiter");
    let request_id = created["id"].as_str().unwrap().to_string();
    let device_cookie = cookie.split(';').next().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/public/terminal-requests")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &device_cookie)
                .body(Body::from(
                    r#"{"qrToken":"table-token-123","note":"کارت‌خوان بیاورید"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let terminal_request: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(terminal_request["type"], "terminal");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"username":"admin","password":"CafeFlow@1404"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, cookie, _) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let session_cookie = cookie.split(';').next().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/service-requests?status=pending")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let pending: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(pending["items"].as_array().unwrap().len(), 2);
    let waiter = pending["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == request_id.as_str())
        .unwrap();
    assert_eq!(waiter["typeLabelFa"], "درخواست گارسون");
    assert_eq!(waiter["tableNameFa"], "میز یک");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/terminal-requests?status=all")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let terminals: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(terminals["items"].as_array().unwrap().len(), 1);
    assert_eq!(terminals["items"][0]["status"], "pending");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/service-requests/{request_id}/status"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"status":"accepted"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&body).unwrap()["status"],
        "accepted"
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/service-requests/{request_id}/status"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"status":"done"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/service-requests?status=all")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let all: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(all["items"].as_array().unwrap().len(), 2);
    let handled = all["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == request_id.as_str())
        .unwrap();
    assert_eq!(handled["status"], "done");
    assert_eq!(handled["handledByName"], "مدیر سیستم");
    assert!(handled["resolvedAt"].is_string());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/service-requests/{request_id}/status"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"status":"cancelled"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("REQUEST_CLOSED"));
}

#[tokio::test]
async fn a_table_closes_only_when_its_orders_are_settled() {
    let (app, _directory) = app_with_catalog().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"username":"admin","password":"CafeFlow@1404"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, cookie, _) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let session_cookie = cookie.split(';').next().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/orders")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(
                    r#"{"tableId":"table-1","items":[{"productId":"product-1","quantity":1}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let created: serde_json::Value = serde_json::from_str(&body).unwrap();
    let order_id = created["id"].as_str().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/tables/table-1/close")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("TABLE_HAS_UNPAID_ORDERS"));

    for target in ["preparing", "ready", "served"] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/orders/{order_id}/transition"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::COOKIE, &session_cookie)
                    .body(Body::from(format!(r#"{{"to":"{target}"}}"#)))
                    .unwrap(),
            )
            .await
            .unwrap();
        let (status, _, body) = body_of(response).await;
        assert_eq!(status, StatusCode::OK, "{target}: {body}");
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/orders/{order_id}/payments"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(r#"{"method":"cash","amount":120000}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/tables/table-1/close")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let closed: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(closed["code"], "T1");
    assert_eq!(closed["closedOrders"], 1);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/tables")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let tables: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(tables["items"][0]["status"], "available");
    assert!(tables["items"][0]["sessionId"].is_null());
}
