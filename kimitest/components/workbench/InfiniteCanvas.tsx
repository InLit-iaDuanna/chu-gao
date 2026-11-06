"use client";

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
  RotateCcw,
  StickyNote,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { GalleryImage } from "@/components/workbench/gallery-images";
import {
  CanvasIconButton,
  CanvasNodeView,
} from "@/components/workbench/InfiniteCanvasNodes";
import {
  arrangedNodes,
  boundsFor,
  clamp,
  createImageNode,
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
  type CanvasNode,
  type CanvasTextNode,
  type CanvasViewport,
  type DragState,
  type StoredCanvas,
} from "@/components/workbench/infinite-canvas-model";
import type { WorkbenchGeneration } from "@/components/workbench/types";
import { cn } from "@/lib/utils";

interface InfiniteCanvasProps {
  accountId: string | null;
  conversationId: string | null;
  generations: WorkbenchGeneration[];
  activeGeneration: WorkbenchGeneration | null;
  activeImage: GalleryImage | null;
  className?: string;
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
  const [hiddenImageKeys, setHiddenImageKeys] = useState<string[]>([]);
  const [viewport, setViewport] = useState<CanvasViewport>(DEFAULT_VIEWPORT);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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
    setViewport(stored.viewport);
    setHiddenImageKeys(stored.hiddenImageKeys);
    setSelectedNodeId(null);
    setLoadedKey(storageKey);
  }, [conversationId, draftStorageKey, storageKey]);

  // 待写入的画布快照。拖拽/平移/缩放会在每个 pointermove 上触发 state 变化，
  // 逐帧同步 JSON.stringify + localStorage.setItem 会造成交互卡顿，
  // 这里改为 400ms 尾随防抖（序列化也推迟到落盘时），并在切换会话 / 卸载 / 页面隐藏时立即冲刷。
  const pendingWriteRef = useRef<{ key: string; snapshot: StoredCanvas } | null>(
    null,
  );

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
        hiddenImageKeys,
        updatedAt: new Date().toISOString(),
      },
    };
    const handle = window.setTimeout(flushPendingWrite, 400);
    return () => window.clearTimeout(handle);
  }, [flushPendingWrite, hiddenImageKeys, isLoaded, nodes, storageKey, viewport]);

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
      const node: CanvasTextNode = {
        id: `note-${Date.now()}`,
        type: "text",
        text: "新批注",
        ...(position ?? centerPositionFor(TEXT_NODE_WIDTH, TEXT_NODE_HEIGHT)),
        width: TEXT_NODE_WIDTH,
        height: TEXT_NODE_HEIGHT,
        z: maxNodeZ(nodes) + 1,
        createdAt: new Date().toISOString(),
      };

      setNodes((current) => [...current, node]);
      setSelectedNodeId(node.id);
    },
    [centerPositionFor, nodes],
  );

  const deleteNode = useCallback((node: CanvasNode) => {
    setNodes((current) => current.filter((item) => item.id !== node.id));
    setSelectedNodeId((current) => (current === node.id ? null : current));

    if (node.type === "image") {
      const key = imageKeyForNode(node);
      setHiddenImageKeys((current) =>
        current.includes(key) ? current : [...current, key],
      );
    }
  }, []);

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

      return [...current, copy];
    });
  }, []);

  const restoreHiddenImages = useCallback(() => {
    setHiddenImageKeys([]);
  }, []);

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
    [],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId === event.pointerId) {
        dragRef.current = null;
      }
    },
    [],
  );

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
        setSelectedNodeId(null);
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
  }, [deleteNode, duplicateNode, selectedNode]);

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
          backgroundColor: "rgb(var(--bg))",
          backgroundImage:
            "radial-gradient(circle, rgb(var(--ink) / 0.14) 1px, transparent 1px)",
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          backgroundSize: `${28 * viewport.scale}px ${28 * viewport.scale}px`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
            <h3 className="mt-3 font-serif text-[22px] tracking-[-0.01em] text-foreground">
              画布还没有内容
            </h3>
            <p className="mt-2 text-[13px] text-text-muted">
              生成完成的图片会自动来到这里，也可以双击空白处写批注。
            </p>
          </div>
        </div>
      ) : null}

      <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-[12px] border border-ink/[0.09] bg-surface-2/80 px-3 text-[12.5px] text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.05),var(--shadow-xs)] transition-all duration-200 hover:border-ink/[0.18] hover:bg-ink/[0.07]"
          onClick={() => addImageSource(activeImageSource)}
          disabled={!activeImageSource || hasActiveImageOnCanvas}
          title={hasActiveImageOnCanvas ? "当前图已在画布中" : "添加当前图"}
        >
          <ImagePlus size={14} strokeWidth={1.5} />
          添加当前图
        </button>
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-[12px] border border-ink/[0.09] bg-surface-2/80 px-3 text-[12.5px] text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.05),var(--shadow-xs)] transition-all duration-200 hover:border-ink/[0.18] hover:bg-ink/[0.07]"
          onClick={() => addTextNode()}
          title="添加批注"
        >
          <StickyNote size={14} strokeWidth={1.5} />
          批注
        </button>
        {hiddenAutoImageCount > 0 ? (
          <button
            type="button"
            className="flex h-9 items-center gap-2 rounded-[12px] border border-ink/[0.09] bg-surface-2/80 px-3 text-[12.5px] text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.05),var(--shadow-xs)] transition-all duration-200 hover:border-ink/[0.18] hover:bg-ink/[0.07]"
            onClick={restoreHiddenImages}
            title="恢复被删除的自动图片节点"
          >
            <RotateCcw size={14} strokeWidth={1.5} />
            恢复 {hiddenAutoImageCount}
          </button>
        ) : null}
      </div>

      <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-[12px] border border-ink/[0.09] bg-surface-2/80 p-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.05),var(--shadow-xs)]">
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

      <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/85 px-3 py-2 font-mono text-[10.5px] text-text-faint shadow-[var(--shadow-xs)]">
        <span>{nodes.length} 节点</span>
        <span className="h-1 w-1 rounded-full bg-border-strong" />
        <span>双击批注</span>
        <span className="h-1 w-1 rounded-full bg-border-strong" />
        <span>Delete 删除</span>
        <span className="h-1 w-1 rounded-full bg-border-strong" />
        <span>⌘D 复制</span>
      </div>

      {selectedNode ? (
        <div className="absolute bottom-3 right-3 z-20 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-lg border border-border bg-surface/90 p-2 shadow-[var(--shadow-xs)]">
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
    </section>
  );
}
