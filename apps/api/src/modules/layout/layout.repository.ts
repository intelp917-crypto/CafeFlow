import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

export interface FloorRow {
  id: string;
  name_fa: string;
  kind: string;
  sort_order: number;
  is_active: number;
}

export interface AreaRow {
  id: string;
  floor_id: string;
  name_fa: string;
  sort_order: number;
  is_active: number;
}

export interface PlanRow {
  id: string;
  floor_id: string;
  width: number;
  height: number;
  grid_size: number;
}

export interface ObjectRow {
  id: string;
  floorplan_id: string;
  type: string;
  ref_table_id: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  layer: string;
  is_locked: number;
  group_id: string | null;
  props_json: string | null;
}

export interface TableRow {
  id: string;
  floor_id: string;
  area_id: string | null;
  code: string;
  name_fa: string;
  capacity: number;
  shape: string;
  status: string;
  waiter_user_id: string | null;
  qr_token: string | null;
  is_active: number;
}

export interface VersionRow {
  id: string;
  floorplan_id: string;
  version: number;
  snapshot_json: string;
  created_by: string | null;
  created_at: string;
}

/** SQL for the floor-plan designer. Every statement is parameterised. */
@Injectable()
export class LayoutRepository {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  /* --------------------------------- floors -------------------------------- */

  listFloors(): FloorRow[] {
    return this.database.all<FloorRow>(
      `SELECT id, name_fa, kind, sort_order, is_active FROM floors ORDER BY sort_order, name_fa`,
    );
  }

  findFloor(id: string): FloorRow | undefined {
    return this.database.get<FloorRow>(
      `SELECT id, name_fa, kind, sort_order, is_active FROM floors WHERE id = ?`,
      [id],
    );
  }

  insertFloor(id: string, nameFa: string, kind: string, sortOrder: number): void {
    this.database.run(`INSERT INTO floors (id, name_fa, kind, sort_order) VALUES (?, ?, ?, ?)`, [
      id,
      nameFa,
      kind,
      sortOrder,
    ]);
  }

