import sharp from "sharp";

import { fail } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { getClientIp } from "@/lib/network";

export const runtime = "nodejs";

const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const MAX_DIMENSION = 16_384;
const MAX_PIXELS = 40_000_000;
const MAX_SVG_ELEMENTS = 10_000;
const NUMBER_PATTERN = "-?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:e[+-]?[0-9]+)?";
const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "rect",
  "ellipse",
  "clipPath",
  "text",
  "tspan",
  "image",
]);
const ALLOWED_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  svg: new Set(["xmlns", "width", "height", "viewBox"]),
  g: new Set(["transform", "opacity"]),
  rect: new Set([
    "x",
    "y",
    "width",
    "height",
    "rx",
    "fill",
    "stroke",
    "stroke-width",
    "transform",
    "opacity",
  ]),
  ellipse: new Set([
    "cx",
    "cy",
    "rx",
    "ry",
    "fill",
    "stroke",
    "stroke-width",
    "transform",
    "opacity",
  ]),
  clipPath: new Set(["id"]),
  text: new Set([
    "x",
    "y",
    "fill",
    "font-family",
    "font-size",
    "font-weight",
    "text-anchor",
    "clip-path",
  ]),
  tspan: new Set(["x", "dy"]),
  image: new Set([
    "href",
    "x",
    "y",
    "width",
    "height",
    "preserveAspectRatio",
    "clip-path",
  ]),
};
const CHILD_ELEMENTS: Record<string, ReadonlySet<string>> = {
  svg: new Set(["rect", "ellipse", "g"]),
  g: new Set(["clipPath", "text", "image"]),
  clipPath: new Set(["rect"]),
  text: new Set(["tspan"]),
  rect: new Set(),
  ellipse: new Set(),
  tspan: new Set(),
  image: new Set(),
};

function safeFilename(value: string): string {
  return (
    value
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .trim()
      .slice(0, 80) || "design"
  );
}

function safeNumber(
  value: string,
  minimum = -10_000_000,
  maximum = 10_000_000,
): boolean {
  if (!new RegExp(`^${NUMBER_PATTERN}$`, "i").test(value)) return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum;
}

function safeTransform(value: string): boolean {
  const match = new RegExp(
    `^translate\\((${NUMBER_PATTERN}) (${NUMBER_PATTERN})\\) rotate\\((${NUMBER_PATTERN}) (${NUMBER_PATTERN}) (${NUMBER_PATTERN})\\)$`,
    "i",
  ).exec(value);
  return Boolean(match?.slice(1).every((part) => safeNumber(part ?? "")));
}

function safeAttribute(name: string, value: string): boolean {
  if (["x", "y", "cx", "cy", "dy"].includes(name)) {
    return safeNumber(value);
  }
  if (
    [
      "width",
      "height",
      "rx",
      "ry",
      "font-size",
      "font-weight",
      "stroke-width",
    ].includes(name)
  ) {
    return (name === "width" || name === "height") && value === "100%"
      ? true
      : safeNumber(value, 0);
  }
  if (name === "opacity") return safeNumber(value, 0, 1);
  if (name === "fill" || name === "stroke") {
    return value === "none" || /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value);
  }
  if (name === "transform") return safeTransform(value);
  if (name === "id") return /^[a-z][a-z0-9_-]{0,127}$/i.test(value);
  if (name === "clip-path") {
    return /^url\(#[a-z][a-z0-9_-]{0,127}\)$/i.test(value);
  }
  if (name === "href") {
    return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i.test(
      value,
    );
  }
  if (name === "font-family") return value === "Arial, sans-serif";
  if (name === "text-anchor") {
    return value === "start" || value === "middle" || value === "end";
  }
  if (name === "preserveAspectRatio") {
    return value === "xMidYMid slice" || value === "xMidYMid meet";
  }
  return name === "xmlns" || name === "viewBox";
}

interface SvgAnalysis {
  width: number;
  height: number;
}

