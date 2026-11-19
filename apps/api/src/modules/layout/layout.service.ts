import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateFloorInput,
  CreateLayoutTableInput,
  LayoutFloorDto,
  LayoutFloorKind,
  LayoutObject,
  LayoutObjectProps,
  LayoutTableDto,
  LayoutTableShape,
  LayoutVersionDto,
  LayoutResponse,
  SaveFloorplanInput,
  UpdateFloorInput,
  UpdateLayoutTableInput,
} from '@cafeflow/shared';
import { LAYOUT_OBJECT_TYPES, TABLE_SHAPES } from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';
import { badRequest, conflict, notFound } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { LayoutRepository, type ObjectRow, type TableRow } from './layout.repository';

export interface ActingUser {
  userId: string;
  username: string;
}

const DEFAULT_PLAN = { width: 1600, height: 1000, gridSize: 20 };
const VERSION_KEEP = 25;

function parseProps(raw: string | null): LayoutObjectProps {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return value as LayoutObjectProps;
  } catch {
    return {};
  }
}

function normalizeBase(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Business rules for the floor-plan designer and its table/QR side. */
@Injectable()
export class LayoutService {
  constructor(
    @Inject(LayoutRepository) private readonly repository: LayoutRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DB_SERVICE) private readonly database: DatabaseService,
  ) {}

  /* --------------------------------- read ---------------------------------- */

  overview(): LayoutResponse {
    const floors = this.repository.listFloors();
    const areas = this.repository.listAreas();
    const tables = this.repository.listTables();

    return {
      floors: floors.map((floor) => {
        const plan = this.ensurePlan(floor.id);
        const floorAreas = areas
          .filter((area) => area.floor_id === floor.id)
          .map((area) => ({ id: area.id, nameFa: area.name_fa, isActive: area.is_active === 1 }));
        const floorTables = tables
          .filter((table) => table.floor_id === floor.id)
          .map((table) => this.mapTable(table));

        return {
          id: floor.id,
          nameFa: floor.name_fa,
          kind: (floor.kind || 'indoor') as LayoutFloorKind,
          sortOrder: floor.sort_order,
          isActive: floor.is_active === 1,
          areas: floorAreas,
          plan: {
            width: plan.width,
            height: plan.height,
            gridSize: plan.grid_size,
            objects: this.repository.listObjects(plan.id).map((row) => this.mapObject(row)),
          },
          tables: floorTables,
        } satisfies LayoutFloorDto;
      }),
      waiters: this.repository.listAssignableStaff().map((staff) => ({ id: staff.id, fullName: staff.full_name })),
    };
  }

  versions(floorId: string): { items: LayoutVersionDto[] } {
    const plan = this.requirePlan(floorId);
    return {
      items: this.repository.listVersions(plan.id).map((row) => ({
        id: row.id,
        version: row.version,
        createdAt: row.created_at,
        createdByName: row.created_by_name,
        objectCount: this.countSnapshotObjects(row.snapshot_json),
      })),
    };
  }

  /* --------------------------------- floors -------------------------------- */

  createFloor(input: CreateFloorInput, actor: ActingUser): { id: string } {
    const id = randomUUID();
    const sortOrder = input.sortOrder ?? this.repository.listFloors().length;
    this.database.transaction(() => {
      this.repository.insertFloor(id, input.nameFa, input.kind, sortOrder);
      this.repository.insertPlan(randomUUID(), id, DEFAULT_PLAN.width, DEFAULT_PLAN.height, DEFAULT_PLAN.gridSize);
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'layout.floor_created',
      entityType: 'floor',
      entityId: id,
      after: { nameFa: input.nameFa, kind: input.kind },
    });

    return { id };
  }

  updateFloor(floorId: string, input: UpdateFloorInput, actor: ActingUser): { id: string } {
    const floor = this.repository.findFloor(floorId);
    if (!floor) throw notFound('طبقه یافت نشد.', 'FLOOR_NOT_FOUND');

    this.repository.updateFloor(floorId, input);
    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'layout.floor_updated',
      entityType: 'floor',
      entityId: floorId,
      before: { nameFa: floor.name_fa, kind: floor.kind, sortOrder: floor.sort_order, isActive: floor.is_active === 1 },
      after: input,
    });

    return { id: floorId };
  }

  deleteFloor(floorId: string, actor: ActingUser): { id: string } {
    const floor = this.repository.findFloor(floorId);
    if (!floor) throw notFound('طبقه یافت نشد.', 'FLOOR_NOT_FOUND');
    if (this.repository.listFloors().length <= 1) {
      throw conflict('دست‌کم یک طبقه باید باقی بماند.', 'LAST_FLOOR');
    }
    if (this.repository.countTablesOnFloor(floorId) > 0) {
      throw conflict('این طبقه میز دارد؛ ابتدا میزها را جابه‌جا یا حذف کنید.', 'FLOOR_HAS_TABLES');
    }

    this.repository.deleteFloor(floorId);
    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'layout.floor_deleted',
      entityType: 'floor',
      entityId: floorId,
      before: { nameFa: floor.name_fa },
    });

    return { id: floorId };
  }

  /* --------------------------------- areas --------------------------------- */

  createArea(floorId: string, nameFa: string, actor: ActingUser): { id: string } {
    const floor = this.repository.findFloor(floorId);
    if (!floor) throw notFound('طبقه یافت نشد.', 'FLOOR_NOT_FOUND');

    const id = randomUUID();
    this.repository.insertArea(id, floorId, nameFa);
    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'layout.area_created',
      entityType: 'area',
      entityId: id,
      after: { floorId, nameFa },
    });

    return { id };
  }

  updateArea(areaId: string, input: { nameFa?: string; isActive?: boolean }, actor: ActingUser): { id: string } {
    const area = this.repository.findArea(areaId);
    if (!area) throw notFound('بخش یافت نشد.', 'AREA_NOT_FOUND');

    this.repository.updateArea(areaId, input);
    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'layout.area_updated',
      entityType: 'area',
      entityId: areaId,
      before: { nameFa: area.name_fa, isActive: area.is_active === 1 },
      after: input,
    });

    return { id: areaId };
  }

  deleteArea(areaId: string, actor: ActingUser): { id: string } {
    const area = this.repository.findArea(areaId);
    if (!area) throw notFound('بخش یافت نشد.', 'AREA_NOT_FOUND');

    this.repository.deleteArea(areaId);
    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'layout.area_deleted',
      entityType: 'area',
      entityId: areaId,
      before: { nameFa: area.name_fa, floorId: area.floor_id },
    });

    return { id: areaId };
  }

  /* ---------------------------------- plan --------------------------------- */

  savePlan(floorId: string, input: SaveFloorplanInput, actor: ActingUser): { savedAt: string; version: number | null } {
    const plan = this.requirePlan(floorId);
    this.assertObjectsBelongToFloor(floorId, input.objects);

    const objects = input.objects.map((object) => ({
      ...object,
      tableId: object.tableId ?? null,
      groupId: object.groupId ?? null,
    }));

    const savedAt = new Date().toISOString();
    this.database.transaction(() => {
      this.repository.updatePlan(plan.id, input.width, input.height, input.gridSize);
      this.repository.clearObjects(plan.id);
      objects.forEach((object) =>
        this.repository.insertObject({
          id: object.id,
          planId: plan.id,
          type: object.type,
          tableId: object.tableId,
          x: object.x,
          y: object.y,
          width: object.width,
          height: object.height,
          rotation: object.rotation,
          zIndex: object.zIndex,
          layer: object.layer,
          locked: object.locked,
          groupId: object.groupId,
          propsJson: Object.keys(object.props).length > 0 ? JSON.stringify(object.props) : null,
        }),
      );
    });

    const version = this.snapshot(plan.id, { ...input, objects }, actor.userId);
    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'layout.plan_saved',
      entityType: 'floorplan',
      entityId: plan.id,
      after: { floorId, objectCount: objects.length, version },
    });

    return { savedAt, version };
  }

  restoreVersion(floorId: string, versionId: string, actor: ActingUser): { savedAt: string } {
    const plan = this.requirePlan(floorId);
    const version = this.repository.findVersion(plan.id, versionId);
    if (!version) throw notFound('نسخه یافت نشد.', 'VERSION_NOT_FOUND');

    let snapshot: SaveFloorplanInput;
    try {
      snapshot = JSON.parse(version.snapshot_json) as SaveFloorplanInput;
    } catch {
      throw badRequest('نسخه ذخیره‌شده معتبر نیست.', 'VERSION_CORRUPT');
    }

    this.assertObjectsBelongToFloor(floorId, snapshot.objects);

    this.database.transaction(() => {
      this.repository.updatePlan(plan.id, snapshot.width, snapshot.height, snapshot.gridSize);
      this.repository.clearObjects(plan.id);
      snapshot.objects.forEach((object) =>
        this.repository.insertObject({
          id: object.id,
          planId: plan.id,
          type: object.type,
          tableId: object.tableId ?? null,
          x: object.x,
          y: object.y,
          width: object.width,
          height: object.height,
          rotation: object.rotation,
          zIndex: object.zIndex,
          layer: object.layer,
          locked: object.locked,
          groupId: object.groupId ?? null,
          propsJson: Object.keys(object.props).length > 0 ? JSON.stringify(object.props) : null,
        }),
      );
    });

    this.snapshot(plan.id, snapshot, actor.userId);
    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'layout.version_restored',
      entityType: 'floorplan',
      entityId: plan.id,
      after: { floorId, version: version.version },
    });

    return { savedAt: new Date().toISOString() };
  }

  /* --------------------------------- tables -------------------------------- */

  createTable(input: CreateLayoutTableInput, actor: ActingUser): { id: string; plan: LayoutFloorDto['plan'] } {
    const floor = this.repository.findFloor(input.floorId);
    if (!floor) throw notFound('طبقه یافت نشد.', 'FLOOR_NOT_FOUND');
    this.assertAreaBelongsToFloor(input.areaId ?? null, input.floorId);

    const code = input.code ?? this.nextTableCode();
    if (this.repository.listTableCodes().some((value) => value.toLowerCase() === code.toLowerCase())) {
      throw conflict('این کد میز قبلاً استفاده شده است.', 'TABLE_CODE_EXISTS');
    }

    const plan = this.requirePlan(input.floorId);
    const id = randomUUID();
    const nameFa = input.nameFa ?? `میز ${code.replace(/^T/, '')}`;
    const qrToken = randomUUID().replace(/-/g, '').slice(0, 12);
    const objectId = randomUUID();

    this.database.transaction(() => {
      this.repository.insertTable({
        id,
        floorId: input.floorId,
        areaId: input.areaId ?? null,
        code,
        nameFa,
        capacity: input.capacity,
        shape: input.shape,
        waiterUserId: input.waiterUserId ?? null,
        isActive: input.isActive,
        qrToken,
      });
      this.repository.insertObject({
        id: objectId,
        planId: plan.id,
        type: 'table',
        tableId: id,
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        rotation: input.rotation,
        zIndex: 10,
        layer: 'tables',
        locked: false,
        groupId: null,
        propsJson: null,
      });
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'layout.table_created',
      entityType: 'dining_table',
      entityId: id,
      after: { code, nameFa, capacity: input.capacity, floorId: input.floorId },
    });

    return { id, plan: this.planDto(input.floorId) };
  }

  updateTable(tableId: string, input: UpdateLayoutTableInput, actor: ActingUser): { id: string } {
    const table = this.repository.findTable(tableId);
    if (!table) throw notFound('میز یافت نشد.', 'TABLE_NOT_FOUND');
    if (input.areaId !== undefined) this.assertAreaBelongsToFloor(input.areaId, table.floor_id);
    if (input.code !== undefined) {
      const duplicated = this.repository
        .listTableCodes()
        .some((code) => code.toLowerCase() === input.code?.toLowerCase() && code !== table.code);
      if (duplicated) throw conflict('این کد میز قبلاً استفاده شده است.', 'TABLE_CODE_EXISTS');
    }

    const values = { ...input };
    delete (values as { note?: unknown }).note;

    this.repository.updateTable(tableId, values);
    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'layout.table_updated',
      entityType: 'dining_table',
      entityId: tableId,
      before: {
        code: table.code,
        nameFa: table.name_fa,
        capacity: table.capacity,
        shape: table.shape,
        areaId: table.area_id,
        waiterUserId: table.waiter_user_id,
        isActive: table.is_active === 1,
      },
      after: input,
    });

    return { id: tableId };
  }

  deleteTable(tableId: string, actor: ActingUser): { id: string } {
    const table = this.repository.findTable(tableId);
    if (!table) throw notFound('میز یافت نشد.', 'TABLE_NOT_FOUND');
    if (this.repository.hasOpenSession(tableId)) {
      throw conflict('این میز نشست باز دارد؛ ابتدا میز را ببندید.', 'TABLE_HAS_OPEN_SESSION');
    }

    this.database.transaction(() => {
      this.repository.deleteObjectsForTable(tableId);
      this.repository.softDeleteTable(tableId);
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'layout.table_deleted',
      entityType: 'dining_table',
      entityId: tableId,
      before: { code: table.code, nameFa: table.name_fa },
    });

    return { id: tableId };
  }

  /* ----------------------------------- QR ---------------------------------- */

  tableQr(tableId: string, baseUrl: string | null | undefined) {
    const table = this.repository.findTable(tableId);
    if (!table) throw notFound('میز یافت نشد.', 'TABLE_NOT_FOUND');
    if (!table.qr_token) throw conflict('این میز توکن QR ندارد.', 'TABLE_WITHOUT_QR');

    return {
      tableId: table.id,
      tableNameFa: table.name_fa,
      token: table.qr_token,
      menuUrl: `${this.menuBase(baseUrl)}/menu/${table.qr_token}`,
    };
  }

  regenerateQr(tableId: string, actor: ActingUser) {
    const table = this.repository.findTable(tableId);
    if (!table) throw notFound('میز یافت نشد.', 'TABLE_NOT_FOUND');

    const token = randomUUID().replace(/-/g, '').slice(0, 12);
    this.repository.setQrToken(tableId, token);
    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'layout.qr_regenerated',
      entityType: 'dining_table',
      entityId: tableId,
      before: { token: table.qr_token },
      after: { token },
    });

    return { tableId, token };
  }

  menuBase(baseUrl: string | null | undefined): string {
    return (
      normalizeBase(baseUrl) ??
      normalizeBase(process.env.PUBLIC_APP_URL) ??
      'http://localhost:5173'
    );
  }

  /* -------------------------------- helpers -------------------------------- */

  private mapTable(table: TableRow): LayoutTableDto {
    return {
      id: table.id,
      code: table.code,
      nameFa: table.name_fa,
      capacity: table.capacity,
      shape: (TABLE_SHAPES.includes(table.shape as LayoutTableShape) ? table.shape : 'square') as LayoutTableShape,
      status: table.status,
      areaId: table.area_id,
      waiterUserId: table.waiter_user_id,
      isActive: table.is_active === 1,
      hasQr: Boolean(table.qr_token),
    };
  }

  private mapObject(row: ObjectRow): LayoutObject {
    const type = LAYOUT_OBJECT_TYPES.includes(row.type as LayoutObject['type']) ? row.type : 'other';
    return {
      id: row.id,
      type: type as LayoutObject['type'],
      tableId: row.ref_table_id,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
      zIndex: row.z_index,
      layer: row.layer,
      locked: row.is_locked === 1,
      groupId: row.group_id,
      props: parseProps(row.props_json),
    };
  }

  private planDto(floorId: string): LayoutFloorDto['plan'] {
    const plan = this.requirePlan(floorId);
    return {
      width: plan.width,
      height: plan.height,
      gridSize: plan.grid_size,
      objects: this.repository.listObjects(plan.id).map((row) => this.mapObject(row)),
    };
  }

  /**
   * A floor always has a plan. The first time a plan is created, tables that
   * have no position yet are laid out on a simple grid so the map is never
   * empty on an installation that was seeded before the designer existed.
   */
  private ensurePlan(floorId: string) {
    const existing = this.repository.findPlan(floorId);
    if (existing) return existing;

    const id = randomUUID();
    this.repository.insertPlan(id, floorId, DEFAULT_PLAN.width, DEFAULT_PLAN.height, DEFAULT_PLAN.gridSize);

    const tables = this.repository.listTables().filter((table) => table.floor_id === floorId);
    tables.forEach((table, index) => {
      const round = table.shape === 'round';
      const width = round ? 110 : 130;
      const height = round ? 110 : table.shape === 'rectangle' ? 90 : 110;
      this.repository.insertObject({
        id: randomUUID(),
        planId: id,
        type: 'table',
        tableId: table.id,
        x: 90 + (index % 4) * 220,
        y: 90 + Math.floor(index / 4) * 200,
        width,
        height,
        rotation: 0,
        zIndex: 10,
        layer: 'tables',
        locked: false,
        groupId: null,
        propsJson: null,
      });
    });

    return this.repository.findPlan(floorId) as NonNullable<ReturnType<LayoutRepository['findPlan']>>;
  }

  private requirePlan(floorId: string) {
    const floor = this.repository.findFloor(floorId);
    if (!floor) throw notFound('طبقه یافت نشد.', 'FLOOR_NOT_FOUND');
    return this.ensurePlan(floorId);
  }

  private assertAreaBelongsToFloor(areaId: string | null, floorId: string): void {
    if (!areaId) return;
    const area = this.repository.findArea(areaId);
    if (!area) throw notFound('بخش یافت نشد.', 'AREA_NOT_FOUND');
    if (area.floor_id !== floorId) {
      throw badRequest('بخش انتخاب‌شده به این طبقه تعلق ندارد.', 'AREA_FLOOR_MISMATCH');
    }
  }

  private assertObjectsBelongToFloor(floorId: string, objects: LayoutObject[]): void {
    const tableIds = new Set(
      this.repository
        .listTables()
        .filter((table) => table.floor_id === floorId)
        .map((table) => table.id),
    );

    const seen = new Set<string>();
    for (const object of objects) {
      if (seen.has(object.id)) throw badRequest('شناسه یک شیء تکراری است.', 'DUPLICATE_OBJECT');
      seen.add(object.id);

      if (object.type !== 'table') continue;
      if (!object.tableId || !tableIds.has(object.tableId)) {
        throw badRequest('میز انتخاب‌شده به این طبقه تعلق ندارد.', 'TABLE_FLOOR_MISMATCH');
      }
    }
  }

  private nextTableCode(): string {
    const codes = new Set(this.repository.listTableCodes().map((code) => code.toUpperCase()));
    let index = 1;
    while (codes.has(`T${index}`)) index += 1;
    return `T${index}`;
  }

  private snapshot(planId: string, plan: SaveFloorplanInput, userId: string): number | null {
    const snapshotJson = JSON.stringify(plan);
    const latest = this.repository.listVersions(planId)[0];
    if (latest && latest.snapshot_json === snapshotJson) return latest.version;

    const version = this.repository.nextVersionNumber(planId);
    this.repository.insertVersion(randomUUID(), planId, version, snapshotJson, userId);
    this.repository.pruneVersions(planId, VERSION_KEEP);
    return version;
  }

  private countSnapshotObjects(snapshotJson: string): number {
    try {
      const snapshot = JSON.parse(snapshotJson) as { objects?: unknown[] };
      return Array.isArray(snapshot.objects) ? snapshot.objects.length : 0;
    } catch {
      return 0;
    }
  }
}
