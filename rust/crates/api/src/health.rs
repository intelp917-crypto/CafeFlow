use axum::Json;
use axum::extract::State;
use serde_json::{Value, json};

use crate::state::AppState;

pub async fn health(State(state): State<AppState>) -> Json<Value> {
    let ok = state.db.ping().await;
    Json(json!({
        "status": if ok { "ok" } else { "degraded" },
        "database": if ok { "ok" } else { "down" },
        "databaseDriver": state.db.driver.as_str(),
        "time": cafeflow_domain::iso_utc(time::OffsetDateTime::now_utc()),
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
