-- ---------------------------------------------------------------------------
-- CafeFlow initial schema
--
-- Design notes:
--  * All primary keys are application-generated UUID strings so that rows can
--    be created offline and later synchronised, and so the schema maps 1:1 to
--    a PostgreSQL migration.
--  * Money is stored as INTEGER rial. Never use REAL for money.
--  * Timestamps are ISO-8601 UTC strings; the API converts to Jalali/Tehran for
--    presentation only.
--  * Optional business modules (inventory, finance, crm, employees) have their
--    tables created up front: disabling a module must never destroy data.
-- ---------------------------------------------------------------------------

-- =========================== identity & access ============================

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE ,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_users_username ON users (username);
-- SQLite used COLLATE NOCASE; PostgreSQL enforces the same rule with an expression index.
CREATE UNIQUE INDEX ux_users_username_lower ON users (lower(username));

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name_fa TEXT NOT NULL,
  description_fa TEXT,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name_fa TEXT NOT NULL,
  group_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_user_roles_user ON user_roles (user_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  last_seen_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  actor_username TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  metadata_json TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_audit_created ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs (actor_user_id);
CREATE INDEX idx_audit_action ON audit_logs (action);

CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title_fa TEXT NOT NULL,
  payload_json TEXT,
  requested_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  decided_at TEXT
);
CREATE INDEX idx_approvals_status ON approval_requests (status, created_at DESC);

-- =========================== organisation / layout =========================

