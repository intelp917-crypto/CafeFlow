use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

#[derive(Debug, Clone)]
pub struct AppError {
    pub status: StatusCode,
    pub code: String,
    pub message: String,
    pub details: Option<Value>,
}

impl AppError {
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", message)
    }

    pub fn new(status: StatusCode, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status,
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let mut error = json!({
            "code": self.code,
            "message": self.message,
        });
        if let Some(details) = self.details {
            error["details"] = details;
        }
        (self.status, Json(json!({ "error": error }))).into_response()
    }
}

pub fn bad_request(message: impl Into<String>, code: impl Into<String>) -> AppError {
    AppError::new(StatusCode::BAD_REQUEST, code, message)
}

pub fn unauthorized(message: impl Into<String>, code: impl Into<String>) -> AppError {
    AppError::new(StatusCode::UNAUTHORIZED, code, message)
}

pub fn forbidden(message: impl Into<String>, code: impl Into<String>) -> AppError {
    AppError::new(StatusCode::FORBIDDEN, code, message)
}

pub fn not_found(message: impl Into<String>, code: impl Into<String>) -> AppError {
    AppError::new(StatusCode::NOT_FOUND, code, message)
}

pub fn conflict(message: impl Into<String>, code: impl Into<String>) -> AppError {
    AppError::new(StatusCode::CONFLICT, code, message)
}

pub fn validation_failed(message: impl Into<String>) -> AppError {
    bad_request(message, "VALIDATION_FAILED")
}

pub fn internal(message: impl Into<String>) -> AppError {
    AppError::new(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", message)
}
