import {
  previewImageUrl,
  primaryImageUrl,
  type GalleryImage,
} from "@/components/workbench/gallery-images";
import type { WorkbenchGeneration } from "@/components/workbench/types";

export type CanvasViewport = {
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

export type CanvasImageNode = CanvasBaseNode & {
  type: "image";
  generationId: string;
  imageId: string | null;
  src: string;
  thumbnailUrl?: string | null;
  prompt: string;
};

export type CanvasTextNode = CanvasBaseNode & {
  type: "text";
  text: string;
};

export type CanvasNode = CanvasImageNode | CanvasTextNode;

export type StoredCanvas = {
  version: 1;
  viewport: CanvasViewport;
  nodes: CanvasNode[];
  hiddenImageKeys: string[];
  updatedAt: string;
};

export type CanvasImageSource = {
  key: string;
  generationId: string;
  imageId: string | null;
  image: GalleryImage;
  src: string;
  thumbnailUrl?: string | null;
  prompt: string;
  createdAt: string;
};

export type DragState =
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

export const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, scale: 1 };
export const MIN_SCALE = 0.12;
export const MAX_SCALE = 3.2;
export const TEXT_NODE_WIDTH = 240;
export const TEXT_NODE_HEIGHT = 150;

const IMAGE_NODE_WIDTH = 280;
const IMAGE_NODE_MIN_WIDTH = 160;
const IMAGE_NODE_MIN_HEIGHT = 150;
const IMAGE_NODE_MAX_WIDTH = 720;
const IMAGE_NODE_MAX_HEIGHT = 720;
const TEXT_NODE_MIN_WIDTH = 180;
const TEXT_NODE_MIN_HEIGHT = 110;
const TEXT_NODE_MAX_WIDTH = 520;
const TEXT_NODE_MAX_HEIGHT = 520;
const ARRANGE_GAP = 42;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function storageKeyFor(
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

export function parseStoredCanvas(
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

export function imageKeyForNode(node: CanvasImageNode): string {
  return imageKeyFor(node.generationId, node.imageId, node.src);
}

export function sourceFromImage(
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

export function sourcesFromGeneration(
  generation: WorkbenchGeneration,
): CanvasImageSource[] {
  const status = generation.status.toLowerCase();
  if (status !== "succeeded") return [];

  return generation.images
    .map((image) => sourceFromImage(generation, image))
    .filter((source): source is CanvasImageSource => Boolean(source));
}

export function dimensionsForImage(image: GalleryImage): {
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

export function resizeNode(
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

export function maxNodeZ(nodes: CanvasNode[]): number {
  return nodes.reduce((max, node) => Math.max(max, node.z), 0);
}

export function nextNodeId(node: CanvasNode): string {
  const prefix = node.type === "image" ? "image-copy" : "note-copy";

  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`;
}

export function boundsFor(nodes: CanvasNode[]) {
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

export function arrangedNodes(nodes: CanvasNode[]): CanvasNode[] {
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

export function nextAutoPosition(
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

export function createImageNode(
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

export function hasImageNode(
  nodes: CanvasNode[],
  source: CanvasImageSource,
): boolean {
  return nodes.some(
    (node) => node.type === "image" && imageKeyForNode(node) === source.key,
  );
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("button, textarea, input, a"))
  );
}
