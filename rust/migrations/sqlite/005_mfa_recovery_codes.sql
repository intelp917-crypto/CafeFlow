-- Phase 7: one-time recovery codes for accounts with TOTP enabled.
-- Only SHA-256 hashes are stored; a code is removed from use by `used_at`.
CREATE TABLE mfa_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_mfa_recovery_user ON mfa_recovery_codes (user_id, used_at);
