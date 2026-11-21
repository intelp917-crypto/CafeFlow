-- A guest can add another round from the QR status page. The unique key makes
-- a retried submission (same clientRequestId) add nothing twice.
CREATE TABLE IF NOT EXISTS order_item_rounds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  UNIQUE (order_id, client_request_id)
);
