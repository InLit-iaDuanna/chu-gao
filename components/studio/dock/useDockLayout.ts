"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_LAYOUT,
  MIN_CENTER_HEIGHT,
  MIN_CENTER_WIDTH,
  PANEL_REGISTRY,
  panelMeta,
  ZONE_MAX_SIZE,
  ZONE_MIN_SIZE,
  ZONE_SPLITTER_SIZE,
  type DockLayoutState,
  type DockZone,
  type PanelType,
} from "./dock-types";

const LAYOUT_KEY_PREFIX = "chugao.dock-layout.v2";
const PRESETS_KEY_PREFIX = "chugao.dock-presets.v1";
/** v1 的全局布局键，首次按用户命名空间加载时迁移。 */
const LEGACY_LAYOUT_KEY = "chugao.dock-layout.v1";

export const PRESET_SLOTS = 3;

const ALL_ZONES: DockZone[] = ["left", "right", "top", "bottom"];

export interface LayoutPreset {
  name: string;
  savedAt: string;
  layout: DockLayoutState;
}

interface DockViewportSize {
  width: number;
  height: number;
}

function cloneDefault(): DockLayoutState {
  return {
    zones: {
      left: DEFAULT_LAYOUT.zones.left.map((panel) => ({ ...panel })),
      right: DEFAULT_LAYOUT.zones.right.map((panel) => ({ ...panel })),
      top: [],
      bottom: [],
    },
    zoneSize: { ...DEFAULT_LAYOUT.zoneSize },
  };
}

function cloneLayout(layout: DockLayoutState): DockLayoutState {
  return {
    zones: {
      left: layout.zones.left.map((panel) => ({ ...panel })),
      right: layout.zones.right.map((panel) => ({ ...panel })),
      top: layout.zones.top.map((panel) => ({ ...panel })),
      bottom: layout.zones.bottom.map((panel) => ({ ...panel })),
    },
    zoneSize: { ...layout.zoneSize },
  };
}

function clampZoneSize(zone: DockZone, size: number): number {
  const fallback = DEFAULT_LAYOUT.zoneSize[zone];
  const finiteSize = Number.isFinite(size) ? size : fallback;
  return Math.round(
    Math.min(ZONE_MAX_SIZE[zone], Math.max(ZONE_MIN_SIZE[zone], finiteSize)),
  );
}

function fitAxisSizes(
  layout: DockLayoutState,
  firstZone: DockZone,
  secondZone: DockZone,
  totalSize: number,
  centerMinSize: number,
): [number, number] {
  const firstActive = layout.zones[firstZone].length > 0;
  const secondActive = layout.zones[secondZone].length > 0;
  let firstSize = clampZoneSize(firstZone, layout.zoneSize[firstZone]);
  let secondSize = clampZoneSize(secondZone, layout.zoneSize[secondZone]);
  const activeCount = Number(firstActive) + Number(secondActive);
  const budget = Math.max(
    0,
    Math.floor(totalSize) - centerMinSize - activeCount * ZONE_SPLITTER_SIZE,
  );

  if (activeCount === 0) return [firstSize, secondSize];

  if (firstActive && !secondActive) {
    return [Math.min(firstSize, budget), secondSize];
  }
  if (!firstActive && secondActive) {
    return [firstSize, Math.min(secondSize, budget)];
  }

  const currentTotal = firstSize + secondSize;
  if (currentTotal <= budget) return [firstSize, secondSize];

  const firstMin = ZONE_MIN_SIZE[firstZone];
  const secondMin = ZONE_MIN_SIZE[secondZone];
  const minTotal = firstMin + secondMin;

  if (budget >= minTotal) {
    const firstSlack = Math.max(0, firstSize - firstMin);
    const secondSlack = Math.max(0, secondSize - secondMin);
    const totalSlack = firstSlack + secondSlack;
    const remainingSlack = budget - minTotal;

    if (totalSlack > 0) {
      firstSize = Math.round(
        firstMin + (remainingSlack * firstSlack) / totalSlack,
      );
      secondSize = Math.max(secondMin, budget - firstSize);
    } else {
      firstSize = firstMin;
      secondSize = secondMin;
    }
  } else if (minTotal > 0) {
    firstSize = Math.round((budget * firstMin) / minTotal);
    secondSize = Math.max(0, budget - firstSize);
  }

  return [firstSize, secondSize];
}

