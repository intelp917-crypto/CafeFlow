use std::path::PathBuf;

use anyhow::{Context, Result};
use cafeflow_db::DbConfig;

#[derive(Debug, Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub api_prefix: String,
    pub production: bool,
    pub web_root: PathBuf,
    pub data_directory: PathBuf,
    pub backup_directory: PathBuf,
    pub session_cookie_name: String,
    pub session_ttl_hours: i64,
    pub session_cookie_secure: bool,
    pub login_max_attempts: i64,
    pub login_lock_minutes: i64,
    pub db: DbConfig,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        // Existing .env files are intentionally supported; a malformed file must
        // not prevent a production process from starting with real env vars.
        let _ = dotenvy::dotenv();

        let production = std::env::var("APP_ENV")
            .or_else(|_| std::env::var("NODE_ENV"))
            .map(|value| value.eq_ignore_ascii_case("production"))
            .unwrap_or(false);
        let port = std::env::var("PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(3000);
        let data_directory = std::env::var_os("CAFEFLOW_DATA_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("data"));
        let data_directory = if data_directory.is_absolute() {
            data_directory
        } else {
            std::env::current_dir()
                .context("مسیر جاری")?
                .join(data_directory)
        };
        let web_root = std::env::var_os("WEB_ROOT")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("apps/web/dist"));
        let web_root = if web_root.is_absolute() {
            web_root
        } else {
            std::env::current_dir().context("مسیر جاری")?.join(web_root)
        };
        let backup_directory = std::env::var_os("CAFEFLOW_BACKUP_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| data_directory.join("backups"));
        let backup_directory = if backup_directory.is_absolute() {
            backup_directory
        } else {
            std::env::current_dir()
                .context("مسیر جاری")?
                .join(backup_directory)
        };

        let session_cookie_secure = std::env::var("SESSION_COOKIE_SECURE")
            .map(|value| matches!(value.trim(), "1" | "true" | "yes" | "on"))
            .unwrap_or(production);
        let session_ttl_hours = read_i64("SESSION_TTL_HOURS", 168).max(1);
        let login_max_attempts = read_i64("LOGIN_MAX_ATTEMPTS", 5).max(1);
        let login_lock_minutes = read_i64("LOGIN_LOCK_MINUTES", 15).max(1);

        let db = DbConfig::from_env()?;
        Ok(Self {
            host: std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port,
            api_prefix: normalize_prefix(
                std::env::var("API_PREFIX").unwrap_or_else(|_| "/api/v1".to_string()),
            ),
            production,
            web_root,
            data_directory,
            backup_directory,
            session_cookie_name: std::env::var("SESSION_COOKIE_NAME")
                .unwrap_or_else(|_| "cafe_session".to_string()),
            session_ttl_hours,
            session_cookie_secure,
            login_max_attempts,
            login_lock_minutes,
            db,
        })
    }
}

fn read_i64(name: &str, fallback: i64) -> i64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(fallback)
}

pub fn normalize_prefix(prefix: String) -> String {
    let trimmed = prefix.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        String::new()
    } else if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}
