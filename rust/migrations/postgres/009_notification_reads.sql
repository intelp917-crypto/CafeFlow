-- Per-user read state. A role-addressed notification used to be marked read for
-- everyone holding that role; each user now records their own read, so one
-- cashier opening the inbox no longer clears it for the next shift.
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id TEXT NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  read_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  PRIMARY KEY (notification_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads (user_id);

-- Personal rows already marked read stay read for their owner.
INSERT INTO notification_reads (notification_id, user_id, read_at)
SELECT id, user_id, COALESCE(created_at, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  FROM notifications
 WHERE is_read = 1 AND user_id IS NOT NULL ON CONFLICT DO NOTHING;
