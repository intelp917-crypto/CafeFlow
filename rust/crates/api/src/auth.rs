use std::collections::HashSet;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use cafeflow_db::{AuditEntry, AuthSession, UserRow, now_iso_after_minutes, sha256_hex};
use cafeflow_domain::module_status;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Row;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::error::{AppError, bad_request, conflict, forbidden, unauthorized, validation_failed};
use crate::state::AppState;
use crate::totp;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginInput {
    username: String,
    password: String,
    code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MfaCodeInput {
    code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MfaRecoveryInput {
    password: String,
    code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MfaDisableInput {
    password: String,
    code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangePasswordInput {
    current_password: String,
    new_password: String,
    confirm_password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UserDto {
    id: String,
    username: String,
    full_name: String,
    roles: Vec<String>,
    permissions: Vec<String>,
    must_change_password: bool,
    mfa_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionDto {
    id: String,
    ip: Option<String>,
    user_agent: Option<String>,
    created_at: String,
    last_seen_at: String,
    expires_at: String,
    current: bool,
}

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, AppError> {
    let input: LoginInput =
        serde_json::from_slice(&body).map_err(|_| validation_failed("اطلاعات ورود معتبر نیست."))?;
    validate_login(&input)?;

    let ip = client_ip(&headers);
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok());
    if let Some(ip) = ip.as_deref() {
        let mut limiter = state
            .login_limiter
            .lock()
            .map_err(|_| AppError::internal("rate limiter"))?;
        if !limiter.hit(&format!("login:{ip}")) {
            return Err(AppError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMITED",
                "تعداد تلاش‌های ورود از این شبکه زیاد بوده است. چند دقیقه بعد دوباره تلاش کنید.",
            ));
        }
    }

    let username = input.username.trim().to_string();
    let Some(user) = state
        .db
        .find_user_by_username(&username)
        .await
        .map_err(db_error)?
    else {
        audit(
            &state,
            AuditEntry {
                actor_username: Some(username.clone()),
                action: "auth.login_failed".to_string(),
                entity_type: "user".to_string(),
                metadata_json: Some(json!({"reason": "unknown_user"}).to_string()),
                ip: ip.clone(),
                user_agent: user_agent.map(str::to_owned),
                ..Default::default()
            },
        )
        .await;
        return Err(unauthorized(
            "نام کاربری یا گذرواژه نادرست است.",
            "INVALID_CREDENTIALS",
        ));
    };

    if user.is_active != 1 {
        return Err(forbidden(
            "حساب کاربری شما غیرفعال شده است. با مدیر سیستم تماس بگیرید.",
            "ACCOUNT_DISABLED",
        ));
    }
    if let Some(locked_until) = &user.locked_until
        && parse_iso(locked_until).is_some_and(|locked| locked > OffsetDateTime::now_utc())
    {
        return Err(AppError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "ACCOUNT_LOCKED",
            "حساب شما به دلیل تلاش‌های ناموفق متعدد موقتاً قفل شده است. چند دقیقه دیگر دوباره تلاش کنید.",
        ));
    }

    if !cafeflow_db::verify_password(&input.password, &user.password_hash) {
        let _ = state
            .db
            .register_failed_login(
                &user.id,
                state.config.login_max_attempts,
                state.config.login_lock_minutes,
            )
            .await;
        audit(
            &state,
            AuditEntry {
                actor_user_id: Some(user.id.clone()),
                actor_username: Some(user.username.clone()),
                action: "auth.login_failed".to_string(),
                entity_type: "user".to_string(),
                entity_id: Some(user.id.clone()),
                metadata_json: Some(json!({"reason": "bad_password"}).to_string()),
                ip: ip.clone(),
                user_agent: user_agent.map(str::to_owned),
                ..Default::default()
            },
        )
        .await;
        return Err(unauthorized(
            "نام کاربری یا گذرواژه نادرست است.",
            "INVALID_CREDENTIALS",
        ));
    }

    if user.totp_enabled == 1 {
        let Some(secret) = user.totp_secret.as_deref() else {
            return Err(unauthorized(
                "کد تأیید دو مرحله‌ای نادرست یا منقضی است.",
                "MFA_INVALID",
            ));
        };
        let submitted = input.code.as_deref().map(str::trim).unwrap_or_default();
        if submitted.is_empty() {
            return Err(AppError::new(
                StatusCode::UNAUTHORIZED,
                "MFA_REQUIRED",
                "این حساب تأیید دو مرحله‌ای دارد؛ کد شش‌رقمی را وارد کنید.",
            ));
        }
        let is_totp = submitted.len() == 6 && submitted.chars().all(|ch| ch.is_ascii_digit());
        let valid = if is_totp {
            totp::verify(secret, submitted)
        } else {
            let hash = sha256_hex(&normalize_recovery_code(submitted));
            state
                .db
                .use_recovery_code(&user.id, &hash)
                .await
                .map_err(db_error)?
        };
        if !valid {
            audit(
                &state,
                AuditEntry {
                    actor_user_id: Some(user.id.clone()),
                    actor_username: Some(user.username.clone()),
                    action: "auth.mfa_failed".to_string(),
                    entity_type: "user".to_string(),
                    entity_id: Some(user.id.clone()),
                    ip: ip.clone(),
                    user_agent: user_agent.map(str::to_owned),
                    ..Default::default()
                },
            )
            .await;
            return Err(unauthorized(
                "کد تأیید دو مرحله‌ای نادرست یا منقضی است.",
                "MFA_INVALID",
            ));
        }
    }

    issue_session(&state, &headers, &user, "auth.login_success").await
}

/// Install key used by the first-run wizard when `CAFEFLOW_INSTALL_KEY` is not
/// set. It only protects the one-time creation of the first super admin.
const DEFAULT_INSTALL_KEY: &str = "P70w4EslWwiFvmay6Bs1";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetupInput {
    install_key: String,
    username: String,
    password: String,
    full_name: Option<String>,
}

pub async fn setup_status(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({ "required": setup_required(&state).await? })))
}

/// Creates the first super admin from `/staff/login` when no active super admin
/// exists yet. No `SEED_ADMIN_*` variable is required: the wizard asks for the
/// install key and the credentials instead.
pub async fn setup(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, AppError> {
    let input: SetupInput = serde_json::from_slice(&body)
        .map_err(|_| validation_failed("اطلاعات راه‌اندازی معتبر نیست."))?;
    let ip = client_ip(&headers);
    if let Some(ip) = ip.as_deref() {
        let mut limiter = state
            .login_limiter
            .lock()
            .map_err(|_| AppError::internal("rate limiter"))?;
        if !limiter.hit(&format!("setup:{ip}")) {
            return Err(AppError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMITED",
                "تعداد تلاش‌های راه‌اندازی زیاد بوده است. چند دقیقه بعد دوباره تلاش کنید.",
            ));
        }
    }
    if !setup_required(&state).await? {
        return Err(conflict(
            "مدیر اصلی قبلاً ساخته شده است.",
            "ALREADY_INITIALIZED",
        ));
    }
    let expected = std::env::var("CAFEFLOW_INSTALL_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_INSTALL_KEY.to_string());
    if sha256_hex(input.install_key.trim()) != sha256_hex(expected.trim()) {
        audit(
            &state,
            AuditEntry {
                actor_username: Some(input.username.trim().to_lowercase()),
                action: "auth.setup_failed".to_string(),
                entity_type: "user".to_string(),
                metadata_json: Some(json!({"reason": "invalid_install_key"}).to_string()),
                ip,
                ..Default::default()
            },
        )
        .await;
        return Err(forbidden("کلید نصب نادرست است.", "INVALID_INSTALL_KEY"));
    }

    let username = input.username.trim().to_lowercase();
    validate_username(&username)?;
    if input.password.len() < 8 {
        return Err(validation_failed("گذرواژه باید حداقل ۸ نویسه باشد."));
    }
    if input.password.len() > 128 {
        return Err(validation_failed("گذرواژه بیش از حد طولانی است."));
    }

    let role_id: Option<String> =
        sqlx::query_scalar("SELECT id FROM roles WHERE key = 'super_admin'")
            .fetch_optional(&state.db.pool)
            .await
            .map_err(db_error)?;
    let Some(role_id) = role_id else {
        return Err(AppError::internal(
            "نقش مدیر ساخته نشده است؛ ابتدا db setup را اجرا کنید.",
        ));
    };
    let taken: Option<String> = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&username)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(db_error)?;
    if taken.is_some() {
        return Err(conflict(
            "این نام کاربری قبلاً استفاده شده است.",
            "USERNAME_TAKEN",
        ));
    }

    let hash = cafeflow_db::hash_password(&input.password).map_err(AppError::internal)?;
    let user_id = Uuid::new_v4().to_string();
    let now = cafeflow_db::now_iso();
    let full_name = input
        .full_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("مدیر سیستم");
    sqlx::query(
        "INSERT INTO users (id, username, full_name, password_hash, is_active, must_change_password, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, 0, $5, $5)",
    )
    .bind(&user_id)
    .bind(&username)
    .bind(full_name)
    .bind(&hash)
    .bind(&now)
    .execute(&state.db.pool)
    .await
    .map_err(db_error)?;
    sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(&user_id)
        .bind(&role_id)
        .execute(&state.db.pool)
        .await
        .map_err(db_error)?;

    audit(
        &state,
        AuditEntry {
            actor_user_id: Some(user_id.clone()),
            actor_username: Some(username.clone()),
            action: "auth.setup_admin".to_string(),
            entity_type: "user".to_string(),
            entity_id: Some(user_id),
            ip,
            ..Default::default()
        },
    )
    .await;

    let Some(user) = state
        .db
        .find_user_by_username(&username)
        .await
        .map_err(db_error)?
    else {
        return Err(AppError::internal("کاربر مدیر پیدا نشد."));
    };
    issue_session(&state, &headers, &user, "auth.setup_login").await
}

async fn setup_required(state: &AppState) -> Result<bool, AppError> {
    let row = sqlx::query(
        "SELECT COUNT(*) AS n
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
          WHERE r.key = 'super_admin' AND u.is_active = 1",
    )
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(row.get::<i64, _>("n") == 0)
}

async fn issue_session(
    state: &AppState,
    headers: &HeaderMap,
    user: &UserRow,
    action: &str,
) -> Result<Response, AppError> {
    state
        .db
        .register_successful_login(&user.id)
        .await
        .map_err(db_error)?;
    let token = cafeflow_db::create_token();
    let session_id = Uuid::new_v4().to_string();
    let expires_at = now_iso_after_minutes(state.config.session_ttl_hours * 60);
    let ip = client_ip(headers);
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok());
    state
        .db
        .create_session(
            &session_id,
            &user.id,
            &token,
            ip.as_deref(),
            user_agent,
            &expires_at,
        )
        .await
        .map_err(db_error)?;

    audit(
        state,
        AuditEntry {
            actor_user_id: Some(user.id.clone()),
            actor_username: Some(user.username.clone()),
            action: action.to_string(),
            entity_type: "session".to_string(),
            entity_id: Some(session_id),
            ip,
            user_agent: user_agent.map(str::to_owned),
            ..Default::default()
        },
    )
    .await;

    let user_dto = user_dto(state, user).await?;
    let modules = state.db.enabled_modules().await.map_err(db_error)?;
    let cookie = build_cookie(
        &state.config.session_cookie_name,
        &token,
        state.config.session_ttl_hours * 3600,
        state.config.session_cookie_secure,
    );
    Ok(json_response(
        StatusCode::OK,
        cookie,
        json!({"user": user_dto, "modules": modules}),
    ))
}

pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    if let Some(token) = cookie_value(&headers, &state.config.session_cookie_name)
        && let Ok(Some(session)) = state.db.find_session_by_token(&token).await
    {
        let _ = state.db.revoke_session(&session.session.id).await;
        audit(
            &state,
            AuditEntry {
                actor_user_id: Some(session.user.id.clone()),
                actor_username: Some(session.user.username.clone()),
                action: "auth.logout".to_string(),
                entity_type: "session".to_string(),
                entity_id: Some(session.session.id),
                ip: client_ip(&headers),
                ..Default::default()
            },
        )
        .await;
    }
    let cookie = clear_cookie(
        &state.config.session_cookie_name,
        state.config.session_cookie_secure,
    );
    Ok(json_response(StatusCode::OK, cookie, json!({"ok": true})))
}

pub async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    let user = user_dto(&state, &session.user).await?;
    let modules = state.db.enabled_modules().await.map_err(db_error)?;
    let enabled: HashSet<String> = modules.iter().cloned().collect();
    let catalog = module_status(|key| enabled.contains(key.as_str()));
    Ok(Json(json!({
        "user": user,
        "modules": modules,
        "moduleCatalog": catalog,
    })))
}

pub async fn mfa_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    Ok(Json(json!({
        "enabled": session.user.totp_enabled == 1,
        "confirmedAt": session.user.totp_confirmed_at,
    })))
}

