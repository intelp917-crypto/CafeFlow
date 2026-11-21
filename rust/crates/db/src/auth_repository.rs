use anyhow::{Context, Result};
use sqlx::Row;

use crate::database::Database;
use crate::password::{now_iso, sha256_hex};

#[derive(Debug, Clone)]
pub struct UserRow {
    pub id: String,
    pub username: String,
    pub full_name: String,
    pub password_hash: String,
    pub is_active: i64,
    pub must_change_password: i64,
    pub failed_login_attempts: i64,
    pub locked_until: Option<String>,
    pub deleted_at: Option<String>,
    pub totp_secret: Option<String>,
    pub totp_enabled: i64,
    pub totp_confirmed_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SessionRow {
    pub id: String,
    pub user_id: String,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: String,
    pub last_seen_at: String,
    pub expires_at: String,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AuthSession {
    pub session: SessionRow,
    pub user: UserRow,
}

#[derive(Debug, Clone, Default)]
pub struct AuditEntry {
    pub actor_user_id: Option<String>,
    pub actor_username: Option<String>,
    pub action: String,
    pub entity_type: String,
    pub entity_id: Option<String>,
    pub before_json: Option<String>,
    pub after_json: Option<String>,
    pub metadata_json: Option<String>,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
}

impl Database {
    pub async fn find_user_by_username(&self, username: &str) -> Result<Option<UserRow>> {
        let row = sqlx::query(
            "SELECT id, username, full_name, password_hash, is_active, must_change_password,
                    failed_login_attempts, locked_until, deleted_at, totp_secret, totp_enabled,
                    totp_confirmed_at
               FROM users
              WHERE lower(username) = lower($1) AND deleted_at IS NULL
              LIMIT 1",
        )
        .bind(username.trim())
        .fetch_optional(&self.pool)
        .await
        .context("جست‌وجوی کاربر")?;
        Ok(row.map(user_from_row))
    }

    pub async fn find_user_by_id(&self, id: &str) -> Result<Option<UserRow>> {
        let row = sqlx::query(
            "SELECT id, username, full_name, password_hash, is_active, must_change_password,
                    failed_login_attempts, locked_until, deleted_at, totp_secret, totp_enabled,
                    totp_confirmed_at
               FROM users
              WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .context("جست‌وجوی کاربر با شناسه")?;
        Ok(row.map(user_from_row))
    }

    pub async fn roles_for_user(&self, user_id: &str) -> Result<Vec<String>> {
        let rows = sqlx::query(
            "SELECT DISTINCT r.key
               FROM roles r
               JOIN user_roles ur ON ur.role_id = r.id
              WHERE ur.user_id = $1
              ORDER BY r.key",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(|row| row.get("key")).collect())
    }

    pub async fn permissions_for_user(&self, user_id: &str) -> Result<Vec<String>> {
        let rows = sqlx::query(
            "SELECT DISTINCT p.key
               FROM permissions p
               JOIN role_permissions rp ON rp.permission_id = p.id
               JOIN user_roles ur ON ur.role_id = rp.role_id
              WHERE ur.user_id = $1
              ORDER BY p.key",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(|row| row.get("key")).collect())
    }

    pub async fn enabled_modules(&self) -> Result<Vec<String>> {
        let rows = sqlx::query("SELECT key FROM module_settings WHERE is_enabled = 1 ORDER BY key")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.iter().map(|row| row.get("key")).collect())
    }

    pub async fn create_session(
        &self,
        id: &str,
        user_id: &str,
        token: &str,
        ip: Option<&str>,
        user_agent: Option<&str>,
        expires_at: &str,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO sessions (id, user_id, token_hash, ip, user_agent, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(id)
        .bind(user_id)
        .bind(sha256_hex(token))
        .bind(ip)
        .bind(user_agent)
        .bind(expires_at)
        .execute(&self.pool)
        .await
        .context("ساخت نشست")?;
        Ok(())
    }

    pub async fn find_session_by_token(&self, token: &str) -> Result<Option<AuthSession>> {
        let row = sqlx::query(
            "SELECT s.id AS session_id, s.user_id, s.ip, s.user_agent, s.created_at AS session_created_at,
                    s.last_seen_at, s.expires_at, s.revoked_at,
                    u.id AS user_id_value, u.username, u.full_name, u.password_hash, u.is_active,
                    u.must_change_password, u.failed_login_attempts, u.locked_until, u.deleted_at,
                    u.totp_secret, u.totp_enabled, u.totp_confirmed_at
               FROM sessions s
               JOIN users u ON u.id = s.user_id
              WHERE s.token_hash = $1
                AND s.revoked_at IS NULL
                AND s.expires_at > $2
                AND u.is_active = 1
                AND u.deleted_at IS NULL
              LIMIT 1",
        )
        .bind(sha256_hex(token))
        .bind(now_iso())
        .fetch_optional(&self.pool)
        .await
        .context("جست‌وجوی نشست")?;

        let Some(row) = row else {
            return Ok(None);
        };
        let session = SessionRow {
            id: row.get("session_id"),
            user_id: row.get("user_id"),
            ip: row.get("ip"),
            user_agent: row.get("user_agent"),
            created_at: row.get("session_created_at"),
            last_seen_at: row.get("last_seen_at"),
            expires_at: row.get("expires_at"),
            revoked_at: row.get("revoked_at"),
        };
        let user = UserRow {
            id: row.get("user_id_value"),
            username: row.get("username"),
            full_name: row.get("full_name"),
            password_hash: row.get("password_hash"),
            is_active: row.get("is_active"),
            must_change_password: row.get("must_change_password"),
            failed_login_attempts: row.get("failed_login_attempts"),
            locked_until: row.get("locked_until"),
            deleted_at: row.get("deleted_at"),
            totp_secret: row.get("totp_secret"),
            totp_enabled: row.get("totp_enabled"),
            totp_confirmed_at: row.get("totp_confirmed_at"),
        };
        Ok(Some(AuthSession { session, user }))
    }

    pub async fn touch_session(&self, session_id: &str) -> Result<()> {
        sqlx::query("UPDATE sessions SET last_seen_at = $1 WHERE id = $2")
            .bind(now_iso())
            .bind(session_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn revoke_session(&self, session_id: &str) -> Result<()> {
        sqlx::query("UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL")
            .bind(now_iso())
            .bind(session_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn revoke_all_sessions(&self, user_id: &str, except: Option<&str>) -> Result<()> {
        if let Some(except) = except {
            sqlx::query(
                "UPDATE sessions SET revoked_at = $1
                  WHERE user_id = $2 AND id <> $3 AND revoked_at IS NULL",
            )
            .bind(now_iso())
            .bind(user_id)
            .bind(except)
            .execute(&self.pool)
            .await?;
        } else {
            sqlx::query(
                "UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL",
            )
            .bind(now_iso())
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    pub async fn list_sessions(&self, user_id: &str) -> Result<Vec<SessionRow>> {
        let rows = sqlx::query(
            "SELECT id, user_id, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at
               FROM sessions
              WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2
              ORDER BY last_seen_at DESC",
        )
        .bind(user_id)
        .bind(now_iso())
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|row| SessionRow {
                id: row.get("id"),
                user_id: row.get("user_id"),
                ip: row.get("ip"),
                user_agent: row.get("user_agent"),
                created_at: row.get("created_at"),
                last_seen_at: row.get("last_seen_at"),
                expires_at: row.get("expires_at"),
                revoked_at: row.get("revoked_at"),
            })
            .collect())
    }

    pub async fn find_session_by_id(&self, id: &str) -> Result<Option<SessionRow>> {
        let row = sqlx::query(
            "SELECT id, user_id, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at
               FROM sessions WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|row| SessionRow {
            id: row.get("id"),
            user_id: row.get("user_id"),
            ip: row.get("ip"),
            user_agent: row.get("user_agent"),
            created_at: row.get("created_at"),
            last_seen_at: row.get("last_seen_at"),
            expires_at: row.get("expires_at"),
            revoked_at: row.get("revoked_at"),
        }))
    }

    pub async fn register_failed_login(
        &self,
        user_id: &str,
        max_attempts: i64,
        lock_minutes: i64,
    ) -> Result<()> {
        let user = self
            .find_user_by_id(user_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("user missing"))?;
        let attempts = user.failed_login_attempts + 1;
        let locked_until = if attempts >= max_attempts {
            Some(crate::password::now_iso_after_minutes(lock_minutes))
        } else {
            None
        };
        sqlx::query(
            "UPDATE users
                SET failed_login_attempts = $1, locked_until = $2, updated_at = $3
              WHERE id = $4",
        )
        .bind(if locked_until.is_some() { 0 } else { attempts })
        .bind(locked_until)
        .bind(now_iso())
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn register_successful_login(&self, user_id: &str) -> Result<()> {
        let now = now_iso();
        sqlx::query(
            "UPDATE users
                SET failed_login_attempts = 0, locked_until = NULL, last_login_at = $1, updated_at = $1
              WHERE id = $2",
        )
        .bind(&now)
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_password_hash(&self, user_id: &str, password_hash: &str) -> Result<()> {
        sqlx::query(
            "UPDATE users
                SET password_hash = $1, must_change_password = 0, updated_at = $2
              WHERE id = $3",
        )
        .bind(password_hash)
        .bind(now_iso())
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn use_recovery_code(&self, user_id: &str, code_hash: &str) -> Result<bool> {
        let row = sqlx::query(
            "SELECT id FROM mfa_recovery_codes
              WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL",
        )
        .bind(user_id)
        .bind(code_hash)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(false);
        };
        let id: String = row.get("id");
        let updated = sqlx::query(
            "UPDATE mfa_recovery_codes SET used_at = $1 WHERE id = $2 AND used_at IS NULL",
        )
        .bind(now_iso())
        .bind(&id)
        .execute(&self.pool)
        .await?;
        Ok(updated.rows_affected() == 1)
    }

    pub async fn count_unused_recovery_codes(&self, user_id: &str) -> Result<i64> {
        let row = sqlx::query(
            "SELECT COUNT(*) AS n FROM mfa_recovery_codes
              WHERE user_id = $1 AND used_at IS NULL",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.get("n"))
    }

    pub async fn set_totp_secret(&self, user_id: &str, secret: &str) -> Result<()> {
        sqlx::query(
            "UPDATE users
                SET totp_secret = $1, totp_enabled = 0, totp_confirmed_at = NULL, updated_at = $2
              WHERE id = $3",
        )
        .bind(secret)
        .bind(now_iso())
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn activate_totp(&self, user_id: &str, confirmed_at: &str) -> Result<()> {
        sqlx::query(
            "UPDATE users
                SET totp_enabled = 1, totp_confirmed_at = $1, updated_at = $1
              WHERE id = $2",
        )
        .bind(confirmed_at)
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn disable_totp(&self, user_id: &str) -> Result<()> {
        sqlx::query(
            "UPDATE users
                SET totp_secret = NULL, totp_enabled = 0, totp_confirmed_at = NULL, updated_at = $1
              WHERE id = $2",
        )
        .bind(now_iso())
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        sqlx::query("DELETE FROM mfa_recovery_codes WHERE user_id = $1")
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn replace_recovery_codes(&self, user_id: &str, hashes: &[String]) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM mfa_recovery_codes WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        for hash in hashes {
            sqlx::query(
                "INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES ($1, $2, $3)",
            )
            .bind(uuid::Uuid::new_v4().to_string())
            .bind(user_id)
            .bind(hash)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn record_audit(&self, entry: &AuditEntry) -> Result<()> {
        sqlx::query(
            "INSERT INTO audit_logs
                (id, actor_user_id, actor_username, action, entity_type, entity_id,
                 before_json, after_json, metadata_json, ip, user_agent, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&entry.actor_user_id)
        .bind(&entry.actor_username)
        .bind(&entry.action)
        .bind(&entry.entity_type)
        .bind(&entry.entity_id)
        .bind(&entry.before_json)
        .bind(&entry.after_json)
        .bind(&entry.metadata_json)
        .bind(&entry.ip)
        .bind(&entry.user_agent)
        .bind(now_iso())
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

fn user_from_row(row: sqlx::any::AnyRow) -> UserRow {
    UserRow {
        id: row.get("id"),
        username: row.get("username"),
        full_name: row.get("full_name"),
        password_hash: row.get("password_hash"),
        is_active: row.get("is_active"),
        must_change_password: row.get("must_change_password"),
        failed_login_attempts: row.get("failed_login_attempts"),
        locked_until: row.get("locked_until"),
        deleted_at: row.get("deleted_at"),
        totp_secret: row.get("totp_secret"),
        totp_enabled: row.get("totp_enabled"),
        totp_confirmed_at: row.get("totp_confirmed_at"),
    }
}
