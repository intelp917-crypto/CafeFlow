//! One-way, repeatable-safe copy of an existing SQLite installation into a
//! freshly migrated PostgreSQL database. The source database is never modified.

use std::collections::BTreeMap;

use anyhow::{Context, Result, bail};
use sqlx::{Any, Row, Transaction, ValueRef};

use crate::config::DbDriver;
use crate::database::Database;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ColumnKind {
    Integer,
    Real,
    Text,
    Bool,
    Blob,
}

#[derive(Debug, Clone)]
struct Column {
    name: String,
    kind: ColumnKind,
}

#[derive(Debug, Default, Clone)]
pub struct CopyReport {
    pub tables: usize,
    pub rows: u64,
    pub per_table: BTreeMap<String, u64>,
}

pub async fn copy_sqlite_to_postgres(
    source: &Database,
    target: &Database,
    dry_run: bool,
    force: bool,
) -> Result<CopyReport> {
    if source.driver != DbDriver::Sqlite {
        bail!("مبدأ باید SQLite باشد.");
    }
    if target.driver != DbDriver::Postgres {
        bail!("مقصد باید PostgreSQL باشد.");
    }

    let table_rows = sqlx::query(
        "SELECT name FROM sqlite_master
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
            AND name <> 'schema_migrations'
            AND name <> '__drizzle_migrations'
          ORDER BY name",
    )
    .fetch_all(&source.pool)
    .await
    .context("خواندن فهرست جدول‌های SQLite")?;
    let tables: Vec<String> = table_rows.iter().map(|row| row.get("name")).collect();
    if tables.is_empty() {
        bail!("هیچ جدولی در مبدأ SQLite پیدا نشد.");
    }

    if dry_run {
        let mut report = CopyReport {
            tables: tables.len(),
            ..Default::default()
        };
        for table in &tables {
            let count = count_rows(source, table).await?;
            report.rows += count;
            report.per_table.insert(table.clone(), count);
        }
        return Ok(report);
    }

    let mut tx = target.pool.begin().await.context("شروع تراکنش کپی")?;
    // Triggers can fire during the import and make FK order matter. Disabling
    // them inside the same transaction means an error leaves the target intact.
    for table in &tables {
        if table_exists(&mut tx, table).await? {
            sqlx::query(&format!("ALTER TABLE {} DISABLE TRIGGER ALL", quote(table)))
                .execute(&mut *tx)
                .await
                .with_context(|| format!("غیرفعال کردن trigger جدول {table}"))?;
        }
    }

    let mut report = CopyReport {
        tables: tables.len(),
        ..Default::default()
    };
    let mut non_empty: Vec<(String, i64)> = Vec::new();
    for table in &tables {
        if !table_exists(&mut tx, table).await? {
            bail!("جدول {table} در PostgreSQL وجود ندارد؛ مهاجرت‌ها را اجرا کنید.");
        }
        let existing = count_target(&mut tx, table).await?;
        if existing > 0 {
            non_empty.push((table.clone(), existing));
        }
    }
    if !non_empty.is_empty() {
        if !force {
            let summary = non_empty
                .iter()
                .map(|(table, count)| format!("{table}={count}"))
                .collect::<Vec<_>>()
                .join("، ");
            bail!(
                "مقصد خالی نیست ({summary}). اگر مطمئن هستید، با --force داده‌های مقصد را پاک کنید."
            );
        }
        for table in &tables {
            sqlx::query(&format!("DELETE FROM {}", quote(table)))
                .execute(&mut *tx)
                .await
                .with_context(|| format!("پاک کردن جدول مقصد {table}"))?;
        }
    }
    for table in &tables {
        let columns = source_columns(source, table).await?;
        if columns.is_empty() {
            continue;
        }
        let sql = format!(
            "INSERT INTO {} ({}) VALUES ({})",
            quote(table),
            columns
                .iter()
                .map(|column| quote(&column.name))
                .collect::<Vec<_>>()
                .join(", "),
            (1..=columns.len())
                .map(|index| format!("${index}"))
                .collect::<Vec<_>>()
                .join(", ")
        );
        let rows = sqlx::query(&format!("SELECT * FROM {}", quote(table)))
            .fetch_all(&source.pool)
            .await
            .with_context(|| format!("خواندن جدول {table}"))?;
        let copied = rows.len() as u64;
        for row in rows {
            let mut statement = sqlx::query(&sql);
            for column in &columns {
                statement = bind_column(statement, &row, column)
                    .with_context(|| format!("تبدیل ستون {}.{}", table, column.name))?;
            }
            statement
                .execute(&mut *tx)
                .await
                .with_context(|| format!("درج ردیف در {table}"))?;
        }
        report.rows += copied;
        report.per_table.insert(table.clone(), copied);
    }

    for (table, expected) in &report.per_table {
        let actual = count_target(&mut tx, table).await?;
        if actual as u64 != *expected {
            bail!("شمارش ردیف جدول {table} مطابق نیست (منبع {expected}، مقصد {actual})");
        }
    }

    for table in &tables {
        if table_exists(&mut tx, table).await? {
            sqlx::query(&format!("ALTER TABLE {} ENABLE TRIGGER ALL", quote(table)))
                .execute(&mut *tx)
                .await
                .with_context(|| format!("فعال کردن trigger جدول {table}"))?;
        }
    }
    tx.commit().await.context("ثبت نهایی کپی")?;
    Ok(report)
}

