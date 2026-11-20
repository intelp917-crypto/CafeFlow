-- The guest's status link is protected by a bearer token that is stored only as
-- a hash. Orders created before this migration keep a NULL hash and stay
-- readable by code, so printed receipts and old links do not break.
ALTER TABLE orders ADD COLUMN status_token_hash TEXT;