/**
 * 按当前工作区总预算收紧四侧区域，始终优先为中心创作区保留空间。
 * 当视口比全部最小尺寸之和还小时，区域会按最小尺寸比例继续收缩；
 * DockWorkspace 会在对应宽度切换到单面板模式，因此不会展示过窄栏位。
 */
export function normalizeDockLayout(
  layout: DockLayoutState,
  viewportWidth: number,
  viewportHeight: number,
): DockLayoutState {
  const width = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const height = Number.isFinite(viewportHeight)
    ? Math.max(0, viewportHeight)
    : 0;
  const [left, right] = fitAxisSizes(
    layout,
    "left",
    "right",
    width,
    MIN_CENTER_WIDTH,
  );
  const [top, bottom] = fitAxisSizes(
    layout,
    "top",
    "bottom",
    height,
    MIN_CENTER_HEIGHT,
  );

  if (
    layout.zoneSize.left === left &&
    layout.zoneSize.right === right &&
    layout.zoneSize.top === top &&
    layout.zoneSize.bottom === bottom
  ) {
    return layout;
  }

  return {
    ...layout,
    zoneSize: { left, right, top, bottom },
  };
}

function isValidLayout(value: unknown): value is DockLayoutState {
  if (!value || typeof value !== "object") return false;
  const layout = value as DockLayoutState;
  if (!layout.zones || !layout.zoneSize) return false;
  const validTypes = new Set(PANEL_REGISTRY.map((meta) => meta.type));
  for (const zone of ALL_ZONES) {
    const panels = layout.zones[zone];
    if (!Array.isArray(panels)) return false;
    for (const panel of panels) {
      if (
        !panel ||
        typeof panel.id !== "string" ||
        !validTypes.has(panel.type) ||
        typeof panel.grow !== "number" ||
        !Number.isFinite(panel.grow) ||
        panel.grow <= 0
      ) {
        return false;
      }
    }
    if (
      typeof layout.zoneSize[zone] !== "number" ||
      !Number.isFinite(layout.zoneSize[zone])
    ) {
      return false;
    }
  }
  return true;
}

function isValidPresets(value: unknown): value is (LayoutPreset | null)[] {
  if (!Array.isArray(value) || value.length !== PRESET_SLOTS) return false;
  return value.every(
    (item) =>
      item === null ||
      (typeof item === "object" &&
        typeof (item as LayoutPreset).name === "string" &&
        typeof (item as LayoutPreset).savedAt === "string" &&
        isValidLayout((item as LayoutPreset).layout)),
  );
}

function readJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存储失败（隐私模式等）时静默降级为会话内状态。
  }
}

function emptyPresets(): (LayoutPreset | null)[] {
  return Array.from({ length: PRESET_SLOTS }, () => null);
}