pub async fn enroll_mfa(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    if session.user.totp_enabled == 1 {
        return Err(AppError::new(
            StatusCode::CONFLICT,
            "MFA_ALREADY_ENABLED",
            "تأیید دو مرحله‌ای قبلاً برای این حساب فعال شده است.",
        ));
    }
    let secret = totp::generate_secret(20);
    state
        .db
        .set_totp_secret(&session.user.id, &secret)
        .await
        .map_err(db_error)?;
    audit(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "auth.mfa_enrollment_started".to_string(),
            entity_type: "user".to_string(),
            entity_id: Some(session.user.id.clone()),
            ip: client_ip(&headers),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({
        "secret": secret,
        "otpauthUrl": totp::otpauth_url(&secret, &session.user.username, "CafeFlow"),
    })))
}

pub async fn activate_mfa(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    let input: MfaCodeInput =
        serde_json::from_slice(&body).map_err(|_| validation_failed("کد تأیید معتبر نیست."))?;
    let Some(secret) = session.user.totp_secret.as_deref() else {
        return Err(bad_request(
            "ابتدا ثبت‌نام تأیید دو مرحله‌ای را شروع کنید.",
            "MFA_NOT_ENROLLED",
        ));
    };
    if !totp::verify(secret, input.code.trim()) {
        return Err(unauthorized("کد تأیید نادرست یا منقضی است.", "MFA_INVALID"));
    }
    let confirmed_at = cafeflow_db::now_iso_after_minutes(0);
    let (plain, hashes) = create_recovery_codes();
    state
        .db
        .activate_totp(&session.user.id, &confirmed_at)
        .await
        .map_err(db_error)?;
    state
        .db
        .replace_recovery_codes(&session.user.id, &hashes)
        .await
        .map_err(db_error)?;
    audit(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "auth.mfa_enabled".to_string(),
            entity_type: "user".to_string(),
            entity_id: Some(session.user.id.clone()),
            ip: client_ip(&headers),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({
        "enabled": true,
        "confirmedAt": confirmed_at,
        "recoveryCodes": plain,
    })))
}