CREATE TABLE departments (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name_fa TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('barista', 'kitchen', 'bar', 'other')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE floors (
  id TEXT PRIMARY KEY,
  name_fa TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE areas (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL REFERENCES floors (id) ON DELETE CASCADE,
  name_fa TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);
CREATE INDEX idx_areas_floor ON areas (floor_id);

CREATE TABLE dining_tables (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL REFERENCES floors (id) ON DELETE RESTRICT,
  area_id TEXT REFERENCES areas (id) ON DELETE SET NULL,
  code TEXT NOT NULL UNIQUE,
  name_fa TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 2 CHECK (capacity > 0),
  shape TEXT NOT NULL DEFAULT 'square' CHECK (shape IN ('square', 'round', 'rectangle')),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'occupied', 'reserved', 'waiting_service', 'waiting_payment', 'cleaning', 'unavailable')),
  waiter_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  qr_token TEXT UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_tables_status ON dining_tables (status);
CREATE INDEX idx_tables_floor ON dining_tables (floor_id);
CREATE INDEX idx_tables_qr ON dining_tables (qr_token);

CREATE TABLE table_sessions (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES dining_tables (id) ON DELETE RESTRICT,
  opened_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  guest_count INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  closed_at TEXT
);
-- At most one open session per table
CREATE UNIQUE INDEX ux_table_open_session ON table_sessions (table_id) WHERE status = 'open';

CREATE TABLE table_merge_members (
  session_id TEXT NOT NULL REFERENCES table_sessions (id) ON DELETE CASCADE,
  table_id TEXT NOT NULL REFERENCES dining_tables (id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, table_id)
);

CREATE TABLE floorplans (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL UNIQUE REFERENCES floors (id) ON DELETE CASCADE,
  width INTEGER NOT NULL DEFAULT 1600,
  height INTEGER NOT NULL DEFAULT 1000,
  grid_size INTEGER NOT NULL DEFAULT 20,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE floorplan_versions (
  id TEXT PRIMARY KEY,
  floorplan_id TEXT NOT NULL REFERENCES floorplans (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  UNIQUE (floorplan_id, version)
);

CREATE TABLE floorplan_objects (
  id TEXT PRIMARY KEY,
  floorplan_id TEXT NOT NULL REFERENCES floorplans (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  ref_table_id TEXT REFERENCES dining_tables (id) ON DELETE SET NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 100,
  height REAL NOT NULL DEFAULT 100,
  rotation REAL NOT NULL DEFAULT 0,
  z_index INTEGER NOT NULL DEFAULT 0,
  layer TEXT NOT NULL DEFAULT 'default',
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  props_json TEXT
);
CREATE INDEX idx_floorplan_objects_plan ON floorplan_objects (floorplan_id);

CREATE TABLE chairs (
  id TEXT PRIMARY KEY,
  floorplan_object_id TEXT REFERENCES floorplan_objects (id) ON DELETE CASCADE,
  table_id TEXT REFERENCES dining_tables (id) ON DELETE CASCADE,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  rotation REAL NOT NULL DEFAULT 0,
  label TEXT
);

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  employee_code TEXT UNIQUE,
  department_id TEXT REFERENCES departments (id) ON DELETE SET NULL,
  floor_id TEXT REFERENCES floors (id) ON DELETE SET NULL,
  position_fa TEXT,
  hired_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_leave', 'inactive')),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

-- ================================ catalog ==================================

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name_fa TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  name_fa TEXT NOT NULL,
  search_key TEXT NOT NULL,
  description_fa TEXT,
  sku TEXT UNIQUE,
  base_price INTEGER NOT NULL CHECK (base_price >= 0),
  department_id TEXT REFERENCES departments (id) ON DELETE SET NULL,
  image_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  prep_minutes INTEGER NOT NULL DEFAULT 10,
  dietary_json TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_products_category ON products (category_id);
CREATE INDEX idx_products_active ON products (is_active, is_archived);
CREATE INDEX idx_products_search ON products (search_key);

CREATE TABLE product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  name_fa TEXT NOT NULL,
  price_delta INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);
CREATE INDEX idx_variants_product ON product_variants (product_id);

CREATE TABLE option_groups (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  name_fa TEXT NOT NULL,
  min_select INTEGER NOT NULL DEFAULT 0,
  max_select INTEGER NOT NULL DEFAULT 1,
  is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_option_groups_product ON option_groups (product_id);

CREATE TABLE product_options (
  id TEXT PRIMARY KEY,
  option_group_id TEXT NOT NULL REFERENCES option_groups (id) ON DELETE CASCADE,
  name_fa TEXT NOT NULL,
  price_delta INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE extras (
  id TEXT PRIMARY KEY,
  name_fa TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE product_extras (
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  extra_id TEXT NOT NULL REFERENCES extras (id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, extra_id)
);

CREATE TABLE product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE availability_windows (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  weekday INTEGER CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);
CREATE INDEX idx_availability_product ON availability_windows (product_id);

-- ============================ QR codes & discounts =========================

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name_fa TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percent', 'fixed')),
  value INTEGER NOT NULL CHECK (value > 0),
  scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'products', 'categories')),
  starts_at TEXT,
  ends_at TEXT,
  max_uses INTEGER,
  max_uses_per_device INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE campaign_targets (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('product', 'category')),
  target_id TEXT NOT NULL,
  PRIMARY KEY (campaign_id, target_type, target_id)
);

CREATE TABLE qr_codes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('table', 'promo')),
  token TEXT NOT NULL UNIQUE,
  table_id TEXT REFERENCES dining_tables (id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES campaigns (id) ON DELETE CASCADE,
  label TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  CHECK (
    (kind = 'table' AND table_id IS NOT NULL AND campaign_id IS NULL) OR
    (kind = 'promo' AND campaign_id IS NOT NULL AND table_id IS NULL)
  )
);
CREATE INDEX idx_qr_codes_token ON qr_codes (token);

CREATE TABLE customer_devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  first_seen_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  last_seen_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

-- ================================= orders ==================================

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  table_id TEXT REFERENCES dining_tables (id) ON DELETE SET NULL,
  table_session_id TEXT REFERENCES table_sessions (id) ON DELETE SET NULL,
  guest_device_id TEXT REFERENCES customer_devices (id) ON DELETE SET NULL,
  waiter_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'awaiting_confirmation', 'confirmed', 'preparing',
                      'partially_ready', 'ready', 'served', 'awaiting_payment', 'paid', 'cancelled')),
  source TEXT NOT NULL DEFAULT 'qr' CHECK (source IN ('qr', 'waiter', 'cashier', 'admin')),
  subtotal INTEGER NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total INTEGER NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  service_charge INTEGER NOT NULL DEFAULT 0 CHECK (service_charge >= 0),
  tax_total INTEGER NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  paid_total INTEGER NOT NULL DEFAULT 0 CHECK (paid_total >= 0),
  note TEXT,
  cancel_reason TEXT,
  client_request_id TEXT,
  created_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  cancelled_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  submitted_at TEXT,
  served_at TEXT,
  paid_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC);