  updateFloor(id: string, values: { nameFa?: string; kind?: string; sortOrder?: number; isActive?: boolean }): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (values.nameFa !== undefined) {
      sets.push('name_fa = ?');
      params.push(values.nameFa);
    }
    if (values.kind !== undefined) {
      sets.push('kind = ?');
      params.push(values.kind);
    }
    if (values.sortOrder !== undefined) {
      sets.push('sort_order = ?');
      params.push(values.sortOrder);
    }
    if (values.isActive !== undefined) {
      sets.push('is_active = ?');
      params.push(values.isActive ? 1 : 0);
    }
    if (sets.length === 0) return;
    params.push(id);
    this.database.run(`UPDATE floors SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  deleteFloor(id: string): void {
    this.database.run(`DELETE FROM floors WHERE id = ?`, [id]);
  }

  countTablesOnFloor(floorId: string): number {
    return this.database.count(
      `SELECT COUNT(*) AS n FROM dining_tables WHERE floor_id = ? AND deleted_at IS NULL`,
      [floorId],
    );
  }

  /* --------------------------------- areas --------------------------------- */

  listAreas(): AreaRow[] {
    return this.database.all<AreaRow>(
      `SELECT id, floor_id, name_fa, sort_order, is_active FROM areas ORDER BY sort_order, name_fa`,
    );
  }

  findArea(id: string): AreaRow | undefined {
    return this.database.get<AreaRow>(`SELECT * FROM areas WHERE id = ?`, [id]);
  }

  insertArea(id: string, floorId: string, nameFa: string): void {
    const next = this.database.get<{ n: number }>(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM areas WHERE floor_id = ?`,
      [floorId],
    );
    this.database.run(`INSERT INTO areas (id, floor_id, name_fa, sort_order) VALUES (?, ?, ?, ?)`, [
      id,
      floorId,
      nameFa,
      next?.n ?? 1,
    ]);
  }

  updateArea(id: string, values: { nameFa?: string; isActive?: boolean }): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (values.nameFa !== undefined) {
      sets.push('name_fa = ?');
      params.push(values.nameFa);
    }
    if (values.isActive !== undefined) {
      sets.push('is_active = ?');
      params.push(values.isActive ? 1 : 0);
    }
    if (sets.length === 0) return;
    params.push(id);
    this.database.run(`UPDATE areas SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  deleteArea(id: string): void {
    this.database.run(`DELETE FROM areas WHERE id = ?`, [id]);
  }

  /* ------------------------------- floorplans ------------------------------ */

  findPlan(floorId: string): PlanRow | undefined {
    return this.database.get<PlanRow>(
      `SELECT id, floor_id, width, height, grid_size FROM floorplans WHERE floor_id = ?`,
      [floorId],
    );
  }

  insertPlan(id: string, floorId: string, width: number, height: number, gridSize: number): void {
    this.database.run(
      `INSERT INTO floorplans (id, floor_id, width, height, grid_size) VALUES (?, ?, ?, ?, ?)`,
      [id, floorId, width, height, gridSize],
    );
  }

  updatePlan(planId: string, width: number, height: number, gridSize: number): void {
    this.database.run(
      `UPDATE floorplans SET width = ?, height = ?, grid_size = ?, updated_at = ? WHERE id = ?`,
      [width, height, gridSize, new Date().toISOString(), planId],
    );
  }

  listObjects(planId: string): ObjectRow[] {
    return this.database.all<ObjectRow>(
      `SELECT * FROM floorplan_objects WHERE floorplan_id = ? ORDER BY z_index, id`,
      [planId],
    );
  }

  clearObjects(planId: string): void {
    this.database.run(`DELETE FROM floorplan_objects WHERE floorplan_id = ?`, [planId]);
  }

  insertObject(row: {
    id: string;
    planId: string;
    type: string;
    tableId: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    zIndex: number;
    layer: string;
    locked: boolean;
    groupId: string | null;
    propsJson: string | null;
  }): void {
    this.database.run(
      `INSERT INTO floorplan_objects
        (id, floorplan_id, type, ref_table_id, x, y, width, height, rotation, z_index, layer, is_locked, group_id, props_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.planId,
        row.type,
        row.tableId,
        row.x,
        row.y,
        row.width,
        row.height,
        row.rotation,
        row.zIndex,
        row.layer,
        row.locked ? 1 : 0,
        row.groupId,
        row.propsJson,
      ],
    );
  }

  deleteObjectsForTable(tableId: string): void {
    this.database.run(`DELETE FROM floorplan_objects WHERE ref_table_id = ?`, [tableId]);
  }

  /* --------------------------------- tables -------------------------------- */

  listTables(): TableRow[] {
    return this.database.all<TableRow>(
      `SELECT id, floor_id, area_id, code, name_fa, capacity, shape, status, waiter_user_id, qr_token, is_active
         FROM dining_tables WHERE deleted_at IS NULL ORDER BY code`,
    );
  }

  findTable(id: string): TableRow | undefined {
    return this.database.get<TableRow>(
      `SELECT id, floor_id, area_id, code, name_fa, capacity, shape, status, waiter_user_id, qr_token, is_active
         FROM dining_tables WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  listTableCodes(): string[] {
    return this.database
      .all<{ code: string }>(`SELECT code FROM dining_tables`)
      .map((row) => row.code);
  }

  insertTable(row: {
    id: string;
    floorId: string;
    areaId: string | null;
    code: string;
    nameFa: string;
    capacity: number;
    shape: string;
    waiterUserId: string | null;
    isActive: boolean;
    qrToken: string;
  }): void {
    this.database.run(
      `INSERT INTO dining_tables
        (id, floor_id, area_id, code, name_fa, capacity, shape, status, waiter_user_id, qr_token, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?)`,
      [
        row.id,
        row.floorId,
        row.areaId,
        row.code,
        row.nameFa,
        row.capacity,
        row.shape,
        row.waiterUserId,
        row.qrToken,
        row.isActive ? 1 : 0,
      ],
    );
    this.database.run(
      `INSERT INTO qr_codes (id, kind, token, table_id, label, is_active) VALUES (?, 'table', ?, ?, ?, 1)`,
      [row.id, row.qrToken, row.id, row.nameFa],
    );
  }

  updateTable(
    id: string,
    values: {
      nameFa?: string;
      code?: string;
      capacity?: number;
      shape?: string;
      areaId?: string | null;
      waiterUserId?: string | null;
      isActive?: boolean;
    },
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (values.nameFa !== undefined) {
      sets.push('name_fa = ?');
      params.push(values.nameFa);
    }
    if (values.code !== undefined) {
      sets.push('code = ?');
      params.push(values.code);
    }
    if (values.capacity !== undefined) {
      sets.push('capacity = ?');
      params.push(values.capacity);
    }
    if (values.shape !== undefined) {
      sets.push('shape = ?');
      params.push(values.shape);
    }
    if (values.areaId !== undefined) {
      sets.push('area_id = ?');
      params.push(values.areaId);
    }
    if (values.waiterUserId !== undefined) {
      sets.push('waiter_user_id = ?');
      params.push(values.waiterUserId);
    }
    if (values.isActive !== undefined) {
      sets.push('is_active = ?');
      params.push(values.isActive ? 1 : 0);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    params.push(new Date().toISOString(), id);
    this.database.run(`UPDATE dining_tables SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  softDeleteTable(id: string): void {
    this.database.run(`UPDATE dining_tables SET deleted_at = ?, is_active = 0 WHERE id = ?`, [
      new Date().toISOString(),
      id,
    ]);
  }

  hasOpenSession(tableId: string): boolean {
    return (
      this.database.count(
        `SELECT COUNT(*) AS n FROM table_sessions WHERE table_id = ? AND status = 'open'`,
        [tableId],
      ) > 0
    );
  }

  setQrToken(tableId: string, token: string): void {
    this.database.transaction(() => {
      this.database.run(`UPDATE dining_tables SET qr_token = ?, updated_at = ? WHERE id = ?`, [
        token,
        new Date().toISOString(),
        tableId,
      ]);
      this.database.run(`UPDATE qr_codes SET is_active = 0 WHERE table_id = ?`, [tableId]);
      this.database.run(
        `INSERT INTO qr_codes (id, kind, token, table_id, label, is_active)
         SELECT ?, 'table', ?, ?, name_fa, 1 FROM dining_tables WHERE id = ?`,
        [randomUUID(), token, tableId, tableId],
      );
    });
  }

  /* -------------------------------- versions ------------------------------- */

  listVersions(planId: string): Array<VersionRow & { created_by_name: string | null }> {
    return this.database.all<VersionRow & { created_by_name: string | null }>(
      `SELECT v.*, u.full_name AS created_by_name
         FROM floorplan_versions v
         LEFT JOIN users u ON u.id = v.created_by
        WHERE v.floorplan_id = ?
        ORDER BY v.version DESC
        LIMIT 25`,
      [planId],
    );
  }

  nextVersionNumber(planId: string): number {
    const row = this.database.get<{ n: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS n FROM floorplan_versions WHERE floorplan_id = ?`,
      [planId],
    );
    return row?.n ?? 1;
  }

  insertVersion(id: string, planId: string, version: number, snapshotJson: string, userId: string | null): void {
    this.database.run(
      `INSERT INTO floorplan_versions (id, floorplan_id, version, snapshot_json, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [id, planId, version, snapshotJson, userId],
    );
  }

  pruneVersions(planId: string, keep: number): void {
    this.database.run(
      `DELETE FROM floorplan_versions
        WHERE floorplan_id = ?
          AND id NOT IN (
            SELECT id FROM floorplan_versions WHERE floorplan_id = ? ORDER BY version DESC LIMIT ?
          )`,
      [planId, planId, keep],
    );
  }

  findVersion(planId: string, versionId: string): VersionRow | undefined {
    return this.database.get<VersionRow>(
      `SELECT * FROM floorplan_versions WHERE id = ? AND floorplan_id = ?`,
      [versionId, planId],
    );
  }

  /* ------------------------------- waiters --------------------------------- */

  listAssignableStaff(): Array<{ id: string; full_name: string }> {
    return this.database.all<{ id: string; full_name: string }>(
      `SELECT DISTINCT u.id, u.full_name
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
        WHERE u.deleted_at IS NULL AND u.is_active = 1
          AND r.key IN ('waiter', 'manager', 'super_admin')
        ORDER BY u.full_name`,
    );
  }
}