pub async fn regenerate_recovery_codes(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    let input: MfaRecoveryInput =
        serde_json::from_slice(&body).map_err(|_| validation_failed("درخواست معتبر نیست."))?;
    if session.user.totp_enabled != 1 || session.user.totp_secret.is_none() {
        return Err(bad_request(
            "تأیید دو مرحله‌ای فعال نیست.",
            "MFA_NOT_ENABLED",
        ));
    }
    if !cafeflow_db::verify_password(&input.password, &session.user.password_hash) {
        return Err(unauthorized("گذرواژه نادرست است.", "INVALID_CREDENTIALS"));
    }
    if !totp::verify(
        session.user.totp_secret.as_deref().unwrap_or_default(),
        input.code.trim(),
    ) {
        return Err(unauthorized("کد تأیید نادرست یا منقضی است.", "MFA_INVALID"));
    }
    let (plain, hashes) = create_recovery_codes();
    state
        .db
        .replace_recovery_codes(&session.user.id, &hashes)
        .await
        .map_err(db_error)?;
    audit(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "auth.mfa_recovery_regenerated".to_string(),
            entity_type: "user".to_string(),
            entity_id: Some(session.user.id.clone()),
            ip: client_ip(&headers),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({"recoveryCodes": plain})))
}

pub async fn disable_mfa(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    let input: MfaDisableInput =
        serde_json::from_slice(&body).map_err(|_| validation_failed("درخواست معتبر نیست."))?;
    if !cafeflow_db::verify_password(&input.password, &session.user.password_hash) {
        return Err(unauthorized("گذرواژه نادرست است.", "INVALID_CREDENTIALS"));
    }
    if session.user.totp_enabled == 1 {
        let Some(secret) = session.user.totp_secret.as_deref() else {
            return Err(unauthorized(
                "برای غیرفعال‌سازی، کد تأیید معتبر لازم است.",
                "MFA_INVALID",
            ));
        };
        if !input
            .code
            .as_deref()
            .is_some_and(|code| totp::verify(secret, code.trim()))
        {
            return Err(unauthorized(
                "برای غیرفعال‌سازی، کد تأیید معتبر لازم است.",
                "MFA_INVALID",
            ));
        }
    }
    state
        .db
        .disable_totp(&session.user.id)
        .await
        .map_err(db_error)?;
    audit(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "auth.mfa_disabled".to_string(),
            entity_type: "user".to_string(),
            entity_id: Some(session.user.id.clone()),
            ip: client_ip(&headers),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({"enabled": false})))
}

