"use client";

import { Button } from "@/components/ui";

import { Copy, Download, ImagePlus, Unlink, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { Generation, ModelInfo } from "../lib/types";
import {
  GenerateNodeBody,
  FrameNodeBody,
  TextNodeBody,
  ShapeNodeBody,
  DesignImageNodeBody,
  ModelNodeBody,
  NoteNodeBody,
  PromptNodeBody,
  QualityNodeBody,
  ReferenceNodeBody,
  StyleNodeBody,
} from "./node-bodies";
import {
  inPortAnchor,
  INPUT_PORTS,
  FRAME_INPUT_PORTS,
  IDLE_RUN,
  NODE_HEADER_H,
  NODE_META,
  NODE_WIDTH,
  estimatedNodeHeight,
  nodeCanConnectToPort,
  nodeHasOutput,
  outPortAnchor,
  type GraphEdge,
  type GraphNode,
  type InputPort,
  type NodeGraphState,
  type NodeKind,
  type NodeRunState,
  type Viewport,
} from "./node-graph-types";

interface NodeCanvasProps {
  graph: NodeGraphState;
  models: ModelInfo[];
  history: Generation[];
  runs: Record<string, NodeRunState>;
  uploads: Record<string, boolean>;
  validationHints: Record<string, string | null>;
  onMoveNodes: (moves: { id: string; x: number; y: number }[]) => void;
  onInteractionEnd: () => void;
  onUpdateNodeData: (id: string, patch: Record<string, unknown>) => void;
  onDuplicateNode: (id: string) => void;
  onDuplicateNodes: (ids: string[]) => string[] | void;
  onRemoveNode: (id: string) => void;
  onRemoveNodes: (ids: string[]) => void;
  onConnect: (from: string, to: string, toPort: InputPort) => void;
  onReorderReference: (edgeId: string, direction: "up" | "down") => void;
  onDisconnect: (edgeId: string) => void;
  onViewportChange: (viewport: Viewport) => void;
  onRun: (nodeId: string) => void;
  onCancel: (nodeId: string) => void;
  onUploadFile: (nodeId: string, file: File) => void;
  onDropFiles: (files: File[], position: { x: number; y: number }) => void;
  onOpenImage: (nodeId: string, index: number) => void;
  onResultAsReference: (
    nodeId: string,
    image: {
      id: string;
      url: string;
      thumbnailUrl: string;
      downloadUrl?: string;
    },
  ) => void;
  onResultAsDesignImage: (
    nodeId: string,
    image: {
      id: string;
      url: string;
      thumbnailUrl: string;
      downloadUrl?: string;
    },
  ) => void;
  onDownloadImage: (image: {
    id: string;
    url: string;
    thumbnailUrl: string;
    downloadUrl?: string;
  }) => void;
}

type Selection = { kind: "node" | "edge"; id: string } | null;

interface Connecting {
  from: string;
  cursor: { x: number; y: number };
}

interface SelectionMarquee {
  x: number;
  y: number;
  width: number;
  height: number;
}

function normalizeBounds(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): SelectionMarquee {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

function boundsIntersect(a: SelectionMarquee, b: SelectionMarquee): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

function edgePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const dx = Math.max(48, Math.abs(to.x - from.x) * 0.5);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

const PORT_HIT_SIZE = 40;
const PORT_SNAP_RADIUS = 28;
const EMPTY_NODES: GraphNode[] = [];
const EMPTY_EDGES: GraphEdge[] = [];

type ParentNodeActions = Pick<
  NodeCanvasProps,
  | "onUpdateNodeData"
  | "onDuplicateNode"
  | "onRemoveNode"
  | "onDisconnect"
  | "onReorderReference"
  | "onRun"
  | "onCancel"
  | "onUploadFile"
  | "onOpenImage"
  | "onResultAsReference"
  | "onResultAsDesignImage"
  | "onDownloadImage"
>;

interface CanvasNodeActions extends ParentNodeActions {
  onNodeMouseDown: (event: React.MouseEvent, node: GraphNode) => void;
  onConnectStart: (event: React.MouseEvent, node: GraphNode) => void;
}

interface CanvasNodeProps {
  node: GraphNode;
  models: ModelInfo[];
  history: Generation[];
  edges: GraphEdge[];
  run: NodeRunState;
  uploading: boolean;
  validationHint: string | null;
  selected: boolean;
  active: boolean;
  connecting: boolean;
  zoom: number;
  referenceOrder: number;
  modelSource: GraphNode | undefined;
  modelConnected: boolean;
  qualityConnected: boolean;
  frameLayers: GraphNode[];
  actions: CanvasNodeActions;
}

function sameArrayItems<T>(a: T[], b: T[]) {
  return (
    a === b ||
    (a.length === b.length && a.every((item, index) => item === b[index]))
  );
}

function areCanvasNodePropsEqual(
  previous: CanvasNodeProps,
  next: CanvasNodeProps,
) {
  if (
    !sameArrayItems(previous.edges, next.edges) ||
    !sameArrayItems(previous.frameLayers, next.frameLayers)
  ) {
    return false;
  }
  return (Object.keys(next) as (keyof CanvasNodeProps)[]).every(
    (key) =>
      key === "edges" ||
      key === "frameLayers" ||
      Object.is(previous[key], next[key]),
  );
}

function exportFrame(node: Extract<GraphNode, { kind: "frame" }>) {
  const svg = document.querySelector<SVGSVGElement>(
    `[data-frame-preview="${node.id}"]`,
  );
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(node.data.width));
  clone.setAttribute("height", String(node.data.height));
  clone.removeAttribute("class");
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], {
      type: "image/svg+xml",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${node.data.name.trim() || "design"}.svg`;
  link.click();
  URL.revokeObjectURL(url);
}

const CanvasNode = memo(function CanvasNode({
  node,
  models,
  history,
  edges,
  run,
  uploading,
  validationHint,
  selected,
  active,
  connecting,
  zoom,
  referenceOrder,
  modelSource,
  modelConnected,
  qualityConnected,
  frameLayers,
  actions,
}: CanvasNodeProps) {
  const meta = NODE_META[node.kind];
  const Icon = meta.icon;
  const {
    onUpdateNodeData,
    onDuplicateNode,
    onRemoveNode,
    onDisconnect,
    onReorderReference,
    onRun,
    onCancel,
    onUploadFile,
    onOpenImage,
    onResultAsReference,
    onResultAsDesignImage,
    onDownloadImage,
    onNodeMouseDown,
    onConnectStart,
  } = actions;
  const connectedModelId =
    modelSource?.kind === "model" ? modelSource.data.modelId : null;

  return (
    <div
      data-node-id={node.id}
      data-node-kind={node.kind}
      onMouseDown={(event) => onNodeMouseDown(event, node)}
      className={cn(
        "absolute touch-none cursor-grab select-none rounded-lg border bg-surface shadow-[var(--shadow-md)] active:cursor-grabbing",
        selected
          ? active
            ? "border-brand/80 ring-1 ring-brand/20"
            : "border-brand/45"
          : "border-border",
      )}
      aria-selected={selected || undefined}
      style={{ left: node.x, top: node.y, width: NODE_WIDTH }}
    >
      <header
        className="flex items-center gap-1.5 rounded-t-lg border-b border-border px-2"
        style={{ height: NODE_HEADER_H }}
      >
        <Icon size={12} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
          {meta.label}
        </span>
        {referenceOrder > 0 ? (
          <span
            className="shrink-0 rounded-full bg-brand/15 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-brand"
            title={`连接到生成节点时作为参考图 ${referenceOrder}`}
          >
            #{referenceOrder}
          </span>
        ) : null}
        <Button
          variant="ghost"
          type="button"
          aria-label="复制节点"
          title="复制节点"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onDuplicateNode(node.id)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded p-0 text-text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <Copy size={10} />
        </Button>
        <Button
          variant="ghost"
          type="button"
          aria-label="删除节点"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onRemoveNode(node.id)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded p-0 text-text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <X size={11} />
        </Button>
      </header>

      {nodeHasOutput(node.kind) ? (
        <Button
          variant="ghost"
          type="button"
          aria-label={`从「${meta.label}」连线到生成节点`}
          onMouseDown={(event) => onConnectStart(event, node)}
          className="group absolute z-20 flex -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full border-0 bg-transparent p-0 transition-colors hover:bg-brand/10"
          style={{
            top: NODE_HEADER_H / 2,
            right: -(PORT_HIT_SIZE / zoom) / 2,
            width: PORT_HIT_SIZE / zoom,
            height: PORT_HIT_SIZE / zoom,
          }}
        >
          <span
            className={cn(
              "h-3 w-3 rounded-full border transition-colors",
              connecting
                ? "border-brand bg-brand"
                : "border-border-strong bg-surface group-hover:border-brand",
            )}
          />
        </Button>
      ) : null}

      {node.kind === "prompt" ? (
        <PromptNodeBody
          node={node}
          onUpdate={(patch) => onUpdateNodeData(node.id, patch)}
        />
      ) : null}
      {node.kind === "style" ? (
        <StyleNodeBody
          node={node}
          onUpdate={(patch) => onUpdateNodeData(node.id, patch)}
        />
      ) : null}
      {node.kind === "reference" ? (
        <ReferenceNodeBody
          node={node}
          history={history}
          uploading={uploading}
          onUpdate={(patch) => onUpdateNodeData(node.id, patch)}
          onUploadFile={(file) => onUploadFile(node.id, file)}
        />
      ) : null}
      {node.kind === "model" ? (
        <ModelNodeBody
          node={node}
          models={models}
          onUpdate={(patch) => onUpdateNodeData(node.id, patch)}
        />
      ) : null}
      {node.kind === "quality" ? (
        <QualityNodeBody
          node={node}
          onUpdate={(patch) => onUpdateNodeData(node.id, patch)}
        />
      ) : null}
      {node.kind === "note" ? (
        <NoteNodeBody
          node={node}
          onUpdate={(patch) => onUpdateNodeData(node.id, patch)}
        />
      ) : null}
      {node.kind === "frame" ? (
        <FrameNodeBody
          node={node}
          onUpdate={(patch) => onUpdateNodeData(node.id, patch)}
        />
      ) : null}
      {node.kind === "text" ? (
        <TextNodeBody
          node={node}
          onUpdate={(patch) => onUpdateNodeData(node.id, patch)}
        />
      ) : null}
      {node.kind === "shape" ? (
        <ShapeNodeBody
          node={node}
          onUpdate={(patch) => onUpdateNodeData(node.id, patch)}
        />
      ) : null}
      {node.kind === "design-image" ? (
        <DesignImageNodeBody
          node={node}
          onUpdate={(patch) => onUpdateNodeData(node.id, patch)}
        />
      ) : null}
      {node.kind === "generate" ? (
        <GenerateNodeBody
          node={node}
          models={models}
          edges={edges}
          run={run}
          validationHint={validationHint}
          onUpdate={(patch) => onUpdateNodeData(node.id, patch)}
          modelConnected={modelConnected}
          effectiveModelId={connectedModelId}
          effectiveSize={
            modelSource?.kind === "model" ? modelSource.data.size : undefined
          }
          effectiveN={
            modelSource?.kind === "model" ? modelSource.data.n : undefined
          }
          effectiveOutputFormat={
            modelSource?.kind === "model"
              ? modelSource.data.outputFormat
              : undefined
          }
          qualityConnected={qualityConnected}
          onRun={() => onRun(node.id)}
          onCancel={() => onCancel(node.id)}
          onDisconnect={onDisconnect}
          onReorderReference={onReorderReference}
          onOpenImage={(index) => onOpenImage(node.id, index)}
          onResultAsReference={(image) => onResultAsReference(node.id, image)}
          onResultAsDesignImage={(image) =>
            onResultAsDesignImage(node.id, image)
          }
          onDownloadImage={onDownloadImage}
        />
      ) : null}
      {node.kind === "frame" ? (
        <div className="border-t border-border p-2">
          <svg
            data-frame-preview={node.id}
            viewBox={`0 0 ${node.data.width} ${node.data.height}`}
            className="max-h-36 w-full border border-border bg-white"
            aria-label={`${node.data.name} 预览`}
          >
            <rect width="100%" height="100%" fill={node.data.background} />
            {frameLayers.map((layer) => {
              if (layer.kind === "text")
                return (
                  <text
                    key={layer.id}
                    x={layer.data.x}
                    y={layer.data.y}
                    fontSize={layer.data.fontSize}
                    fill={layer.data.color}
                  >
                    {layer.data.text}
                  </text>
                );
              if (layer.kind === "shape" && layer.data.shape === "circle")
                return (
                  <ellipse
                    key={layer.id}
                    cx={layer.data.x + layer.data.width / 2}
                    cy={layer.data.y + layer.data.height / 2}
                    rx={layer.data.width / 2}
                    ry={layer.data.height / 2}
                    fill={layer.data.fill}
                  />
                );
              if (layer.kind === "shape")
                return (
                  <rect
                    key={layer.id}
                    x={layer.data.x}
                    y={layer.data.y}
                    width={layer.data.width}
                    height={layer.data.height}
                    fill={layer.data.fill}
                  />
                );
              if (layer.kind === "design-image" && layer.data.url)
                return (
                  <image
                    key={layer.id}
                    href={layer.data.url}
                    x={layer.data.x}
                    y={layer.data.y}
                    width={layer.data.width}
                    height={layer.data.height}
                    preserveAspectRatio={
                      layer.data.fit === "cover"
                        ? "xMidYMid slice"
                        : "xMidYMid meet"
                    }
                  />
                );
              return null;
            })}
          </svg>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-text-faint">
            <span>{frameLayers.length} 个图层</span>
            <Button
              variant="ghost"
              type="button"
              onClick={() => exportFrame(node)}
              title="导出 SVG"
              aria-label="导出 SVG"
              className="flex h-6 w-6 items-center justify-center p-0 text-text-muted hover:text-foreground"
            >
              <Download size={11} />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}, areCanvasNodePropsEqual);

const CanvasEdge = memo(function CanvasEdge({
  edge,
  fromNode,
  toNode,
  zoom,
  selected,
  onSelect,
  onPanStart,
}: {
  edge: GraphEdge;
  fromNode: GraphNode;
  toNode: GraphNode;
  zoom: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onPanStart: (event: React.MouseEvent) => void;
}) {
  const path = edgePath(
    outPortAnchor(fromNode),
    inPortAnchor(toNode, edge.toPort),
  );
  return (
    <g style={{ pointerEvents: "auto" }}>
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={24 / zoom}
        onMouseDown={(event) => {
          if (event.button === 1) {
            event.stopPropagation();
            onPanStart(event);
            return;
          }
          event.stopPropagation();
          event.preventDefault();
          onSelect(edge.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect(edge.id);
        }}
        className="cursor-pointer"
      />
      <path
        d={path}
        fill="none"
        strokeWidth={selected ? 2.5 : 1.5}
        className={cn(
          "pointer-events-none transition-colors",
          selected ? "stroke-brand" : "stroke-text-faint",
        )}
      />
    </g>
  );
});

const NodeInputPorts = memo(function NodeInputPorts({
  node,
  zoom,
  connectingFromId,
  connectingFromKind,
}: {
  node: GraphNode;
  zoom: number;
  connectingFromId: string | null;
  connectingFromKind: NodeKind | null;
}) {
  const ports = node.kind === "frame" ? FRAME_INPUT_PORTS : INPUT_PORTS;
  return ports.map((port) => {
    const anchor = inPortAnchor(node, port);
    const valid =
      connectingFromKind !== null &&
      connectingFromId !== node.id &&
      nodeCanConnectToPort(connectingFromKind, port);
    return (
      <span
        key={`${node.id}-${port}`}
        data-in-port-node={node.id}
        data-in-port-key={port}
        className={cn(
          "absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-transparent transition-colors",
          valid ? "bg-brand/10" : "hover:bg-brand/10",
        )}
        style={{
          left: anchor.x,
          top: anchor.y,
          width: PORT_HIT_SIZE / zoom,
          height: PORT_HIT_SIZE / zoom,
        }}
      >
        <span
          className={cn(
            "h-3 w-3 rounded-full border transition-colors",
            valid
              ? "border-brand bg-brand/60"
              : "border-border-strong bg-surface",
          )}
        />
      </span>
    );
  });
});

export function NodeCanvas({
  graph,
  models,
  history,
  runs,
  uploads,
  validationHints,
  onMoveNodes,
  onInteractionEnd,
  onUpdateNodeData,
  onDuplicateNode,
  onDuplicateNodes,
  onRemoveNode,
  onRemoveNodes,
  onConnect,
  onReorderReference,
  onDisconnect,
  onViewportChange,
  onRun,
  onCancel,
  onUploadFile,
  onDropFiles,
  onOpenImage,
  onResultAsReference,
  onResultAsDesignImage,
  onDownloadImage,
}: NodeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const interactionRectRef = useRef<DOMRect | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [connecting, setConnecting] = useState<Connecting | null>(null);
  const [panning, setPanning] = useState(false);
  const [selectionMarquee, setSelectionMarquee] =
    useState<SelectionMarquee | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragDepthRef = useRef(0);

  const { viewport } = graph;
  const nodesRef = useRef(graph.nodes);
  const graphRef = useRef(graph);
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  const nodeActionRef = useRef<ParentNodeActions>({
    onUpdateNodeData,
    onDuplicateNode,
    onRemoveNode,
    onDisconnect,
    onReorderReference,
    onRun,
    onCancel,
    onUploadFile,
    onOpenImage,
    onResultAsReference,
    onResultAsDesignImage,
    onDownloadImage,
  });
  nodesRef.current = graph.nodes;
  graphRef.current = graph;
  selectedNodeIdsRef.current = selectedNodeIds;
  nodeActionRef.current = {
    onUpdateNodeData,
    onDuplicateNode,
    onRemoveNode,
    onDisconnect,
    onReorderReference,
    onRun,
    onCancel,
    onUploadFile,
    onOpenImage,
    onResultAsReference,
    onResultAsDesignImage,
    onDownloadImage,
  };

  const selectedEdge =
    selection?.kind === "edge"
      ? (graph.edges.find((edge) => edge.id === selection.id) ?? null)
      : null;

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect =
      interactionRectRef.current ??
      containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const current = graphRef.current.viewport;
    return {
      x: (clientX - rect.left - current.x) / current.zoom,
      y: (clientY - rect.top - current.y) / current.zoom,
    };
  }, []);

  const findInputPortAtPoint = useCallback(
    (clientX: number, clientY: number, fromId: string) => {
      const rect =
        interactionRectRef.current ??
        containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const current = graphRef.current;
      const fromNode = current.nodes.find((item) => item.id === fromId);
      if (!fromNode) return null;
      const candidates: {
        nodeId: string;
        port: InputPort;
        distance: number;
      }[] = [];
      for (const node of current.nodes) {
        if (node.id === fromId) continue;
        if (node.kind !== "generate" && node.kind !== "frame") continue;
        const ports = node.kind === "frame" ? FRAME_INPUT_PORTS : INPUT_PORTS;
        for (const port of ports) {
          if (!nodeCanConnectToPort(fromNode.kind, port)) continue;
          const anchor = inPortAnchor(node, port);
          const x =
            rect.left + current.viewport.x + anchor.x * current.viewport.zoom;
          const y =
            rect.top + current.viewport.y + anchor.y * current.viewport.zoom;
          const distance = Math.hypot(clientX - x, clientY - y);
          if (distance <= PORT_SNAP_RADIUS) {
            candidates.push({ nodeId: node.id, port, distance });
          }
        }
      }
      return candidates.sort((a, b) => a.distance - b.distance)[0] ?? null;
    },
    [],
  );

  // ─── 滚轮缩放（以指针为中心） ───
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const scrollHost = target?.closest(
        "textarea, input, select, [contenteditable='true'], [data-node-scrollable]",
      );
      // 节点内的提示词、历史图片等滚动容器优先消费滚轮，避免被画布缩放截走。
      if (scrollHost) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const current = graphRef.current.viewport;
      const next = Math.min(
        1.75,
        Math.max(0.25, current.zoom * Math.exp(-event.deltaY * 0.0012)),
      );
      const scale = next / current.zoom;
      onViewportChange({
        zoom: next,
        x: px - (px - current.x) * scale,
        y: py - (py - current.y) * scale,
      });
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [onViewportChange]);

  // ─── Delete/Backspace 删除选中节点或连线 ───
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "c") {
        if (selectedNodeIds.length === 0) return;
        event.preventDefault();
        clipboardRef.current = [...selectedNodeIds];
        return;
      }
      if (modifier && event.key.toLowerCase() === "v") {
        if (clipboardRef.current.length === 0) return;
        event.preventDefault();
        const copied = onDuplicateNodes(clipboardRef.current);
        if (copied?.length) {
          setSelectedNodeIds(copied);
          setSelection({ kind: "node", id: copied.at(-1)! });
        }
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selection?.kind === "node") {
        event.preventDefault();
        if (selectedNodeIds.length > 1) onRemoveNodes(selectedNodeIds);
        else onRemoveNode(selection.id);
        setSelectedNodeIds([]);
        setSelection(null);
      } else if (selection?.kind === "edge") {
        event.preventDefault();
        onDisconnect(selection.id);
        setSelection(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    onDisconnect,
    onDuplicateNodes,
    onRemoveNode,
    onRemoveNodes,
    selectedNodeIds,
    selection,
  ]);

  // ─── 拖拽交互：鼠标事件 + window 级监听 + ref ───
  // 不用 PointerEvent：部分浏览器/内嵌 webview 不下发 pointer 事件，
  // 鼠标事件是全环境兼容的兜底方案。
  type DragInfo =
    | { type: "pan"; startX: number; startY: number; base: Viewport }
    | {
        type: "node";
        ids: string[];
        offsets: Record<string, { x: number; y: number }>;
      }
    | { type: "connect"; from: string }
    | {
        type: "marquee";
        startX: number;
        startY: number;
        baseSelection: string[];
      };

  const dragRef = useRef<DragInfo | null>(null);
  const clipboardRef = useRef<string[]>([]);
  const latestRef = useRef({
    toWorld,
    findInputPortAtPoint,
    onViewportChange,
    onMoveNodes,
    onConnect,
    onInteractionEnd,
  });
  latestRef.current = {
    toWorld,
    findInputPortAtPoint,
    onViewportChange,
    onMoveNodes,
    onConnect,
    onInteractionEnd,
  };

  const mouseMoveFrameRef = useRef<number | null>(null);
  const pendingMouseMoveRef = useRef<{
    clientX: number;
    clientY: number;
  } | null>(null);

  useEffect(() => {
    const applyMouseMove = (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      const latest = latestRef.current;
      if (drag.type === "pan") {
        latest.onViewportChange({
          zoom: drag.base.zoom,
          x: drag.base.x + (clientX - drag.startX),
          y: drag.base.y + (clientY - drag.startY),
        });
      } else if (drag.type === "node") {
        const pos = latest.toWorld(clientX, clientY);
        const firstId = drag.ids[0];
        const firstOffset = firstId ? drag.offsets[firstId] : undefined;
        if (firstOffset) {
          const nextFirstX = pos.x - firstOffset.x;
          const nextFirstY = pos.y - firstOffset.y;
          latest.onMoveNodes(
            drag.ids.map((id) => {
              const offset = drag.offsets[id] ?? firstOffset;
              return {
                id,
                x: Math.round(nextFirstX + firstOffset.x - offset.x),
                y: Math.round(nextFirstY + firstOffset.y - offset.y),
              };
            }),
          );
        }
      } else if (drag.type === "marquee") {
        const cursor = latest.toWorld(clientX, clientY);
        const bounds = normalizeBounds(
          drag.startX,
          drag.startY,
          cursor.x,
          cursor.y,
        );
        setSelectionMarquee(bounds);
        const hitIds = nodesRef.current
          .filter((node) =>
            boundsIntersect(bounds, {
              x: node.x,
              y: node.y,
              width: NODE_WIDTH,
              height: estimatedNodeHeight(node),
            }),
          )
          .map((node) => node.id);
        const merged = drag.baseSelection.length
          ? [...new Set([...drag.baseSelection, ...hitIds])]
          : hitIds;
        setSelectedNodeIds((current) =>
          current.length === merged.length &&
          current.every((id, index) => id === merged[index])
            ? current
            : merged,
        );
        const nextSelection = merged.length
          ? ({ kind: "node", id: merged.at(-1)! } as const)
          : null;
        setSelection((current) =>
          current?.kind === nextSelection?.kind &&
          current?.id === nextSelection?.id
            ? current
            : nextSelection,
        );
      } else {
        setConnecting((current) =>
          current
            ? { ...current, cursor: latest.toWorld(clientX, clientY) }
            : current,
        );
      }
    };

    const cancelScheduledMove = () => {
      if (mouseMoveFrameRef.current !== null) {
        window.cancelAnimationFrame(mouseMoveFrameRef.current);
        mouseMoveFrameRef.current = null;
      }
    };
    const flushMouseMove = () => {
      mouseMoveFrameRef.current = null;
      const pending = pendingMouseMoveRef.current;
      pendingMouseMoveRef.current = null;
      if (pending) applyMouseMove(pending.clientX, pending.clientY);
    };
    const handleMove = (event: MouseEvent) => {
      if (!dragRef.current) return;
      pendingMouseMoveRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
      };
      if (mouseMoveFrameRef.current === null) {
        mouseMoveFrameRef.current =
          window.requestAnimationFrame(flushMouseMove);
      }
    };

    const handleUp = (event: MouseEvent) => {
      if (!dragRef.current) return;
      pendingMouseMoveRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
      };
      cancelScheduledMove();
      flushMouseMove();
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      latestRef.current.onInteractionEnd();
      setPanning(false);
      if (drag.type === "marquee") setSelectionMarquee(null);
      if (drag.type === "connect") {
        const hit = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest("[data-in-port-node]");
        const directTo = hit?.getAttribute("data-in-port-node");
        const directPort = hit?.getAttribute(
          "data-in-port-key",
        ) as InputPort | null;
        const snapped = latestRef.current.findInputPortAtPoint(
          event.clientX,
          event.clientY,
          drag.from,
        );
        const directNode = directTo
          ? graphRef.current.nodes.find((node) => node.id === directTo)
          : undefined;
        const directIsValid = Boolean(
          directNode &&
          directPort &&
          directNode.id !== drag.from &&
          nodeCanConnectToPort(
            graphRef.current.nodes.find((node) => node.id === drag.from)
              ?.kind ?? "note",
            directPort,
          ),
        );
        const to = directIsValid ? directTo : snapped?.nodeId;
        const toPort = directIsValid ? directPort : snapped?.port;
        if (to && toPort) {
          latestRef.current.onConnect(drag.from, to, toPort);
        }
        setConnecting(null);
      }
      interactionRectRef.current = null;
    };

    const handleBlur = () => {
      cancelScheduledMove();
      pendingMouseMoveRef.current = null;
      dragRef.current = null;
      interactionRectRef.current = null;
      latestRef.current.onInteractionEnd();
      setPanning(false);
      setConnecting(null);
      setSelectionMarquee(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      cancelScheduledMove();
      pendingMouseMoveRef.current = null;
      interactionRectRef.current = null;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const startPan = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    interactionRectRef.current = null;
    dragRef.current = {
      type: "pan",
      startX: event.clientX,
      startY: event.clientY,
      base: graphRef.current.viewport,
    };
    setPanning(true);
  }, []);

  // ─── 空白处框选；中键始终平移，即使指针停在节点上 ───
  const handleCanvasMouseDown = (event: React.MouseEvent) => {
    if (event.button === 1) {
      startPan(event);
      return;
    }
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    if (
      target?.closest(
        "[data-node-id], [data-in-port-node], button, input, textarea, select, a",
      )
    ) {
      return;
    }
    interactionRectRef.current =
      containerRef.current?.getBoundingClientRect() ?? null;
    const start = toWorld(event.clientX, event.clientY);
    dragRef.current = {
      type: "marquee",
      startX: start.x,
      startY: start.y,
      baseSelection: event.shiftKey ? selectedNodeIds : [],
    };
    setSelectionMarquee({ x: start.x, y: start.y, width: 0, height: 0 });
    if (!event.shiftKey) {
      setSelectedNodeIds([]);
      setSelection(null);
    }
  };

  // ─── 节点拖拽（整张卡片，除表单控件与端口） ───
  const handleNodeMouseDown = useCallback(
    (event: React.MouseEvent, node: GraphNode) => {
      if (event.button === 1) {
        event.stopPropagation();
        startPan(event);
        return;
      }
      if (event.button !== 0) return;
      event.stopPropagation();
      setSelection({ kind: "node", id: node.id });
      if (event.shiftKey) {
        setSelectedNodeIds((current) => {
          const next = current.includes(node.id)
            ? current.filter((id) => id !== node.id)
            : [...current, node.id];
          setSelection(next.length ? { kind: "node", id: node.id } : null);
          return next;
        });
        return;
      }
      const selectedIds = selectedNodeIdsRef.current;
      const target = event.target as HTMLElement;
      if (
        target.closest(
          "input, textarea, select, option, button, summary, a, [data-in-port-node]",
        )
      ) {
        if (!selectedIds.includes(node.id)) setSelectedNodeIds([node.id]);
        return;
      }
      event.preventDefault();
      interactionRectRef.current =
        containerRef.current?.getBoundingClientRect() ?? null;
      const origin = toWorld(event.clientX, event.clientY);
      const ids = selectedIds.includes(node.id) ? selectedIds : [node.id];
      if (!selectedIds.includes(node.id)) setSelectedNodeIds([node.id]);
      const idSet = new Set(ids);
      const offsets = Object.fromEntries(
        graphRef.current.nodes
          .filter((candidate) => idSet.has(candidate.id))
          .map((candidate) => [
            candidate.id,
            { x: origin.x - candidate.x, y: origin.y - candidate.y },
          ]),
      );
      dragRef.current = { type: "node", ids, offsets };
    },
    [startPan, toWorld],
  );

  // ─── 连线：从输出端口拖出 ───
  const handleConnectStart = useCallback(
    (event: React.MouseEvent, node: GraphNode) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      interactionRectRef.current =
        containerRef.current?.getBoundingClientRect() ?? null;
      dragRef.current = { type: "connect", from: node.id };
      setConnecting({
        from: node.id,
        cursor: toWorld(event.clientX, event.clientY),
      });
    },
    [toWorld],
  );

  const hasDraggedFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const handleDragEnter = (event: React.DragEvent) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    fileDragDepthRef.current += 1;
    setFileDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (!hasDraggedFiles(event)) return;
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) setFileDragActive(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
    const files = Array.from(event.dataTransfer.files).filter((file) =>
      ["image/png", "image/jpeg", "image/webp"].includes(file.type),
    );
    if (files.length === 0) return;
    onDropFiles(files, toWorld(event.clientX, event.clientY));
  };

  const nodeActions = useMemo<CanvasNodeActions>(
    () => ({
      onUpdateNodeData: (id, patch) =>
        nodeActionRef.current.onUpdateNodeData(id, patch),
      onDuplicateNode: (id) => nodeActionRef.current.onDuplicateNode(id),
      onRemoveNode: (id) => nodeActionRef.current.onRemoveNode(id),
      onDisconnect: (id) => nodeActionRef.current.onDisconnect(id),
      onReorderReference: (id, direction) =>
        nodeActionRef.current.onReorderReference(id, direction),
      onRun: (id) => nodeActionRef.current.onRun(id),
      onCancel: (id) => nodeActionRef.current.onCancel(id),
      onUploadFile: (id, file) => nodeActionRef.current.onUploadFile(id, file),
      onOpenImage: (id, index) => nodeActionRef.current.onOpenImage(id, index),
      onResultAsReference: (id, image) =>
        nodeActionRef.current.onResultAsReference(id, image),
      onResultAsDesignImage: (id, image) =>
        nodeActionRef.current.onResultAsDesignImage(id, image),
      onDownloadImage: (image) => nodeActionRef.current.onDownloadImage(image),
      onNodeMouseDown: handleNodeMouseDown,
      onConnectStart: handleConnectStart,
    }),
    [handleConnectStart, handleNodeMouseDown],
  );
  const handleSelectEdge = useCallback((id: string) => {
    setSelection({ kind: "edge", id });
    setSelectedNodeIds([]);
  }, []);

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const selectedNodeIdSet = useMemo(
    () => new Set(selectedNodeIds),
    [selectedNodeIds],
  );
  const relations = useMemo(() => {
    const referenceGroups = new Map<string, GraphEdge[]>();
    const referenceOrders = new Map<string, number>();
    const modelSources = new Map<string, GraphNode>();
    const connectedPorts = new Set<string>();
    const frameLayers = new Map<string, GraphNode[]>();
    const incomingEdges = new Map<string, GraphEdge[]>();
    for (const edge of graph.edges) {
      const incoming = incomingEdges.get(edge.to) ?? [];
      incoming.push(edge);
      incomingEdges.set(edge.to, incoming);
      if (edge.toPort === "reference") {
        const group = referenceGroups.get(edge.to) ?? [];
        group.push(edge);
        referenceGroups.set(edge.to, group);
      }
      if (edge.toPort === "model" || edge.toPort === "quality") {
        connectedPorts.add(`${edge.to}:${edge.toPort}`);
      }
      if (edge.toPort === "model") {
        const source = nodeById.get(edge.from);
        if (source) modelSources.set(edge.to, source);
      }
      if (edge.toPort === "layer") {
        const source = nodeById.get(edge.from);
        if (source) {
          const layers = frameLayers.get(edge.to) ?? [];
          layers.push(source);
          frameLayers.set(edge.to, layers);
        }
      }
    }
    for (const group of referenceGroups.values()) {
      group.forEach((edge, index) => referenceOrders.set(edge.from, index + 1));
    }
    return {
      referenceOrders,
      modelSources,
      connectedPorts,
      frameLayers,
      incomingEdges,
    };
  }, [graph.edges, nodeById]);
  const connectingFrom = connecting ? nodeById.get(connecting.from) : undefined;

  return (
    <div
      ref={containerRef}
      data-node-canvas
      onMouseDown={handleCanvasMouseDown}
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "relative h-full w-full touch-none overflow-hidden bg-background",
        panning ? "cursor-grabbing" : "cursor-grab",
      )}
      style={{
        backgroundImage:
          "radial-gradient(circle, rgb(var(--border) / 0.8) 1px, transparent 1px)",
        backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {/* 连线层 */}
        <svg
          className="absolute left-0 top-0"
          style={{ overflow: "visible", pointerEvents: "none" }}
          width={1}
          height={1}
        >
          {graph.edges.map((edge) => {
            const fromNode = nodeById.get(edge.from);
            const toNode = nodeById.get(edge.to);
            if (!fromNode || !toNode) return null;
            return (
              <CanvasEdge
                key={edge.id}
                edge={edge}
                fromNode={fromNode}
                toNode={toNode}
                zoom={viewport.zoom}
                selected={
                  selection?.kind === "edge" && selection.id === edge.id
                }
                onSelect={handleSelectEdge}
                onPanStart={startPan}
              />
            );
          })}
          {connecting && connectingFrom ? (
            <path
              d={edgePath(outPortAnchor(connectingFrom), connecting.cursor)}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              className="stroke-brand"
            />
          ) : null}
        </svg>

        {/* 节点层 */}
        {graph.nodes.map((node) => (
          <CanvasNode
            key={node.id}
            node={node}
            models={models}
            history={history}
            edges={relations.incomingEdges.get(node.id) ?? EMPTY_EDGES}
            run={runs[node.id] ?? IDLE_RUN}
            uploading={Boolean(uploads[node.id])}
            validationHint={validationHints[node.id] ?? null}
            selected={selectedNodeIdSet.has(node.id)}
            active={selection?.kind === "node" && selection.id === node.id}
            connecting={connecting?.from === node.id}
            zoom={viewport.zoom}
            referenceOrder={relations.referenceOrders.get(node.id) ?? 0}
            modelSource={relations.modelSources.get(node.id)}
            modelConnected={relations.connectedPorts.has(`${node.id}:model`)}
            qualityConnected={relations.connectedPorts.has(
              `${node.id}:quality`,
            )}
            frameLayers={relations.frameLayers.get(node.id) ?? EMPTY_NODES}
            actions={nodeActions}
          />
        ))}

        {/* 输入端口锚点（生成节点，位置与 PORT_ROW 行高严格对齐） */}
        {graph.nodes
          .filter((node) => node.kind === "generate" || node.kind === "frame")
          .map((node) => (
            <NodeInputPorts
              key={node.id}
              node={node}
              zoom={viewport.zoom}
              connectingFromId={connecting?.from ?? null}
              connectingFromKind={connectingFrom?.kind ?? null}
            />
          ))}
        {selectionMarquee ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-40 border border-brand bg-brand/10"
            style={{
              left: selectionMarquee.x,
              top: selectionMarquee.y,
              width: selectionMarquee.width,
              height: selectionMarquee.height,
            }}
          />
        ) : null}
      </div>

      {selectedNodeIds.length > 1 ? (
        <div
          onMouseDown={(event) => event.stopPropagation()}
          className="absolute left-3 top-3 z-40 flex items-center gap-2 rounded-md border border-border bg-surface/95 px-2 py-1.5 text-[11px] shadow-[var(--shadow-md)] backdrop-blur-sm"
        >
          <span className="tabular-nums text-text-muted">
            已选 {selectedNodeIds.length} 个节点
          </span>
          <Button
            variant="ghost"
            type="button"
            aria-label="复制所选节点"
            title="复制所选节点"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => {
              const copied = onDuplicateNodes(selectedNodeIds);
              if (copied?.length) {
                setSelectedNodeIds(copied);
                setSelection({ kind: "node", id: copied.at(-1)! });
              }
            }}
            className="flex h-6 items-center gap-1 rounded px-1.5 text-text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <Copy size={11} />
            复制
          </Button>
          <Button
            variant="ghost"
            type="button"
            aria-label="删除所选节点"
            title="删除所选节点"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => {
              onRemoveNodes(selectedNodeIds);
              setSelectedNodeIds([]);
              setSelection(null);
            }}
            className="flex h-6 items-center gap-1 rounded px-1.5 text-danger hover:bg-danger/10"
          >
            <X size={11} />
            删除
          </Button>
        </div>
      ) : null}

      {selectedEdge ? (
        <div
          onMouseDown={(event) => event.stopPropagation()}
          className="absolute left-3 top-14 z-40 flex items-center gap-2 rounded-md border border-brand/40 bg-surface/95 px-2 py-1.5 text-[11px] shadow-[var(--shadow-md)] backdrop-blur-sm"
        >
          <Unlink size={12} className="text-brand" />
          <span className="text-text-muted">已选中连线</span>
          <Button
            variant="ghost"
            type="button"
            aria-label="断开选中连线"
            title="断开选中连线"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => {
              onDisconnect(selectedEdge.id);
              setSelection(null);
            }}
            className="flex h-6 items-center gap-1 rounded px-1.5 text-danger hover:bg-danger/10"
          >
            <X size={11} />
            断开
          </Button>
        </div>
      ) : null}

      {graph.nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-xs text-text-faint">
            画布是空的，从上方工具栏添加节点开始
          </p>
        </div>
      ) : null}

      {fileDragActive ? (
        <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-lg border border-dashed border-brand bg-background/75 backdrop-blur-[2px]">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ImagePlus size={16} className="text-brand" />
            添加参考图
          </div>
        </div>
      ) : null}
    </div>
  );
}