let idCounter = 0;
function nextPanelId(type: PanelType): string {
  idCounter += 1;
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${type}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${type}-${Date.now().toString(36)}-${idCounter}`;
}

export interface DockLayoutApi {
  layout: DockLayoutState;
  presets: (LayoutPreset | null)[];
  /** localStorage 恢复完成后为 true（避免 SSR 水合不一致）。 */
  hydrated: boolean;
  addPanel: (zone: DockZone, type: PanelType) => void;
  closePanel: (zone: DockZone, panelId: string) => void;
  setPanelType: (zone: DockZone, panelId: string, type: PanelType) => void;
  movePanel: (
    panelId: string,
    fromZone: DockZone,
    toZone: DockZone,
    insertIndex?: number,
  ) => void;
  setZoneSize: (zone: DockZone, size: number) => void;
  /** 容器尺寸变化或持久化恢复后，按总预算归一化区域尺寸。 */
  normalizeForViewport: (width: number, height: number) => void;
  /** 拖动区域内分隔条：调整 index 与 index+1 两个面板的 grow。 */
  resizePair: (zone: DockZone, index: number, deltaGrow: number) => void;
  ensurePanel: (type: PanelType) => void;
  resetLayout: () => void;
  /** 把当前布局存入预设槽位（覆盖已有）。 */
  savePreset: (slot: number) => void;
  applyPreset: (slot: number) => void;
  deletePreset: (slot: number) => void;
}

/**
 * 布局与预设均按 storageKey（用户 ID）命名空间持久化：
 * 每个账号 3 个预设槽位，互不干扰。
 */
export function useDockLayout(storageKey: string): DockLayoutApi {
  const [layout, setLayout] = useState<DockLayoutState>(cloneDefault);
  const [presets, setPresets] = useState<(LayoutPreset | null)[]>(emptyPresets);
  const [hydrated, setHydrated] = useState(false);
  const skipLayoutPersist = useRef(true);
  const skipPresetsPersist = useRef(true);
  const viewportSize = useRef<DockViewportSize | null>(null);

  const layoutKey = `${LAYOUT_KEY_PREFIX}.${storageKey}`;
  const presetsKey = `${PRESETS_KEY_PREFIX}.${storageKey}`;

  const fitCurrentViewport = useCallback((next: DockLayoutState) => {
    const viewport = viewportSize.current;
    return viewport
      ? normalizeDockLayout(next, viewport.width, viewport.height)
      : next;
  }, []);

  useEffect(() => {
    const stored = readJson(layoutKey);
    const legacy = readJson(LEGACY_LAYOUT_KEY);
    if (isValidLayout(stored)) {
      const originalDefault =
        stored.zones.left.length === 1 &&
        stored.zones.left[0].id === "default-history" &&
        stored.zones.right.length === 1 &&
        stored.zones.right[0].id === "default-conversation" &&
        !stored.zones.top.length &&
        !stored.zones.bottom.length &&
        stored.zoneSize.left === 288 &&
        stored.zoneSize.right === 380;
      setLayout(fitCurrentViewport(originalDefault ? cloneDefault() : stored));
    } else if (isValidLayout(legacy)) {
      setLayout(fitCurrentViewport(legacy));
    } else {
      setLayout(fitCurrentViewport(cloneDefault()));
    }

    const storedPresets = readJson(presetsKey);
    setPresets(isValidPresets(storedPresets) ? storedPresets : emptyPresets());

    skipLayoutPersist.current = true;
    skipPresetsPersist.current = true;
    setHydrated(true);
  }, [fitCurrentViewport, layoutKey, presetsKey]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipLayoutPersist.current) {
      skipLayoutPersist.current = false;
      return;
    }
    writeJson(layoutKey, layout);
  }, [hydrated, layout, layoutKey]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipPresetsPersist.current) {
      skipPresetsPersist.current = false;
      return;
    }
    writeJson(presetsKey, presets);
  }, [hydrated, presets, presetsKey]);

  const addPanel = useCallback(
    (zone: DockZone, type: PanelType) => {
      setLayout((current) =>
        fitCurrentViewport({
          ...current,
          zones: {
            ...current.zones,
            [zone]: [
              ...current.zones[zone],
              { id: nextPanelId(type), type, grow: 1 },
            ],
          },
        }),
      );
    },
    [fitCurrentViewport],
  );

  const closePanel = useCallback((zone: DockZone, panelId: string) => {
    setLayout((current) => ({
      ...current,
      zones: {
        ...current.zones,
        [zone]: current.zones[zone].filter((panel) => panel.id !== panelId),
      },
    }));
  }, []);

  const setPanelType = useCallback(
    (zone: DockZone, panelId: string, type: PanelType) => {
      setLayout((current) => ({
        ...current,
        zones: {
          ...current.zones,
          [zone]: current.zones[zone].map((panel) =>
            panel.id === panelId ? { ...panel, type } : panel,
          ),
        },
      }));
    },
    [],
  );

  const movePanel = useCallback(
    (
      panelId: string,
      fromZone: DockZone,
      toZone: DockZone,
      insertIndex?: number,
    ) => {
      setLayout((current) => {
        const source = current.zones[fromZone];
        const panelIndex = source.findIndex((panel) => panel.id === panelId);
        if (panelIndex < 0) return current;

        const panel = source[panelIndex];
        const nextSource = source.filter((item) => item.id !== panelId);
        const target = current.zones[toZone];

        let index = insertIndex ?? target.length;
        if (fromZone === toZone && panelIndex < index) index -= 1;
        const targetBase = fromZone === toZone ? nextSource : target;
        index = Math.max(0, Math.min(index, targetBase.length));

        const nextTarget = [
          ...targetBase.slice(0, index),
          panel,
          ...targetBase.slice(index),
        ];

        return fitCurrentViewport({
          ...current,
          zones: {
            ...current.zones,
            [fromZone]: fromZone === toZone ? nextTarget : nextSource,
            [toZone]: nextTarget,
          },
        });
      });
    },
    [fitCurrentViewport],
  );

  const setZoneSize = useCallback(
    (zone: DockZone, size: number) => {
      const clamped = clampZoneSize(zone, size);
      setLayout((current) => {
        if (current.zoneSize[zone] === clamped) return current;
        return fitCurrentViewport({
          ...current,
          zoneSize: { ...current.zoneSize, [zone]: clamped },
        });
      });
    },
    [fitCurrentViewport],
  );

  const normalizeForViewport = useCallback((width: number, height: number) => {
    const nextViewport = {
      width: Number.isFinite(width) ? Math.max(0, width) : 0,
      height: Number.isFinite(height) ? Math.max(0, height) : 0,
    };
    viewportSize.current = nextViewport;
    setLayout((current) =>
      normalizeDockLayout(current, nextViewport.width, nextViewport.height),
    );
  }, []);

  const resizePair = useCallback(
    (zone: DockZone, index: number, deltaGrow: number) => {
      setLayout((current) => {
        const panels = current.zones[zone];
        const a = panels[index];
        const b = panels[index + 1];
        if (!a || !b) return current;
        const MIN_GROW = 0.5;
        const growA = Math.max(MIN_GROW, a.grow + deltaGrow);
        const growB = Math.max(MIN_GROW, b.grow - deltaGrow);
        if (growA === a.grow && growB === b.grow) return current;
        const next = panels.map((panel, i) =>
          i === index
            ? { ...panel, grow: growA }
            : i === index + 1
              ? { ...panel, grow: growB }
              : panel,
        );
        return { ...current, zones: { ...current.zones, [zone]: next } };
      });
    },
    [],
  );

  const ensurePanel = useCallback(
    (type: PanelType) => {
      setLayout((current) => {
        const exists = ALL_ZONES.some((zone) =>
          current.zones[zone].some((panel) => panel.type === type),
        );
        if (exists) return current;
        const zone = panelMeta(type).defaultZone;
        return fitCurrentViewport({
          ...current,
          zones: {
            ...current.zones,
            [zone]: [
              ...current.zones[zone],
              { id: nextPanelId(type), type, grow: 1 },
            ],
          },
        });
      });
    },
    [fitCurrentViewport],
  );

  const resetLayout = useCallback(() => {
    setLayout(fitCurrentViewport(cloneDefault()));
  }, [fitCurrentViewport]);

  const savePreset = useCallback(
    (slot: number) => {
      setPresets((current) =>
        current.map((item, index) =>
          index === slot
            ? {
                name: `方案 ${slot + 1}`,
                savedAt: new Date().toISOString(),
                layout: cloneLayout(layout),
              }
            : item,
        ),
      );
    },
    [layout],
  );

  const applyPreset = useCallback(
    (slot: number) => {
      const preset = presets[slot];
      if (!preset) return;
      setLayout(fitCurrentViewport(cloneLayout(preset.layout)));
    },
    [fitCurrentViewport, presets],
  );

  const deletePreset = useCallback((slot: number) => {
    setPresets((current) =>
      current.map((item, index) => (index === slot ? null : item)),
    );
  }, []);

  return {
    layout,
    presets,
    hydrated,
    addPanel,
    closePanel,
    setPanelType,
    movePanel,
    setZoneSize,
    normalizeForViewport,
    resizePair,
    ensurePanel,
    resetLayout,
    savePreset,
    applyPreset,
    deletePreset,
  };
}
