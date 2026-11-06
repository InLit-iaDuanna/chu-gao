"use client";

import { Button } from "@/components/ui";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  Copy,
  ImagePlus,
  LayoutGrid,
  Maximize2,
  Play,
  RotateCcw,
  StickyNote,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { GalleryImage } from "./gallery-images";
import { CanvasIconButton, CanvasNodeView } from "./InfiniteCanvasNodes";
import {
  arrangedNodes,
  boundsFor,
  clamp,
  createImageNode,
  createWorkflowOutputNode,
  DEFAULT_VIEWPORT,
  dimensionsForImage,
  hasImageNode,
  imageKeyForNode,
  isInteractiveTarget,
  MAX_SCALE,
  maxNodeZ,
  MIN_SCALE,
  nextAutoPosition,
  nextNodeId,
  parseStoredCanvas,
  resizeNode,
  sourceFromImage,
  sourcesFromGeneration,
  storageKeyFor,
  TEXT_NODE_HEIGHT,
  TEXT_NODE_WIDTH,
  type CanvasImageSource,
  type CanvasEdge,
  type CanvasGeneration,
  type CanvasNode,
  type CanvasTextNode,
  type CanvasViewport,
  type DragState,
  type StoredCanvas,
} from "./infinite-canvas-model";
import { cn } from "@/lib/utils";

interface InfiniteCanvasProps {
  accountId: string | null;
  conversationId: string | null;
  generations: CanvasGeneration[];
  activeGeneration: CanvasGeneration | null;
  activeImage: GalleryImage | null;
  className?: string;
}

function edgePathBetween(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): string {
  const bend = Math.max(56, Math.abs(endX - startX) * 0.45);
  return (
    "M " +
    startX +
    " " +
    startY +
    " C " +
    (startX + bend) +
    " " +
    startY +
    ", " +
    (endX - bend) +
    " " +
    endY +
    ", " +
    endX +
    " " +
    endY
  );
}

function edgePath(source: CanvasNode, target: CanvasNode): string {
  return edgePathBetween(
    source.x + source.width,
    source.y + source.height / 2,
    target.x,
    target.y + target.height / 2,
  );
}

