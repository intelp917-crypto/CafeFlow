use std::path::Path;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use cafeflow_api::{AppState, Config, build_router};
use cafeflow_db::{Database, DbConfig, DbDriver, SeedOptions};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message as WsMessage;
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

#[tokio::test]
async fn catalog_manages_categories_products_options_extras_and_images() {
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
    let session = cookie.split(';').next().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/catalog")
                .header(header::COOKIE, &session)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let catalog: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(catalog["categories"][0]["productCount"], 2);
    let cappuccino = catalog["products"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == "product-2")
        .unwrap();
    assert_eq!(
        cappuccino["optionGroups"][0]["options"][0]["nameFa"],
        "شیر بادام"
    );
    assert_eq!(cappuccino["extras"][0]["nameFa"], "شات اضافه");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/catalog/categories")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(r#"{"nameFa":"نوشیدنی سرد","isActive":true}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let category: serde_json::Value = serde_json::from_str(&body).unwrap();
    let category_id = category["id"].as_str().unwrap().to_string();
    assert_eq!(category["productCount"], 0);
    assert!(category["slug"].as_str().unwrap().contains('-'));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/catalog/categories")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(r#"{"nameFa":"نوشيدني سرد"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("CATEGORY_EXISTS"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/catalog/categories/order")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(format!(
                    r#"{{"ids":["{category_id}","cat-1"]}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let reordered: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(reordered[0]["id"], category_id.as_str());
    assert_eq!(reordered[0]["sortOrder"], 1);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/catalog/products")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(format!(
                    r#"{{"categoryId":"{category_id}","nameFa":"لیموناد","basePrice":120000,"descriptionFa":"لیمو و نعنا","prepMinutes":4}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let product: serde_json::Value = serde_json::from_str(&body).unwrap();
    let product_id = product["id"].as_str().unwrap().to_string();
    assert_eq!(product["categoryNameFa"], "نوشیدنی سرد");
    assert_eq!(product["basePrice"], 120000);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/catalog/products")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(format!(
                    r#"{{"categoryId":"{category_id}","nameFa":"ليموناد","basePrice":90000}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("PRODUCT_EXISTS"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/v1/catalog/products/{product_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(r#"{"basePrice":130000,"isAvailable":false}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let updated: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(updated["basePrice"], 130000);
    assert_eq!(updated["isAvailable"], false);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/catalog/products/{product_id}/options"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(
                    r#"{"groups":[{"nameFa":"اندازه","minSelect":1,"maxSelect":1,"isRequired":true,"options":[{"nameFa":"بزرگ","priceDelta":20000},{"nameFa":"کوچک","priceDelta":-10000,"isActive":false}]}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let with_options: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(with_options["optionGroups"][0]["nameFa"], "اندازه");
    assert_eq!(
        with_options["optionGroups"][0]["options"][0]["priceDelta"],
        20000
    );
    assert_eq!(
        with_options["optionGroups"][0]["options"][1]["isActive"],
        false
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/catalog/products/{product_id}/extras"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(
                    r#"{"extras":[{"nameFa":"نعنا","price":5000},{"nameFa":"یخ","price":1000,"isActive":false}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let with_extras: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(with_extras["extras"][0]["nameFa"], "نعنا");
    assert_eq!(with_extras["extras"][1]["nameFa"], "یخ");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!(
                    "/api/v1/catalog/products/{product_id}/availability"
                ))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(
                    r#"{"windows":[{"weekday":null,"startTime":"08:00","endTime":"12:30"},{"weekday":6,"startTime":"18:00","endTime":"23:00"}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let with_windows: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(with_windows["availabilityWindows"][0]["startTime"], "08:00");
    assert_eq!(with_windows["availabilityWindows"][1]["weekday"], 6);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/catalog/products/order")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(
                    r#"{"categoryId":"cat-1","ids":["product-2","product-1"]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let products: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(products[0]["id"], "product-2");

    let csv = [
        "category,name,price,description,department,prepMinutes,imageUrl,isAvailable,isActive",
        "نوشیدنی سرد,چای,80000,چای تازه,,3,,true,true",
        "دسر,چیزکیک,180000,,,8,,,",
    ]
    .join("\n");
    let dry_body = serde_json::json!({"csv": csv, "dryRun": true}).to_string();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/catalog/import")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(dry_body))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let dry: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(dry["dryRun"], true);
    assert_eq!(dry["summary"]["created"], 2);
    assert_eq!(dry["summary"]["categoriesCreated"], 1);
    assert_eq!(dry["summary"]["errors"], 0);

    let import_body = serde_json::json!({"csv": csv, "dryRun": false}).to_string();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/catalog/import")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(import_body))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let imported: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(imported["summary"]["created"], 2);
    assert_eq!(imported["summary"]["categoriesCreated"], 1);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/catalog")
                .header(header::COOKIE, &session)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let catalog: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert!(
        catalog["categories"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["nameFa"] == "دسر")
    );
    let tea = catalog["products"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["nameFa"] == "چای")
        .unwrap();
    assert_eq!(tea["prepMinutes"], 3);
    assert_eq!(tea["basePrice"], 80000);

    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/catalog/images")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(format!(
                    r#"{{"dataUrl":"data:image/png;base64,{png}"}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let image: serde_json::Value = serde_json::from_str(&body).unwrap();
    let url = image["url"].as_str().unwrap().to_string();
    assert!(url.starts_with("/api/v1/public/product-images/"));
    assert_eq!(image["mime"], "image/png");

    let response = app
        .clone()
        .oneshot(Request::builder().uri(&url).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "image/png");
    assert_eq!(
        response.headers()[header::CACHE_CONTROL],
        "public, max-age=31536000, immutable"
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/catalog/categories/{category_id}"))
                .header(header::COOKIE, &session)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("CATEGORY_NOT_EMPTY"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/catalog/products/{product_id}"))
                .header(header::COOKIE, &session)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&body).unwrap()["isArchived"],
        true
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/v1/catalog/products/{product_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(r#"{"isArchived":false}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&body).unwrap()["isArchived"],
        false
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/catalog/products")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session)
                .body(Body::from(format!(
                    r#"{{"categoryId":"{category_id}","nameFa":"نوشیدنی خطرناک","basePrice":1000,"imageUrl":"javascript:alert(1)"}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("VALIDATION_FAILED"));
}

#[tokio::test]
async fn reports_summarize_sales_refunds_and_export_payments() {
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
                    r#"{"tableId":"table-1","items":[{"productId":"product-1","quantity":1},{"productId":"product-2","quantity":1,"optionIds":["option-1"],"extraIds":["extra-1"]}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let created: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(created["total"], 235000);
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

    for (method, amount) in [("cash", 200000), ("card", 35000)] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/orders/{order_id}/payments"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::COOKIE, &session_cookie)
                    .body(Body::from(format!(
                        r#"{{"method":"{method}","amount":{amount}}}"#
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        let (status, _, body) = body_of(response).await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
    }

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
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/reports/summary")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let report: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(report["totals"]["sales"], 235000);
    assert_eq!(report["totals"]["refunds"], 20000);
    assert_eq!(report["totals"]["net"], 215000);
    assert_eq!(report["totals"]["payments"], 2);
    assert_eq!(report["totals"]["orders"], 1);
    assert_eq!(report["totals"]["averageOrder"], 235000);
    assert_eq!(report["byMethod"][0]["method"], "cash");
    assert_eq!(report["byMethod"][0]["methodLabelFa"], "نقدی");
    assert_eq!(report["byMethod"][0]["total"], 200000);
    assert_eq!(report["byMethod"][1]["method"], "card");
    assert_eq!(report["daily"].as_array().unwrap().len(), 1);
    assert_eq!(report["daily"][0]["sales"], 235000);
    assert_eq!(report["topProducts"][0]["nameFa"], "اسپرسو");
    assert_eq!(report["topProducts"][0]["revenue"], 120000);
    assert_eq!(report["topProducts"][1]["nameFa"], "کاپوچینو");
    assert_eq!(report["topProducts"][1]["revenue"], 115000);
    let from = report["from"].as_str().unwrap();
    let to = report["to"].as_str().unwrap();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/reports/payments.csv?from={from}&to={to}"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap(),
        "text/csv; charset=utf-8"
    );
    let csv = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    let csv = String::from_utf8(csv.to_vec()).unwrap();
    assert!(csv.starts_with('\u{feff}'));
    assert!(csv.contains("\"نقدی\""));
    assert!(csv.contains("\"refunded\""));
    assert_eq!(csv.lines().count(), 4);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/reports/payments.xlsx?from={from}&to={to}"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let xlsx = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    assert!(xlsx.starts_with(b"PK\x03\x04"));
    assert!(xlsx.len() > 1000);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/reports/summary?from=2026-02-30&to=2026-03-01")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("INVALID_DATE_RANGE"));
}

#[tokio::test]
async fn print_queue_claims_jobs_atomically_and_tracks_status() {
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
    let ticket_id = tickets["jobs"][0]["id"].as_str().unwrap().to_string();

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
    let proforma_id = proforma["job"]["id"].as_str().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/print/jobs?status=queued")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let queued: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(queued["items"].as_array().unwrap().len(), 2);
    assert_eq!(queued["items"][0]["status"], "queued");
    assert!(queued["items"][0]["receipt"].as_array().unwrap().len() > 3);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/print/jobs?status=unknown")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("INVALID_PRINT_STATUS"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/print/jobs/{ticket_id}/sent"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let sent: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(sent["status"], "sent");
    assert_eq!(sent["attempts"], 0);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/print/jobs/{ticket_id}/sent"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
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
                .method("POST")
                .uri(format!("/api/v1/print/jobs/{ticket_id}/printed"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let printed: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(printed["status"], "printed");
    assert_eq!(printed["attempts"], 1);
    assert!(printed["printedAt"].as_str().is_some());

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/print/jobs/{ticket_id}/sent"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("PRINT_JOB_ALREADY_PRINTED"));

    let long_error = format!(r#"{{"error":"{}"}}"#, "x".repeat(250));
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/print/jobs/{proforma_id}/failed"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &session_cookie)
                .body(Body::from(long_error))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let failed: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(failed["status"], "failed");
    assert_eq!(failed["attempts"], 1);
    assert_eq!(failed["error"].as_str().unwrap().chars().count(), 200);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/print/jobs/{proforma_id}/sent"))
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("PRINT_JOB_NOT_QUEUED"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/print/jobs?status=failed")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let failed_jobs: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(failed_jobs["items"].as_array().unwrap().len(), 1);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/print/jobs/missing/printed")
                .header(header::COOKIE, &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(body.contains("PRINT_JOB_NOT_FOUND"));

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/print/jobs")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn games_join_reuses_the_device_seat_and_enforces_capacity() {
    let (app, _directory) = app_with_catalog().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/public/games/catalog")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK);
    let catalog: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(catalog["games"].as_array().unwrap().len(), 38);
    let tictactoe = catalog["games"]
        .as_array()
        .unwrap()
        .iter()
        .find(|game| game["id"] == "tictactoe")
        .unwrap();
    assert_eq!(tictactoe["nameFa"], "دوز");
    assert_eq!(tictactoe["playable"], true);

    let join_body = r#"{"qrToken":"table-token-123","gameId":"tictactoe","nameFa":"میزبان"}"#;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/public/games/join")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(join_body))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, cookie, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert!(cookie.starts_with("cafe_device="));
    let device_cookie = cookie.split(';').next().unwrap().to_string();
    let host: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(host["seat"], 0);
    assert_eq!(host["room"]["seats"].as_array().unwrap().len(), 1);
    assert_eq!(host["room"]["seats"][0]["nameFa"], "میزبان");
    assert!(host["state"].is_null());
    assert!(host["seatToken"].as_str().unwrap().len() >= 32);
    let room_id = host["room"]["roomId"].as_str().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/public/games/join")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &device_cookie)
                .body(Body::from(join_body))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let rejoin: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(rejoin["seat"], 0);
    assert_eq!(rejoin["room"]["roomId"], room_id);
    assert_eq!(rejoin["room"]["seats"].as_array().unwrap().len(), 1);
    assert_ne!(rejoin["seatToken"], host["seatToken"]);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/public/games/join")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"qrToken":"table-token-123","gameId":"tictactoe","nameFa":"مهمان"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let guest: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(guest["seat"], 1);
    assert_eq!(guest["room"]["seats"].as_array().unwrap().len(), 2);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/public/games/join")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"qrToken":"table-token-123","gameId":"tictactoe"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("GAME_FULL"));

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/public/games/join")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"qrToken":"missing-token","gameId":"tictactoe"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(body.contains("QR_NOT_FOUND"));
}

#[tokio::test]
async fn games_are_blocked_when_the_module_is_disabled() {
    let (app, directory) = app_with_catalog().await;
    let database = Database::connect(&config(directory.path()).db)
        .await
        .unwrap();
    sqlx::query("UPDATE module_settings SET is_enabled = 0 WHERE key = 'games'")
        .execute(&database.pool)
        .await
        .unwrap();
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/public/games/catalog")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(body.contains("MODULE_DISABLED"));
}

async fn join_games(app: &axum::Router, name: &str) -> (serde_json::Value, String) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/public/games/join")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"qrToken":"table-token-123","gameId":"tictactoe","nameFa":"{name}"}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();
    let token = value["seatToken"].as_str().unwrap().to_string();
    (value, token)
}

type GameSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn next_frame(socket: &mut GameSocket, kind: &str) -> serde_json::Value {
    loop {
        let message = tokio::time::timeout(std::time::Duration::from_secs(5), socket.next())
            .await
            .expect("websocket frame timeout")
            .expect("websocket closed")
            .expect("websocket error");
        if let WsMessage::Text(text) = message {
            let value: serde_json::Value = serde_json::from_str(text.as_str()).unwrap();
            if value["type"] == kind {
                return value;
            }
        }
    }
}

async fn send_frame(socket: &mut GameSocket, value: serde_json::Value) {
    socket
        .send(WsMessage::Text(value.to_string().into()))
        .await
        .unwrap();
}

#[tokio::test]
async fn games_websocket_plays_a_full_room_and_rejects_stale_seats() {
    let (app, _directory) = app_with_catalog().await;
    let (host, host_token) = join_games(&app, "میزبان").await;
    let (guest, guest_token) = join_games(&app, "مهمان").await;
    let room_id = host["room"]["roomId"].as_str().unwrap();
    assert_eq!(guest["room"]["roomId"], room_id);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let (mut host_ws, _) =
        tokio_tungstenite::connect_async(format!("ws://{address}/ws/games?seat={host_token}"))
            .await
            .unwrap();
    let lobby = next_frame(&mut host_ws, "room").await;
    assert_eq!(lobby["room"]["phase"], "lobby");
    assert_eq!(lobby["room"]["seats"][0]["connected"], true);

    let (mut guest_ws, _) =
        tokio_tungstenite::connect_async(format!("ws://{address}/ws/games?seat={guest_token}"))
            .await
            .unwrap();
    let host_view = next_frame(&mut host_ws, "room").await;
    assert_eq!(host_view["room"]["seats"].as_array().unwrap().len(), 2);
    let guest_view = next_frame(&mut guest_ws, "room").await;
    assert_eq!(guest_view["room"]["seats"].as_array().unwrap().len(), 2);

    send_frame(
        &mut host_ws,
        serde_json::json!({"type": "ready", "ready": true}),
    )
    .await;
    assert_eq!(
        next_frame(&mut host_ws, "room").await["room"]["seats"][0]["ready"],
        true
    );
    assert_eq!(
        next_frame(&mut guest_ws, "room").await["room"]["seats"][0]["ready"],
        true
    );
    send_frame(
        &mut guest_ws,
        serde_json::json!({"type": "ready", "ready": true}),
    )
    .await;
    assert_eq!(
        next_frame(&mut guest_ws, "room").await["room"]["seats"][1]["ready"],
        true
    );
    assert_eq!(
        next_frame(&mut host_ws, "room").await["room"]["seats"][1]["ready"],
        true
    );

    send_frame(&mut host_ws, serde_json::json!({"type": "start"})).await;
    let host_room = next_frame(&mut host_ws, "room").await;
    assert_eq!(host_room["room"]["phase"], "playing");
    let guest_room = next_frame(&mut guest_ws, "room").await;
    assert_eq!(guest_room["room"]["phase"], "playing");
    assert_eq!(
        next_frame(&mut host_ws, "state").await["state"]["currentPlayer"],
        0
    );
    assert_eq!(
        next_frame(&mut guest_ws, "state").await["state"]["currentPlayer"],
        0
    );

    send_frame(
        &mut guest_ws,
        serde_json::json!({"type": "move", "move": {"cell": 4}}),
    )
    .await;
    let refused = next_frame(&mut guest_ws, "error").await;
    assert_eq!(refused["code"], "MOVE_REFUSED");

    send_frame(
        &mut host_ws,
        serde_json::json!({"type": "move", "move": {"cell": 0}}),
    )
    .await;
    assert_eq!(
        next_frame(&mut guest_ws, "state").await["state"]["currentPlayer"],
        1
    );
    assert_eq!(
        next_frame(&mut host_ws, "state").await["state"]["currentPlayer"],
        1
    );
    send_frame(
        &mut guest_ws,
        serde_json::json!({"type": "move", "move": {"cell": 3}}),
    )
    .await;
    assert_eq!(
        next_frame(&mut host_ws, "state").await["state"]["currentPlayer"],
        0
    );
    assert_eq!(
        next_frame(&mut guest_ws, "state").await["state"]["currentPlayer"],
        0
    );
    send_frame(
        &mut host_ws,
        serde_json::json!({"type": "move", "move": {"cell": 1}}),
    )
    .await;
    assert_eq!(
        next_frame(&mut guest_ws, "state").await["state"]["currentPlayer"],
        1
    );
    assert_eq!(
        next_frame(&mut host_ws, "state").await["state"]["currentPlayer"],
        1
    );
    send_frame(
        &mut guest_ws,
        serde_json::json!({"type": "move", "move": {"cell": 4}}),
    )
    .await;
    assert_eq!(
        next_frame(&mut host_ws, "state").await["state"]["currentPlayer"],
        0
    );
    assert_eq!(
        next_frame(&mut guest_ws, "state").await["state"]["currentPlayer"],
        0
    );
    send_frame(
        &mut host_ws,
        serde_json::json!({"type": "move", "move": {"cell": 2}}),
    )
    .await;
    let finished = next_frame(&mut guest_ws, "state").await;
    assert_eq!(finished["state"]["winner"], 0);
    assert_eq!(
        next_frame(&mut host_ws, "state").await["state"]["winner"],
        0
    );

    send_frame(&mut guest_ws, serde_json::json!({"type": "leave"})).await;
    let after_leave = next_frame(&mut host_ws, "room").await;
    assert_eq!(after_leave["room"]["seats"].as_array().unwrap().len(), 1);
    assert_eq!(after_leave["room"]["seats"][0]["nameFa"], "میزبان");

    let (mut stale_ws, _) =
        tokio_tungstenite::connect_async(format!("ws://{address}/ws/games?seat=not-a-real-seat"))
            .await
            .unwrap();
    loop {
        let message = tokio::time::timeout(std::time::Duration::from_secs(5), stale_ws.next())
            .await
            .expect("stale seat close timeout")
            .expect("stale seat socket")
            .expect("stale seat error");
        if let WsMessage::Close(Some(frame)) = message {
            assert_eq!(
                frame.code,
                tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Library(4401)
            );
            break;
        }
    }

    host_ws.close(None).await.unwrap();
    server.abort();
}

#[tokio::test]
async fn admin_settings_staff_and_management_flow() {
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
    let session = cookie.split(';').next().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/api/v1/settings")
                .header(header::COOKIE, &session)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"taxPercent":9,"digitMode":"latin"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let settings: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(settings["taxPercent"], 9);
    assert_eq!(settings["digitMode"], "latin");

    for module in ["employees", "reservations"] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/v1/modules/{module}"))
                    .header(header::COOKIE, &session)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"enabled":true}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        let (status, _, body) = body_of(response).await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/users")
                .header(header::COOKIE, &session)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"username":"shift.user","fullName":"کاربر شیفت","password":"CafeFlow@1404","roleKeys":["waiter"]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let staff: serde_json::Value = serde_json::from_str(&body).unwrap();
    let user_id = staff["id"].as_str().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/employees")
                .header(header::COOKIE, &session)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"userId":"{user_id}","employeeCode":"E-100","positionFa":"گارسون","status":"active"}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let employee: serde_json::Value = serde_json::from_str(&body).unwrap();
    let employee_id = employee["id"].as_str().unwrap().to_string();
    assert_eq!(employee["statusLabelFa"], "فعال");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/shifts")
                .header(header::COOKIE, &session)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"employeeId":"{employee_id}","startsAt":"2026-12-01T09:00:00+03:30","endsAt":"2026-12-01T17:00:00+03:30","note":"شیفت صبح"}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let shift: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(shift["durationHours"], 8.0);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/reservations")
                .header(header::COOKIE, &session)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"customerName":"مهمان تست","customerPhone":"09121234567","guestCount":2,"reservedFor":"2026-12-02T19:30:00+03:30","durationMinutes":90,"tableId":"table-1"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let reservation: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(reservation["status"], "pending");
    assert_eq!(reservation["tableCode"], "T1");

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/audit?page=1&pageSize=10")
                .header(header::COOKIE, &session)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let audit: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert!(audit["total"].as_i64().unwrap() >= 3);
}

#[tokio::test]
async fn notifications_and_message_queue_are_scoped_and_idempotent() {
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
    let (_, cookie, _) = body_of(response).await;
    let session = cookie.split(';').next().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/messages/templates")
                .header(header::COOKIE, &session)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"key":"test_welcome","channel":"sms","titleFa":"خوش آمدید","bodyFa":"سلام {{name}}","isActive":true}"#,
                ))
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
                .method("POST")
                .uri("/api/v1/messages/send")
                .header(header::COOKIE, &session)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"channel":"sms","templateKey":"test_welcome","recipients":["09120000000"],"variables":{"name":"سارا"}}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let sent: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(sent["queued"], 1);
    assert_eq!(sent["items"][0]["bodyFa"], "سلام سارا");
    let id = sent["items"][0]["id"].as_str().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/messages/{id}/sent"))
                .header(header::COOKIE, &session)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&body).unwrap()["status"],
        "sent"
    );

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/notifications")
                .header(header::COOKIE, &session)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = body_of(response).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&body).unwrap()["unreadCount"],
        0
    );
}
