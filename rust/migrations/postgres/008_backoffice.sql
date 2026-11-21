-- Phase 9: back-office completion (shifts, messaging permissions, templates).

CREATE TABLE shifts (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  note TEXT,
  checked_in_at TEXT,
  checked_out_at TEXT,
  created_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_shifts_employee_time ON shifts (employee_id, starts_at);
CREATE INDEX idx_shifts_time ON shifts (starts_at);

CREATE INDEX idx_expenses_spent_at ON expenses (spent_at DESC);
CREATE INDEX idx_purchases_purchased_at ON purchases (purchased_at DESC);
CREATE INDEX idx_outbox_channel_status ON notification_outbox (channel, status, created_at DESC);

-- Message centre permissions. They are inserted here (not only in the seed) so
-- an installation that already has a database receives them on migration.
INSERT INTO permissions (id, key, name_fa, group_key)
VALUES
  (md5(random()::text), 'messages.read', 'مشاهده مرکز پیام', 'messages'),
  (md5(random()::text), 'messages.write', 'ارسال پیام و مدیریت قالب‌ها', 'messages') ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN ('messages.read', 'messages.write')
 WHERE r.key IN ('super_admin', 'manager') ON CONFLICT DO NOTHING;

-- Starter templates. Bodies use {{variable}} placeholders rendered on send.
INSERT INTO notification_templates (id, key, channel, title_fa, body_fa, is_active) VALUES
  (md5(random()::text), 'order_ready', 'sms', 'سفارش آماده است',
   '{{name}} عزیز، سفارش {{code}} در {{cafe}} آماده تحویل است.', 1),
  (md5(random()::text), 'reservation_confirmed', 'sms', 'رزرو تأیید شد',
   '{{name}} عزیز، رزرو شما برای {{date}} ساعت {{time}} تأیید شد.', 1),
  (md5(random()::text), 'birthday_greeting', 'sms', 'تولدت مبارک',
   '{{name}} عزیز، تولدت مبارک! به مناسبت تولدت یک قهوه مهمان ما هستی.', 1),
  (md5(random()::text), 'loyalty_points', 'sms', 'امتیاز وفاداری',
   '{{name}} عزیز، امتیاز باشگاه مشتریان شما به {{points}} رسید.', 1) ON CONFLICT DO NOTHING;
