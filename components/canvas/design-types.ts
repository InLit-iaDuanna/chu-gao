export type DesignObjectType = "text" | "rect" | "ellipse" | "image";

interface DesignObjectBase {
  id: string;
  type: DesignObjectType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
}

export interface DesignTextObject extends DesignObjectBase {
  type: "text";
  text: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
}

export interface DesignShapeObject extends DesignObjectBase {
  type: "rect" | "ellipse";
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
}

export interface DesignImageObject extends DesignObjectBase {
  type: "image";
  src: string;
  fit: "cover" | "contain";
  radius: number;
}

export type DesignObject =
  | DesignTextObject
  | DesignShapeObject
  | DesignImageObject;

export interface DesignDocument {
  version: 1;
  name: string;
  width: number;
  height: number;
  background: string;
  objects: DesignObject[];
}

export const DEFAULT_DESIGN_DOCUMENT: DesignDocument = {
  version: 1,
  name: "未命名设计",
  width: 1080,
  height: 1350,
  background: "#ffffff",
  objects: [],
};

const MAX_DOCUMENT_DIMENSION = 16_384;
const MAX_DOCUMENT_PIXELS = 40_000_000;
const MAX_OBJECTS = 10_000;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function validBaseObject(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 160 &&
    typeof value.name === "string" &&
    value.name.length <= 1_000 &&
    finiteNumber(value.x, -10_000_000, 10_000_000) &&
    finiteNumber(value.y, -10_000_000, 10_000_000) &&
    finiteNumber(value.width, 0.1, 10_000_000) &&
    finiteNumber(value.height, 0.1, 10_000_000) &&
    finiteNumber(value.rotation, -1_000_000, 1_000_000) &&
    finiteNumber(value.opacity, 0, 1) &&
    typeof value.visible === "boolean" &&
    typeof value.locked === "boolean"
  );
}

function validDesignObject(value: unknown): value is DesignObject {
  if (!isRecord(value) || !validBaseObject(value)) return false;
  if (value.type === "text") {
    return (
      typeof value.text === "string" &&
      value.text.length <= 1_000_000 &&
      finiteNumber(value.fontSize, 1, 100_000) &&
      finiteNumber(value.fontWeight, 1, 1_000) &&
      typeof value.color === "string" &&
      HEX_COLOR.test(value.color) &&
      (value.align === "left" ||
        value.align === "center" ||
        value.align === "right")
    );
  }
  if (value.type === "rect" || value.type === "ellipse") {
    return (
      typeof value.fill === "string" &&
      HEX_COLOR.test(value.fill) &&
      typeof value.stroke === "string" &&
      HEX_COLOR.test(value.stroke) &&
      finiteNumber(value.strokeWidth, 0, 100_000) &&
      finiteNumber(value.radius, 0, 10_000_000)
    );
  }
  if (value.type === "image") {
    return (
      typeof value.src === "string" &&
      value.src.length <= 32 * 1024 * 1024 &&
      !/^javascript:/i.test(value.src.trim()) &&
      (value.fit === "cover" || value.fit === "contain") &&
      finiteNumber(value.radius, 0, 10_000_000)
    );
  }
  return false;
}

function defaultDocument(): DesignDocument {
  return { ...DEFAULT_DESIGN_DOCUMENT, objects: [] };
}

export function nextDesignId(type: DesignObjectType): string {
  return `${type}-${crypto.randomUUID().slice(0, 8)}`;
}

export function parseDesignDocument(raw: string | null): DesignDocument {
  if (!raw) return defaultDocument();
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !Array.isArray(value.objects) ||
      value.objects.length > MAX_OBJECTS ||
      typeof value.name !== "string" ||
      value.name.length > 1_000 ||
      !Number.isInteger(value.width) ||
      !Number.isInteger(value.height) ||
      !finiteNumber(value.width, 1, MAX_DOCUMENT_DIMENSION) ||
      !finiteNumber(value.height, 1, MAX_DOCUMENT_DIMENSION) ||
      value.width * value.height > MAX_DOCUMENT_PIXELS ||
      typeof value.background !== "string" ||
      !HEX_COLOR.test(value.background)
    ) {
      return defaultDocument();
    }
    const ids = new Set<string>();
    const objects = value.objects.filter((object): object is DesignObject => {
      if (!validDesignObject(object) || ids.has(object.id)) return false;
      ids.add(object.id);
      return true;
    });
    return {
      version: 1,
      name: value.name,
      width: value.width,
      height: value.height,
      background: value.background,
      objects,
    };
  } catch {
    return defaultDocument();
  }
}
