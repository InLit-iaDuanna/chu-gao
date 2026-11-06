import type { DesignDocument, DesignObject } from "./design-types";

export interface SnapGuides {
  x: number | null;
  y: number | null;
}

export interface SnappedPosition {
  x: number;
  y: number;
  guides: SnapGuides;
}

export interface DesignBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getObjectBounds(objects: DesignObject[]): DesignBounds | null {
  if (objects.length === 0) return null;
  const left = Math.min(...objects.map((object) => object.x));
  const top = Math.min(...objects.map((object) => object.y));
  const right = Math.max(...objects.map((object) => object.x + object.width));
  const bottom = Math.max(...objects.map((object) => object.y + object.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function intersectsBounds(
  object: DesignObject,
  bounds: DesignBounds,
): boolean {
  return (
    object.x < bounds.x + bounds.width &&
    object.x + object.width > bounds.x &&
    object.y < bounds.y + bounds.height &&
    object.y + object.height > bounds.y
  );
}

function closestSnap(
  moving: number[],
  targets: number[],
  threshold: number,
): { delta: number; guide: number } | null {
  let best: { delta: number; guide: number } | null = null;
  for (const anchor of moving) {
    for (const target of targets) {
      const delta = target - anchor;
      if (Math.abs(delta) > threshold) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) {
        best = { delta, guide: target };
      }
    }
  }
  return best;
}

export function snapObjectPosition(
  document: DesignDocument,
  object: DesignObject,
  x: number,
  y: number,
  threshold = 6,
): SnappedPosition {
  const xTargets = [0, document.width / 2, document.width];
  const yTargets = [0, document.height / 2, document.height];

  for (const candidate of document.objects) {
    if (candidate.id === object.id || !candidate.visible) continue;
    xTargets.push(
      candidate.x,
      candidate.x + candidate.width / 2,
      candidate.x + candidate.width,
    );
    yTargets.push(
      candidate.y,
      candidate.y + candidate.height / 2,
      candidate.y + candidate.height,
    );
  }

  const xSnap = closestSnap(
    [x, x + object.width / 2, x + object.width],
    xTargets,
    threshold,
  );
  const ySnap = closestSnap(
    [y, y + object.height / 2, y + object.height],
    yTargets,
    threshold,
  );

  return {
    x: x + (xSnap?.delta ?? 0),
    y: y + (ySnap?.delta ?? 0),
    guides: { x: xSnap?.guide ?? null, y: ySnap?.guide ?? null },
  };
}
