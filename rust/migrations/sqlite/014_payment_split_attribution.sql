-- A cashier can now take each person's share separately. Keeping the split id
-- on the payment makes «این پرداخت مال کدام نفر بود» auditable after the fact;
-- ON DELETE SET NULL keeps old receipts valid when a split is cleared.
ALTER TABLE payments ADD COLUMN bill_split_id TEXT REFERENCES bill_splits (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_split ON payments (bill_split_id);
