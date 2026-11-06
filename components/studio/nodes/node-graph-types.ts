import type { LucideIcon } from "lucide-react";
import type { ImageQuality } from "@/lib/models/types";
import {
  Gauge,
  ImagePlus,
  Palette,
  Play,
  SlidersHorizontal,
  StickyNote,
  Type,
  Frame,
  Square,
} from "lucide-react";

// 节点图数据模型（ComfyUI 式：节点 + 有向连线 → 编译为一次生成请求）

export type NodeKind =
  | "prompt"
  | "style"
  | "reference"
  | "model"
  | "quality"
  | "note"
  | "generate"
  | "frame"
  | "text"
  | "shape"
  | "design-image";

/** 生成节点的输入端口。 */
export type InputPort = "prompt" | "reference" | "model" | "quality" | "layer";

export interface PromptNodeData {
  text: string;
}

export interface StyleNodeData {
  preset: string;
  text: string;
}

export interface ReferenceNodeData {
  kind: "upload" | "source";
  key: string;
  previewUrl: string;
}

export interface ModelNodeData {
  modelId: string | null;
  size?: string;
  n: number;
  outputFormat?: string;
  providerChannelId?: string;
}

export interface QualityNodeData {
  quality: ImageQuality;
  /** Historical persisted value; read-only migration fallback. */
  image2Mode?: "standard" | "high";
  background: "auto" | "opaque";
}

export interface NoteNodeData {
  text: string;
}

/** 生成节点可独立运行的模型与参数。 */
export interface GenerateNodeData {
  note?: string;
  modelId?: string | null;
  size?: string;
  n?: number;
  outputFormat?: string;
  quality?: ImageQuality;
  image2Mode?: "standard" | "high";
  background?: string;
}

export interface FrameNodeData {
  width: number;
  height: number;
  background: string;
  name: string;
}

export interface TextNodeData {
  text: string;
  fontSize: number;
  color: string;
  x: number;
  y: number;
}

export interface ShapeNodeData {
  shape: "rectangle" | "circle";
  width: number;
  height: number;
  fill: string;
  x: number;
  y: number;
}

