-- SQLite stores every floating-point column as REAL. PostgreSQL's REAL is
-- float4, which the Rust `f64` decoder refuses to read (and silently rounds
-- measurements to single precision). Use the same 64-bit type on both
-- dialects so floor-plan coordinates, ingredient quantities and recipe
-- amounts round-trip without loss.
ALTER TABLE floorplan_objects ALTER COLUMN x TYPE DOUBLE PRECISION;
ALTER TABLE floorplan_objects ALTER COLUMN y TYPE DOUBLE PRECISION;
ALTER TABLE floorplan_objects ALTER COLUMN width TYPE DOUBLE PRECISION;
ALTER TABLE floorplan_objects ALTER COLUMN height TYPE DOUBLE PRECISION;
ALTER TABLE floorplan_objects ALTER COLUMN rotation TYPE DOUBLE PRECISION;

ALTER TABLE chairs ALTER COLUMN x TYPE DOUBLE PRECISION;
ALTER TABLE chairs ALTER COLUMN y TYPE DOUBLE PRECISION;
ALTER TABLE chairs ALTER COLUMN rotation TYPE DOUBLE PRECISION;

ALTER TABLE ingredients ALTER COLUMN current_qty TYPE DOUBLE PRECISION;
ALTER TABLE ingredients ALTER COLUMN min_qty TYPE DOUBLE PRECISION;

ALTER TABLE recipes ALTER COLUMN yield_qty TYPE DOUBLE PRECISION;
ALTER TABLE recipe_items ALTER COLUMN qty TYPE DOUBLE PRECISION;
ALTER TABLE purchase_items ALTER COLUMN qty TYPE DOUBLE PRECISION;
ALTER TABLE stock_movements ALTER COLUMN qty TYPE DOUBLE PRECISION;
ALTER TABLE waste_records ALTER COLUMN qty TYPE DOUBLE PRECISION;

ALTER TABLE settings ALTER COLUMN latitude TYPE DOUBLE PRECISION;
ALTER TABLE settings ALTER COLUMN longitude TYPE DOUBLE PRECISION;
