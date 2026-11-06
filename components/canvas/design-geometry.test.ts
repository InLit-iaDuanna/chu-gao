import { describe, expect, it } from "vitest";

import {
  getObjectBounds,
  intersectsBounds,
  snapObjectPosition,
} from "./design-geometry";
import {
  DEFAULT_DESIGN_DOCUMENT,
  type DesignShapeObject,
} from "./design-types";

const object: DesignShapeObject = {
  id: "rect-1",
  type: "rect",
  name: "矩形",
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  fill: "#000000",
  stroke: "#000000",
  strokeWidth: 0,
  radius: 0,
};

describe("design snapping", () => {
  it("snaps object centers to the artboard center", () => {
    const document = { ...DEFAULT_DESIGN_DOCUMENT, objects: [object] };
    const result = snapObjectPosition(document, object, 486, 634, 6);
    expect(result.x).toBe(490);
    expect(result.y).toBe(635);
    expect(result.guides).toEqual({ x: 540, y: 675 });
  });

  it("snaps to another visible object's edge", () => {
    const other = { ...object, id: "rect-2", x: 300, y: 200 };
    const document = {
      ...DEFAULT_DESIGN_DOCUMENT,
      objects: [object, other],
    };
    const result = snapObjectPosition(document, object, 196, 116, 6);
    expect(result.x).toBe(200);
    expect(result.y).toBe(120);
    expect(result.guides).toEqual({ x: 300, y: 200 });
  });
});

describe("design bounds", () => {
  it("calculates a bounding box around multiple objects", () => {
    expect(
      getObjectBounds([
        { ...object, x: 20, y: 40 },
        { ...object, id: "rect-2", x: 180, y: 220, width: 120 },
      ]),
    ).toEqual({ x: 20, y: 40, width: 280, height: 260 });
  });

  it("detects objects touched by a selection rectangle", () => {
    expect(
      intersectsBounds(
        { ...object, x: 100, y: 100 },
        { x: 80, y: 80, width: 30, height: 30 },
      ),
    ).toBe(true);
    expect(
      intersectsBounds(
        { ...object, x: 100, y: 100 },
        { x: 0, y: 0, width: 50, height: 50 },
      ),
    ).toBe(false);
  });
});
