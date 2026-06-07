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

import {
  previewImageUrl,
  primaryImageUrl,
  type GalleryImage,
} from "@/components/workbench/gallery-images";
import type { WorkbenchGeneration } from "@/components/workbench/types";
import { cn } from "@/lib/utils";

type CanvasViewport = {
  x: number;
  y: number;
  scale: number;
};

type CanvasBaseNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: string;
};

type CanvasImageNode = CanvasBaseNode & {
  type: "image";
  generationId: string;
  imageId: string | null;
  src: string;
  thumbnailUrl?: string | null;
  prompt: string;
};

type CanvasTextNode = CanvasBaseNode & {
  type: "text";
  text: string;
};

type CanvasNode = CanvasImageNode | CanvasTextNode;

type StoredCanvas = {
  version: 1;
  viewport: CanvasViewport;
  nodes: CanvasNode[];
  hiddenImageKeys: string[];
  updatedAt: string;
};

type CanvasImageSource = {
  key: string;
  generationId: string;
  imageId: string | null;
  image: GalleryImage;
  src: string;
  thumbnailUrl?: string | null;
  prompt: string;
  createdAt: string;
};

type DragState =
  | {
      type: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      viewport: CanvasViewport;
    }
  | {
      type: "node";
      pointerId: number;
      nodeId: string;
      startX: number;
      startY: number;
      startNodeX: number;
      startNodeY: number;
      scale: number;
    }
  | {
      type: "resize";
      pointerId: number;
      nodeId: string;
      startX: number;
      startY: number;
      startWidth: number;
      startHeight: number;
      scale: number;
    };

