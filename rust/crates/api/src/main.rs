use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{Context, Result};
use cafeflow_api::{AppState, Config, build_router};
use cafeflow_db::{Database, DbConfig, SeedOptions};
use clap::{Parser, Subcommand};
use time::OffsetDateTime;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Parser)]
#[command(name = "cafeflow", version, about = "CafeFlow Rust backend")]
struct Cli {
    #[command(subcommand)]
    action: Option<Action>,
}

#[derive(Debug, Subcommand)]
enum Action {
    /// Run the HTTP server (default).
    Serve,
    /// Database maintenance commands.
    Db {
        #[command(subcommand)]
        command: DbAction,
    },
    /// Write a consistent SQLite backup into $CAFEFLOW_BACKUP_DIR.
    Backup,
}

#[derive(Debug, Subcommand)]
enum DbAction {
    Migrate,
    Seed,
    Setup,
    /// Copy an existing SQLite database into an empty, migrated PostgreSQL database.
    MigrateToPostgres {
        /// PostgreSQL URL; defaults to POSTGRES_URL.
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        dry_run: bool,
        /// Delete rows already in the target (including migration defaults).
        #[arg(long)]
        force: bool,
    },
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("cafeflow: {error:#}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();
    init_tracing();
    match cli.action.unwrap_or(Action::Serve) {
        Action::Serve => serve().await,
        Action::Db { command } => database_command(command).await,
        Action::Backup => backup().await,
    }
}

async fn serve() -> Result<()> {
    let config = Config::from_env()?;
    let database = Database::connect(&config.db).await?;
    let state = AppState::new(database, config.clone());
    let app = build_router(state);

    let address: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .with_context(|| format!("آدرس نامعتبر: {}:{}", config.host, config.port))?;
    let listener = TcpListener::bind(address)
        .await
        .with_context(|| format!("listen on {address}"))?;
    tracing::info!(
        "CafeFlow API روی http://{} آماده است (prefix={}, db={}, data={})",
        address,
        config.api_prefix,
        config.db.driver.as_str(),
        config.data_directory.display()
    );
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .context("اجرای HTTP server")?;
    Ok(())
}

async fn database_command(command: DbAction) -> Result<()> {
    let config = Config::from_env()?;
    let database = Database::connect(&config.db).await?;
    match command {
        DbAction::Migrate => {
            let applied = database.migrate().await?;
            println!("✅ {} مهاجرت اعمال شد.", applied.len());
        }
        DbAction::Seed => {
            let seeded = seed(&database).await?;
            println!(
                "{}",
                if seeded {
                    "✅ داده اولیه ساخته شد."
                } else {
                    "ℹ️ داده اولیه از قبل وجود دارد."
                }
            );
        }
        DbAction::Setup => {
            database.migrate().await?;
            let seeded = seed(&database).await?;
            println!(
                "{}",
                if seeded {
                    "✅ پایگاه داده آماده شد."
                } else {
                    "ℹ️ پایگاه داده از قبل آماده بود."
                }
            );
        }
        DbAction::MigrateToPostgres {
            target,
            dry_run,
            force,
        } => {
            let target_url = target
                .or_else(|| std::env::var("POSTGRES_URL").ok())
                .filter(|value| !value.trim().is_empty())
                .context("مقصد PostgreSQL را با --target یا POSTGRES_URL مشخص کنید.")?;
            let target_config = DbConfig {
                driver: cafeflow_db::DbDriver::Postgres,
                database_path: config.db.database_path.clone(),
                database_url: Some(target_url),
                pool_max: 5,
                auto_migrate: !dry_run,
                data_directory: config.data_directory.clone(),
            };
            let target_database = Database::connect(&target_config).await?;
            let report =
                cafeflow_db::copy_sqlite_to_postgres(&database, &target_database, dry_run, force)
                    .await?;
            println!(
                "{} {} جدول و {} ردیف{}",
                if dry_run {
                    "ℹ️ پیش‌نمایش:"
                } else {
                    "✅ کپی شد:"
                },
                report.tables,
                report.rows,
                if dry_run {
                    " (هیچ تغییری اعمال نشد)"
                } else {
                    ""
                }
            );
            for (table, count) in report.per_table {
                println!("   {table}: {count}");
            }
        }
    }
    Ok(())
}

async fn seed(database: &Database) -> Result<bool> {
    let options = SeedOptions {
        admin_username: std::env::var("SEED_ADMIN_USERNAME")
            .unwrap_or_else(|_| "admin".to_string()),
        // Optional: without it the first admin is created through the
        // install-key wizard on /staff/login.
        admin_password: std::env::var("SEED_ADMIN_PASSWORD").unwrap_or_default(),
        demo_staff: env_bool("SEED_DEMO_STAFF", true),
        demo_menu: env_bool("SEED_DEMO_MENU", true),
    };
    cafeflow_db::seed_database(database, &options).await
}

async fn backup() -> Result<()> {
    let config = Config::from_env()?;
    let database = Database::connect(&config.db).await?;
    std::fs::create_dir_all(&config.backup_directory)?;
    let stamp = OffsetDateTime::now_utc()
        .format(time::macros::format_description!(
            "[year][month][day]-[hour][minute][second]"
        ))
        .context("timestamp")?;
    let target: PathBuf = config
        .backup_directory
        .join(format!("cafeflow-{stamp}.sqlite"));
    database.backup_sqlite(&target).await?;
    println!("✅ پشتیبان ساخته شد: {}", target.display());
    Ok(())
}

fn env_bool(name: &str, fallback: bool) -> bool {
    std::env::var(name)
        .map(|value| matches!(value.trim(), "1" | "true" | "yes" | "on"))
        .unwrap_or(fallback)
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("cafeflow_api=info,tower_http=info,sqlx=warn"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}
