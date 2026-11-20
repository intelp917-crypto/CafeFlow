import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@cafeflow/ui';
import { Lock, Maximize2, RotateCw } from 'lucide-react';
import {
  ENTITY_ZONE_LABELS_FA,
  LAYOUT_OBJECT_TYPE_LABELS_FA,
  type EntityZoneKind,
  type LayoutObject,
  type LayoutTableDto,
} from '@cafeflow/shared';
import { ObjectArtwork, STATUS_LABELS_FA } from './artwork';

export { STATUS_LABELS_FA };

export interface PlanModel {
  width: number;
  height: number;
  gridSize: number;
  objects: LayoutObject[];
}

export interface Viewport {
  zoom: number;
  pan: { x: number; y: number };
}

export interface LiveStatus {
  status: string;
  pendingRequests: number;
  openTotal: number;
}

interface LayoutCanvasProps {
  plan: PlanModel;
  tables: LayoutTableDto[];
  selectedIds: string[];
  viewport: Viewport;
  snapEnabled: boolean;
  showGrid: boolean;
  preview: boolean;
  liveStatuses: Map<string, LiveStatus>;
  onSelect: (ids: string[]) => void;
  onChange: (updater: (objects: LayoutObject[]) => LayoutObject[], options?: { history?: boolean }) => void;
  onDragEnd: (startObjects: LayoutObject[]) => void;
  onViewportChange: (viewport: Viewport) => void;
  onDropItem: (itemKey: string, point: { x: number; y: number }) => void;
  onBackgroundClick: () => void;
}

type DragKind = 'move' | 'resize' | 'rotate' | 'pan' | 'chair';

interface DragState {
  kind: DragKind;
  pointerId: number;
  capture?: HTMLElement | null;
  startClient: { x: number; y: number };
  startPan: { x: number; y: number };
  startObjects: LayoutObject[];
  primaryId?: string;
  objectId?: string;
  chairId?: string;
  startWidth?: number;
  startHeight?: number;
  center?: { x: number; y: number };
}