const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, scale: 1 };
const MIN_SCALE = 0.12;
const MAX_SCALE = 3.2;
const IMAGE_NODE_WIDTH = 280;
const IMAGE_NODE_MIN_WIDTH = 160;
const IMAGE_NODE_MIN_HEIGHT = 150;
const IMAGE_NODE_MAX_WIDTH = 720;
const IMAGE_NODE_MAX_HEIGHT = 720;
const TEXT_NODE_WIDTH = 240;
const TEXT_NODE_HEIGHT = 150;
const TEXT_NODE_MIN_WIDTH = 180;
const TEXT_NODE_MIN_HEIGHT = 110;
const TEXT_NODE_MAX_WIDTH = 520;
const TEXT_NODE_MAX_HEIGHT = 520;
const ARRANGE_GAP = 42;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function storageKeyFor(
  accountId: string | null,
  conversationId: string | null,
) {
  return `chugao:canvas:v1:${accountId ?? "anonymous"}:${conversationId ?? "draft"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCanvasNode(value: unknown): value is CanvasNode {
  if (!isRecord(value)) return false;

  const baseIsValid =
    typeof value.id === "string" &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    isFiniteNumber(value.z) &&
    typeof value.createdAt === "string";

  if (!baseIsValid) return false;

  if (value.type === "text") {
    return typeof value.text === "string";
  }

  return (
    value.type === "image" &&
    typeof value.generationId === "string" &&
    (typeof value.imageId === "string" || value.imageId === null) &&
    typeof value.src === "string" &&
    typeof value.prompt === "string"
  );
}

function normalizeViewport(value: unknown): CanvasViewport {
  if (!isRecord(value)) return DEFAULT_VIEWPORT;

  return {
    x: isFiniteNumber(value.x) ? value.x : DEFAULT_VIEWPORT.x,
    y: isFiniteNumber(value.y) ? value.y : DEFAULT_VIEWPORT.y,
    scale: isFiniteNumber(value.scale)
      ? clamp(value.scale, MIN_SCALE, MAX_SCALE)
      : DEFAULT_VIEWPORT.scale,
  };
}

function parseStoredCanvas(
  raw: string | null,
): Omit<StoredCanvas, "version" | "updatedAt"> {
  if (!raw) {
    return { viewport: DEFAULT_VIEWPORT, nodes: [], hiddenImageKeys: [] };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return { viewport: DEFAULT_VIEWPORT, nodes: [], hiddenImageKeys: [] };
    }

    return {
      viewport: normalizeViewport(parsed.viewport),
      nodes: Array.isArray(parsed.nodes)
        ? parsed.nodes.filter(isCanvasNode)
        : [],
      hiddenImageKeys: Array.isArray(parsed.hiddenImageKeys)
        ? parsed.hiddenImageKeys.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    };
  } catch {
    return { viewport: DEFAULT_VIEWPORT, nodes: [], hiddenImageKeys: [] };
  }
}

function imageKeyFor(
  generationId: string,
  imageId: string | null,
  src: string,
): string {
  return `${generationId}:${imageId ?? src}`;
}

function imageKeyForNode(node: CanvasImageNode): string {
  return imageKeyFor(node.generationId, node.imageId, node.src);
}

function sourceFromImage(
  generation: WorkbenchGeneration,
  image: GalleryImage,
): CanvasImageSource | null {
  const src = primaryImageUrl(image);
  if (!src) return null;

  const imageId = image.id ?? null;

  return {
    key: imageKeyFor(generation.id, imageId, src),
    generationId: generation.id,
    imageId,
    image,
    src,
    thumbnailUrl: previewImageUrl(image) ?? null,
    prompt: generation.prompt,
    createdAt: generation.createdAt,
  };
}

function sourcesFromGeneration(
  generation: WorkbenchGeneration,
): CanvasImageSource[] {
  const status = generation.status.toLowerCase();
  if (status !== "succeeded") return [];

  return generation.images
    .map((image) => sourceFromImage(generation, image))
    .filter((source): source is CanvasImageSource => Boolean(source));
}

function dimensionsForImage(image: GalleryImage): {
  width: number;
  height: number;
} {
  const ratio =
    image.width && image.height && image.width > 0 && image.height > 0
      ? image.height / image.width
      : 1;
  const height = clamp(Math.round(IMAGE_NODE_WIDTH * ratio) + 36, 190, 430);

  return { width: IMAGE_NODE_WIDTH, height };
}

function minSizeForNode(node: CanvasNode): { width: number; height: number } {
  if (node.type === "image") {
    return { width: IMAGE_NODE_MIN_WIDTH, height: IMAGE_NODE_MIN_HEIGHT };
  }

  return { width: TEXT_NODE_MIN_WIDTH, height: TEXT_NODE_MIN_HEIGHT };
}

function maxSizeForNode(node: CanvasNode): { width: number; height: number } {
  if (node.type === "image") {
    return { width: IMAGE_NODE_MAX_WIDTH, height: IMAGE_NODE_MAX_HEIGHT };
  }

  return { width: TEXT_NODE_MAX_WIDTH, height: TEXT_NODE_MAX_HEIGHT };
}

function resizeNode(
  node: CanvasNode,
  width: number,
  height: number,
): CanvasNode {
  const min = minSizeForNode(node);
  const max = maxSizeForNode(node);

  return {
    ...node,
    width: Math.round(clamp(width, min.width, max.width)),
    height: Math.round(clamp(height, min.height, max.height)),
  };
}

function maxNodeZ(nodes: CanvasNode[]): number {
  return nodes.reduce((max, node) => Math.max(max, node.z), 0);
}

function nextNodeId(node: CanvasNode): string {
  const prefix = node.type === "image" ? "image-copy" : "note-copy";

  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`;
}

function boundsFor(nodes: CanvasNode[]) {
  if (nodes.length === 0) return null;

  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  const right = Math.max(...nodes.map((node) => node.x + node.width));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height));

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function arrangedNodes(nodes: CanvasNode[]): CanvasNode[] {
  if (nodes.length === 0) return nodes;

  const ordered = [...nodes].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt.localeCompare(b.createdAt);
    }

    return a.z - b.z;
  });
  const columns = Math.ceil(Math.sqrt(ordered.length));
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights: number[] = [];

  ordered.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, node.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, node.height);
  });

  const columnX = columnWidths.reduce<number[]>((positions, width, index) => {
    const previous =
      index === 0
        ? 0
        : positions[index - 1] + columnWidths[index - 1] + ARRANGE_GAP;
    positions.push(previous);
    return positions;
  }, []);
  const rowY = rowHeights.reduce<number[]>((positions, height, index) => {
    const previous =
      index === 0
        ? 0
        : positions[index - 1] + rowHeights[index - 1] + ARRANGE_GAP;
    positions.push(previous);
    return positions;
  }, []);
  const totalWidth =
    columnWidths.reduce((sum, width) => sum + width, 0) +
    ARRANGE_GAP * Math.max(0, columns - 1);
  const totalHeight =
    rowHeights.reduce((sum, height) => sum + height, 0) +
    ARRANGE_GAP * Math.max(0, rowHeights.length - 1);
  const arrangedById = new Map<string, CanvasNode>();

  ordered.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    arrangedById.set(node.id, {
      ...node,
      x: Math.round(columnX[column] - totalWidth / 2),
      y: Math.round(rowY[row] - totalHeight / 2),
      z: index + 1,
    });
  });

  return nodes.map((node) => arrangedById.get(node.id) ?? node);
}

