import { useEffect, useState } from 'react';
import { Modal, cn } from '@cafeflow/ui';
import {
  ENTITY_ZONE_LABELS_FA,
  LAYOUT_FLOOR_KIND_LABELS_FA,
  LAYOUT_OBJECT_TYPE_LABELS_FA,
  TABLE_SHAPE_LABELS_FA,
  TABLE_SHAPES,
  type EntityZoneKind,
  type LayoutFloorDto,
  type LayoutObject,
  type LayoutObjectProps,
  type LayoutTableDto,
  type LayoutTableShape,
  type LayoutVersionDto,
} from '@cafeflow/shared';
import type { UpdateLayoutTableInput } from '@cafeflow/shared';
import { EQUIPMENT_LIBRARY, TABLE_LIBRARY, ZONE_LIBRARY, type LibraryItem } from './catalog';
import type { PlanModel } from './LayoutCanvas';

const inputClass =
  'h-9 w-full rounded-xl border border-line bg-surface px-2.5 text-xs text-ink placeholder:text-muted/70 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-500/10';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted first:mt-0">{children}</p>;
}

function objectLabel(object: LayoutObject, tables: LayoutTableDto[]): string {
  if (object.props.labelFa) return object.props.labelFa;
  const table = object.tableId ? tables.find((item) => item.id === object.tableId) : undefined;
  if (table) return table.nameFa;
  if (object.props.zoneKind) {
    return ENTITY_ZONE_LABELS_FA[object.props.zoneKind as EntityZoneKind] ?? 'محدوده';
  }
  return LAYOUT_OBJECT_TYPE_LABELS_FA[object.type];
}

/* ------------------------------- library ---------------------------------- */