CREATE INDEX idx_orders_table_status ON orders (table_id, status);
CREATE INDEX idx_orders_created ON orders (created_at DESC);
CREATE UNIQUE INDEX ux_orders_idempotency ON orders (guest_device_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products (id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL,
  unit_price_snapshot INTEGER NOT NULL CHECK (unit_price_snapshot >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  options_json TEXT,
  extras_json TEXT,
  note TEXT,
  department_id TEXT REFERENCES departments (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'preparing', 'ready', 'served', 'cancelled')),
  total INTEGER NOT NULL CHECK (total >= 0),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_order_items_order ON order_items (order_id);
CREATE INDEX idx_order_items_department ON order_items (department_id, status);

CREATE TABLE order_item_options (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL REFERENCES order_items (id) ON DELETE CASCADE,
  option_id TEXT REFERENCES product_options (id) ON DELETE SET NULL,
  name_snapshot TEXT NOT NULL,
  price_snapshot INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE prep_tasks (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL UNIQUE REFERENCES order_items (id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  department_id TEXT REFERENCES departments (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'in_progress', 'ready', 'delayed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  target_minutes INTEGER NOT NULL DEFAULT 10,
  started_at TEXT,
  ready_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_prep_tasks_department_status ON prep_tasks (department_id, status, created_at);

CREATE TABLE order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_order_events_order ON order_events (order_id, created_at);

-- ================================ payments =================================

CREATE TABLE cash_registers (
  id TEXT PRIMARY KEY,
  name_fa TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  table_session_id TEXT REFERENCES table_sessions (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'void')),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  paid_total INTEGER NOT NULL DEFAULT 0 CHECK (paid_total >= 0),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  settled_at TEXT
);
CREATE INDEX idx_bills_order ON bills (order_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  bill_id TEXT REFERENCES bills (id) ON DELETE SET NULL,
  order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'online', 'wallet', 'other')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'failed', 'refunded')),
  received_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  cash_register_id TEXT REFERENCES cash_registers (id) ON DELETE SET NULL,
  reference TEXT,
  paid_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_payments_order ON payments (order_id);
CREATE INDEX idx_payments_paid_at ON payments (paid_at DESC);

CREATE TABLE bill_splits (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  is_paid INTEGER NOT NULL DEFAULT 0 CHECK (is_paid IN (0, 1))
);

CREATE TABLE terminal_requests (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders (id) ON DELETE CASCADE,
  table_id TEXT REFERENCES dining_tables (id) ON DELETE SET NULL,
  requested_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'completed', 'cancelled')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  completed_at TEXT
);
CREATE INDEX idx_terminal_requests_status ON terminal_requests (status, created_at);

-- ================================= service =================================

CREATE TABLE customer_requests (
  id TEXT PRIMARY KEY,
  table_id TEXT REFERENCES dining_tables (id) ON DELETE SET NULL,
  order_id TEXT REFERENCES orders (id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('waiter', 'water', 'tissues', 'bill', 'terminal', 'assistance', 'custom')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'done', 'cancelled')),
  created_by_device_id TEXT REFERENCES customer_devices (id) ON DELETE SET NULL,
  handled_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  resolved_at TEXT
);
CREATE INDEX idx_customer_requests_table_status ON customer_requests (table_id, status);
CREATE INDEX idx_customer_requests_status ON customer_requests (status, created_at);

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  guest_count INTEGER NOT NULL CHECK (guest_count > 0),
  reserved_for TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 90,
  table_id TEXT REFERENCES dining_tables (id) ON DELETE SET NULL,
  area_id TEXT REFERENCES areas (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'seated', 'cancelled', 'no_show')),
  note TEXT,
  created_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  decided_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_reservations_time ON reservations (reserved_for);
CREATE INDEX idx_reservations_table ON reservations (table_id, reserved_for);

-- ============================ notifications ================================

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  role_key TEXT,
  type TEXT NOT NULL,
  title_fa TEXT NOT NULL,
  body_fa TEXT,
  data_json TEXT,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_notifications_user ON notifications (user_id, is_read, created_at DESC);

CREATE TABLE notification_templates (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('inapp', 'sms', 'push')),
  title_fa TEXT NOT NULL,
  body_fa TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('inapp', 'sms', 'push')),
  template_key TEXT,
  recipient TEXT,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  scheduled_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  sent_at TEXT
);
CREATE INDEX idx_outbox_status ON notification_outbox (status, scheduled_at);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

-- ================================ printing =================================