async fn source_columns(source: &Database, table: &str) -> Result<Vec<Column>> {
    let rows = sqlx::query(&format!("PRAGMA table_info({})", quote(table)))
        .fetch_all(&source.pool)
        .await
        .with_context(|| format!("خواندن ستون‌های {table}"))?;
    let mut columns = Vec::new();
    for row in rows {
        let name: String = row.get("name");
        let declared: String = row.get::<Option<String>, _>("type").unwrap_or_default();
        columns.push(Column {
            name,
            kind: kind_for(&declared),
        });
    }
    Ok(columns)
}

fn kind_for(declared: &str) -> ColumnKind {
    let upper = declared.trim().to_ascii_uppercase();
    if upper.contains("BOOL") {
        ColumnKind::Bool
    } else if upper.contains("INT") {
        ColumnKind::Integer
    } else if upper.contains("REAL")
        || upper.contains("FLOA")
        || upper.contains("DOUB")
        || upper.contains("NUM")
    {
        ColumnKind::Real
    } else if upper.contains("BLOB") {
        ColumnKind::Blob
    } else {
        ColumnKind::Text
    }
}

fn bind_column<'q>(
    statement: sqlx::query::Query<'q, Any, sqlx::any::AnyArguments<'q>>,
    row: &sqlx::any::AnyRow,
    column: &Column,
) -> Result<sqlx::query::Query<'q, Any, sqlx::any::AnyArguments<'q>>> {
    let name = column.name.as_str();
    let value = row.try_get_raw(name)?;
    if value.is_null() {
        return Ok(match column.kind {
            ColumnKind::Integer | ColumnKind::Bool => statement.bind(None::<i64>),
            ColumnKind::Real => statement.bind(None::<f64>),
            ColumnKind::Text => statement.bind(None::<String>),
            ColumnKind::Blob => statement.bind(None::<Vec<u8>>),
        });
    }
    Ok(match column.kind {
        ColumnKind::Integer | ColumnKind::Bool => statement.bind(row.try_get::<i64, _>(name)?),
        ColumnKind::Real => statement.bind(row.try_get::<f64, _>(name)?),
        ColumnKind::Text => statement.bind(row.try_get::<String, _>(name)?),
        ColumnKind::Blob => statement.bind(row.try_get::<Vec<u8>, _>(name)?),
    })
}

async fn table_exists(tx: &mut Transaction<'_, Any>, table: &str) -> Result<bool> {
    let row = sqlx::query(
        "SELECT 1 AS present FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = $1",
    )
    .bind(table)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(row.is_some())
}

async fn count_rows(source: &Database, table: &str) -> Result<u64> {
    let row = sqlx::query(&format!("SELECT COUNT(*) AS n FROM {}", quote(table)))
        .fetch_one(&source.pool)
        .await?;
    let count: i64 = row.get("n");
    Ok(count.max(0) as u64)
}

async fn count_target(tx: &mut Transaction<'_, Any>, table: &str) -> Result<i64> {
    let row = sqlx::query(&format!("SELECT COUNT(*) AS n FROM {}", quote(table)))
        .fetch_one(&mut **tx)
        .await?;
    Ok(row.get("n"))
}

fn quote(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}