pub async fn sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    let items = state
        .db
        .list_sessions(&session.user.id)
        .await
        .map_err(db_error)?
        .into_iter()
        .map(|row| SessionDto {
            current: row.id == session.session.id,
            id: row.id,
            ip: row.ip,
            user_agent: row.user_agent,
            created_at: row.created_at,
            last_seen_at: row.last_seen_at,
            expires_at: row.expires_at,
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({"items": items})))
}

pub async fn revoke_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    let target = state.db.find_session_by_id(&id).await.map_err(db_error)?;
    let Some(target) = target else {
        return Err(crate::error::not_found(
            "نشست مورد نظر یافت نشد.",
            "NOT_FOUND",
        ));
    };
    let is_own = target.user_id == session.user.id;
    if !is_own && !session_has_permission(&state, &session.user.id, "sessions.manage").await? {
        return Err(forbidden(
            "اجازه بستن نشست سایر کاربران را ندارید.",
            "FORBIDDEN",
        ));
    }
    state.db.revoke_session(&id).await.map_err(db_error)?;
    audit(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "auth.session_revoked".to_string(),
            entity_type: "session".to_string(),
            entity_id: Some(id),
            metadata_json: Some(json!({"ownerUserId": target.user_id, "self": is_own}).to_string()),
            ip: client_ip(&headers),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

pub async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let session = require_auth(&state, &headers).await?;
    let input: ChangePasswordInput = serde_json::from_slice(&body)
        .map_err(|_| validation_failed("اطلاعات گذرواژه معتبر نیست."))?;
    if input.new_password.len() < 8 {
        return Err(validation_failed("گذرواژه باید حداقل ۸ نویسه باشد."));
    }
    if input.new_password.len() > 128 {
        return Err(validation_failed("گذرواژه بیش از حد طولانی است."));
    }
    if input.new_password != input.confirm_password {
        return Err(validation_failed(
            "تکرار گذرواژه با گذرواژه جدید مطابقت ندارد.",
        ));
    }
    if !cafeflow_db::verify_password(&input.current_password, &session.user.password_hash) {
        return Err(bad_request(
            "گذرواژه فعلی نادرست است.",
            "INVALID_CURRENT_PASSWORD",
        ));
    }
    if cafeflow_db::verify_password(&input.new_password, &session.user.password_hash) {
        return Err(bad_request(
            "گذرواژه جدید نباید با گذرواژه فعلی یکسان باشد.",
            "PASSWORD_REUSED",
        ));
    }
    let hash = cafeflow_db::hash_password(&input.new_password).map_err(AppError::internal)?;
    state
        .db
        .update_password_hash(&session.user.id, &hash)
        .await
        .map_err(db_error)?;
    state
        .db
        .revoke_all_sessions(&session.user.id, Some(&session.session.id))
        .await
        .map_err(db_error)?;
    audit(
        &state,
        AuditEntry {
            actor_user_id: Some(session.user.id.clone()),
            actor_username: Some(session.user.username.clone()),
            action: "auth.password_changed".to_string(),
            entity_type: "user".to_string(),
            entity_id: Some(session.user.id),
            ip: client_ip(&headers),
            ..Default::default()
        },
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

pub(crate) async fn require_auth(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<AuthSession, AppError> {
    let Some(token) = cookie_value(headers, &state.config.session_cookie_name) else {
        return Err(unauthorized(
            "برای دسترسی باید وارد حساب خود شوید.",
            "UNAUTHORIZED",
        ));
    };
    let session = state
        .db
        .find_session_by_token(&token)
        .await
        .map_err(db_error)?;
    let Some(session) = session else {
        return Err(unauthorized(
            "نشست شما منقضی شده است. لطفاً دوباره وارد شوید.",
            "SESSION_EXPIRED",
        ));
    };
    let _ = state.db.touch_session(&session.session.id).await;
    Ok(session)
}

async fn user_dto(state: &AppState, user: &UserRow) -> Result<UserDto, AppError> {
    Ok(UserDto {
        id: user.id.clone(),
        username: user.username.clone(),
        full_name: user.full_name.clone(),
        roles: state.db.roles_for_user(&user.id).await.map_err(db_error)?,
        permissions: state
            .db
            .permissions_for_user(&user.id)
            .await
            .map_err(db_error)?,
        must_change_password: user.must_change_password == 1,
        mfa_enabled: user.totp_enabled == 1,
    })
}

pub(crate) async fn session_has_permission(
    state: &AppState,
    user_id: &str,
    permission: &str,
) -> Result<bool, AppError> {
    Ok(state
        .db
        .permissions_for_user(user_id)
        .await
        .map_err(db_error)?
        .iter()
        .any(|candidate| candidate == permission))
}

fn validate_username(username: &str) -> Result<(), AppError> {
    if username.len() < 3 || username.len() > 64 {
        return Err(validation_failed("نام کاربری باید بین ۳ و ۶۴ نویسه باشد."));
    }
    if !username
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err(validation_failed(
            "نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط باشد.",
        ));
    }
    Ok(())
}

fn validate_login(input: &LoginInput) -> Result<(), AppError> {
    validate_username(input.username.trim())?;
    if input.password.is_empty() {
        return Err(validation_failed("گذرواژه الزامی است."));
    }
    if let Some(code) = &input.code {
        let code = code.trim();
        let valid = (code.len() == 6 && code.chars().all(|ch| ch.is_ascii_digit()))
            || (code.len() == 8 && code.chars().all(|ch| ch.is_ascii_alphanumeric()))
            || (code.len() == 9 && code.chars().filter(|ch| *ch == '-').count() == 1);
        if !valid {
            return Err(validation_failed("کد تأیید باید ۶ رقم یا کد پشتیبان باشد."));
        }
    }
    Ok(())
}

fn create_recovery_codes() -> (Vec<String>, Vec<String>) {
    let mut plain = Vec::new();
    let mut hashes = Vec::new();
    for _ in 0..10 {
        let raw = totp::generate_secret(5);
        let code = format!("{}-{}", &raw[0..4], &raw[4..8]);
        hashes.push(sha256_hex(&normalize_recovery_code(&code)));
        plain.push(code);
    }
    (plain, hashes)
}

fn parse_iso(value: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(value, &Rfc3339).ok()
}

fn normalize_recovery_code(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_uppercase()
}

fn client_ip(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned)
        })
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|header| {
            header.split(';').find_map(|part| {
                let (key, value) = part.trim().split_once('=')?;
                if key == name {
                    percent_decode(value)
                } else {
                    None
                }
            })
        })
}