function analyzeCanvasSvg(svg: string): SvgAnalysis | null {
  if (
    !svg.startsWith("<svg ") ||
    !svg.endsWith("</svg>") ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(svg) ||
    /<!|<\?|\b(?:style|class)\s*=/i.test(svg) ||
    /&(?!amp;|apos;|gt;|lt;|quot;)/.test(svg)
  ) {
    return null;
  }

  const tagPattern = /<([^<>]+)>/g;
  const attributePattern = /\s+([A-Za-z][A-Za-z0-9-]*)="([^"]*)"/g;
  const stack: string[] = [];
  let root: Record<string, string> | null = null;
  let elementCount = 0;
  let previousEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(svg))) {
    const text = svg.slice(previousEnd, match.index);
    const parent = stack.at(-1);
    if (text.trim() && parent !== "tspan") return null;
    previousEnd = tagPattern.lastIndex;

    const body = match[1] ?? "";
    if (body.startsWith("/")) {
      const closingName = body.slice(1);
      if (!ALLOWED_ELEMENTS.has(closingName) || stack.pop() !== closingName) {
        return null;
      }
      continue;
    }

    const selfClosing = body.endsWith("/");
    const content = selfClosing ? body.slice(0, -1) : body;
    const nameMatch = /^([A-Za-z][A-Za-z0-9]*)/.exec(content);
    const name = nameMatch?.[1];
    if (!name || !ALLOWED_ELEMENTS.has(name)) return null;
    elementCount += 1;
    if (elementCount > MAX_SVG_ELEMENTS) return null;

    const currentParent = stack.at(-1);
    if (!currentParent) {
      if (name !== "svg" || root) return null;
    } else if (!CHILD_ELEMENTS[currentParent]?.has(name)) {
      return null;
    }

    const attributes: Record<string, string> = {};
    const attributeSource = content.slice(name.length);
    let consumed = "";
    attributePattern.lastIndex = 0;
    let attribute: RegExpExecArray | null;
    while ((attribute = attributePattern.exec(attributeSource))) {
      const attributeName = attribute[1] ?? "";
      const value = attribute[2] ?? "";
      if (
        attributes[attributeName] !== undefined ||
        !ALLOWED_ATTRIBUTES[name]?.has(attributeName) ||
        !safeAttribute(attributeName, value)
      ) {
        return null;
      }
      attributes[attributeName] = value;
      consumed += attribute[0];
    }
    if (consumed !== attributeSource) return null;
    if (name === "svg") root = attributes;

    const mustBeSelfClosing =
      name === "rect" || name === "ellipse" || name === "image";
    if (
      (mustBeSelfClosing && !selfClosing) ||
      (name === "svg" && selfClosing)
    ) {
      return null;
    }
    if (!selfClosing) stack.push(name);
  }

  if (previousEnd !== svg.length || stack.length !== 0 || !root) return null;
  if (root.xmlns !== "http://www.w3.org/2000/svg") return null;
  const width = Number(root.width);
  const height = Number(root.height);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    width * height > MAX_PIXELS ||
    root.viewBox !== `0 0 ${root.width} ${root.height}`
  ) {
    return null;
  }
  return { width, height };
}

export async function POST(request: Request) {
  const rateLimitFailure = await userActionRateLimitResponse(
    "ip:" + (getClientIp(request.headers) ?? "unknown"),
    "canvas-export",
    process.env.RATE_LIMIT_CANVAS_EXPORT_PER_MIN,
    30,
  );
  if (rateLimitFailure) return rateLimitFailure;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_EXPORT_BYTES) {
    return fail("PAYLOAD_TOO_LARGE", "设计文件过大", { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return fail("VALIDATION_ERROR", "设计文件无效", { status: 400 });
  }
  const svg = formData.get("svg");
  const format = formData.get("format");
  const name = formData.get("name");
  const dimensions =
    typeof svg === "string" && Buffer.byteLength(svg) <= MAX_EXPORT_BYTES
      ? analyzeCanvasSvg(svg)
      : null;
  if (
    typeof svg !== "string" ||
    (format !== "svg" && format !== "png") ||
    typeof name !== "string" ||
    !dimensions
  ) {
    return fail("VALIDATION_ERROR", "设计文件无效", { status: 400 });
  }

  const filename = safeFilename(name);
  const headers = {
    "Cache-Control": "private, no-store",
    "Content-Disposition":
      "attachment; filename*=UTF-8''" +
      encodeURIComponent(filename) +
      "." +
      format,
  };

  if (format === "svg") {
    return new Response(svg, {
      headers: { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" },
    });
  }

  try {
    const png = await sharp(Buffer.from(svg), {
      density: 72,
      limitInputPixels: MAX_PIXELS,
    })
      .resize(dimensions.width, dimensions.height)
      .png()
      .toBuffer();
    return new Response(new Uint8Array(png), {
      headers: { ...headers, "Content-Type": "image/png" },
    });
  } catch {
    return fail("EXPORT_FAILED", "PNG 导出失败", { status: 500 });
  }
}