CREATE TABLE printers (
  id TEXT PRIMARY KEY,
  name_fa TEXT NOT NULL,
  department_id TEXT REFERENCES departments (id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('receipt', 'kitchen', 'barista', 'other')),
  connection TEXT NOT NULL DEFAULT 'bridge' CHECK (connection IN ('tcp', 'usb', 'bridge')),
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE print_jobs (
  id TEXT PRIMARY KEY,
  printer_id TEXT REFERENCES printers (id) ON DELETE SET NULL,
  order_id TEXT REFERENCES orders (id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  job_key TEXT NOT NULL UNIQUE,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'printed', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  printed_at TEXT
);
CREATE INDEX idx_print_jobs_status ON print_jobs (status, created_at);

-- ============================= configuration ===============================

CREATE TABLE settings (
  id TEXT PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  restaurant_name_fa TEXT NOT NULL DEFAULT 'کافه‌فلو',
  currency TEXT NOT NULL DEFAULT 'IRR',
  digit_mode TEXT NOT NULL DEFAULT 'fa' CHECK (digit_mode IN ('fa', 'latin')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Tehran',
  locale TEXT NOT NULL DEFAULT 'fa-IR',
  service_charge_percent INTEGER NOT NULL DEFAULT 0 CHECK (service_charge_percent BETWEEN 0 AND 30),
  tax_percent INTEGER NOT NULL DEFAULT 0 CHECK (tax_percent BETWEEN 0 AND 30),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE module_settings (
  key TEXT PRIMARY KEY,
  is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
  updated_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

-- ===================== optional: inventory (module OFF) ====================

CREATE TABLE measurement_units (
  id TEXT PRIMARY KEY,
  name_fa TEXT NOT NULL,
  symbol TEXT NOT NULL
);

CREATE TABLE ingredients (
  id TEXT PRIMARY KEY,
  name_fa TEXT NOT NULL,
  unit_id TEXT REFERENCES measurement_units (id) ON DELETE SET NULL,
  current_qty REAL NOT NULL DEFAULT 0,
  min_qty REAL NOT NULL DEFAULT 0,
  cost_per_unit INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_ingredients_low_stock ON ingredients (is_active);

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL UNIQUE REFERENCES products (id) ON DELETE CASCADE,
  yield_qty REAL NOT NULL DEFAULT 1,
  note TEXT
);

CREATE TABLE recipe_items (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  ingredient_id TEXT NOT NULL REFERENCES ingredients (id) ON DELETE RESTRICT,
  qty REAL NOT NULL CHECK (qty > 0)
);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name_fa TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  supplier_id TEXT REFERENCES suppliers (id) ON DELETE SET NULL,
  invoice_no TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  purchased_at TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
  ingredient_id TEXT NOT NULL REFERENCES ingredients (id) ON DELETE RESTRICT,
  qty REAL NOT NULL CHECK (qty > 0),
  unit_cost INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  ingredient_id TEXT NOT NULL REFERENCES ingredients (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('purchase', 'sale_deduction', 'adjustment', 'waste', 'restore')),
  qty REAL NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  ref_type TEXT,
  ref_id TEXT,
  note TEXT,
  created_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_stock_movements_ingredient ON stock_movements (ingredient_id, created_at DESC);

CREATE TABLE waste_records (
  id TEXT PRIMARY KEY,
  ingredient_id TEXT NOT NULL REFERENCES ingredients (id) ON DELETE CASCADE,
  qty REAL NOT NULL CHECK (qty > 0),
  reason TEXT,
  recorded_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

-- ======================= optional: finance (module OFF) ====================

CREATE TABLE financial_transactions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('revenue', 'expense', 'correction', 'transfer')),
  amount INTEGER NOT NULL,
  method TEXT,
  cash_register_id TEXT REFERENCES cash_registers (id) ON DELETE SET NULL,
  order_id TEXT REFERENCES orders (id) ON DELETE SET NULL,
  payment_id TEXT REFERENCES payments (id) ON DELETE SET NULL,
  reverses_transaction_id TEXT REFERENCES financial_transactions (id) ON DELETE SET NULL,
  description TEXT,
  created_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_fin_tx_created ON financial_transactions (created_at DESC);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  description TEXT,
  spent_at TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE cash_sessions (
  id TEXT PRIMARY KEY,
  cash_register_id TEXT NOT NULL REFERENCES cash_registers (id) ON DELETE CASCADE,
  opened_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  opened_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  opening_float INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT,
  closing_amount INTEGER,
  expected_amount INTEGER,
  difference INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'))
);

-- ========================== optional: CRM (module OFF) =====================

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT NOT NULL,
  birth_date TEXT,
  notes TEXT,
  consent_marketing INTEGER NOT NULL DEFAULT 0 CHECK (consent_marketing IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  deleted_at TEXT
);
CREATE INDEX idx_customers_phone ON customers (phone);

CREATE TABLE loyalty_accounts (
  customer_id TEXT PRIMARY KEY REFERENCES customers (id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'regular' CHECK (tier IN ('regular', 'silver', 'gold', 'vip')),
  wallet_balance INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE loyalty_ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  order_id TEXT REFERENCES orders (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE wallet_ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  order_id TEXT REFERENCES orders (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