fn percent_decode(value: &str) -> Option<String> {
    // Session tokens are URL-safe base64; a literal value is enough for them,
    // while this handles a cookie encoded by the browser.
    let mut output = String::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok()?;
            output.push(u8::from_str_radix(hex, 16).ok()? as char);
            index += 3;
        } else {
            output.push(bytes[index] as char);
            index += 1;
        }
    }
    Some(output)
}

fn build_cookie(name: &str, token: &str, max_age: i64, secure: bool) -> String {
    let mut cookie = format!("{name}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}");
    if secure {
        cookie.push_str("; Secure");
    }
    cookie
}

fn clear_cookie(name: &str, secure: bool) -> String {
    let mut cookie = format!("{name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    if secure {
        cookie.push_str("; Secure");
    }
    cookie
}

fn json_response(status: StatusCode, cookie: String, value: Value) -> Response {
    let mut response = (status, Json(value)).into_response();
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

async fn audit(state: &AppState, entry: AuditEntry) {
    if let Err(error) = state.db.record_audit(&entry).await {
        tracing::warn!("ثبت audit ناموفق بود: {error}");
    }
}

fn db_error(error: impl std::fmt::Display) -> AppError {
    tracing::error!("database error: {error}");
    AppError::internal("خطای پایگاه داده رخ داد.")
}
