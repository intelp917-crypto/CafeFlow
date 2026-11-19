import { useCallback, useEffect, useMemo, useRef } from 'react';
import { cn } from '@cafeflow/ui';
import {
  ENTITY_ZONE_LABELS_FA,
  LAYOUT_OBJECT_TYPE_LABELS_FA,
  type EntityZoneKind,
  type LayoutObject,
  type LayoutTableDto,
} from '@cafeflow/shared';
import { findLibraryItem } from './catalog';

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

const STATUS_FILL: Record<string, string> = {
  available: '#eef6ec',
  occupied: '#fcefe5',
  reserved: '#eaf1f4',
  waiting_service: '#fbf2df',
  waiting_payment: '#fbf2df',
  cleaning: '#f0e9dc',
  unavailable: '#f6f0e6',
};

const STATUS_STROKE: Record<string, string> = {
  available: '#3f7a45',
  occupied: '#b95f33',
  reserved: '#2c5a6b',
  waiting_service: '#9a6c12',
  waiting_payment: '#9a6c12',
  cleaning: '#9c8b76',
  unavailable: '#7b6a5b',
};

export const STATUS_LABELS_FA: Record<string, string> = {
  available: 'آزاد',
  occupied: 'اشغال',
  reserved: 'رزرو',
  waiting_service: 'در انتظار سرویس',
  waiting_payment: 'در انتظار پرداخت',
  cleaning: 'نظافت',
  unavailable: 'غیرفعال',
};

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

  const beginDrag = (event: React.PointerEvent, state: Omit<DragState, 'pointerId' | 'startClient' | 'startPan' | 'startObjects'>) => {
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = {
      ...state,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startPan: { ...viewport.pan },
      startObjects: plan.objects.map((object) => ({ ...object })),
    };
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = (event.clientX - drag.startClient.x) / viewport.zoom;
    const dy = (event.clientY - drag.startClient.y) / viewport.zoom;

    if (drag.kind === 'pan') {
      onViewportChange({ zoom: viewport.zoom, pan: { x: drag.startPan.x + (event.clientX - drag.startClient.x), y: drag.startPan.y + (event.clientY - drag.startClient.y) } });
      return;
    }

    if (drag.kind === 'move' && drag.primaryId) {
      const primary = drag.startObjects.find((object) => object.id === drag.primaryId);
      if (!primary) return;
      const nextX = snap(primary.x + dx);
      const nextY = snap(primary.y + dy);
      const offsetX = nextX - primary.x;
      const offsetY = nextY - primary.y;
      const movingIds = new Set(
        selectedIds.includes(drag.primaryId) ? selectedIds : [drag.primaryId],
      );

      onChange(
        (objects) =>
          objects.map((object) => {
            if (!movingIds.has(object.id) || object.locked) return object;
            return { ...object, x: Math.round(object.x + offsetX), y: Math.round(object.y + offsetY) };
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
        preview ? 'cursor-default' : 'cursor-grab',
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
          const shape = table?.shape ?? 'square';
          const label =
            object.props.labelFa ??
            table?.nameFa ??
            (object.props.zoneKind
              ? ENTITY_ZONE_LABELS_FA[object.props.zoneKind as EntityZoneKind] ?? 'محدوده'
              : LAYOUT_OBJECT_TYPE_LABELS_FA[object.type]);
          const isZone = object.type === 'zone';
          const isTable = object.type === 'table';
          const fill = isTable && preview ? STATUS_FILL[live?.status ?? 'available'] : isZone ? `${object.props.color ?? '#cdbda7'}55` : object.props.color ?? '#f0e9dc';
          const stroke = isTable && preview ? STATUS_STROKE[live?.status ?? 'available'] : isZone ? object.props.color ?? '#9c8b76' : '#b99e84';

          return (
            <div
              key={object.id}
              role="button"
              tabIndex={0}
              aria-label={label}
              onPointerDown={(event) => onObjectPointerDown(event, object)}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect([object.id]);
              }}
              className={cn('absolute select-none', !preview && (object.locked ? 'cursor-not-allowed' : 'cursor-move'))}
              style={{
                left: object.x,
                top: object.y,
                width: object.width,
                height: object.height,
                transform: `rotate(${object.rotation}deg)`,
                zIndex: object.zIndex,
                backgroundColor: isZone ? fill : undefined,
                borderStyle: isZone ? 'dashed' : 'solid',
              }}
            >
              <div
                className={cn(
                  'relative flex h-full w-full flex-col items-center justify-center overflow-hidden px-1 text-center',
                  isZone ? 'rounded-md' : 'rounded-lg',
                  isTable && shape === 'round' && 'rounded-full',
                  selected ? 'ring-2 ring-brand-500 ring-offset-2' : '',
                )}
                style={{
                  backgroundColor: isZone ? 'transparent' : fill,
                  border: `${isZone ? 2 : 1.5}px ${isZone ? 'dashed' : 'solid'} ${stroke}`,
                  borderRadius: shape === 'round' && !isZone ? '9999px' : undefined,
                  color: isTable && preview ? stroke : '#291b13',
                }}
              >
                <span className="max-w-full truncate text-[11px] font-semibold leading-4">{label}</span>
                {isTable ? (
                  <span className="num text-[9px] leading-3 opacity-70">
                    {table ? `${table.capacity} نفر` : ''}
                    {preview && live ? ` · ${STATUS_LABELS_FA[live.status] ?? live.status}` : ''}
                  </span>
                ) : null}
                {!isTable && object.props.note ? (
                  <span className="max-w-full truncate text-[8px] leading-3 opacity-70">{object.props.note}</span>
                ) : null}
                {object.locked ? <span className="absolute left-1 top-1 text-[8px] opacity-60">🔒</span> : null}
                {preview && live && live.pendingRequests > 0 ? (
                  <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-danger-500 text-[8px] font-bold text-white">
                    {live.pendingRequests}
                  </span>
                ) : null}
              </div>

              {isTable && table
                ? chairLayout(object, table.capacity).map((chair) => (
                    <div
                      key={chair.id}
                      onPointerDown={(event) => {
                        if (preview) return;
                        event.stopPropagation();
                        beginDrag(event, { kind: 'chair', objectId: object.id, chairId: chair.id });
                      }}
                      onPointerMove={handlePointerMove}
                      onPointerUp={endDrag}
                      className={cn(
                        'absolute rounded-[4px] border border-sec-300 bg-sec-100',
                        !preview && 'cursor-grab hover:border-brand-400',
                      )}
                      style={{
                        width: 20,
                        height: 20,
                        left: object.width / 2 + chair.dx - 10,
                        top: object.height / 2 + chair.dy - 10,
                        transform: `rotate(${chair.rotation}deg)`,
                      }}
                    />
                  ))
                : null}

              {selected && !preview && !object.locked ? (
                <>
                  <div
                    role="button"
                    tabIndex={-1}
                    aria-label="چرخش"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      beginDrag(event, {
                        kind: 'rotate',
                        objectId: object.id,
                        center: { x: object.x + object.width / 2, y: object.y + object.height / 2 },
                      });
                    }}
                    onPointerMove={handlePointerMove}
                    onPointerUp={endDrag}
                    className="absolute -top-7 left-1/2 size-4 -translate-x-1/2 cursor-grab rounded-full border-2 border-brand-500 bg-surface"
                  />
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
                    onPointerMove={handlePointerMove}
                    onPointerUp={endDrag}
                    className="absolute -bottom-2 -right-2 size-4 cursor-nwse-resize rounded-sm border-2 border-brand-500 bg-surface"
                  />
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-espresso/85 px-3 py-1 text-[10px] text-cream/80">
        {preview ? 'نمای زنده' : `${Math.round(viewport.zoom * 100)}٪`} — {plan.objects.length} المان
      </div>
    </div>
  );
}
