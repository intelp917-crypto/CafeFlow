use std::path::PathBuf;

use axum::Router;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use tower_http::services::ServeDir;

use crate::state::AppState;

pub fn static_router(state: AppState) -> Router<AppState> {
    let root = state.config.web_root.clone();

    Router::new()
        .nest_service("/assets", ServeDir::new(root.join("assets")))
        .nest_service("/images", ServeDir::new(root.join("images")))
        .nest_service("/scenes", ServeDir::new(root.join("scenes")))
        .nest_service("/videos", ServeDir::new(root.join("videos")))
        .route(
            "/sw.js",
            get({
                let path = root.join("sw.js");
                move || no_cache_file(path.clone())
            }),
        )
        .route(
            "/manifest.webmanifest",
            get({
                let path = root.join("manifest.webmanifest");
                move || no_cache_file(path.clone())
            }),
        )
        .route(
            "/offline.html",
            get({
                let path = root.join("offline.html");
                move || no_cache_file(path.clone())
            }),
        )
        .fallback(spa_index)
}

async fn spa_index(State(state): State<AppState>) -> Response {
    let index = state.config.web_root.join("index.html");
    no_cache_file(index).await
}

async fn no_cache_file(path: PathBuf) -> Response {
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            (
                StatusCode::OK,
                [
                    (
                        header::CONTENT_TYPE,
                        HeaderValue::from_str(mime.as_ref())
                            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
                    ),
                    (header::CACHE_CONTROL, HeaderValue::from_static("no-cache")),
                ],
                bytes,
            )
                .into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