/** Chairs are stored as offsets from the table centre. */
function chairLayout(object: LayoutObject, capacity: number) {
  const seats = Math.max(1, Math.min(capacity, 24));
  const rx = object.width / 2 + 18;
  const ry = object.height / 2 + 18;
  const overrides = object.props.chairs ?? [];

  return Array.from({ length: seats }, (_, index) => {
    const id = `c${index}`;
    const angle = (Math.PI * 2 * index) / seats;
    const stored = overrides.find((chair) => chair.id === id);
    return {
      id,
      dx: stored ? stored.dx : Math.cos(angle) * rx,
      dy: stored ? stored.dy : Math.sin(angle) * ry,
      rotation: stored ? stored.rotation : (angle * 180) / Math.PI + 90,
    };
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(maximum, minimum));
}

export function LayoutCanvas({
  plan,
  tables,
  selectedIds,
  viewport,
  snapEnabled,
  showGrid,
  preview,
  liveStatuses,
  onSelect,
  onChange,
  onDragEnd,
  onViewportChange,
  onDropItem,
  onBackgroundClick,
}: LayoutCanvasProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const tablesById = useMemo(() => new Map(tables.map((table) => [table.id, table])), [tables]);

  const snap = useCallback(
    (value: number) => {
      const step = snapEnabled ? plan.gridSize : 1;
      return Math.round(value / step) * step;
    },
    [plan.gridSize, snapEnabled],
  );

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - viewport.pan.x) / viewport.zoom,
        y: (clientY - rect.top - viewport.pan.y) / viewport.zoom,
      };
    },
    [viewport],
  );

  /* Zooming keeps the point under the cursor fixed. */
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const nextZoom = Math.min(2.5, Math.max(0.25, viewport.zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
      const worldX = (event.clientX - rect.left - viewport.pan.x) / viewport.zoom;
      const worldY = (event.clientY - rect.top - viewport.pan.y) / viewport.zoom;
      onViewportChange({
        zoom: nextZoom,
        pan: {
          x: event.clientX - rect.left - worldX * nextZoom,
          y: event.clientY - rect.top - worldY * nextZoom,
        },
      });
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [onViewportChange, viewport]);

  const beginDrag = (event: React.PointerEvent, state: Omit<DragState, 'pointerId' | 'capture' | 'startClient' | 'startPan' | 'startObjects'>) => {
    const capture = event.currentTarget as HTMLElement | null;
    try {
      capture?.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is best-effort; dragging still works through bubbling.
    }
    dragRef.current = {
      ...state,
      pointerId: event.pointerId,
      capture,
      startClient: { x: event.clientX, y: event.clientY },
      startPan: { ...viewport.pan },
      startObjects: plan.objects.map((object) => ({ ...object })),
    };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = (event.clientX - drag.startClient.x) / viewport.zoom;
    const dy = (event.clientY - drag.startClient.y) / viewport.zoom;

    if (drag.kind === 'pan') {
      onViewportChange({
        zoom: viewport.zoom,
        pan: {
          x: drag.startPan.x + (event.clientX - drag.startClient.x),
          y: drag.startPan.y + (event.clientY - drag.startClient.y),
        },
      });
      return;
    }

    if (drag.kind === 'move' && drag.primaryId) {
      const primary = drag.startObjects.find((object) => object.id === drag.primaryId);
      if (!primary) return;

      // Movement is always derived from the snapshot taken at pointer-down, so
      // repeated pointer-move events cannot accumulate into a runaway jump.
      const movingIds = new Set(selectedIds.includes(drag.primaryId) ? selectedIds : [drag.primaryId]);
      const movable = drag.startObjects.filter((object) => movingIds.has(object.id) && !object.locked);
      if (movable.length === 0) return;

      let minX = -Infinity;
      let maxX = Infinity;
      let minY = -Infinity;
      let maxY = Infinity;
      for (const object of movable) {
        minX = Math.max(minX, -object.x);
        maxX = Math.min(maxX, plan.width - object.width - object.x);
        minY = Math.max(minY, -object.y);
        maxY = Math.min(maxY, plan.height - object.height - object.y);
      }

      const stepX = clamp(snap(dx), minX, maxX);
      const stepY = clamp(snap(dy), minY, maxY);
      if (stepX === 0 && stepY === 0) return;

      const starts = new Map(drag.startObjects.map((object) => [object.id, object]));
      onChange(
        (objects) =>
          objects.map((object) => {
            const start = starts.get(object.id);
            if (!start || !movingIds.has(object.id) || start.locked) return object;
            return { ...object, x: Math.round(start.x + stepX), y: Math.round(start.y + stepY) };
          }),
        { history: false },
      );
      return;
    }

    if (drag.kind === 'resize' && drag.objectId) {
      const width = Math.max(24, snap((drag.startWidth ?? 100) + dx));
      const height = Math.max(24, snap((drag.startHeight ?? 100) + dy));
      onChange(
        (objects) => objects.map((object) => (object.id === drag.objectId ? { ...object, width, height } : object)),
        { history: false },
      );
      return;
    }

    if (drag.kind === 'rotate' && drag.objectId && drag.center) {
      const point = toWorld(event.clientX, event.clientY);
      const angle = (Math.atan2(point.y - drag.center.y, point.x - drag.center.x) * 180) / Math.PI + 90;
      const rotation = snapEnabled ? Math.round(angle / 15) * 15 : Math.round(angle);
      onChange(
        (objects) => objects.map((object) => (object.id === drag.objectId ? { ...object, rotation } : object)),
        { history: false },
      );
      return;
    }

    if (drag.kind === 'chair' && drag.objectId && drag.chairId) {
      const object = plan.objects.find((item) => item.id === drag.objectId);
      if (!object) return;
      const point = toWorld(event.clientX, event.clientY);
      const centerX = object.x + object.width / 2;
      const centerY = object.y + object.height / 2;
      const chairDx = Math.round(point.x - centerX);
      const chairDy = Math.round(point.y - centerY);

      onChange(
        (objects) =>
          objects.map((item) => {
            if (item.id !== drag.objectId) return item;
            const chairs = [...(item.props.chairs ?? [])];
            const index = chairs.findIndex((chair) => chair.id === drag.chairId);
            const entry = { id: drag.chairId as string, dx: chairDx, dy: chairDy, rotation: 0 };
            if (index >= 0) chairs[index] = entry;
            else chairs.push(entry);
            return { ...item, props: { ...item.props, chairs } };
          }),
        { history: false },
      );
    }
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    try {
      if (drag.capture?.hasPointerCapture?.(drag.pointerId)) {
        drag.capture.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // Nothing to release.
    }
    if (drag.kind !== 'pan') onDragEnd(drag.startObjects);
  };

  const onObjectPointerDown = (event: React.PointerEvent, object: LayoutObject) => {
    if (event.button !== 0) return;
    event.stopPropagation();

    if (preview) {
      onSelect([object.id]);
      return;
    }

    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    let nextSelection: string[];
    if (additive) {
      nextSelection = selectedIds.includes(object.id)
        ? selectedIds.filter((id) => id !== object.id)
        : [...selectedIds, object.id];
    } else if (selectedIds.includes(object.id)) {
      nextSelection = selectedIds;
    } else if (object.groupId) {
      nextSelection = plan.objects.filter((item) => item.groupId === object.groupId).map((item) => item.id);
    } else {
      nextSelection = [object.id];
    }

    onSelect(nextSelection);
    if (object.locked) return;

    beginDrag(event, { kind: 'move', primaryId: object.id });
  };

  return (
    <div
      ref={viewportRef}
      className={cn(
        'relative h-full w-full overflow-hidden rounded-[1.35rem] border border-line bg-[#f4ece0]',
        preview ? 'cursor-default' : dragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
      dir="ltr"
      style={{
        backgroundImage:
          'radial-gradient(circle at 20% 20%, rgba(185,95,51,0.05), transparent 55%), radial-gradient(circle at 80% 0%, rgba(150,160,159,0.08), transparent 45%)',
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        onBackgroundClick();
        beginDrag(event, { kind: 'pan' });
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const itemKey = event.dataTransfer.getData('application/x-cafeflow-item');
        if (!itemKey) return;
        const point = toWorld(event.clientX, event.clientY);
        onDropItem(itemKey, { x: snap(point.x), y: snap(point.y) });
      }}
    >
      <div
        className="absolute origin-top-left"
        style={{
          width: plan.width,
          height: plan.height,
          transform: `translate(${viewport.pan.x}px, ${viewport.pan.y}px) scale(${viewport.zoom})`,
          backgroundColor: '#fffcf6',
          boxShadow: '0 30px 80px -50px rgba(41,27,19,0.55)',
        }}
      >
        {showGrid ? (
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0" width={plan.width} height={plan.height}>
            <defs>
              <pattern id="cf-plan-grid" width={plan.gridSize} height={plan.gridSize} patternUnits="userSpaceOnUse">
                <path
                  d={`M ${plan.gridSize} 0 L 0 0 0 ${plan.gridSize}`}
                  fill="none"
                  stroke="#e6dbc9"
                  strokeWidth={0.6}
                />
              </pattern>
            </defs>
            <rect width={plan.width} height={plan.height} fill="url(#cf-plan-grid)" />
          </svg>
        ) : null}

        {plan.objects.map((object) => {
          const selected = selectedIds.includes(object.id);
          const table = object.tableId ? tablesById.get(object.tableId) : undefined;
          const live = table ? liveStatuses.get(table.id) : undefined;
          const label =
            object.props.labelFa ??
            table?.nameFa ??
            (object.props.zoneKind
              ? ENTITY_ZONE_LABELS_FA[object.props.zoneKind as EntityZoneKind] ?? 'محدوده'
              : LAYOUT_OBJECT_TYPE_LABELS_FA[object.type]);

          return (
            <div
              key={object.id}
              role="button"
              tabIndex={0}
              aria-label={label}
              title={object.props.note ? `${label} — ${object.props.note}` : label}
              onPointerDown={(event) => onObjectPointerDown(event, object)}
              onPointerMove={(event) => {
                event.stopPropagation();
                handlePointerMove(event);
              }}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect([object.id]);
                }
              }}
              className={cn(
                'absolute select-none outline-none focus-visible:ring-2 focus-visible:ring-brand-500/70',
                !preview && (object.locked ? 'cursor-not-allowed' : 'cursor-move'),
              )}
              style={{
                left: object.x,
                top: object.y,
                width: object.width,
                height: object.height,
                transform: `rotate(${object.rotation}deg)`,
                zIndex: object.zIndex,
                touchAction: 'none',
              }}
            >
              <ObjectArtwork
                object={object}
                table={table}
                liveStatus={live?.status}
                preview={preview}
                label={label}
                selected={selected}
              />

              {object.locked ? (
                <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded-full bg-surface/90 px-1 py-0.5 text-[8px] text-muted shadow-sm">
                  <Lock aria-hidden="true" size={8} />
                </span>
              ) : null}

              {preview && live && live.pendingRequests > 0 ? (
                <span className="absolute -right-2 -top-2 flex size-4 items-center justify-center rounded-full bg-danger-500 text-[8px] font-bold text-white shadow-sm">
                  {live.pendingRequests}
                </span>
              ) : null}

              {object.type === 'table' && table
                ? chairLayout(object, table.capacity).map((chair, index) => (
                    <div
                      key={chair.id}
                      role="button"
                      tabIndex={-1}
                      aria-label={`صندلی ${index + 1}`}
                      onPointerDown={(event) => {
                        if (preview) return;
                        event.stopPropagation();
                        beginDrag(event, { kind: 'chair', objectId: object.id, chairId: chair.id });
                      }}
                      onPointerMove={(event) => {
                        event.stopPropagation();
                        handlePointerMove(event);
                      }}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      className={cn('absolute overflow-hidden rounded-[7px]', !preview && 'cursor-grab active:cursor-grabbing')}
                      style={{
                        width: 22,
                        height: 22,
                        left: object.width / 2 + chair.dx - 11,
                        top: object.height / 2 + chair.dy - 11,
                        transform: `rotate(${chair.rotation}deg)`,
                        touchAction: 'none',
                        background: 'linear-gradient(180deg, #f6ebd9 0%, #e7d3b7 100%)',
                        border: '1.5px solid #cdbda7',
                        boxShadow: '0 1px 2px rgba(41,27,19,0.18)',
                      }}
                    >
                      <span aria-hidden="true" className="absolute inset-x-1 top-[3px] h-[3px] rounded-full bg-sec-300/80" />
                    </div>
                  ))
                : null}

              {selected && !preview && !object.locked ? (
                <>
                  <div
                    role="button"
                    tabIndex={-1}
                    aria-label="چرخش المان"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      beginDrag(event, {
                        kind: 'rotate',
                        objectId: object.id,
                        center: { x: object.x + object.width / 2, y: object.y + object.height / 2 },
                      });
                    }}
                    onPointerMove={(event) => {
                      event.stopPropagation();
                      handlePointerMove(event);
                    }}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    className="absolute -top-8 left-1/2 flex size-6 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border border-brand-500 bg-surface text-brand-600 shadow-sm active:cursor-grabbing"
                    style={{ touchAction: 'none' }}
                  >
                    <RotateCw aria-hidden="true" size={11} />
                  </div>
                  <div
                    role="button"
                    tabIndex={-1}
                    aria-label="تغییر اندازه"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      beginDrag(event, {
                        kind: 'resize',
                        objectId: object.id,
                        startWidth: object.width,
                        startHeight: object.height,
                      });
                    }}
                    onPointerMove={(event) => {
                      event.stopPropagation();
                      handlePointerMove(event);
                    }}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    className="absolute -bottom-2.5 -right-2.5 flex size-6 cursor-nwse-resize items-center justify-center rounded-lg border border-brand-500 bg-surface text-brand-600 shadow-sm"
                    style={{ touchAction: 'none' }}
                  >
                    <Maximize2 aria-hidden="true" size={11} />
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-espresso/85 px-3 py-1 text-[10px] text-cream/80">
        {preview ? 'نمای زنده' : `${Math.round(viewport.zoom * 100)}٪`} — {plan.objects.length} المان
      </div>
      {!preview ? (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-espresso/85 px-3 py-1 text-[10px] text-cream/80">
برای جابه‌جایی بکشید · Shift برای انتخاب چندگانه · کلیدهای جهت‌دار ۱ پیکسل (با Shift ۱۰ پیکسل)
        </div>
      ) : null}
    </div>
  );
}