function LibraryGroup({
  title,
  items,
  onAdd,
}: {
  title: string;
  items: LibraryItem[];
  onAdd: (key: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-muted">{title}</p>
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            draggable
            onDragStart={(event) => event.dataTransfer.setData('application/x-cafeflow-item', item.key)}
            onClick={() => onAdd(item.key)}
            className="flex h-16 cursor-grab flex-col items-center justify-center gap-1 rounded-xl border border-line bg-surface px-1 text-[10px] text-ink transition hover:border-brand-300 hover:bg-brand-50/50 active:cursor-grabbing"
          >
            <span
              className={cn('border border-sec-300 bg-sec-100', item.type === 'table' ? 'size-5' : 'h-4 w-7')}
              style={{
                borderRadius: item.type === 'table' ? (item.shape === 'round' ? '9999px' : '4px') : '2px',
                backgroundColor: item.color ?? '#f0e9dc',
                borderColor: item.color ?? '#cdbda7',
              }}
            />
            <span className="text-center leading-3">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function LibraryPanel({ onAdd, disabled }: { onAdd: (key: string) => void; disabled: boolean }) {
  return (
    <aside className="flex h-full flex-col gap-4 overflow-y-auto rounded-[1.35rem] border border-line bg-canvas/60 p-3">
      <div>
        <p className="font-display text-sm font-bold text-ink">کتابخانه ابزارها</p>
        <p className="text-[10px] leading-4 text-muted">بکشید و روی بوم رها کنید، یا کلیک کنید تا در مرکز بوم اضافه شود.</p>
      </div>
      <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
        <LibraryGroup title="میزها" items={TABLE_LIBRARY} onAdd={onAdd} />
        <LibraryGroup title="تجهیزات و فضاها" items={EQUIPMENT_LIBRARY} onAdd={onAdd} />
        <LibraryGroup title="محدوده‌ها" items={ZONE_LIBRARY} onAdd={onAdd} />
      </fieldset>
    </aside>
  );
}

/* ------------------------------- inspector -------------------------------- */

interface InspectorProps {
  plan: PlanModel;
  floor: LayoutFloorDto;
  tables: LayoutTableDto[];
  waiters: Array<{ id: string; fullName: string }>;
  selected: LayoutObject[];
  canWrite: boolean;
  onSelect: (ids: string[]) => void;
  onPatchObject: (id: string, patch: Partial<LayoutObject>) => void;
  onPatchProps: (id: string, props: Partial<LayoutObjectProps>) => void;
  onPatchTable: (id: string, patch: UpdateLayoutTableInput) => void;
  onDeleteSelected: () => void;
  onDeleteTable: (id: string) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onDuplicate: () => void;
  onReorder: (id: string, direction: 'up' | 'down') => void;
  onOpenQr: (tableId: string) => void;
  onOpenFloor: () => void;
}

export function InspectorPanel({
  plan,
  floor,
  tables,
  waiters,
  selected,
  canWrite,
  onSelect,
  onPatchObject,
  onPatchProps,
  onPatchTable,
  onDeleteSelected,
  onDeleteTable,
  onGroup,
  onUngroup,
  onDuplicate,
  onReorder,
  onOpenQr,
  onOpenFloor,
}: InspectorProps) {
  const single = selected.length === 1 ? selected[0] : null;
  const table = single?.tableId ? tables.find((item) => item.id === single.tableId) ?? null : null;
  const layers = [...plan.objects].sort((a, b) => b.zIndex - a.zIndex);

  return (
    <aside className="flex h-full flex-col gap-3 overflow-y-auto rounded-[1.35rem] border border-line bg-canvas/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-sm font-bold text-ink">
            {selected.length === 0 ? 'تنظیمات طبقه' : selected.length === 1 ? 'تنظیمات المان' : `${selected.length} المان انتخاب شده`}
          </p>
          <p className="text-[10px] text-muted">{floor.nameFa}</p>
        </div>
        <button
          type="button"
          onClick={onOpenFloor}
          className="rounded-full border border-line px-2 py-1 text-[10px] text-muted hover:border-brand-300 hover:text-brand-700"
        >
          طبقه
        </button>
      </div>

      {selected.length === 0 ? (
        <div className="space-y-2 rounded-xl border border-line bg-surface p-3 text-[11px] text-muted">
          <div className="flex justify-between">
            <span>نوع فضا</span>
            <span className="text-ink">{LAYOUT_FLOOR_KIND_LABELS_FA[floor.kind]}</span>
          </div>
          <div className="flex justify-between">
            <span>ابعاد پلان</span>
            <span className="num text-ink">
              {plan.width} × {plan.height}
            </span>
          </div>
          <div className="flex justify-between">
            <span>میزها</span>
            <span className="num text-ink">{tables.length}</span>
          </div>
          <div className="flex justify-between">
            <span>بخش‌ها</span>
            <span className="text-ink">{floor.areas.length > 0 ? floor.areas.map((area) => area.nameFa).join('، ') : 'تعریف نشده'}</span>
          </div>
          <p className="border-t border-line pt-2 leading-5">
            برای ویرایش، یک المان را روی بوم انتخاب کنید. با Shift چند المان را هم‌زمان انتخاب کنید.
          </p>
        </div>
      ) : null}

      {selected.length > 1 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={onGroup} className="rounded-full border border-line px-2.5 py-1 text-[10px] hover:border-brand-300">
              گروه‌بندی
            </button>
            <button type="button" onClick={onUngroup} className="rounded-full border border-line px-2.5 py-1 text-[10px] hover:border-brand-300">
              حذف گروه
            </button>
            <button type="button" onClick={onDuplicate} className="rounded-full border border-line px-2.5 py-1 text-[10px] hover:border-brand-300">
              تکرار
            </button>
            <button
              type="button"
              onClick={onDeleteSelected}
              className="rounded-full border border-danger-200 bg-danger-50 px-2.5 py-1 text-[10px] text-danger-700"
            >
              حذف
            </button>
          </div>
        </div>
      ) : null}

      {single && canWrite ? (
        <div className="space-y-2">
          {table ? (
            <>
              <SectionTitle>میز</SectionTitle>
              <Field label="نام میز">
                <input
                  className={inputClass}
                  value={table.nameFa}
                  onChange={(event) => onPatchTable(table.id, { nameFa: event.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="کد">
                  <input
                    className={inputClass}
                    value={table.code}
                    onChange={(event) => onPatchTable(table.id, { code: event.target.value })}
                  />
                </Field>
                <Field label="تعداد صندلی">
                  <input
                    type="number"
                    min={1}
                    max={60}
                    className={inputClass}
                    value={table.capacity}
                    onChange={(event) => onPatchTable(table.id, { capacity: Number(event.target.value) || 1 })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="شکل میز">
                  <select
                    className={inputClass}
                    value={table.shape}
                    onChange={(event) => onPatchTable(table.id, { shape: event.target.value as LayoutTableShape })}
                  >
                    {TABLE_SHAPES.map((shape) => (
                      <option key={shape} value={shape}>
                        {TABLE_SHAPE_LABELS_FA[shape]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="بخش / ناحیه">
                  <select
                    className={inputClass}
                    value={table.areaId ?? ''}
                    onChange={(event) => onPatchTable(table.id, { areaId: event.target.value || null })}
                  >
                    <option value="">بدون بخش</option>
                    {floor.areas.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.nameFa}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="ویتر مسئول">
                <select
                  className={inputClass}
                  value={table.waiterUserId ?? ''}
                  onChange={(event) => onPatchTable(table.id, { waiterUserId: event.target.value || null })}
                >
                  <option value="">تعیین نشده</option>
                  {waiters.map((waiter) => (
                    <option key={waiter.id} value={waiter.id}>
                      {waiter.fullName}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2 text-[11px]">
                <span>میز فعال باشد</span>
                <input
                  type="checkbox"
                  checked={table.isActive}
                  onChange={(event) => onPatchTable(table.id, { isActive: event.target.checked })}
                  className="size-4 accent-[#b95f33]"
                />
              </label>
              <button
                type="button"
                onClick={() => onOpenQr(table.id)}
                className="w-full rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
              >
                QR اختصاصی میز
              </button>
            </>
          ) : null}

          <SectionTitle>ظاهر و ابعاد</SectionTitle>
          <Field label="برچسب">
            <input
              className={inputClass}
              value={single.props.labelFa ?? ''}
              placeholder={objectLabel(single, tables)}
              onChange={(event) => onPatchProps(single.id, { labelFa: event.target.value })}
            />
          </Field>
          {single.type === 'zone' ? (
            <Field label="نوع محدوده">
              <select
                className={inputClass}
                value={single.props.zoneKind ?? ''}
                onChange={(event) => onPatchProps(single.id, { zoneKind: event.target.value || undefined })}
              >
                <option value="">عمومی</option>
                {Object.entries(ENTITY_ZONE_LABELS_FA).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Field label="عرض">
              <input
                type="number"
                className={inputClass}
                value={Math.round(single.width)}
                onChange={(event) => onPatchObject(single.id, { width: Math.max(20, Number(event.target.value) || 20) })}
              />
            </Field>
            <Field label="ارتفاع">
              <input
                type="number"
                className={inputClass}
                value={Math.round(single.height)}
                onChange={(event) => onPatchObject(single.id, { height: Math.max(20, Number(event.target.value) || 20) })}
              />
            </Field>
            <Field label="چرخش (درجه)">
              <input
                type="number"
                className={inputClass}
                value={Math.round(single.rotation)}
                onChange={(event) => onPatchObject(single.id, { rotation: Number(event.target.value) || 0 })}
              />
            </Field>
            <Field label="رنگ">
              <input
                type="color"
                className="h-9 w-full cursor-pointer rounded-xl border border-line bg-surface px-1"
                value={single.props.color ?? '#cdbda7'}
                onChange={(event) => onPatchProps(single.id, { color: event.target.value })}
              />
            </Field>
          </div>
          <Field label="یادداشت / محدوده اختصاصی">
            <input
              className={inputClass}
              value={single.props.note ?? ''}
              onChange={(event) => onPatchProps(single.id, { note: event.target.value })}
            />
          </Field>

          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => onPatchObject(single.id, { locked: !single.locked })}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[10px]',
                single.locked ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line text-muted',
              )}
            >
              {single.locked ? 'قفل است' : 'قفل المان'}
            </button>
            <button type="button" onClick={() => onReorder(single.id, 'up')} className="rounded-full border border-line px-2.5 py-1 text-[10px]">
              لایه بالاتر
            </button>
            <button type="button" onClick={() => onReorder(single.id, 'down')} className="rounded-full border border-line px-2.5 py-1 text-[10px]">
              لایه پایین‌تر
            </button>
            <button type="button" onClick={onDuplicate} className="rounded-full border border-line px-2.5 py-1 text-[10px]">
              تکرار
            </button>
            {table ? (
              <button
                type="button"
                onClick={() => onDeleteTable(table.id)}
                className="rounded-full border border-danger-200 bg-danger-50 px-2.5 py-1 text-[10px] text-danger-700"
              >
                حذف میز
              </button>
            ) : (
              <button
                type="button"
                onClick={onDeleteSelected}
                className="rounded-full border border-danger-200 bg-danger-50 px-2.5 py-1 text-[10px] text-danger-700"
              >
                حذف المان
              </button>
            )}
          </div>
        </div>
      ) : null}

      <SectionTitle>لایه‌ها</SectionTitle>
      <div className="space-y-1">
        {layers.length === 0 ? <p className="text-[10px] text-muted">هنوز المانی روی بوم نیست.</p> : null}
        {layers.map((layer) => {
          const isSelected = selected.some((item) => item.id === layer.id);
          return (
            <div
              key={layer.id}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px]',
                isSelected ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line bg-surface text-muted',
              )}
            >
              <button type="button" className="min-w-0 flex-1 truncate text-start" onClick={() => onSelect([layer.id])}>
                {objectLabel(layer, tables)}
              </button>
              <button
                type="button"
                aria-label="قفل"
                onClick={() => onPatchObject(layer.id, { locked: !layer.locked })}
                className={cn('rounded px-1', layer.locked ? 'text-brand-700' : 'text-muted/60 hover:text-ink')}
              >
                {layer.locked ? 'قفل' : 'باز'}
              </button>
              <button type="button" aria-label="بالا" onClick={() => onReorder(layer.id, 'up')} className="px-1 hover:text-ink">
                ↑
              </button>
              <button type="button" aria-label="پایین" onClick={() => onReorder(layer.id, 'down')} className="px-1 hover:text-ink">
                ↓
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/* --------------------------------- modals ---------------------------------- */

export function FloorModal({
  open,
  onClose,
  floor,
  canWrite,
  plan,
  onSave,
  onDelete,
  onAddArea,
  onDeleteArea,
  onPlanSize,
  error,
}: {
  open: boolean;
  onClose: () => void;
  floor: LayoutFloorDto | null;
  canWrite: boolean;
  plan: PlanModel;
  onSave: (values: { nameFa: string; kind: LayoutFloorDto['kind']; width: number; height: number; gridSize: number }) => void;
  onDelete: () => void;
  onAddArea: (nameFa: string) => void;
  onDeleteArea: (areaId: string) => void;
  onPlanSize: (values: { width: number; height: number; gridSize: number }) => void;
  error: string | null;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LayoutFloorDto['kind']>('indoor');
  const [width, setWidth] = useState(1600);
  const [height, setHeight] = useState(1000);
  const [gridSize, setGridSize] = useState(20);
  const [areaName, setAreaName] = useState('');

  useEffect(() => {
    if (!floor) return;
    setName(floor.nameFa);
    setKind(floor.kind);
    setWidth(plan.width);
    setHeight(plan.height);
    setGridSize(plan.gridSize);
    setAreaName('');
  }, [floor, open, plan.width, plan.height, plan.gridSize]);

  return (
    <Modal open={open} onClose={onClose} title="تنظیمات طبقه" description="نام، نوع فضا، ابعاد بوم و بخش‌های همین طبقه.">
      <div className="space-y-3">
        <Field label="نام طبقه">
          <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="نوع فضا">
          <select className={inputClass} value={kind} onChange={(event) => setKind(event.target.value as LayoutFloorDto['kind'])}>
            {Object.entries(LAYOUT_FLOOR_KIND_LABELS_FA).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="عرض بوم">
            <input type="number" className={inputClass} value={width} onChange={(event) => setWidth(Number(event.target.value) || 400)} />
          </Field>
          <Field label="ارتفاع بوم">
            <input type="number" className={inputClass} value={height} onChange={(event) => setHeight(Number(event.target.value) || 300)} />
          </Field>
          <Field label="شبکه">
            <input type="number" className={inputClass} value={gridSize} onChange={(event) => setGridSize(Number(event.target.value) || 4)} />
          </Field>
        </div>
        {canWrite ? (
          <button
            type="button"
            className="w-full rounded-full bg-brand-500 px-3 py-2 text-xs font-medium text-cream hover:bg-brand-600"
            onClick={() => onSave({ nameFa: name.trim(), kind, width, height, gridSize })}
          >
            ذخیره تنظیمات طبقه
          </button>
        ) : null}

        <div className="rounded-xl border border-line bg-canvas/60 p-3">
          <p className="mb-2 text-[10px] font-semibold text-muted">بخش‌های این طبقه</p>
          <div className="space-y-1">
            {(floor?.areas ?? []).length === 0 ? <p className="text-[10px] text-muted">بخشی تعریف نشده است.</p> : null}
            {(floor?.areas ?? []).map((area) => (
              <div key={area.id} className="flex items-center justify-between rounded-lg bg-surface px-2 py-1 text-[11px]">
                <span>{area.nameFa}</span>
                {canWrite ? (
                  <button type="button" className="text-[10px] text-danger-600" onClick={() => onDeleteArea(area.id)}>
                    حذف
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {canWrite ? (
            <div className="mt-2 flex gap-1.5">
              <input
                className={inputClass}
                placeholder="نام بخش"
                value={areaName}
                onChange={(event) => setAreaName(event.target.value)}
              />
              <button
                type="button"
                className="shrink-0 rounded-full border border-line px-3 text-xs hover:border-brand-300"
                onClick={() => {
                  if (!areaName.trim()) return;
                  onAddArea(areaName.trim());
                  setAreaName('');
                }}
              >
                افزودن
              </button>
            </div>
          ) : null}
        </div>

        {error ? <p className="text-[11px] text-danger-600">{error}</p> : null}

        {canWrite ? (
          <div className="flex items-center justify-between border-t border-line pt-2">
            <button type="button" className="text-[11px] text-danger-600 hover:underline" onClick={onDelete}>
              حذف طبقه
            </button>
            <button type="button" className="text-[11px] text-muted hover:text-ink" onClick={() => onPlanSize({ width, height, gridSize })}>
              اعمال ابعاد بوم
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export function VersionsModal({
  open,
  onClose,
  versions,
  loading,
  onRestore,
  canWrite,
}: {
  open: boolean;
  onClose: () => void;
  versions: LayoutVersionDto[];
  loading: boolean;
  onRestore: (versionId: string) => void;
  canWrite: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title="تاریخچه تغییرات" description="۲۵ نسخه آخر این طبقه؛ بازگردانی یک نسخه، نسخه تازه می‌سازد.">
      {loading ? <p className="text-xs text-muted">در حال بارگذاری…</p> : null}
      {!loading && versions.length === 0 ? <p className="text-xs text-muted">هنوز نسخه‌ای ذخیره نشده است.</p> : null}
      <div className="space-y-1.5">
        {versions.map((version) => (
          <div key={version.id} className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2 text-[11px]">
            <div>
              <p className="font-semibold text-ink">نسخه {version.version}</p>
              <p className="text-[10px] text-muted">
                {new Date(version.createdAt).toLocaleString('fa-IR')} — {version.objectCount} المان
                {version.createdByName ? ` — ${version.createdByName}` : ''}
              </p>
            </div>
            {canWrite ? (
              <button
                type="button"
                onClick={() => onRestore(version.id)}
                className="rounded-full border border-line px-2.5 py-1 text-[10px] hover:border-brand-300 hover:text-brand-700"
              >
                بازگردانی
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function QrModal({
  open,
  onClose,
  table,
  menuUrl,
  imageSrc,
  canWrite,
  onRegenerate,
  onDownloadPng,
  onDownloadSvg,
  onCopy,
  notice,
}: {
  open: boolean;
  onClose: () => void;
  table: LayoutTableDto | null;
  menuUrl: string;
  imageSrc: string;
  canWrite: boolean;
  onRegenerate: () => void;
  onDownloadPng: () => void;
  onDownloadSvg: () => void;
  onCopy: () => void;
  notice: string | null;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={table ? `QR میز ${table.nameFa}` : 'QR میز'}
      description="این کد مشتری را مستقیم به منوی همان میز می‌برد؛ چاپ یا دانلود کنید."
    >
      <div className="space-y-3">
        {imageSrc ? (
          <div className="flex justify-center rounded-2xl border border-line bg-surface p-4">
            <img src={imageSrc} alt="QR میز" className="size-56" />
          </div>
        ) : (
          <p className="text-xs text-muted">در حال ساخت کد…</p>
        )}
        <p dir="ltr" className="select-all break-all rounded-lg bg-canvas px-2 py-1.5 text-center text-[10px] text-muted">
          {menuUrl}
        </p>
        <div className="flex flex-wrap justify-center gap-1.5">
          <button type="button" onClick={onDownloadPng} className="rounded-full border border-line px-3 py-1.5 text-[11px] hover:border-brand-300">
            دانلود PNG
          </button>
          <button type="button" onClick={onDownloadSvg} className="rounded-full border border-line px-3 py-1.5 text-[11px] hover:border-brand-300">
            دانلود SVG
          </button>
          <button type="button" onClick={onCopy} className="rounded-full border border-line px-3 py-1.5 text-[11px] hover:border-brand-300">
            کپی لینک منو
          </button>
          {canWrite ? (
            <button
              type="button"
              onClick={onRegenerate}
              className="rounded-full border border-danger-200 bg-danger-50 px-3 py-1.5 text-[11px] text-danger-700"
            >
              ساخت توکن جدید
            </button>
          ) : null}
        </div>
        {notice ? <p className="text-center text-[11px] text-success-600">{notice}</p> : null}
        <p className="text-[10px] leading-5 text-muted">
          ساخت توکن جدید، کدهای چاپ‌شده قبلی این میز را از کار می‌اندازد. اگر برچسب QR قدیمی روی میز است، باید با کد تازه جایگزین شود.
        </p>
      </div>
    </Modal>
  );
}
