use std::path::PathBuf;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use cafeflow_api::{AppState, Config, build_router};
use cafeflow_db::{Database, DbConfig, DbDriver, SeedOptions};
use tower::ServiceExt;

fn config(root: &std::path::Path) -> Config {
    let db = DbConfig {
        driver: DbDriver::Sqlite,
        database_path: root.join("cafeflow.db"),
        database_url: None,
        pool_max: 1,
        auto_migrate: true,
        data_directory: root.to_path_buf(),
    };
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
        db,
    }
}

async fn test_app() -> (axum::Router, tempfile::TempDir) {
    let directory = tempfile::tempdir().expect("tempdir");
    let cfg = config(directory.path());
    let database = Database::connect(&cfg.db).await.expect("db");
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
    .expect("seed");
    let state = AppState::new(database, cfg);
    (build_router(state), directory)
}

async fn json(response: axum::response::Response) -> (StatusCode, String, String) {
    let status = response.status();
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("body");
    (
        status,
        cookie,
        String::from_utf8(bytes.to_vec()).expect("utf8"),
    )
}

fn login_request(username: &str, password: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(format!(
            r#"{{"username":"{username}","password":"{password}"}}"#
        )))
        .expect("request")
}

#[tokio::test]
async fn login_me_logout_and_protection() {
    let (app, _directory) = test_app().await;

    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/me")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let (status, _, body) = json(
        app.clone()
            .oneshot(login_request("admin", "wrong-password"))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(body.contains("INVALID_CREDENTIALS"));

    let (status, cookie, body) = json(
        app.clone()
            .oneshot(login_request("admin", "CafeFlow@1404"))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(cookie.contains("cafe_session="));
    assert!(cookie.contains("HttpOnly"));
    assert!(body.contains("super_admin"));
    let token = cookie.split(';').next().unwrap().to_string();

    let (status, _, body) = json(
        app.clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/me")
                    .header(header::COOKIE, &token)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.contains("moduleCatalog"));

    let (status, _, _) = json(
        app.clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/logout")
                    .header(header::COOKIE, &token)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _, _) = json(
        app.oneshot(
            Request::builder()
                .uri("/api/v1/auth/me")
                .header(header::COOKIE, &token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn mfa_enroll_login_and_recovery_codes() {
    let (app, _directory) = test_app().await;
    let (_, cookie, _) = json(
        app.clone()
            .oneshot(login_request("admin", "CafeFlow@1404"))
            .await
            .unwrap(),
    )
    .await;
    let token = cookie.split(';').next().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/mfa/enroll")
                .header(header::COOKIE, &token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, _, body) = json(response).await;
    assert_eq!(status, StatusCode::OK);
    let enrollment: serde_json::Value = serde_json::from_str(&body).unwrap();
    let secret = enrollment["secret"].as_str().unwrap();
    let code = cafeflow_api::totp::code_at(
        secret,
        time::OffsetDateTime::now_utc().unix_timestamp() * 1000,
    )
    .unwrap();

    let (status, _, body) = json(
        app.clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/mfa/activate")
                    .header(header::COOKIE, &token)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(r#"{{"code":"{code}"}}"#)))
                    .unwrap(),
            )
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let activated: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(activated["recoveryCodes"].as_array().unwrap().len(), 10);

    let (status, _, body) = json(
        app.clone()
            .oneshot(login_request("admin", "CafeFlow@1404"))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(body.contains("MFA_REQUIRED"));

    let body = format!(r#"{{"username":"admin","password":"CafeFlow@1404","code":"{code}"}}"#);
    let (status, _, _) = json(
        app.oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn health_and_unknown_api_route() {
    let (app, directory) = test_app().await;
    std::fs::create_dir_all(directory.path().join("public")).unwrap();
    std::fs::write(
        directory.path().join("public/index.html"),
        "<!doctype html><title>CafeFlow test</title>",
    )
    .unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    let body = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(body.contains("\"status\":\"ok\""));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/public/branding")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    assert!(String::from_utf8_lossy(&bytes).contains("nameFa"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/games/uno")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    assert!(String::from_utf8_lossy(&bytes).contains("CafeFlow test"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/images/missing.png")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/not-a-route")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[allow(dead_code)]
fn _path_check(_: PathBuf) {}
