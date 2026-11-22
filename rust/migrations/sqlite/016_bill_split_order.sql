-- Shares need a database-independent order. SQLite's rowid does not exist in
-- PostgreSQL, and sorting by a Persian label puts «سهم ۱۰» before «سهم ۲»,
-- which could mark the wrong person's share as paid.
ALTER TABLE bill_splits ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
