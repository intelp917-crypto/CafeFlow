-- Phase 7: indexes for the queries added in phases 5–6. The tables already
-- existed, so this migration only adds covering indexes and touches no data.
CREATE INDEX IF NOT EXISTS idx_reservations_status_time ON reservations (status, reserved_for);
CREATE INDEX IF NOT EXISTS idx_notifications_role_read ON notifications (role_key, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_method_status ON payments (method, status, paid_at DESC);
