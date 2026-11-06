import type { LucideIcon } from "lucide-react";
import {
  History,
  Images,
  Lightbulb,
  ListChecks,
  MessageSquare,
  SlidersHorizontal,
  SquarePen,
} from "lucide-react";

/** 可停靠区域：中心内容区四周的四条边。 */
export type DockZone = "left" | "right" | "top" | "bottom";

export type PanelType =
  | "conversation"
  | "composer"
  | "history"
  | "queue"
  | "params"
  | "references"
  | "inspiration";

export interface DockPanelState {
  id: string;
  type: PanelType;
  /** 同一区域内多个面板的空间分配权重。 */
  grow: number;
}

export interface DockLayoutState {
  zones: Record<DockZone, DockPanelState[]>;
  /** left/right 为宽度、top/bottom 为高度（px）。 */
  zoneSize: Record<DockZone, number>;
}

export interface PanelMeta {
  type: PanelType;
  title: string;
  icon: LucideIcon;
  /** 通过「确保存在」逻辑（如 initialThreadId）补开时的默认停靠边。 */
  defaultZone: DockZone;
}

export const PANEL_REGISTRY: readonly PanelMeta[] = [
  {
    type: "conversation",
    title: "对话",
    icon: MessageSquare,
    defaultZone: "right",
  },
  {
    type: "composer",
    title: "提示词编辑",
    icon: SquarePen,
    defaultZone: "bottom",
  },
  {
    type: "history",
    title: "历史生成",
    icon: History,
    defaultZone: "left",
  },
  {
    type: "queue",
    title: "生成队列",
    icon: ListChecks,
    defaultZone: "right",
  },
  {
    type: "params",
    title: "生成参数",
    icon: SlidersHorizontal,
    defaultZone: "left",
  },
  {
    type: "references",
    title: "参考图",
    icon: Images,
    defaultZone: "bottom",
  },
  {
    type: "inspiration",
    title: "提示词灵感",
    icon: Lightbulb,
    defaultZone: "left",
  },
] as const;

export function panelMeta(type: PanelType): PanelMeta {
  const meta = PANEL_REGISTRY.find((item) => item.type === type);
  if (!meta) throw new Error(`Unknown panel type: ${type}`);
  return meta;
}

export const ZONE_LABEL: Record<DockZone, string> = {
  left: "左侧",
  right: "右侧",
  top: "顶部",
  bottom: "底部",
};

export const DEFAULT_LAYOUT: DockLayoutState = {
  zones: {
    left: [],
    right: [],
    top: [],
    bottom: [],
  },
  zoneSize: { left: 288, right: 380, top: 260, bottom: 260 },
};

export const ZONE_MIN_SIZE: Record<DockZone, number> = {
  left: 220,
  right: 280,
  top: 160,
  bottom: 160,
};

export const ZONE_MAX_SIZE: Record<DockZone, number> = {
  left: 560,
  right: 640,
  top: 480,
  bottom: 480,
};

/** Dock 模式下为中心创作区保留的最小空间。 */
export const MIN_CENTER_WIDTH = 480;
export const MIN_CENTER_HEIGHT = 320;

/** 区域分隔条的实际占用尺寸，与 DockWorkspace 中的 5px 保持一致。 */
export const ZONE_SPLITTER_SIZE = 5;

/** 小于该宽度时切换为单面板标签模式，避免左右栏挤压中心区。 */
export const DOCK_COMPACT_BREAKPOINT = 1100;