function nextAutoPosition(
  nodes: CanvasNode[],
  width: number,
): {
  x: number;
  y: number;
} {
  const bounds = boundsFor(nodes);
  if (!bounds) return { x: -width / 2, y: -140 };

  const lane = nodes.length % 4;
  return {
    x: bounds.right + 48,
    y: bounds.top + lane * 52,
  };
}

function createImageNode(
  source: CanvasImageSource,
  position: { x: number; y: number },
  z: number,
): CanvasImageNode {
  const dimensions = dimensionsForImage(source.image);

  return {
    id: `image-${source.key}`,
    type: "image",
    generationId: source.generationId,
    imageId: source.imageId,
    src: source.src,
    thumbnailUrl: source.thumbnailUrl,
    prompt: source.prompt,
    x: position.x,
    y: position.y,
    width: dimensions.width,
    height: dimensions.height,
    z,
    createdAt: source.createdAt,
  };
}

function hasImageNode(nodes: CanvasNode[], source: CanvasImageSource): boolean {
  return nodes.some(
    (node) => node.type === "image" && imageKeyForNode(node) === source.key,
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("button, textarea, input, a"))
  );
}

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

  useEffect(() => {
    if (!isLoaded || typeof window === "undefined") return;

    const payload: StoredCanvas = {
      version: 1,
      viewport,
      nodes,
      hiddenImageKeys,
      updatedAt: new Date().toISOString(),
    };

    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [hiddenImageKeys, isLoaded, nodes, storageKey, viewport]);

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
          backgroundColor: "rgb(var(--surface))",
          backgroundImage:
            "linear-gradient(rgb(var(--border) / 0.42) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--border) / 0.42) 1px, transparent 1px)",
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          backgroundSize: `${32 * viewport.scale}px ${32 * viewport.scale}px`,
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
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface/90 px-3 text-[12.5px] text-foreground shadow-[var(--shadow-xs)] backdrop-blur-md transition-colors hover:border-border-strong hover:bg-surface"
          onClick={() => addImageSource(activeImageSource)}
          disabled={!activeImageSource || hasActiveImageOnCanvas}
          title={hasActiveImageOnCanvas ? "当前图已在画布中" : "添加当前图"}
        >
          <ImagePlus size={14} strokeWidth={1.5} />
          添加当前图
        </button>
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface/90 px-3 text-[12.5px] text-foreground shadow-[var(--shadow-xs)] backdrop-blur-md transition-colors hover:border-border-strong hover:bg-surface"
          onClick={() => addTextNode()}
          title="添加批注"
        >
          <StickyNote size={14} strokeWidth={1.5} />
          批注
        </button>
        {hiddenAutoImageCount > 0 ? (
          <button
            type="button"
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface/90 px-3 text-[12.5px] text-foreground shadow-[var(--shadow-xs)] backdrop-blur-md transition-colors hover:border-border-strong hover:bg-surface"
            onClick={restoreHiddenImages}
            title="恢复被删除的自动图片节点"
          >
            <RotateCcw size={14} strokeWidth={1.5} />
            恢复 {hiddenAutoImageCount}
          </button>
        ) : null}
      </div>

      <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-surface/90 p-1 shadow-[var(--shadow-xs)] backdrop-blur-md">
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

      <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/85 px-3 py-2 font-mono text-[10.5px] text-text-faint shadow-[var(--shadow-xs)] backdrop-blur-md">
        <span>{nodes.length} 节点</span>
        <span className="h-1 w-1 rounded-full bg-border-strong" />
        <span>双击批注</span>
        <span className="h-1 w-1 rounded-full bg-border-strong" />
        <span>Delete 删除</span>
        <span className="h-1 w-1 rounded-full bg-border-strong" />
        <span>⌘D 复制</span>
      </div>

      {selectedNode ? (
        <div className="absolute bottom-3 right-3 z-20 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-lg border border-border bg-surface/90 p-2 shadow-[var(--shadow-xs)] backdrop-blur-md">
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

function CanvasIconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-muted"
    >
      {children}
    </button>
  );
}

function CanvasNodeView({
  node,
  selected,
  onPointerDown,
  onResizePointerDown,
  onDelete,
  onDuplicate,
  onTextChange,
}: {
  node: CanvasNode;
  selected: boolean;
  onPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    node: CanvasNode,
  ) => void;
  onResizePointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    node: CanvasNode,
  ) => void;
  onDelete: (node: CanvasNode) => void;
  onDuplicate: (node: CanvasNode) => void;
  onTextChange: (nodeId: string, text: string) => void;
}): React.ReactElement {
  return (
    <div
      data-canvas-node
      className={cn(
        "absolute overflow-hidden rounded-xl border bg-surface shadow-[var(--shadow-md)] transition-shadow",
        selected
          ? "border-foreground shadow-[var(--shadow-ring-strong)]"
          : "border-border hover:border-border-strong",
      )}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        zIndex: node.z,
      }}
      onPointerDown={(event) => onPointerDown(event, node)}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {node.type === "image" ? (
        <ImageCanvasNode
          node={node}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      ) : (
        <TextCanvasNode
          node={node}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onTextChange={onTextChange}
        />
      )}
      {selected ? (
        <button
          type="button"
          className="absolute bottom-1.5 right-1.5 h-4 w-4 cursor-nwse-resize rounded-[4px] border border-foreground/30 bg-background/90 shadow-[var(--shadow-xs)] transition-transform hover:scale-110"
          aria-label="调整节点大小"
          title="拖拽调整大小"
          onPointerDown={(event) => onResizePointerDown(event, node)}
        />
      ) : null}
    </div>
  );
}

