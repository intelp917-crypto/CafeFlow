use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DbDriver {
    Sqlite,
    Postgres,
}

impl DbDriver {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sqlite => "sqlite",
            Self::Postgres => "postgres",
        }
    }
}

#[derive(Debug, Clone)]
pub struct DbConfig {
    pub driver: DbDriver,
    /// SQLite file path. Ignored for PostgreSQL.
    pub database_path: PathBuf,
    /// PostgreSQL connection string. Required when `driver == Postgres`.
    pub database_url: Option<String>,
    pub pool_max: u32,
    pub auto_migrate: bool,
    pub data_directory: PathBuf,
}

impl DbConfig {
    pub fn from_env() -> Result<Self> {
        let driver = match std::env::var("DB_DRIVER")
            .unwrap_or_else(|_| "sqlite".to_string())
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "sqlite" => DbDriver::Sqlite,
            "postgres" | "postgresql" => DbDriver::Postgres,
            other => bail!("DB_DRIVER نامعتبر است: {other} (sqlite | postgres)"),
        };

        let data_directory = std::env::var_os("CAFEFLOW_DATA_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("data"));
        let data_directory = absolute(&data_directory)?;

        let database_path = std::env::var_os("DATABASE_PATH")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .map(|path| absolute(&path))
            .transpose()?
            .unwrap_or_else(|| data_directory.join("cafeflow.db"));

        let database_url = std::env::var("DATABASE_URL")
            .ok()
            .filter(|value| !value.trim().is_empty());
        if driver == DbDriver::Postgres && database_url.is_none() {
            bail!("DB_DRIVER=postgres است اما DATABASE_URL تنظیم نشده است.");
        }
        if driver == DbDriver::Sqlite && database_url.is_some() {
            eprintln!("[config] DB_DRIVER=sqlite است؛ DATABASE_URL نادیده گرفته می‌شود.");
        }

        let pool_max = std::env::var("DB_POOL_MAX")
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(if driver == DbDriver::Sqlite { 1 } else { 10 });

        let auto_migrate = std::env::var("DB_AUTO_MIGRATE")
            .map(|value| matches!(value.trim(), "1" | "true" | "yes" | "on"))
            .unwrap_or(true);

        Ok(Self {
            driver,
            database_path,
            database_url,
            pool_max,
            auto_migrate,
            data_directory,
        })
    }

    /// URL handed to SQLx's Any driver. SQLite accepts an absolute path; on
    /// Windows the path is normalized to forward slashes before it is wrapped.
    pub fn connection_url(&self) -> String {
        match self.driver {
            DbDriver::Postgres => self.database_url.clone().unwrap_or_default(),
            DbDriver::Sqlite => {
                let path = self.database_path.to_string_lossy().replace('\\', "/");
                // SQLx expects file URLs for absolute paths. Windows drive
                // paths need three slashes (`sqlite:///C:/...`), otherwise the
                // drive letter is parsed as a host and opening fails.
                if path.starts_with('/') {
                    format!("sqlite://{path}?mode=rwc")
                } else {
                    format!("sqlite:///{path}?mode=rwc")
                }
            }
        }
    }
}

fn absolute(path: &Path) -> Result<PathBuf> {
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    let cwd = std::env::current_dir().context("خواندن مسیر جاری")?;
    Ok(cwd.join(path))
}
