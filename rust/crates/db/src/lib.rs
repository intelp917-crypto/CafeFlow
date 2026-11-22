//! Database access, migrations and auth persistence for CafeFlow.

mod auth_repository;
mod config;
mod copy;
mod database;
mod password;
mod seed;

pub use auth_repository::{AuditEntry, AuthSession, SessionRow, UserRow};
pub use config::{DbConfig, DbDriver};
pub use copy::{CopyReport, copy_sqlite_to_postgres};
pub use database::Database;
pub use password::{
    create_token, hash_password, now_iso, now_iso_after_minutes, sha256_hex, verify_password,
};
pub use seed::{SeedOptions, is_seeded, seed_database};