export function InfiniteCanvas({
  accountId,
  conversationId,
  generations,
  activeGeneration,
  activeImage,
  className,
}: InfiniteCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const storageKey = useMemo(
    () => storageKeyFor(accountId, conversationId),
    [accountId, conversationId],
  );
  const draftStorageKey = useMemo(
    () => storageKeyFor(accountId, null),
    [accountId],
  );

  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [hiddenImageKeys, setHiddenImageKeys] = useState<string[]>([]);
  const [viewport, setViewport] = useState<CanvasViewport>(DEFAULT_VIEWPORT);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<{
    sourceId: string;
    x: number;
    y: number;
  } | null>(null);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [workflowMessage, setWorkflowMessage] = useState<string | null>(null);

  const isLoaded = loadedKey === storageKey;
  const activeImageSource = useMemo(() => {
    if (!activeGeneration || !activeImage) return null;
    return sourceFromImage(activeGeneration, activeImage);
  }, [activeGeneration, activeImage]);
  const autoImageSources = useMemo(
    () =>
      generations.flatMap((generation) => sourcesFromGeneration(generation)),
    [generations],
  );
  const hasActiveImageOnCanvas = Boolean(
    activeImageSource && hasImageNode(nodes, activeImageSource),
  );
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const hiddenAutoImageCount = useMemo(() => {
    if (hiddenImageKeys.length === 0 || autoImageSources.length === 0) return 0;

    const availableKeys = new Set(autoImageSources.map((source) => source.key));
    return hiddenImageKeys.filter((key) => availableKeys.has(key)).length;
  }, [autoImageSources, hiddenImageKeys]);

  useEffect(() => {
    setLoadedKey(null);

    if (typeof window === "undefined") return;

    if (conversationId) {
      const draft = window.localStorage.getItem(draftStorageKey);
      const target = window.localStorage.getItem(storageKey);
      if (draft && !target) {
        window.localStorage.setItem(storageKey, draft);
        window.localStorage.removeItem(draftStorageKey);
      }
    }

    const stored = parseStoredCanvas(window.localStorage.getItem(storageKey));
    setNodes(stored.nodes);
    setEdges(stored.edges);
    setViewport(stored.viewport);
    setHiddenImageKeys(stored.hiddenImageKeys);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setConnectionPreview(null);
    setLoadedKey(storageKey);
  }, [conversationId, draftStorageKey, storageKey]);

  // 待写入的画布快照。拖拽/平移/缩放会在每个 pointermove 上触发 state 变化，
  // 逐帧同步 JSON.stringify + localStorage.setItem 会造成交互卡顿，
  // 这里改为 400ms 尾随防抖（序列化也推迟到落盘时），并在切换会话 / 卸载 / 页面隐藏时立即冲刷。
  const pendingWriteRef = useRef<{
    key: string;
    snapshot: StoredCanvas;
  } | null>(null);

  const flushPendingWrite = useCallback(() => {
    const pending = pendingWriteRef.current;
    if (!pending || typeof window === "undefined") return;
    window.localStorage.setItem(pending.key, JSON.stringify(pending.snapshot));
    pendingWriteRef.current = null;
  }, []);

  useEffect(() => {
    if (!isLoaded || typeof window === "undefined") return;

    pendingWriteRef.current = {
      key: storageKey,
      snapshot: {
        version: 1,
        viewport,
        nodes,
        edges,
        hiddenImageKeys,
        updatedAt: new Date().toISOString(),
      },
    };
    const handle = window.setTimeout(flushPendingWrite, 400);
    return () => window.clearTimeout(handle);
  }, [
    edges,
    flushPendingWrite,
    hiddenImageKeys,
    isLoaded,
    nodes,
    storageKey,
    viewport,
  ]);

  // storageKey 变化（切换会话）或组件卸载时，先把旧画布的待写快照落盘，避免丢失最后 400ms 的编辑。
  useEffect(() => flushPendingWrite, [flushPendingWrite, storageKey]);

  // 页面隐藏 / 关闭时冲刷，保证与旧的同步写入行为一致的持久化保障。
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushPendingWrite();
    };
    window.addEventListener("pagehide", flushPendingWrite);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flushPendingWrite);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flushPendingWrite]);

  useEffect(() => {
    if (!isLoaded || autoImageSources.length === 0) return;

    setNodes((current) => {
      let next = current;
      let nextZ = maxNodeZ(current);

      for (const source of autoImageSources) {
        if (
          hiddenImageKeys.includes(source.key) ||
          hasImageNode(next, source)
        ) {
          continue;
        }

        const dimensions = dimensionsForImage(source.image);
        const position = nextAutoPosition(next, dimensions.width);
        next = [...next, createImageNode(source, position, nextZ + 1)];
        nextZ += 1;
      }

      return next;
    });
  }, [autoImageSources, hiddenImageKeys, isLoaded]);

  const screenToWorld = useCallback(
    (screenX: number, screenY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const localX = rect ? screenX - rect.left : screenX;
      const localY = rect ? screenY - rect.top : screenY;

      return {
        x: (localX - viewport.x) / viewport.scale,
        y: (localY - viewport.y) / viewport.scale,
      };
    },
    [viewport],
  );

  const centerPositionFor = useCallback(
    (width: number, height: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const world = screenToWorld(
        (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
        (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
      );

      return {
        x: world.x - width / 2,
        y: world.y - height / 2,
      };
    },
    [screenToWorld],
  );

  const bringToFront = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setNodes((current) => {
      const topZ = maxNodeZ(current);
      const target = current.find((node) => node.id === nodeId);
      if (!target || target.z >= topZ) return current;

      return current.map((node) =>
        node.id === nodeId ? { ...node, z: topZ + 1 } : node,
      );
    });
  }, []);

  const addImageSource = useCallback(
    (source: CanvasImageSource | null) => {
      if (!source) return;

      setHiddenImageKeys((current) =>
        current.filter((key) => key !== source.key),
      );
      setSelectedEdgeId(null);
      setNodes((current) => {
        const existing = current.find(
          (node) =>
            node.type === "image" && imageKeyForNode(node) === source.key,
        );

        if (existing) {
          setSelectedNodeId(existing.id);
          return current.map((node) =>
            node.id === existing.id
              ? { ...node, z: maxNodeZ(current) + 1 }
              : node,
          );
        }

        const dimensions = dimensionsForImage(source.image);
        const position = centerPositionFor(dimensions.width, dimensions.height);
        const node = createImageNode(source, position, maxNodeZ(current) + 1);
        setSelectedNodeId(node.id);

        return [...current, node];
      });
    },
    [centerPositionFor],
  );

  const addTextNode = useCallback(
    (position?: { x: number; y: number }) => {
      const defaultPosition =
        nodes.length === 0
          ? centerPositionFor(TEXT_NODE_WIDTH, TEXT_NODE_HEIGHT)
          : nextAutoPosition(nodes, TEXT_NODE_WIDTH);
      const node: CanvasTextNode = {
        id: `note-${Date.now()}`,
        type: "text",
        text: "新批注",
        ...(position ?? defaultPosition),
        width: TEXT_NODE_WIDTH,
        height: TEXT_NODE_HEIGHT,
        z: maxNodeZ(nodes) + 1,
        createdAt: new Date().toISOString(),
      };

      setNodes((current) => [...current, node]);
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
    },
    [centerPositionFor, nodes],
  );

  const deleteNode = useCallback((node: CanvasNode) => {
    setNodes((current) => current.filter((item) => item.id !== node.id));
    setEdges((current) =>
      current.filter(
        (edge) => edge.sourceId !== node.id && edge.targetId !== node.id,
      ),
    );
    setSelectedNodeId((current) => (current === node.id ? null : current));

    if (node.type === "image") {
      const key = imageKeyForNode(node);
      setHiddenImageKeys((current) =>
        current.includes(key) ? current : [...current, key],
      );
    }
  }, []);

  const deleteEdge = useCallback((edgeId: string) => {
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    setSelectedEdgeId((current) => (current === edgeId ? null : current));
  }, []);

  const onConnectStart = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode) => {
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const startX = node.x + node.width;
      const startY = node.y + node.height / 2;
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
      setConnectionPreview({ sourceId: node.id, x: startX + 80, y: startY });
      dragRef.current = {
        type: "connect",
        pointerId: event.pointerId,
        sourceId: node.id,
      };
    },
    [],
  );

  const updateTextNode = useCallback((nodeId: string, text: string) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId && node.type === "text" ? { ...node, text } : node,
      ),
    );
  }, []);

  const duplicateNode = useCallback((node: CanvasNode | null) => {
    if (!node) return;

    setNodes((current) => {
      const copy: CanvasNode = {
        ...node,
        id: nextNodeId(node),
        x: node.x + 28,
        y: node.y + 28,
        z: maxNodeZ(current) + 1,
        createdAt: new Date().toISOString(),
      };
      setSelectedNodeId(copy.id);
      setSelectedEdgeId(null);

      return [...current, copy];
    });
  }, []);

  const restoreHiddenImages = useCallback(() => {
    setHiddenImageKeys([]);
  }, []);

  const runWorkflow = useCallback(() => {
    if (workflowRunning) return;

    const baseNodes = nodes.filter(
      (node) => node.type !== "image" || node.generationId !== "local-workflow",
    );
    const baseNodeIds = new Set(baseNodes.map((node) => node.id));
    const baseEdges = edges.filter(
      (edge) =>
        baseNodeIds.has(edge.sourceId) && baseNodeIds.has(edge.targetId),
    );
    const outgoing = new Set(baseEdges.map((edge) => edge.sourceId));
    const incoming = new Map<string, string[]>();
    for (const edge of baseEdges) {
      const parents = incoming.get(edge.targetId) ?? [];
      parents.push(edge.sourceId);
      incoming.set(edge.targetId, parents);
    }
    const terminals = baseNodes.filter(
      (node) => !outgoing.has(node.id) && incoming.has(node.id),
    );

    if (baseEdges.length === 0 || terminals.length === 0) {
      setWorkflowMessage("请先连接两个节点");
      return;
    }

    setWorkflowRunning(true);
    setWorkflowMessage("正在本地执行工作流…");

    window.setTimeout(() => {
      const created: CanvasNode[] = [];
      const createdEdges: CanvasEdge[] = [];

      terminals.slice(0, 6).forEach((terminal, index) => {
        const ordered: CanvasNode[] = [];
        const visited = new Set<string>();
        const visit = (nodeId: string) => {
          if (visited.has(nodeId)) return;
          visited.add(nodeId);
          for (const parentId of incoming.get(nodeId) ?? []) visit(parentId);
          const current = baseNodes.find((node) => node.id === nodeId);
          if (current) ordered.push(current);
        };
        visit(terminal.id);

        const prompt = ordered
          .map((node) =>
            node.type === "text" ? node.text : node.prompt || "图片素材",
          )
          .filter(Boolean)
          .join(" → ")
          .slice(0, 420);
        const output = createWorkflowOutputNode(
          prompt || "空工作流",
          { x: terminal.x + terminal.width + 120, y: terminal.y + index * 250 },
          maxNodeZ(baseNodes) + index + 1,
        );
        created.push(output);
        createdEdges.push({
          id: "edge-" + Date.now() + "-" + index,
          sourceId: terminal.id,
          targetId: output.id,
        });
      });

      setNodes([...baseNodes, ...created]);
      setEdges([...baseEdges, ...createdEdges]);
      setSelectedNodeId(created[0]?.id ?? null);
      setSelectedEdgeId(null);
      setWorkflowRunning(false);
      setWorkflowMessage("本地工作流完成 · " + created.length + " 个结果节点");
    }, 520);
  }, [edges, nodes, workflowRunning]);

  const onNodePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, node: CanvasNode) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      bringToFront(node.id);
      dragRef.current = {
        type: "node",
        pointerId: event.pointerId,
        nodeId: node.id,
        startX: event.clientX,
        startY: event.clientY,
        startNodeX: node.x,
        startNodeY: node.y,
        scale: viewport.scale,
      };
    },
    [bringToFront, viewport.scale],
  );

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode) => {
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      bringToFront(node.id);
      dragRef.current = {
        type: "resize",
        pointerId: event.pointerId,
        nodeId: node.id,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: node.width,
        startHeight: node.height,
        scale: viewport.scale,
      };
    },
    [bringToFront, viewport.scale],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      dragRef.current = {
        type: "pan",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        viewport,
      };
    },
    [viewport],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      if (drag.type === "pan") {
        setViewport({
          ...drag.viewport,
          x: drag.viewport.x + event.clientX - drag.startX,
          y: drag.viewport.y + event.clientY - drag.startY,
        });
        return;
      }

      if (drag.type === "connect") {
        const world = screenToWorld(event.clientX, event.clientY);
        setConnectionPreview({
          sourceId: drag.sourceId,
          x: world.x,
          y: world.y,
        });
        return;
      }

      const dx = (event.clientX - drag.startX) / drag.scale;
      const dy = (event.clientY - drag.startY) / drag.scale;

      if (drag.type === "resize") {
        setNodes((current) =>
          current.map((node) =>
            node.id === drag.nodeId
              ? resizeNode(node, drag.startWidth + dx, drag.startHeight + dy)
              : node,
          ),
        );
        return;
      }

      setNodes((current) =>
        current.map((node) =>
          node.id === drag.nodeId
            ? { ...node, x: drag.startNodeX + dx, y: drag.startNodeY + dy }
            : node,
        ),
      );
    },
    [screenToWorld],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId === event.pointerId) {
        const drag = dragRef.current;
        if (drag.type === "connect") {
          const target = document
            .elementFromPoint(event.clientX, event.clientY)
            ?.closest<HTMLElement>("[data-node-id]")
            ?.getAttribute("data-node-id");
          if (target && target !== drag.sourceId) {
            setEdges((current) => {
              if (
                current.some(
                  (edge) =>
                    edge.sourceId === drag.sourceId && edge.targetId === target,
                )
              ) {
                return current;
              }
              return [
                ...current,
                {
                  id:
                    "edge-" +
                    Date.now() +
                    "-" +
                    Math.round(Math.random() * 10000),
                  sourceId: drag.sourceId,
                  targetId: target,
                },
              ];
            });
          }
          setConnectionPreview(null);
        }
        dragRef.current = null;
      }
    },
    [],
  );

  const onPointerCancel = useCallback(() => {
    dragRef.current = null;
    setConnectionPreview(null);
  }, []);

  const onCanvasDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isInteractiveTarget(event.target)) return;

      const world = screenToWorld(event.clientX, event.clientY);
      addTextNode({
        x: world.x - TEXT_NODE_WIDTH / 2,
        y: world.y - TEXT_NODE_HEIGHT / 2,
      });
    },
    [addTextNode, screenToWorld],
  );

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      setViewport((current) => {
        const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
        const localX = clientX - rect.left;
        const localY = clientY - rect.top;
        const worldX = (localX - current.x) / current.scale;
        const worldY = (localY - current.y) / current.scale;

        return {
          x: localX - worldX * nextScale,
          y: localY - worldY * nextScale,
          scale: nextScale,
        };
      });
    },
    [],
  );

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY > 0 ? 0.9 : 1.1);
    },
    [zoomAt],
  );

  const resetViewport = useCallback(() => {
    setViewport(DEFAULT_VIEWPORT);
  }, []);

  const fitToNodeList = useCallback(
    (nodeList: CanvasNode[]) => {
      const bounds = boundsFor(nodeList);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!bounds || !rect) {
        resetViewport();
        return;
      }

      const padding = 120;
      const scale = clamp(
        Math.min(
          (rect.width - padding) / Math.max(bounds.width, 1),
          (rect.height - padding) / Math.max(bounds.height, 1),
        ),
        MIN_SCALE,
        1.2,
      );
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;

      setViewport({
        x: rect.width / 2 - centerX * scale,
        y: rect.height / 2 - centerY * scale,
        scale,
      });
    },
    [resetViewport],
  );

  const fitToNodes = useCallback(() => {
    fitToNodeList(nodes);
  }, [fitToNodeList, nodes]);

  const arrangeCanvas = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();

    setNodes((current) => {
      const arranged = arrangedNodes(current);
      if (rect) window.requestAnimationFrame(() => fitToNodeList(arranged));
      return arranged;
    });
  }, [fitToNodeList]);

  const zoomAtCenter = useCallback(
    (factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAt],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isInteractiveTarget(event.target)) return;

      if (event.key === "Escape") {
        dragRef.current = null;
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setConnectionPreview(null);
        return;
      }

      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        selectedEdgeId
      ) {
        event.preventDefault();
        deleteEdge(selectedEdgeId);
        return;
      }

      if (!selectedNode) return;

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteNode(selectedNode);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateNode(selectedNode);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteEdge, deleteNode, duplicateNode, selectedEdgeId, selectedNode]);

  return (
    <section
      className={cn(
        "surface-panel relative min-h-[420px] w-full overflow-hidden bg-surface",
        className,
      )}
      aria-label="无限画布"
    >
      <div
        ref={containerRef}
        className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
        style={{
          backgroundColor: "rgb(var(--surface))",
          backgroundImage:
            "linear-gradient(rgb(var(--border) / 0.42) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--border) / 0.42) 1px, transparent 1px)",
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          backgroundSize: `${32 * viewport.scale}px ${32 * viewport.scale}px`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        onDoubleClick={onCanvasDoubleClick}
      >
        <div
          className="absolute left-0 top-0 will-change-transform"
          style={{
            transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
            transformOrigin: "0 0",
          }}
        >
          <svg
            width="1"
            height="1"
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            aria-hidden="true"
          >
            {edges.map((edge) => {
              const source = nodes.find((node) => node.id === edge.sourceId);
              const target = nodes.find((node) => node.id === edge.targetId);
              if (!source || !target) return null;
              const path = edgePath(source, target);
              const selected = selectedEdgeId === edge.id;
              return (
                <g
                  key={edge.id}
                  className="pointer-events-auto"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectedNodeId(null);
                    setSelectedEdgeId(edge.id);
                  }}
                >
                  <path
                    d={path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={18}
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke={
                      selected
                        ? "rgb(var(--brand-primary))"
                        : "rgb(var(--border-strong))"
                    }
                    strokeWidth={selected ? 3 : 2}
                    strokeLinecap="round"
                    markerEnd="url(#canvas-arrow)"
                  />
                </g>
              );
            })}
            {connectionPreview
              ? (() => {
                  const source = nodes.find(
                    (node) => node.id === connectionPreview.sourceId,
                  );
                  if (!source) return null;
                  const startX = source.x + source.width;
                  const startY = source.y + source.height / 2;
                  const path = edgePathBetween(
                    startX,
                    startY,
                    connectionPreview.x,
                    connectionPreview.y,
                  );
                  return (
                    <path
                      d={path}
                      fill="none"
                      stroke="rgb(var(--brand-primary))"
                      strokeWidth={2.5}
                      strokeDasharray="7 6"
                      strokeLinecap="round"
                    />
                  );
                })()
              : null}
            <defs>
              <marker
                id="canvas-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  fill="rgb(var(--brand-primary))"
                />
              </marker>
            </defs>
          </svg>
          {nodes.map((node) => (
            <CanvasNodeView
              key={node.id}
              node={node}
              selected={node.id === selectedNodeId}
              onPointerDown={onNodePointerDown}
              onResizePointerDown={onResizePointerDown}
              onDelete={deleteNode}
              onDuplicate={duplicateNode}
              onTextChange={updateTextNode}
              onConnectStart={onConnectStart}
            />
          ))}
        </div>
      </div>

      {nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
              无限画布
            </p>
            <h3 className="mt-3 text-[20px] font-medium text-foreground">
              画布还没有内容
            </h3>
            <p className="mt-2 text-[13px] text-text-muted">
              生成完成的图片会自动来到这里，也可以双击空白处写批注。
            </p>
          </div>
        </div>
      ) : null}

      <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[12.5px] text-foreground shadow-[var(--shadow-xs)] transition-colors hover:border-border-strong hover:bg-surface"
          onClick={() => addImageSource(activeImageSource)}
          disabled={!activeImageSource || hasActiveImageOnCanvas}
          title={hasActiveImageOnCanvas ? "当前图已在画布中" : "添加当前图"}
        >
          <ImagePlus size={14} strokeWidth={1.5} />
          添加当前图
        </Button>
        <Button
          variant="ghost"
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[12.5px] text-foreground shadow-[var(--shadow-xs)] transition-colors hover:border-border-strong hover:bg-surface"
          onClick={() => addTextNode()}
          title="添加批注"
        >
          <StickyNote size={14} strokeWidth={1.5} />
          批注
        </Button>
        {hiddenAutoImageCount > 0 ? (
          <Button
            variant="ghost"
            type="button"
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[12.5px] text-foreground shadow-[var(--shadow-xs)] transition-colors hover:border-border-strong hover:bg-surface"
            onClick={restoreHiddenImages}
            title="恢复被删除的自动图片节点"
          >
            <RotateCcw size={14} strokeWidth={1.5} />
            恢复 {hiddenAutoImageCount}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg border border-brand/30 bg-brand/10 px-3 text-[12.5px] text-foreground shadow-[var(--shadow-xs)] transition-colors hover:bg-brand/15 disabled:cursor-wait disabled:opacity-60"
          onClick={runWorkflow}
          disabled={workflowRunning || nodes.length < 2}
          title="按连线顺序在浏览器本地运行"
        >
          <Play size={14} fill="currentColor" strokeWidth={1.5} />
          {workflowRunning ? "运行中…" : "运行工作流"}
        </Button>
      </div>
      {workflowMessage ? (
        <div className="absolute left-3 top-[4.25rem] z-20 rounded-md border border-brand/20 bg-surface px-2.5 py-1.5 text-[11px] text-text-muted shadow-[var(--shadow-xs)]">
          {workflowMessage}
        </div>
      ) : null}

      <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-surface p-1 shadow-[var(--shadow-xs)]">
        <CanvasIconButton label="缩小" onClick={() => zoomAtCenter(0.86)}>
          <ZoomOut size={14} strokeWidth={1.5} />
        </CanvasIconButton>
        <span className="min-w-12 px-1 text-center font-mono text-[11px] text-text-muted">
          {Math.round(viewport.scale * 100)}%
        </span>
        <CanvasIconButton label="放大" onClick={() => zoomAtCenter(1.16)}>
          <ZoomIn size={14} strokeWidth={1.5} />
        </CanvasIconButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <CanvasIconButton
          label="自动整理"
          onClick={arrangeCanvas}
          disabled={nodes.length < 2}
        >
          <LayoutGrid size={14} strokeWidth={1.5} />
        </CanvasIconButton>
        <CanvasIconButton label="适配内容" onClick={fitToNodes}>
          <Maximize2 size={14} strokeWidth={1.5} />
        </CanvasIconButton>
        <CanvasIconButton label="重置视图" onClick={resetViewport}>
          <RotateCcw size={14} strokeWidth={1.5} />
        </CanvasIconButton>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[10.5px] text-text-faint shadow-[var(--shadow-xs)]">
        <span>{nodes.length} 节点</span>
        <span className="h-1 w-1 rounded-full bg-border-strong" />
        <span>{edges.length} 连线</span>
        <span className="h-1 w-1 rounded-full bg-border-strong" />
        <span>双击批注</span>
        <span className="h-1 w-1 rounded-full bg-border-strong" />
        <span>Delete 删除</span>
        <span className="h-1 w-1 rounded-full bg-border-strong" />
        <span>⌘D 复制</span>
      </div>

      {selectedNode ? (
        <div className="absolute bottom-3 right-3 z-20 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-lg border border-border bg-surface p-2 shadow-[var(--shadow-xs)]">
          <div className="min-w-0 px-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-faint">
              {selectedNode.type === "image" ? "图片节点" : "批注节点"}
            </p>
            <p className="mt-0.5 truncate text-[11.5px] text-text-muted">
              {Math.round(selectedNode.width)}×{Math.round(selectedNode.height)}
            </p>
          </div>
          <CanvasIconButton
            label="复制节点"
            onClick={() => duplicateNode(selectedNode)}
          >
            <Copy size={14} strokeWidth={1.5} />
          </CanvasIconButton>
          <CanvasIconButton
            label="删除节点"
            onClick={() => deleteNode(selectedNode)}
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </CanvasIconButton>
        </div>
      ) : null}
      {selectedEdgeId ? (
        <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2 rounded-lg border border-border bg-surface p-2 shadow-[var(--shadow-xs)]">
          <span className="px-1 text-[11.5px] text-text-muted">已选中连线</span>
          <CanvasIconButton
            label="删除连线"
            onClick={() => deleteEdge(selectedEdgeId)}
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </CanvasIconButton>
        </div>
      ) : null}
    </section>
  );
}
