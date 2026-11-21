-- One row per order that redeemed a promo QR campaign. The unique order id is
-- what stops a retried submission from charging the campaign twice.
CREATE TABLE IF NOT EXISTS campaign_redemptions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
  device_id TEXT REFERENCES customer_devices (id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX IF NOT EXISTS idx_campaign_redemptions_campaign
  ON campaign_redemptions (campaign_id, device_id);