export interface DesignImageNodeData {
  url: string;
  imageId?: string;
  fit: "cover" | "contain";
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BaseNode<K extends NodeKind, D> {
  id: string;
  kind: K;
  x: number;
  y: number;
  data: D;
}

export type GraphNode =
  | BaseNode<"prompt", PromptNodeData>
  | BaseNode<"style", StyleNodeData>
  | BaseNode<"reference", ReferenceNodeData>
  | BaseNode<"model", ModelNodeData>
  | BaseNode<"quality", QualityNodeData>
  | BaseNode<"note", NoteNodeData>
  | BaseNode<"generate", GenerateNodeData>
  | BaseNode<"frame", FrameNodeData>
  | BaseNode<"text", TextNodeData>
  | BaseNode<"shape", ShapeNodeData>
  | BaseNode<"design-image", DesignImageNodeData>;

export interface GraphEdge {
  id: string;
  /** 上游节点（输出端）。 */
  from: string;
  /** 生成节点（输入端）。 */
  to: string;
  toPort: InputPort;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface NodeGraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewport: Viewport;
}

// 画布几何常量（端口锚点由此推导，避免测量 DOM）

export const NODE_WIDTH = 244;
export const NODE_HEADER_H = 34;
export const PORT_ROW_H = 22;

export function outPortAnchor(node: GraphNode): { x: number; y: number } {
  return { x: node.x + NODE_WIDTH, y: node.y + NODE_HEADER_H / 2 };
}

export function inPortAnchor(
  node: GraphNode,
  port: InputPort,
): { x: number; y: number } {
  const ports = node.kind === "frame" ? FRAME_INPUT_PORTS : INPUT_PORTS;
  const index = ports.indexOf(port);
  return {
    x: node.x,
    y: node.y + NODE_HEADER_H + index * PORT_ROW_H + PORT_ROW_H / 2,
  };
}

// 端口与节点元信息

export const INPUT_PORTS: InputPort[] = [
  "prompt",
  "reference",
  "model",
  "quality",
];

export const FRAME_INPUT_PORTS: InputPort[] = ["layer"];

export const PORT_LABEL: Record<InputPort, string> = {
  prompt: "提示词",
  reference: "参考图",
  model: "模型参数",
  quality: "Image2 设置",
  layer: "图层",
};

/** 各输入端口接受的上游节点类型。 */
export const PORT_ACCEPTS: Record<InputPort, readonly NodeKind[]> = {
  prompt: ["prompt", "style"],
  reference: ["reference"],
  model: ["model"],
  quality: ["quality"],
  layer: ["text", "shape", "design-image"],
};

export const SINGLE_INPUT_PORTS = new Set<InputPort>(["model", "quality"]);

export function nodeCanConnectToPort(kind: NodeKind, port: InputPort): boolean {
  return PORT_ACCEPTS[port].includes(kind);
}

export function nodeHasOutput(kind: NodeKind): boolean {
  return kind !== "generate" && kind !== "note" && kind !== "frame";
}

export const NODE_META: Record<NodeKind, { label: string; icon: LucideIcon }> =
  {
    prompt: { label: "提示词", icon: Type },
    style: { label: "风格预设", icon: Palette },
    reference: { label: "参考图", icon: ImagePlus },
    model: { label: "模型与参数", icon: SlidersHorizontal },
    quality: { label: "Image2 设置", icon: Gauge },
    note: { label: "批注", icon: StickyNote },
    generate: { label: "生成", icon: Play },
    frame: { label: "画板", icon: Frame },
    text: { label: "文字", icon: Type },
    shape: { label: "形状", icon: Square },
    "design-image": { label: "设计图片", icon: ImagePlus },
  };

let idCounter = 0;
export function nextGraphId(prefix: string): string {
  idCounter += 1;
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function defaultNodeData(kind: NodeKind): GraphNode["data"] {
  switch (kind) {
    case "prompt":
      return { text: "" } satisfies PromptNodeData;
    case "style":
      return {
        preset: "cinematic",
        text: "电影感构图，层次丰富的光影，细腻质感",
      } satisfies StyleNodeData;
    case "reference":
      return {
        kind: "upload",
        key: "",
        previewUrl: "",
      } satisfies ReferenceNodeData;
    case "model":
      return { modelId: null, n: 1 } satisfies ModelNodeData;
    case "quality":
      return {
        quality: "high",
        background: "auto",
      } satisfies QualityNodeData;
    case "note":
      return { text: "" } satisfies NoteNodeData;
    case "generate":
      return {} satisfies GenerateNodeData;
    case "frame":
      return {
        width: 1080,
        height: 1350,
        background: "#ffffff",
        name: "新画板",
      } satisfies FrameNodeData;
    case "text":
      return {
        text: "双击编辑文字",
        fontSize: 48,
        color: "#111111",
        x: 80,
        y: 100,
      } satisfies TextNodeData;
    case "shape":
      return {
        shape: "rectangle",
        width: 320,
        height: 180,
        fill: "#dbeafe",
        x: 80,
        y: 220,
      } satisfies ShapeNodeData;
    case "design-image":
      return {
        url: "",
        fit: "cover",
        x: 80,
        y: 440,
        width: 640,
        height: 480,
      } satisfies DesignImageNodeData;
  }
}

const ESTIMATED_NODE_HEIGHT: Record<NodeKind, number> = {
  prompt: 150,
  style: 150,
  reference: 130,
  model: 190,
  quality: 108,
  note: 150,
  generate: NODE_HEADER_H + INPUT_PORTS.length * PORT_ROW_H + 96,
  frame: 300,
  text: 176,
  shape: 176,
  "design-image": 190,
};

export function estimatedNodeHeightForKind(kind: NodeKind): number {
  return ESTIMATED_NODE_HEIGHT[kind];
}

export function estimatedNodeHeight(node: GraphNode): number {
  return estimatedNodeHeightForKind(node.kind);
}

/** 首次打开时的示例图：提示词 → 生成 ← 模型与参数。 */
export function defaultGraph(): NodeGraphState {
  const promptNode: GraphNode = {
    id: "default-prompt",
    kind: "prompt",
    x: 40,
    y: 60,
    data: { text: "" },
  };
  const modelNode: GraphNode = {
    id: "default-model",
    kind: "model",
    x: 40,
    y: 260,
    data: { modelId: null, n: 1 },
  };
  const generateNode: GraphNode = {
    id: "default-generate",
    kind: "generate",
    x: 380,
    y: 140,
    data: {},
  };
  return {
    nodes: [promptNode, modelNode, generateNode],
    edges: [
      {
        id: "default-edge-prompt",
        from: promptNode.id,
        to: generateNode.id,
        toPort: "prompt",
      },
      {
        id: "default-edge-model",
        from: modelNode.id,
        to: generateNode.id,
        toPort: "model",
      },
    ],
    viewport: { x: 24, y: 16, zoom: 1 },
  };
}

// 运行时执行状态（不持久化）

export interface NodeRunState {
  generationId: string | null;
  status: "idle" | "running" | "succeeded" | "failed" | "canceled";
  progress: number;
  images: {
    id: string;
    url: string;
    thumbnailUrl: string;
    downloadUrl?: string;
  }[];
  error: string | null;
}

export const IDLE_RUN: NodeRunState = {
  generationId: null,
  status: "idle",
  progress: 0,
  images: [],
  error: null,
};
