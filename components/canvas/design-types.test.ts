import { describe, expect, it } from "vitest";

import { DEFAULT_DESIGN_DOCUMENT, parseDesignDocument } from "./design-types";

describe("design document", () => {
  it("falls back for missing or invalid documents", () => {
    expect(parseDesignDocument(null)).toEqual(DEFAULT_DESIGN_DOCUMENT);
    expect(parseDesignDocument("not-json")).toEqual(DEFAULT_DESIGN_DOCUMENT);
    expect(parseDesignDocument(JSON.stringify({ version: 2 }))).toEqual(
      DEFAULT_DESIGN_DOCUMENT,
    );
  });

  it("restores a valid document", () => {
    const document = {
      ...DEFAULT_DESIGN_DOCUMENT,
      name: "海报",
      objects: [
        {
          id: "rect-1",
          type: "rect" as const,
          name: "背景块",
          x: 10,
          y: 20,
          width: 300,
          height: 200,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          fill: "#ffffff",
          stroke: "#000000",
          strokeWidth: 0,
          radius: 8,
        },
      ],
    };

    expect(parseDesignDocument(JSON.stringify(document))).toEqual(document);
  });

  it("drops corrupt objects without losing the rest of the design", () => {
    const validObject = {
      id: "rect-1",
      type: "rect" as const,
      name: "背景块",
      x: 10,
      y: 20,
      width: 300,
      height: 200,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 0,
      radius: 8,
    };
    const restored = parseDesignDocument(
      JSON.stringify({
        ...DEFAULT_DESIGN_DOCUMENT,
        objects: [
          validObject,
          { ...validObject, id: "broken", width: Number.POSITIVE_INFINITY },
          { ...validObject },
        ],
      }),
    );

    expect(restored.objects).toEqual([validObject]);
  });

  it("rejects unsafe or unrenderable document metadata", () => {
    expect(
      parseDesignDocument(
        JSON.stringify({
          ...DEFAULT_DESIGN_DOCUMENT,
          width: 20_000,
        }),
      ),
    ).toEqual(DEFAULT_DESIGN_DOCUMENT);
    expect(
      parseDesignDocument(
        JSON.stringify({
          ...DEFAULT_DESIGN_DOCUMENT,
          background: "url(javascript:alert(1))",
        }),
      ),
    ).toEqual(DEFAULT_DESIGN_DOCUMENT);
  });
});
