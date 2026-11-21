-- ---------------------------------------------------------------------------
-- Phase 8: floor-plan designer
--
-- The base schema already has floors, areas, floorplans, floorplan_objects and
-- floorplan_versions. This migration adds what the designer needs on top:
--   * a floor kind so indoor / outdoor / kitchen spaces are distinguishable,
--   * grouping for multi-select objects,
--   * free-form plan and object properties (zone colour, chair offsets, …).
-- Existing rows keep working: every new column has a default.
-- ---------------------------------------------------------------------------

ALTER TABLE floors ADD COLUMN kind TEXT NOT NULL DEFAULT 'indoor';

ALTER TABLE floorplans ADD COLUMN props_json TEXT;

ALTER TABLE floorplan_objects ADD COLUMN group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_floorplan_objects_group ON floorplan_objects (floorplan_id, group_id);
