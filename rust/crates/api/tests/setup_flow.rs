use std::path::Path;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use cafeflow_api::{AppState, Config, build_router};
use cafeflow_db::{Database, DbConfig, DbDriver, SeedOptions};
use tower::ServiceExt;

const INSTALL_KEY: &str = "P70w4EslWwiFvmay6Bs1";

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

async fn app_without_admin() -> (axum::Router, tempfile::TempDir) {
    let directory = tempfile::tempdir().unwrap();
    let cfg = config(directory.path());
    let database = Database::connect(&cfg.db).await.unwrap();
    cafeflow_db::seed_database(
        &database,
        &SeedOptions {
            admin_username: "admin".to_string(),
            admin_password: String::new(),
            demo_staff: false,
            demo_menu: false,
        },
    )
    .await
    .unwrap();
    let state = AppState::new(database, cfg);
    (build_router(state), directory)
}

async fn send(
    app: &axum::Router,
    method: &str,
    uri: &str,
    body: Option<&str>,
    cookie: Option<&str>,
) -> (StatusCode, String, String) {
    let mut builder = Request::builder().method(method).uri(uri);
    if body.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    if let Some(cookie) = cookie {
        builder = builder.header(header::COOKIE, cookie);
    }
    let request = builder
        .body(Body::from(body.unwrap_or_default().to_string()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, cookie, String::from_utf8(bytes.to_vec()).unwrap())
}

#[tokio::test]
async fn first_run_needs_the_install_key_and_creates_the_admin() {
    let (app, _directory) = app_without_admin().await;

    let (status, _, body) = send(&app, "GET", "/api/v1/auth/setup", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body.contains("\"required\":true"),
        "unexpected body: {body}"
    );

    let wrong = r#"{"installKey":"nope","username":"owner","password":"StrongPass123"}"#;
    let (status, _, body) = send(&app, "POST", "/api/v1/auth/setup", Some(wrong), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(
        body.contains("INVALID_INSTALL_KEY"),
        "unexpected body: {body}"
    );

    let payload = format!(
        r#"{{"installKey":"{INSTALL_KEY}","username":"owner","password":"StrongPass123","fullName":"مالک"}}"#
    );
    let (status, set_cookie, body) =
        send(&app, "POST", "/api/v1/auth/setup", Some(&payload), None).await;
    assert_eq!(status, StatusCode::OK, "unexpected body: {body}");
    assert!(body.contains("super_admin"), "unexpected body: {body}");
    assert!(set_cookie.starts_with("cafe_session="));

    let cookie = set_cookie.split(';').next().unwrap().to_string();
    let (status, _, body) = send(&app, "GET", "/api/v1/auth/me", None, Some(&cookie)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body.contains("\"username\":\"owner\""),
        "unexpected body: {body}"
    );

    let (status, _, body) = send(&app, "GET", "/api/v1/auth/setup", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body.contains("\"required\":false"),
        "unexpected body: {body}"
    );

    let (status, _, body) = send(&app, "POST", "/api/v1/auth/setup", Some(&payload), None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(
        body.contains("ALREADY_INITIALIZED"),
        "unexpected body: {body}"
    );

    let login = r#"{"username":"owner","password":"StrongPass123"}"#;
    let (status, set_cookie, _) = send(&app, "POST", "/api/v1/auth/login", Some(login), None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(set_cookie.starts_with("cafe_session="));
}
