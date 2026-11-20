import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, PageHeader, Spinner, cn } from '@cafeflow/ui';
import { Breadcrumb } from '../lib/branding';
import type {
  CreateLayoutTableInput,
  LayoutFloorDto,
  LayoutObject,
  LayoutObjectProps,
  LayoutResponse,
  LayoutTableDto,
  LayoutVersionDto,
  UpdateLayoutTableInput,
} from '@cafeflow/shared';
import { api, API_BASE, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatCountFa } from '../lib/format';
import type { StaffTablesResponse } from '../lib/types';
import { findLibraryItem } from '../features/floorplan/catalog';
import {
  LayoutCanvas,
  STATUS_LABELS_FA,
  type LiveStatus,
  type PlanModel,
  type Viewport,
} from '../features/floorplan/LayoutCanvas';
import {
  FloorModal,
  InspectorPanel,
  LibraryPanel,
  QrModal,
  VersionsModal,
} from '../features/floorplan/LayoutPanels';

interface ConfirmRequest {
  message: string;
  run: () => void;
}

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `o-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ToggleButton({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'h-8 rounded-full border px-2.5 text-[11px] transition',
        active
          ? 'border-brand-300 bg-brand-50 text-brand-700'
          : 'border-line text-muted hover:border-brand-300 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

export function LayoutPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('layout.write');

  const [data, setData] = useState<LayoutResponse | null>(null);
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanModel | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, pan: { x: 24, y: 24 } });
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [past, setPast] = useState<PlanModel[]>([]);
  const [future, setFuture] = useState<PlanModel[]>([]);

  const [liveStatuses, setLiveStatuses] = useState<Map<string, LiveStatus>>(new Map());

  const [floorModalOpen, setFloorModalOpen] = useState(false);
  const [floorError, setFloorError] = useState<string | null>(null);
  const [newFloorOpen, setNewFloorOpen] = useState(false);
  const [newFloorName, setNewFloorName] = useState('');

  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<LayoutVersionDto[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const [qrTableId, setQrTableId] = useState<string | null>(null);
  const [qrMeta, setQrMeta] = useState<{ menuUrl: string } | null>(null);
  const [qrNotice, setQrNotice] = useState<string | null>(null);

  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const planRef = useRef<PlanModel | null>(null);
  const floorIdRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const pastRef = useRef<PlanModel[]>([]);
  const futureRef = useRef<PlanModel[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const clipboardRef = useRef<LayoutObject[]>([]);
  const importRef = useRef<HTMLInputElement | null>(null);
  const tablePatchRef = useRef<Map<string, { values: UpdateLayoutTableInput; timer: number }>>(new Map());

  const activeFloor = data?.floors.find((floor) => floor.id === activeFloorId) ?? null;

  const applyPlanDirect = useCallback((model: PlanModel) => {
    planRef.current = model;
    setPlan(model);
    dirtyRef.current = false;
    setDirty(false);
    pastRef.current = [];
    futureRef.current = [];
    setPast([]);
    setFuture([]);
  }, []);

  const fit = useCallback((model: PlanModel) => {
    const element = wrapRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const zoom = Math.min((rect.width - 28) / model.width, (rect.height - 28) / model.height, 1.4);
    const safeZoom = Math.max(0.2, zoom);
    setViewport({
      zoom: safeZoom,
      pan: {
        x: (rect.width - model.width * safeZoom) / 2,
        y: (rect.height - model.height * safeZoom) / 2,
      },
    });
  }, []);

  const loadAll = useCallback(async (preferredFloorId?: string) => {
    setLoading(true);
    try {
      const response = await api.get<LayoutResponse>('/layout');
      setData(response);
      const current = preferredFloorId ?? floorIdRef.current;
      const floor = response.floors.find((item) => item.id === current) ?? response.floors[0] ?? null;
      if (floor) {
        floorIdRef.current = floor.id;
        setActiveFloorId(floor.id);
        applyPlanDirect(floor.plan);
        window.requestAnimationFrame(() => fit(floor.plan));
      }
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [applyPlanDirect, fit]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const refreshMeta = useCallback(async () => {
    try {
      const response = await api.get<LayoutResponse>('/layout');
      setData(response);
    } catch {
      // The map keeps working with the data it already has.
    }
  }, []);

  /* --------------------------------- saving -------------------------------- */

  const saveNow = useCallback(async () => {
    const model = planRef.current;
    const floorId = floorIdRef.current;
    if (!model || !floorId || !dirtyRef.current) return;

    const snapshot = JSON.stringify(model);
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api.put<{ savedAt: string }>(`/layout/floors/${floorId}/plan`, model);
      setSavedAt(result.savedAt);
      if (JSON.stringify(planRef.current) === snapshot) {
        dirtyRef.current = false;
        setDirty(false);
      }
    } catch (caught) {
      setSaveError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => void saveNow(), 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, plan, saveNow]);

  const setHistory = (pastStack: PlanModel[], futureStack: PlanModel[]) => {
    pastRef.current = pastStack;
    futureRef.current = futureStack;
    setPast(pastStack);
    setFuture(futureStack);
  };

  const applyPlan = useCallback((updater: (model: PlanModel) => PlanModel, options?: { history?: boolean }) => {
    const current = planRef.current;
    if (!current) return;
    const next = updater(current);
    if (next === current) return;
    if (options?.history !== false) {
      setHistory([...pastRef.current.slice(-49), current], []);
    }
    planRef.current = next;
    setPlan(next);
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  const handleDragEnd = useCallback((startObjects: LayoutObject[]) => {
    const current = planRef.current;
    if (!current) return;
    if (JSON.stringify(startObjects) === JSON.stringify(current.objects)) return;
    setHistory([...pastRef.current.slice(-49), { ...current, objects: startObjects }], []);
  }, []);

  const undo = useCallback(() => {
    const current = planRef.current;
    if (!current || pastRef.current.length === 0) return;
    const previous = pastRef.current[pastRef.current.length - 1];
    setHistory(pastRef.current.slice(0, -1), [current, ...futureRef.current].slice(0, 50));
    planRef.current = previous;
    setPlan(previous);
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    const current = planRef.current;
    if (!current || futureRef.current.length === 0) return;
    const next = futureRef.current[0];
    setHistory([...pastRef.current, current].slice(-50), futureRef.current.slice(1));
    planRef.current = next;
    setPlan(next);
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  /* --------------------------------- tables -------------------------------- */

  const patchTable = useCallback(
    (tableId: string, patch: UpdateLayoutTableInput) => {
      setData((previous) =>
        previous
          ? {
              ...previous,
              floors: previous.floors.map((floor) => ({
                ...floor,
                tables: floor.tables.map((table) =>
                  table.id === tableId
                    ? {
                        ...table,
                        ...(patch.nameFa !== undefined ? { nameFa: patch.nameFa } : {}),
                        ...(patch.code !== undefined ? { code: patch.code } : {}),
                        ...(patch.capacity !== undefined ? { capacity: patch.capacity } : {}),
                        ...(patch.shape !== undefined ? { shape: patch.shape } : {}),
                        ...(patch.areaId !== undefined ? { areaId: patch.areaId } : {}),
                        ...(patch.waiterUserId !== undefined ? { waiterUserId: patch.waiterUserId } : {}),
                        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
                      }
                    : table,
                ),
              })),
            }
          : previous,
      );

      const pending = tablePatchRef.current.get(tableId) ?? { values: {}, timer: 0 };
      if (pending.timer) window.clearTimeout(pending.timer);
      const values: UpdateLayoutTableInput = { ...pending.values, ...patch };
      const timer = window.setTimeout(async () => {
        tablePatchRef.current.delete(tableId);
        try {
          await api.patch(`/layout/tables/${tableId}`, values);
          setNotice('اطلاعات میز ذخیره شد.');
          setError(null);
          await refreshMeta();
        } catch (caught) {
          setError(errorMessage(caught));
          await refreshMeta();
        }
      }, 500);
      tablePatchRef.current.set(tableId, { values, timer });
    },
    [refreshMeta],
  );

  const addItem = useCallback(
    async (itemKey: string, point?: { x: number; y: number }) => {
      const item = findLibraryItem(itemKey);
      const model = planRef.current;
      const floorId = floorIdRef.current;
      if (!item || !model || !floorId) return;

      const center = point ?? { x: model.width / 2, y: model.height / 2 };

      if (item.type === 'table') {
        await saveNow();
        try {
          const created = await api.post<{ id: string; plan: PlanModel }>('/layout/tables', {
            floorId,
            capacity: item.capacity ?? 4,
            shape: item.shape ?? 'square',
            x: Math.max(0, Math.round(center.x - item.width / 2)),
            y: Math.max(0, Math.round(center.y - item.height / 2)),
            width: item.width,
            height: item.height,
            rotation: 0,
            isActive: true,
          } satisfies CreateLayoutTableInput);

          planRef.current = created.plan;
          setPlan(created.plan);
          dirtyRef.current = false;
          setDirty(false);
          await refreshMeta();
          const createdObject = created.plan.objects.find((object) => object.tableId === created.id);
          if (createdObject) setSelectedIds([createdObject.id]);
          setNotice('میز جدید ساخته شد.');
          setError(null);
        } catch (caught) {
          setError(errorMessage(caught));
        }
        return;
      }

      const object: LayoutObject = {
        id: uid(),
        type: item.type,
        tableId: null,
        x: Math.round(center.x - item.width / 2),
        y: Math.round(center.y - item.height / 2),
        width: item.width,
        height: item.height,
        rotation: 0,
        zIndex: item.group === 'zones' ? 1 : 30,
        layer: item.group === 'zones' ? 'zones' : 'equipment',
        locked: false,
        groupId: null,
        props: { color: item.color, zoneKind: item.zoneKind },
      };
      applyPlan((current) => ({ ...current, objects: [...current.objects, object] }));
      setSelectedIds([object.id]);
    },
    [applyPlan, refreshMeta, saveNow],
  );

  const patchObject = useCallback(
    (id: string, patch: Partial<LayoutObject>) => {
      applyPlan((current) => ({
        ...current,
        objects: current.objects.map((object) => (object.id === id ? { ...object, ...patch } : object)),
      }));
    },
    [applyPlan],
  );

  const patchProps = useCallback(
    (id: string, props: Partial<LayoutObjectProps>) => {
      applyPlan((current) => ({
        ...current,
        objects: current.objects.map((object) =>
          object.id === id ? { ...object, props: { ...object.props, ...props } } : object,
        ),
      }));
    },
    [applyPlan],
  );

  const reorder = useCallback(
    (id: string, direction: 'up' | 'down') => {
      applyPlan((current) => {
        const sorted = [...current.objects].sort((a, b) => a.zIndex - b.zIndex);
        const index = sorted.findIndex((object) => object.id === id);
        const target = direction === 'up' ? index + 1 : index - 1;
        if (index < 0 || target < 0 || target >= sorted.length) return current;
        const currentZ = sorted[index].zIndex;
        const targetZ = sorted[target].zIndex;
        return {
          ...current,
          objects: current.objects.map((object) => {
            if (object.id === sorted[index].id) return { ...object, zIndex: targetZ === currentZ ? targetZ + (direction === 'up' ? 1 : -1) : targetZ };
            if (object.id === sorted[target].id) return { ...object, zIndex: currentZ };
            return object;
          }),
        };
      });
    },
    [applyPlan],
  );

  const duplicateSelection = useCallback(() => {
    const current = planRef.current;
    if (!current) return;
    const selected = current.objects.filter((object) => selectedIds.includes(object.id));
    const duplicable = selected.filter((object) => object.type !== 'table');
    if (duplicable.length === 0) {
      setNotice('برای کپی میز از کتابخانه یک میز تازه اضافه کنید؛ هر میز به یک رکورد واقعی وصل است.');
      return;
    }
    const groupMap = new Map<string, string>();
    const copies = duplicable.map((object) => {
      if (object.groupId && !groupMap.has(object.groupId)) groupMap.set(object.groupId, uid());
      return {
        ...object,
        id: uid(),
        x: object.x + 24,
        y: object.y + 24,
        groupId: object.groupId ? (groupMap.get(object.groupId) as string) : null,
        props: { ...object.props },
      } satisfies LayoutObject;
    });

    applyPlan((model) => ({ ...model, objects: [...model.objects, ...copies] }));
    setSelectedIds(copies.map((object) => object.id));
  }, [applyPlan, selectedIds]);

  const groupSelection = useCallback(() => {
    if (selectedIds.length < 2) return;
    const groupId = uid();
    applyPlan((current) => ({
      ...current,
      objects: current.objects.map((object) => (selectedIds.includes(object.id) ? { ...object, groupId } : object)),
    }));
  }, [applyPlan, selectedIds]);

  const ungroupSelection = useCallback(() => {
    applyPlan((current) => ({
      ...current,
      objects: current.objects.map((object) =>
        selectedIds.includes(object.id) ? { ...object, groupId: null } : object,
      ),
    }));
  }, [applyPlan, selectedIds]);

  const deleteSelection = useCallback(() => {
    const current = planRef.current;
    if (!current) return;
    const selected = current.objects.filter((object) => selectedIds.includes(object.id));
    if (selected.some((object) => object.type === 'table')) {
      setNotice('حذف میز از پنل تنظیمات میز انجام می‌شود، چون به سفارش‌ها و رزروها وصل است.');
      return;
    }
    setConfirmRequest({
      message: `${selected.length} المان حذف شود؟`,
      run: () => {
        applyPlan((model) => ({
          ...model,
          objects: model.objects.filter((object) => !selectedIds.includes(object.id)),
        }));
        setSelectedIds([]);
      },
    });
  }, [applyPlan, selectedIds]);

  const deleteTable = useCallback(
    (tableId: string) => {
      const table = data?.floors.flatMap((floor) => floor.tables).find((item) => item.id === tableId);
      setConfirmRequest({
        message: `میز «${table?.nameFa ?? tableId}» حذف شود؟ این میز از نقشه و فهرست میزها حذف می‌شود.`,
        run: () => {
          void (async () => {
            try {
              await api.delete(`/layout/tables/${tableId}`);
              applyPlan((model) => ({
                ...model,
                objects: model.objects.filter((object) => object.tableId !== tableId),
              }));
              setSelectedIds([]);
              await refreshMeta();
              setNotice('میز حذف شد.');
              setError(null);
            } catch (caught) {
              setError(errorMessage(caught));
            }
          })();
        },
      });
    },
    [applyPlan, data, refreshMeta],
  );

  /* --------------------------------- floors -------------------------------- */

  const switchFloor = useCallback(
    async (floorId: string) => {
      if (floorId === floorIdRef.current) return;
      await saveNow();
      const floor = data?.floors.find((item) => item.id === floorId);
      if (!floor) return;
      floorIdRef.current = floor.id;
      setActiveFloorId(floor.id);
      setSelectedIds([]);
      applyPlanDirect(floor.plan);
      window.requestAnimationFrame(() => fit(floor.plan));
    },
    [applyPlanDirect, data, fit, saveNow],
  );

  const saveFloorSettings = useCallback(
    async (values: { nameFa: string; kind: LayoutFloorDto['kind']; width: number; height: number; gridSize: number }) => {
      const floorId = floorIdRef.current;
      if (!floorId) return;
      setFloorError(null);
      try {
        await api.patch(`/layout/floors/${floorId}`, { nameFa: values.nameFa, kind: values.kind });
        applyPlan((model) => ({ ...model, width: values.width, height: values.height, gridSize: values.gridSize }));
        await refreshMeta();
        setNotice('تنظیمات طبقه ذخیره شد.');
        setError(null);
      } catch (caught) {
        setFloorError(errorMessage(caught));
      }
    },
    [applyPlan, refreshMeta],
  );

  const addArea = useCallback(
    async (nameFa: string) => {
      const floorId = floorIdRef.current;
      if (!floorId) return;
      try {
        await api.post(`/layout/floors/${floorId}/areas`, { nameFa });
        await refreshMeta();
      } catch (caught) {
        setFloorError(errorMessage(caught));
      }
    },
    [refreshMeta],
  );

  const removeArea = useCallback(
    async (areaId: string) => {
      try {
        await api.delete(`/layout/areas/${areaId}`);
        await refreshMeta();
      } catch (caught) {
        setFloorError(errorMessage(caught));
      }
    },
    [refreshMeta],
  );

  const deleteFloor = useCallback(() => {
    const floorId = floorIdRef.current;
    if (!floorId) return;
    setConfirmRequest({
      message: 'این طبقه و پلان آن حذف شود؟ فقط طبقه‌های بدون میز قابل حذف هستند.',
      run: () => {
        void (async () => {
          try {
            await api.delete(`/layout/floors/${floorId}`);
            setFloorModalOpen(false);
            floorIdRef.current = null;
            await loadAll();
            setNotice('طبقه حذف شد.');
          } catch (caught) {
            setFloorError(errorMessage(caught));
          }
        })();
      },
    });
  }, [loadAll]);

  const createFloor = useCallback(async () => {
    const name = newFloorName.trim();
    if (!name) return;
    try {
      const created = await api.post<{ id: string }>('/layout/floors', { nameFa: name, kind: 'indoor' });
      setNewFloorOpen(false);
      setNewFloorName('');
      await loadAll(created.id);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [loadAll, newFloorName]);

  /* -------------------------------- versions ------------------------------- */

  const openVersions = useCallback(async () => {
    const floorId = floorIdRef.current;
    if (!floorId) return;
    setVersionsOpen(true);
    setVersionsLoading(true);
    try {
      const response = await api.get<{ items: LayoutVersionDto[] }>(`/layout/floors/${floorId}/versions`);
      setVersions(response.items);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setVersionsLoading(false);
    }
  }, []);

  const restoreVersion = useCallback(
    async (versionId: string) => {
      const floorId = floorIdRef.current;
      if (!floorId) return;
      try {
        await api.post(`/layout/floors/${floorId}/versions/${versionId}/restore`);
        await loadAll();
        setVersionsOpen(false);
        setNotice('نسخه بازگردانی شد.');
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [loadAll],
  );

  /* ----------------------------------- QR ---------------------------------- */

  const qrBase = encodeURIComponent(window.location.origin);
  const qrSrc = qrTableId ? `${API_BASE}/layout/tables/${qrTableId}/qr.png?size=512&base=${qrBase}` : '';

  const openQr = useCallback(async (tableId: string) => {
    setQrTableId(tableId);
    setQrMeta(null);
    setQrNotice(null);
    try {
      const meta = await api.get<{ menuUrl: string }>(`/layout/tables/${tableId}/qr?base=${qrBase}`);
      setQrMeta(meta);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [qrBase]);

  const regenerateQr = useCallback(async () => {
    if (!qrTableId) return;
    try {
      await api.post(`/layout/tables/${qrTableId}/qr`);
      const meta = await api.get<{ menuUrl: string }>(`/layout/tables/${qrTableId}/qr?base=${qrBase}`);
      setQrMeta(meta);
      setQrNotice('توکن تازه ساخته شد؛ برچسب‌های قبلی از کار افتادند.');
      await refreshMeta();
    } catch (caught) {
      setQrNotice(errorMessage(caught));
    }
  }, [qrBase, qrTableId, refreshMeta]);

  const downloadQr = useCallback(
    async (format: 'png' | 'svg') => {
      if (!qrTableId) return;
      try {
        const response = await fetch(`${API_BASE}/layout/tables/${qrTableId}/qr.${format}?size=1024&base=${qrBase}`, {
          credentials: 'include',
        });
        if (!response.ok) throw new Error('دانلود ناموفق بود.');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `qr-${qrTableId}.${format}`;
        link.click();
        URL.revokeObjectURL(url);
      } catch (caught) {
        setQrNotice(errorMessage(caught));
      }
    },
    [qrBase, qrTableId],
  );

  const copyMenuLink = useCallback(async () => {
    if (!qrMeta) return;
    try {
      await navigator.clipboard.writeText(qrMeta.menuUrl);
      setQrNotice('لینک منو کپی شد.');
    } catch {
      setQrNotice('کپی خودکار ممکن نبود؛ لینک را دستی انتخاب کنید.');
    }
  }, [qrMeta]);

  /* ------------------------------- live view -------------------------------- */

  useEffect(() => {
    if (!preview) return;
    let cancelled = false;

    const fetchLive = async () => {
      try {
        const response = await api.get<StaffTablesResponse>('/tables');
        if (cancelled) return;
        const map = new Map<string, LiveStatus>();
        response.items.forEach((item) =>
          map.set(item.id, { status: item.status, pendingRequests: item.pendingRequests, openTotal: item.openTotal }),
        );
        setLiveStatuses(map);
      } catch {
        // Keep the last known state.
      }
    };

    void fetchLive();
    const interval = window.setInterval(fetchLive, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [preview]);

  /* -------------------------------- shortcut -------------------------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && key === 'c' && selectedIds.length > 0) {
        const model = planRef.current;
        const selected = model?.objects.filter((object) => selectedIds.includes(object.id)) ?? [];
        clipboardRef.current = selected.map((object) => ({ ...object, props: { ...object.props } }));
        setNotice(`${selected.length} المان کپی شد.`);
        return;
      }
      if (mod && key === 'v') {
        const model = planRef.current;
        if (!model || clipboardRef.current.length === 0) return;
        const copies = clipboardRef.current
          .filter((object) => object.type !== 'table')
          .map((object) => ({ ...object, id: uid(), x: object.x + 24, y: object.y + 24, groupId: null, props: { ...object.props } }));
        if (copies.length === 0) return;
        applyPlan((current) => ({ ...current, objects: [...current.objects, ...copies] }));
        setSelectedIds(copies.map((object) => object.id));
        return;
      }
      if (mod && key === 'd') {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod && key === 'a') {
        event.preventDefault();
        setSelectedIds(planRef.current?.objects.map((object) => object.id) ?? []);
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        if (selectedIds.length > 0) {
          event.preventDefault();
          deleteSelection();
        }
        return;
      }
      if (key === 'escape') {
        setSelectedIds([]);
        return;
      }
      if (selectedIds.length > 0 && event.key.startsWith('Arrow')) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        applyPlan((current) => ({
          ...current,
          objects: current.objects.map((object) =>
            selectedIds.includes(object.id) && !object.locked
              ? { ...object, x: object.x + dx, y: object.y + dy }
              : object,
          ),
        }));
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyPlan, deleteSelection, duplicateSelection, redo, selectedIds, undo]);

  /* -------------------------------- import/export --------------------------- */

  const exportPlan = useCallback(() => {
    const model = planRef.current;
    if (!model) return;
    const payload = JSON.stringify({ name: activeFloor?.nameFa ?? 'floor', ...model }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `floorplan-${activeFloor?.nameFa ?? 'floor'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [activeFloor?.nameFa]);

  const importPlan = useCallback(
    async (file: File) => {
      try {
        const parsed = JSON.parse(await file.text()) as Partial<PlanModel> & { objects?: LayoutObject[] };
        if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number' || !Array.isArray(parsed.objects)) {
          throw new Error('ساختار فایل معتبر نیست.');
        }
        const model: PlanModel = {
          width: Math.min(6000, Math.max(400, Math.round(parsed.width))),
          height: Math.min(6000, Math.max(300, Math.round(parsed.height))),
          gridSize: Math.min(100, Math.max(4, Math.round(parsed.gridSize ?? 20))),
          objects: parsed.objects.map((object) => ({
            ...object,
            id: object.id || uid(),
            props: object.props ?? {},
          })),
        };
        applyPlan(() => model);
        setSelectedIds([]);
        window.requestAnimationFrame(() => fit(model));
        setNotice('طرح وارد شد؛ برای ثبت نهایی ذخیره می‌شود.');
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [applyPlan, fit],
  );

  const selectedObjects = plan ? plan.objects.filter((object) => selectedIds.includes(object.id)) : [];
  const tables = activeFloor?.tables ?? [];

  return (
    <div className="space-y-3">
      <PageHeader
        title="طراحی سالن"
        description="پلان طبقات را با کشیدن میز و تجهیزات بسازید؛ هر میز به سفارش‌ها، رزروها و QR اختصاصی همان میز وصل است."
        breadcrumb={<Breadcrumb page="طراحی سالن" />}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => window.location.assign('/admin/tables')}>
              فهرست میزها
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreview((value) => !value)}>
              {preview ? 'خروج از پیش‌نمایش' : 'پیش‌نمایش زنده'}
            </Button>
          </div>
        }
      />

      {notice ? (
        <Alert tone="success">{notice}</Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saveError ? <Alert tone="warning">ذخیره خودکار ناموفق بود: {saveError}</Alert> : null}

      {loading || !plan || !activeFloor ? (
        <div className="flex justify-center rounded-[1.35rem] border border-line bg-surface py-24 text-brand-600">
          <Spinner size="lg" label="در حال بارگذاری نقشه…" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 rounded-[1.35rem] border border-line bg-surface px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {data?.floors.map((floor) => (
                <button
                  key={floor.id}
                  type="button"
                  onClick={() => void switchFloor(floor.id)}
                  className={cn(
                    'h-8 rounded-full border px-3 text-[11px] transition',
                    floor.id === activeFloorId
                      ? 'border-brand-500 bg-brand-500 text-cream'
                      : 'border-line text-muted hover:border-brand-300 hover:text-ink',
                  )}
                >
                  {floor.nameFa}
                </button>
              ))}
              {canWrite ? (
                <button
                  type="button"
                  onClick={() => setNewFloorOpen(true)}
                  className="h-8 rounded-full border border-dashed border-line px-3 text-[11px] text-muted hover:border-brand-300 hover:text-brand-700"
                >
                  + طبقه
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-1 text-[10px] text-muted">
                {saving
                  ? 'در حال ذخیره…'
                  : dirty
                    ? 'تغییرات ذخیره نشده'
                    : savedAt
                      ? `ذخیره شد ${new Date(savedAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}`
                      : 'آماده'}
              </span>
              <ToggleButton onClick={() => void saveNow()} active={dirty || saving} title="ذخیره">
                ذخیره
              </ToggleButton>
              <ToggleButton onClick={undo} title="واگرد (Ctrl+Z)">↶</ToggleButton>
              <ToggleButton onClick={redo} title="جلو (Ctrl+Shift+Z)">↷</ToggleButton>
              <ToggleButton onClick={() => setViewport((value) => ({ ...value, zoom: Math.max(0.25, value.zoom - 0.1) }))}>
                −
              </ToggleButton>
              <span className="num w-10 text-center text-[10px] text-muted">{Math.round(viewport.zoom * 100)}٪</span>
              <ToggleButton onClick={() => setViewport((value) => ({ ...value, zoom: Math.min(2.5, value.zoom + 0.1) }))}>
                +
              </ToggleButton>
              <ToggleButton onClick={() => fit(plan)}>تناسب</ToggleButton>
              <ToggleButton active={showGrid} onClick={() => setShowGrid((value) => !value)}>
                شبکه
              </ToggleButton>
              <ToggleButton active={snapEnabled} onClick={() => setSnapEnabled((value) => !value)}>
                چسبیدن
              </ToggleButton>
              <ToggleButton onClick={() => void openVersions()}>تاریخچه</ToggleButton>
              <ToggleButton onClick={exportPlan}>خروجی</ToggleButton>
              {canWrite ? (
                <>
                  <ToggleButton onClick={() => importRef.current?.click()}>ورود طرح</ToggleButton>
                  <input
                    ref={importRef}
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importPlan(file);
                      event.target.value = '';
                    }}
                  />
                </>
              ) : null}
            </div>
          </div>

          <div
            className={cn(
              'grid gap-3',
              preview ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-[15rem_minmax(0,1fr)_18rem]',
            )}
            style={{ height: 'min(76vh, 940px)' }}
          >
            {!preview ? <LibraryPanel onAdd={(key) => void addItem(key)} disabled={!canWrite} /> : null}

            <div ref={wrapRef} className="relative min-h-[420px]">
              <LayoutCanvas
                plan={plan}
                tables={tables}
                selectedIds={selectedIds}
                viewport={viewport}
                snapEnabled={snapEnabled}
                showGrid={showGrid}
                preview={preview}
                liveStatuses={liveStatuses}
                onSelect={setSelectedIds}
                onChange={(updater, options) => applyPlan((model) => ({ ...model, objects: updater(model.objects) }), options)}
                onDragEnd={handleDragEnd}
                onViewportChange={setViewport}
                onDropItem={(key, point) => void addItem(key, point)}
                onBackgroundClick={() => setSelectedIds([])}
              />

              {preview ? (
                <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-surface/95 px-3 py-2 text-[10px] text-muted shadow">
                  {Object.entries(STATUS_LABELS_FA).map(([status, label]) => (
                    <span key={status} className="flex items-center gap-1">
                      <span
                        className="size-2 rounded-full"
                        style={{
                          backgroundColor:
                            status === 'available'
                              ? '#3f7a45'
                              : status === 'occupied'
                                ? '#b95f33'
                                : status === 'reserved'
                                  ? '#2c5a6b'
                                  : status === 'cleaning'
                                    ? '#9c8b76'
                                    : status === 'unavailable'
                                      ? '#7b6a5b'
                                      : '#9a6c12',
                        }}
                      />
                      {label}
                    </span>
                  ))}
                  <span className="text-muted/70">|</span>
                  <span>{formatCountFa(tables.length)} میز — به‌روزرسانی هر ۱۰ ثانیه</span>
                </div>
              ) : null}

              {!canWrite ? (
                <div className="absolute inset-x-3 top-3 rounded-xl bg-espresso/85 px-3 py-1.5 text-center text-[10px] text-cream/85">
                  دسترسی شما فقط مشاهده است.
                </div>
              ) : null}
            </div>

            {!preview ? (
              <InspectorPanel
                plan={plan}
                floor={activeFloor}
                tables={tables}
                waiters={data?.waiters ?? []}
                selected={selectedObjects}
                canWrite={canWrite}
                onSelect={setSelectedIds}
                onPatchObject={patchObject}
                onPatchProps={patchProps}
                onPatchTable={patchTable}
                onDeleteSelected={deleteSelection}
                onDeleteTable={deleteTable}
                onGroup={groupSelection}
                onUngroup={ungroupSelection}
                onDuplicate={duplicateSelection}
                onReorder={reorder}
                onOpenQr={(tableId) => void openQr(tableId)}
                onOpenFloor={() => setFloorModalOpen(true)}
              />
            ) : null}
          </div>
        </>
      )}

      <FloorModal
        open={floorModalOpen}
        onClose={() => {
          setFloorModalOpen(false);
          setFloorError(null);
        }}
        floor={activeFloor}
        canWrite={canWrite}
        plan={plan ?? { width: 1600, height: 1000, gridSize: 20, objects: [] }}
        onSave={(values) => void saveFloorSettings(values)}
        onDelete={deleteFloor}
        onAddArea={(nameFa) => void addArea(nameFa)}
        onDeleteArea={(areaId) => void removeArea(areaId)}
        onPlanSize={(values) => {
          applyPlan((model) => ({ ...model, ...values }));
          setFloorModalOpen(false);
        }}
        error={floorError}
      />

      <VersionsModal
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        versions={versions}
        loading={versionsLoading}
        onRestore={(versionId) => void restoreVersion(versionId)}
        canWrite={canWrite}
      />

      <QrModal
        open={Boolean(qrTableId)}
        onClose={() => {
          setQrTableId(null);
          setQrMeta(null);
          setQrNotice(null);
        }}
        table={tables.find((table) => table.id === qrTableId) ?? null}
        menuUrl={qrMeta?.menuUrl ?? ''}
        imageSrc={qrSrc}
        canWrite={canWrite}
        onRegenerate={() => void regenerateQr()}
        onDownloadPng={() => void downloadQr('png')}
        onDownloadSvg={() => void downloadQr('svg')}
        onCopy={() => void copyMenuLink()}
        notice={qrNotice}
      />

      <Modal
        open={newFloorOpen}
        onClose={() => setNewFloorOpen(false)}
        title="افزودن طبقه یا فضا"
        description="برای هر طبقه یک پلان مستقل ساخته می‌شود."
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setNewFloorOpen(false)}>
              انصراف
            </Button>
            <Button size="sm" onClick={() => void createFloor()} disabled={!newFloorName.trim()}>
              ساخت طبقه
            </Button>
          </>
        }
      >
        <input
          className="h-11 w-full rounded-2xl border border-line bg-surface px-3 text-sm text-ink focus:border-brand-400 focus:outline-none"
          placeholder="مثلاً: طبقه اول — سالن VIP"
          value={newFloorName}
          onChange={(event) => setNewFloorName(event.target.value)}
        />
      </Modal>

      <Modal
        open={Boolean(confirmRequest)}
        onClose={() => setConfirmRequest(null)}
        title="تأیید عملیات"
        size="sm"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRequest(null)}>
              انصراف
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                confirmRequest?.run();
                setConfirmRequest(null);
              }}
            >
              تأیید
            </Button>
          </>
        }
      >
        <p className="text-xs leading-6 text-ink">{confirmRequest?.message}</p>
      </Modal>
    </div>
  );
}
