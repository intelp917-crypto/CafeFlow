-- Phase 7: optional TOTP two-factor authentication for staff accounts.
-- The secret is stored as an RFC 4648 base32 string; sessions still decide
-- authorization, so enabling MFA never grants anything by itself.
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_confirmed_at TEXT;
