use std::path::Path;

use anyhow::{Context, Result, anyhow};
use include_dir::{Dir, include_dir};
use sqlx::any::AnyPoolOptions;
use sqlx::{AnyPool, Row};
use tracing::{info, warn};

use crate::config::{DbConfig, DbDriver};

static SQLITE_MIGRATIONS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../migrations/sqlite");
static POSTGRES_MIGRATIONS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../migrations/postgres");

#[derive(Clone)]
pub struct Database {
    pub pool: AnyPool,
    pub driver: DbDriver,
    pub data_directory: std::path::PathBuf,
}

impl Database {
    pub async fn connect(config: &DbConfig) -> Result<Self> {
        sqlx::any::install_default_drivers();

        if config.driver == DbDriver::Sqlite
            && let Some(parent) = config.database_path.parent()
        {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("ساخت پوشه پایگاه داده: {}", parent.display()))?;
        }

        let url = config.connection_url();
        let mut options = AnyPoolOptions::new().max_connections(config.pool_max);
        if config.driver == DbDriver::Sqlite {
            options = options.after_connect(|connection, _meta| {
                Box::pin(async move {
                    for pragma in [
                        "PRAGMA journal_mode = WAL",
                        "PRAGMA foreign_keys = ON",
                        "PRAGMA busy_timeout = 5000",
                        "PRAGMA synchronous = NORMAL",
                    ] {
                        sqlx::query(pragma).execute(&mut *connection).await?;
                    }
                    Ok(())
                })
            });
        }

        let pool = options
            .connect(&url)
            .await
            .with_context(|| format!("اتصال به پایگاه داده ({}): {url}", config.driver.as_str()))?;

        let database = Self {
            pool,
            driver: config.driver,
            data_directory: config.data_directory.clone(),
        };

        if config.auto_migrate {
            database.migrate().await?;
        }

        Ok(database)
    }

    pub async fn migrate(&self) -> Result<Vec<String>> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await
        .context("ساخت جدول schema_migrations")?;

        let rows = sqlx::query("SELECT name FROM schema_migrations")
            .fetch_all(&self.pool)
            .await
            .context("خواندن مهاجرت‌های اعمال‌شده")?;
        let applied: std::collections::HashSet<String> = rows
            .iter()
            .map(|row| row.get::<String, _>("name"))
            .collect();

        let directory = match self.driver {
            DbDriver::Sqlite => &SQLITE_MIGRATIONS,
            DbDriver::Postgres => &POSTGRES_MIGRATIONS,
        };
        let mut files: Vec<_> = directory
            .files()
            .filter(|file| {
                file.path()
                    .extension()
                    .is_some_and(|extension| extension == "sql")
            })
            .collect();
        files.sort_by_key(|file| file.path().file_name().map(|name| name.to_owned()));

        let mut newly_applied = Vec::new();
        for file in files {
            let name = file
                .path()
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| anyhow!("نام فایل مهاجرت نامعتبر است"))?
                .to_string();
            if applied.contains(&name) {
                continue;
            }

            let sql = file
                .contents_utf8()
                .ok_or_else(|| anyhow!("مهاجرت {name} UTF-8 نیست"))?;
            info!("اعمال مهاجرت {} ({})", name, self.driver.as_str());

            let mut transaction = self.pool.begin().await.context("شروع تراکنش مهاجرت")?;
            sqlx::raw_sql(sql)
                .execute(&mut *transaction)
                .await
                .with_context(|| format!("اجرای مهاجرت {name}"))?;
            sqlx::query("INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)")
                .bind(&name)
                .bind(crate::password::now_iso())
                .execute(&mut *transaction)
                .await
                .context("ثبت مهاجرت")?;
            transaction.commit().await.context("ثبت تراکنش مهاجرت")?;
            newly_applied.push(name);
        }

        if newly_applied.is_empty() {
            info!("پایگاه داده به‌روز است؛ مهاجرت جدیدی وجود ندارد.");
        }
        Ok(newly_applied)
    }

    pub async fn ping(&self) -> bool {
        sqlx::query("SELECT 1").fetch_one(&self.pool).await.is_ok()
    }

    pub async fn table_count(&self) -> Result<i64> {
        let row = match self.driver {
            DbDriver::Sqlite => {
                sqlx::query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
                    .fetch_one(&self.pool)
                    .await?
            }
            DbDriver::Postgres => sqlx::query(
                "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = 'public'",
            )
            .fetch_one(&self.pool)
            .await?,
        };
        Ok(row.get::<i64, _>("n"))
    }

    pub fn ensure_data_directory(&self) -> Result<()> {
        std::fs::create_dir_all(&self.data_directory)
            .with_context(|| format!("ساخت مسیر داده: {}", self.data_directory.display()))?;
        Ok(())
    }

    /// Consistent SQLite copy. PostgreSQL deployments should use pg_dump or a
    /// managed snapshot; this command refuses rather than pretending.
    pub async fn backup_sqlite(&self, target: &Path) -> Result<()> {
        if self.driver != DbDriver::Sqlite {
            warn!("backup داخلی فقط برای SQLite است؛ برای PostgreSQL از pg_dump استفاده کنید.");
            return Err(anyhow!("backup داخلی برای PostgreSQL پیاده‌سازی نشده است."));
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let escaped = target.to_string_lossy().replace('\'', "''");
        sqlx::raw_sql(&format!("VACUUM INTO '{escaped}'"))
            .execute(&self.pool)
            .await
            .context("ساخت نسخه پشتیبان SQLite")?;
        Ok(())
    }
}