function ImageCanvasNode({
  node,
  onDelete,
  onDuplicate,
}: {
  node: CanvasImageNode;
  onDelete: (node: CanvasNode) => void;
  onDuplicate: (node: CanvasNode) => void;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-2 px-2">
        <p className="min-w-0 truncate text-[11.5px] font-medium text-text-muted">
          {node.prompt || "生成图"}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface hover:text-foreground"
            aria-label="复制图片节点"
            title="复制"
            onClick={() => onDuplicate(node)}
          >
            <Copy size={12} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface hover:text-foreground"
            aria-label="删除图片节点"
            title="删除"
            onClick={() => onDelete(node)}
          >
            <Trash2 size={12} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background">
        <img
          src={node.thumbnailUrl ?? node.src}
          alt={node.prompt || "画布图片"}
          className="h-full w-full object-contain"
          draggable={false}
          decoding="async"
        />
      </div>
    </div>
  );
}

function TextCanvasNode({
  node,
  onDelete,
  onDuplicate,
  onTextChange,
}: {
  node: CanvasTextNode;
  onDelete: (node: CanvasNode) => void;
  onDuplicate: (node: CanvasNode) => void;
  onTextChange: (nodeId: string, text: string) => void;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col bg-warning/[0.08]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-warning/20 px-2 text-warning">
        <div className="flex items-center gap-1.5">
          <StickyNote size={12} strokeWidth={1.5} />
          <span className="text-[11.5px] font-medium text-foreground">
            批注
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface hover:text-foreground"
            aria-label="复制批注"
            title="复制"
            onClick={() => onDuplicate(node)}
          >
            <Copy size={12} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface hover:text-foreground"
            aria-label="删除批注"
            title="删除"
            onClick={() => onDelete(node)}
          >
            <Trash2 size={12} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <textarea
        value={node.text}
        onChange={(event) => onTextChange(node.id, event.target.value)}
        onPointerDown={(event) => event.stopPropagation()}
        className="min-h-0 flex-1 resize-none bg-transparent px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-text-faint"
        aria-label="批注内容"
        maxLength={800}
      />
    </div>
  );
}
