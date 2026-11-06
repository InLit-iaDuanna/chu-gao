"use client";

import {
  Button,
  IconButton,
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui";

import {
  LayoutTemplate,
  ListChecks,
  MessageSquare,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  History,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui";
import { cn } from "@/lib/utils";

import {
  DOCK_COMPACT_BREAKPOINT,
  MIN_CENTER_WIDTH,
  PANEL_REGISTRY,
  ZONE_MAX_SIZE,
  ZONE_MIN_SIZE,
  ZONE_LABEL,
  type DockZone,
  type PanelType,
} from "./dock-types";
import { DockPanel, PANEL_DRAG_MIME, type PanelDragPayload } from "./DockPanel";
import { useDockLayout } from "./useDockLayout";

/** left/right 区域内面板纵向堆叠；top/bottom 区域内面板横向堆叠。 */
function stackIsColumn(zone: DockZone): boolean {
  return zone === "left" || zone === "right";
}

/** 空区域时，中心区四边中点的「+」拉起按钮位置。 */

function zoneKeyboardDelta(zone: DockZone, key: string): number | null {
  const increase =
    (zone === "left" && key === "ArrowRight") ||
    (zone === "right" && key === "ArrowLeft") ||
    (zone === "top" && key === "ArrowDown") ||
    (zone === "bottom" && key === "ArrowUp");
  const decrease =
    (zone === "left" && key === "ArrowLeft") ||
    (zone === "right" && key === "ArrowRight") ||
    (zone === "top" && key === "ArrowUp") ||
    (zone === "bottom" && key === "ArrowDown");

  if (increase) return 16;
  if (decrease) return -16;
  return null;
}

interface DockWorkspaceProps {
  /** 布局/预设的持久化命名空间（传用户 ID，每个账号独立）。 */
  storageKey: string;
  renderPanel: (type: PanelType) => ReactNode;
  /** 挂载后确保至少存在一个的类型（用于 ?thread= 等深链）。 */
  ensureTypes?: PanelType[];
  children: ReactNode;
  focusComposerVersion?: number;
}

interface ZoneDragState {
  zone: DockZone;
  startPos: number;
  startSize: number;
}

interface PairDragState {
  zone: DockZone;
  index: number;
  lastPos: number;
}

const MOBILE_WORKSPACE_TABS = [
  { id: "history", label: "历史", icon: History },
  { id: "conversation", label: "对话", icon: MessageSquare },
  { id: "params", label: "参数", icon: SlidersHorizontal },
  { id: "queue", label: "队列", icon: ListChecks },
] as const;

export function DockWorkspace({
  storageKey,
  renderPanel,
  ensureTypes,
  children,
  focusComposerVersion = 0,
}: DockWorkspaceProps) {
  const dock = useDockLayout(storageKey);
  const { hydrated, normalizeForViewport } = dock;
  const [dropTarget, setDropTarget] = useState<{
    zone: DockZone;
    index: number;
  } | null>(null);
  const [zoneDrag, setZoneDrag] = useState<ZoneDragState | null>(null);
  const [pairDrag, setPairDrag] = useState<PairDragState | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 });
  const [mobileView, setMobileView] = useState<PanelType | null>(null);
  useEffect(() => {
    if (focusComposerVersion) setMobileView(null);
  }, [focusComposerVersion]);

  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;

    const update = () => {
      const rect = element.getBoundingClientRect();
      const next = {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      setWorkspaceSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };

    update();
    window.addEventListener("resize", update);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, []);

  const isCompact =
    workspaceSize.width > 0 && workspaceSize.width < DOCK_COMPACT_BREAKPOINT;

  useEffect(() => {
    if (!hydrated || workspaceSize.width <= 0 || workspaceSize.height <= 0) {
      return;
    }
    normalizeForViewport(workspaceSize.width, workspaceSize.height);
  }, [hydrated, normalizeForViewport, workspaceSize]);

  const ensureKey = (ensureTypes ?? []).join(",");
  useEffect(() => {
    if (!dock.hydrated || !ensureKey) return;
    for (const type of ensureKey.split(",") as PanelType[]) {
      dock.ensurePanel(type);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dock.hydrated, ensureKey]);

  useEffect(() => {
    if (isCompact && ensureKey.split(",").includes("conversation")) {
      setMobileView("conversation");
    }
  }, [ensureKey, isCompact]);

  // 拖拽在区域外结束时清理高亮。
  useEffect(() => {
    const clear = () => setDropTarget(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);

  const axisPos = (
    zone: DockZone,
    event: { clientX: number; clientY: number },
  ) => (stackIsColumn(zone) ? event.clientY : event.clientX);

  const zoneAxisPos = (
    zone: DockZone,
    event: { clientX: number; clientY: number },
  ) => (zone === "left" || zone === "right" ? event.clientX : event.clientY);

  // ─── 区域边缘分隔条：调整整条区域的宽/高 ─────────────────────
  const renderZoneSplitter = (zone: DockZone) => {
    const vertical = zone === "left" || zone === "right";
    const active = zoneDrag?.zone === zone;
    const sign = zone === "left" || zone === "top" ? 1 : -1;
    return (
      <div
        key={`splitter-${zone}`}
        role="separator"
        tabIndex={0}
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-label={`调整${ZONE_LABEL[zone]}区域大小`}
        aria-valuemin={ZONE_MIN_SIZE[zone]}
        aria-valuemax={ZONE_MAX_SIZE[zone]}
        aria-valuenow={dock.layout.zoneSize[zone]}
        onKeyDown={(event) => {
          const delta = zoneKeyboardDelta(zone, event.key);
          if (delta === null) return;
          event.preventDefault();
          dock.setZoneSize(zone, dock.layout.zoneSize[zone] + delta);
        }}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          const startPos = zoneAxisPos(zone, event);
          const startSize = dock.layout.zoneSize[zone];
          setZoneDrag({ zone, startPos, startSize });

          const handleMove = (rawEvent: Event) => {
            const moveEvent = rawEvent as MouseEvent;
            const delta = zoneAxisPos(zone, moveEvent) - startPos;
            dock.setZoneSize(zone, startSize + sign * delta);
          };
          const handleUp = () => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", handleUp);
            setZoneDrag(null);
          };
          window.addEventListener("mousemove", handleMove);
          window.addEventListener("mouseup", handleUp);
        }}
        className={cn(
          "group relative shrink-0 touch-none select-none outline-none max-md:hidden focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          vertical ? "w-[5px] cursor-col-resize" : "h-[5px] cursor-row-resize",
        )}
      >
        <div
          className={cn(
            "absolute bg-border-strong transition-colors",
            vertical
              ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
              : "inset-x-0 top-1/2 h-px -translate-y-1/2",
            active ? "bg-foreground" : "group-hover:bg-foreground",
          )}
        />
      </div>
    );
  };

  // ─── 区域内面板分隔条：调整相邻面板的空间权重 ────────────────
  const renderPairSplitter = (zone: DockZone, index: number) => {
    const column = stackIsColumn(zone);
    const active = pairDrag?.zone === zone && pairDrag.index === index;
    return (
      <div
        key={`pair-${zone}-${index}`}
        role="separator"
        tabIndex={0}
        aria-orientation={column ? "horizontal" : "vertical"}
        aria-label={`调整${ZONE_LABEL[zone]}内面板大小`}
        onKeyDown={(event) => {
          const positive =
            (column && event.key === "ArrowDown") ||
            (!column && event.key === "ArrowRight");
          const negative =
            (column && event.key === "ArrowUp") ||
            (!column && event.key === "ArrowLeft");
          if (!positive && !negative) return;
          event.preventDefault();
          dock.resizePair(zone, index, positive ? 0.1 : -0.1);
        }}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          const stackEl = event.currentTarget.parentElement;
          let lastPos = axisPos(zone, event);
          setPairDrag({ zone, index, lastPos });

          const handleMove = (rawEvent: Event) => {
            const moveEvent = rawEvent as MouseEvent;
            const pos = axisPos(zone, moveEvent);
            if (!stackEl) return;
            const rect = stackEl.getBoundingClientRect();
            const totalPx = column ? rect.height : rect.width;
            const panels = dock.layout.zones[zone];
            const totalGrow = panels.reduce(
              (sum, panel) => sum + panel.grow,
              0,
            );
            if (totalPx <= 0 || totalGrow <= 0) return;
            const deltaGrow = ((pos - lastPos) / totalPx) * totalGrow;
            if (deltaGrow !== 0) dock.resizePair(zone, index, deltaGrow);
            lastPos = pos;
            setPairDrag({ zone, index, lastPos: pos });
          };
          const handleUp = () => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", handleUp);
            setPairDrag(null);
          };
          window.addEventListener("mousemove", handleMove);
          window.addEventListener("mouseup", handleUp);
        }}
        className={cn(
          "group relative shrink-0 touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          column ? "h-[5px] cursor-row-resize" : "w-[5px] cursor-col-resize",
        )}
      >
        <div
          className={cn(
            "absolute bg-border-strong transition-colors",
            column
              ? "inset-x-0 top-1/2 h-px -translate-y-1/2"
              : "inset-y-0 left-1/2 w-px -translate-x-1/2",
            active ? "bg-foreground" : "group-hover:bg-foreground",
          )}
        />
      </div>
    );
  };

  // ─── 拖放：栏目在四条边之间移动 ─────────────────────────────
  const acceptsPanelDrag = (event: React.DragEvent) =>
    event.dataTransfer.types.includes(PANEL_DRAG_MIME);

  const handleZoneDragOver = (zone: DockZone) => (event: React.DragEvent) => {
    if (!acceptsPanelDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ zone, index: dock.layout.zones[zone].length });
  };

  const handlePanelDragOver =
    (zone: DockZone, index: number) => (event: React.DragEvent) => {
      if (!acceptsPanelDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDropTarget({ zone, index });
    };

  const handleZoneDrop = (zone: DockZone) => (event: React.DragEvent) => {
    if (!acceptsPanelDrag(event)) return;
    event.preventDefault();
    const raw = event.dataTransfer.getData(PANEL_DRAG_MIME);
    const target = dropTarget;
    setDropTarget(null);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as PanelDragPayload;
      const index =
        target?.zone === zone ? target.index : dock.layout.zones[zone].length;
      dock.movePanel(payload.panelId, payload.fromZone, zone, index);
    } catch {
      // 非本应用拖拽内容，忽略。
    }
  };

  const handleZoneDragLeave = (event: React.DragEvent) => {
    const related = event.relatedTarget as Node | null;
    if (!related || !event.currentTarget.contains(related)) {
      setDropTarget(null);
    }
  };

  // ─── 「+」菜单：添加栏目 / 重置布局 ──────────────────────────
  const renderAddMenu = (zone: DockZone, trigger: ReactElement) => (
    <DropdownMenu className="min-w-40" trigger={trigger}>
      {PANEL_REGISTRY.map((meta) => {
        const Icon = meta.icon;
        return (
          <DropdownMenuItem
            key={meta.type}
            onClick={() => dock.addPanel(zone, meta.type)}
            className="h-7 text-xs"
          >
            <Icon size={12} className="text-text-muted" />
            {meta.title}
          </DropdownMenuItem>
        );
      })}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={dock.resetLayout} className="h-7 text-xs">
        <RotateCcw size={12} className="text-text-muted" />
        重置布局
      </DropdownMenuItem>
    </DropdownMenu>
  );

  // ─── 布局预设：每个账号 3 个槽位 ─────────────────────────────
  const renderPresetsMenu = () => (
    <DropdownMenu
      className="min-w-52"
      trigger={
        <IconButton
          variant="secondary"
          size="sm"
          aria-label="布局方案"
          title="布局方案（保存/切换工作区布局）"
          className="border border-border-strong bg-surface-2 text-text-muted shadow-[var(--shadow-sm)] hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          <LayoutTemplate size={13} />
        </IconButton>
      }
    >
      <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-text-muted">
        布局方案
      </div>
      {dock.presets.map((preset, slot) =>
        preset ? (
          <div key={slot} className="flex items-center gap-0.5 pr-1">
            <DropdownMenuItem
              onClick={() => dock.applyPreset(slot)}
              className="h-7 flex-1 text-xs"
            >
              <LayoutTemplate size={12} className="text-text-muted" />
              <span className="min-w-0 flex-1 truncate">{preset.name}</span>
              <span className="text-[10px] text-text-muted">
                {new Date(preset.savedAt).toLocaleDateString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                })}
              </span>
            </DropdownMenuItem>
            <IconButton
              variant="ghost"
              size="sm"
              onClick={() => dock.savePreset(slot)}
              aria-label={`覆盖保存到方案 ${slot + 1}`}
              title="用当前布局覆盖"
              className="shrink-0 text-text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
            >
              <Save size={11} />
            </IconButton>
            <IconButton
              variant="ghost"
              size="sm"
              onClick={() => dock.deletePreset(slot)}
              aria-label={`删除方案 ${slot + 1}`}
              title="删除该方案"
              className="shrink-0 text-text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
            >
              <Trash2 size={11} />
            </IconButton>
          </div>
        ) : (
          <DropdownMenuItem
            key={slot}
            onClick={() => dock.savePreset(slot)}
            className="h-7 text-xs"
          >
            <Save size={12} className="text-text-muted" />
            保存当前到方案 {slot + 1}
          </DropdownMenuItem>
        ),
      )}
    </DropdownMenu>
  );

  // ─── 一条边的区域堆叠 ────────────────────────────────────────
  const renderZone = (zone: DockZone) => {
    const panels = dock.layout.zones[zone];
    if (panels.length === 0) return null;
    const column = stackIsColumn(zone);
    const sizeStyle = column
      ? { width: dock.layout.zoneSize[zone] }
      : { height: dock.layout.zoneSize[zone] };

    return (
      <div
        key={`zone-${zone}`}
        style={sizeStyle}
        onDragOver={handleZoneDragOver(zone)}
        onDrop={handleZoneDrop(zone)}
        onDragLeave={handleZoneDragLeave}
        className={cn(
          "flex min-h-0 min-w-0 shrink-0 bg-surface max-md:hidden",
          column ? "flex-col" : "flex-row",
        )}
      >
        {panels.map((panel, index) => {
          const inserting =
            dropTarget?.zone === zone && dropTarget.index === index;
          return (
            <Fragment key={panel.id}>
              {index > 0 ? renderPairSplitter(zone, index - 1) : null}
              {inserting ? (
                <div
                  aria-hidden
                  className={cn(
                    "shrink-0 bg-brand",
                    column ? "h-0.5 w-full" : "w-0.5 self-stretch",
                  )}
                />
              ) : null}
              <div
                onDragOver={handlePanelDragOver(zone, index)}
                style={{ flexGrow: panel.grow, flexBasis: 0 }}
                className="flex min-h-0 min-w-0 flex-col overflow-hidden"
              >
                <DockPanel
                  zone={zone}
                  panelId={panel.id}
                  type={panel.type}
                  onSwitchType={(type) =>
                    dock.setPanelType(zone, panel.id, type)
                  }
                  onClose={() => dock.closePanel(zone, panel.id)}
                >
                  {renderPanel(panel.type)}
                </DockPanel>
              </div>
            </Fragment>
          );
        })}
        {dropTarget?.zone === zone && dropTarget.index === panels.length ? (
          <div
            aria-hidden
            className={cn(
              "shrink-0 bg-brand",
              column ? "h-0.5 w-full" : "w-0.5 self-stretch",
            )}
          />
        ) : null}
        {renderAddMenu(
          zone,
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={`在${ZONE_LABEL[zone]}添加栏目`}
            title={`在${ZONE_LABEL[zone]}添加栏目`}
            className={cn(
              "shrink-0 rounded-none border-border-strong text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-inset",
              column ? "h-8 w-full border-t" : "h-full w-8 border-l",
            )}
          >
            <Plus size={13} />
          </IconButton>,
        )}
      </div>
    );
  };

  const toolbar = (
    <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-2 md:px-4">
      <h1
        aria-label="创作"
        className="mr-auto flex items-center gap-2 text-sm font-semibold"
      >
        <Sparkles size={16} />
        <span className="hidden sm:inline">创作</span>
      </h1>
      {MOBILE_WORKSPACE_TABS.map((item) => {
        const Icon = item.icon;
        const location = (Object.keys(dock.layout.zones) as DockZone[]).find(
          (zone) =>
            dock.layout.zones[zone].some((panel) => panel.type === item.id),
        );
        const active = isCompact ? mobileView === item.id : Boolean(location);
        return (
          <Button
            key={item.id}
            variant="ghost"
            type="button"
            aria-pressed={active}
            title={item.label}
            aria-label={item.label}
            onClick={() => {
              if (isCompact) setMobileView(item.id);
              else if (location)
                dock.layout.zones[location]
                  .filter((panel) => panel.type === item.id)
                  .forEach((panel) => dock.closePanel(location, panel.id));
              else dock.ensurePanel(item.id);
            }}
            className={cn(
              "h-11 gap-1.5 px-2 text-xs md:h-9",
              active ? "bg-brand/10 text-foreground" : "text-text-muted",
            )}
          >
            <Icon size={16} />
            <span className="max-[360px]:hidden">{item.label}</span>
          </Button>
        );
      })}
      {!isCompact ? (
        <>
          {renderAddMenu(
            "right",
            <IconButton
              type="button"
              variant="ghost"
              aria-label="更多工具"
              title="更多工具"
              className="h-9 w-9"
            >
              <Plus size={16} />
            </IconButton>,
          )}
          {renderPresetsMenu()}
        </>
      ) : null}
    </div>
  );

  if (isCompact) {
    return (
      <div
        ref={workspaceRef}
        className="flex h-full min-h-0 min-w-0 flex-col bg-background"
      >
        {toolbar}

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {children}
        </div>
        <Dialog
          open={mobileView !== null}
          onOpenChange={(open) => {
            if (!open) setMobileView(null);
          }}
        >
          <DialogContent
            aria-describedby={undefined}
            className="flex h-[min(85dvh,800px)] w-[calc(100vw-1rem)] max-w-xl flex-col overflow-hidden"
          >
            <DialogTitle className="shrink-0 border-b border-border p-3 text-sm">
              {PANEL_REGISTRY.find((item) => item.type === mobileView)?.title}
            </DialogTitle>
            <div className="min-h-0 flex-1">
              {mobileView ? renderPanel(mobileView) : null}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div ref={workspaceRef} className="flex h-full min-h-0 min-w-0 flex-col">
      {toolbar}
      {renderZone("top")}
      {dock.layout.zones.top.length > 0 ? renderZoneSplitter("top") : null}

      <div className="flex min-h-0 min-w-0 flex-1">
        {renderZone("left")}
        {dock.layout.zones.left.length > 0 ? renderZoneSplitter("left") : null}

        <div
          style={{ minWidth: MIN_CENTER_WIDTH }}
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
        >
          {children}
        </div>

        {dock.layout.zones.right.length > 0
          ? renderZoneSplitter("right")
          : null}
        {renderZone("right")}
      </div>

      {dock.layout.zones.bottom.length > 0
        ? renderZoneSplitter("bottom")
        : null}
      {renderZone("bottom")}
    </div>
  );
}
