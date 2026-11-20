-- A guest can add another round from the QR status page. The unique key makes
-- a retried submission (same clientRequestId) add nothing twice.
CREATE TABLE IF NOT EXISTS order_item_rounds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (order_id, client_request_id)
);
