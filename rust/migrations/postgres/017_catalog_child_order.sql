-- Stable order for catalogue child rows. `rowid` does not exist in PostgreSQL,
-- so the manager's chosen order needs an explicit column on both engines.
ALTER TABLE product_extras ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE availability_windows ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
