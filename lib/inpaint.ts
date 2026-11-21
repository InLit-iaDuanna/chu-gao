import sharp from "sharp";

import type { ImageSize, InternalRequest } from "@/lib/models/types";
import type { GeneratedImageData } from "@/lib/providers/types";

/**
 * 局部重绘（遮罩编辑）。
 *
 * 现有生图渠道收到 OpenAI 风格的 `mask` 字段后并不按遮罩作画（2026-11 实测：
 * ldai / xixiapi 的 Image 2 / 2.5 / 2.6 都会忽略遮罩并重画整张图）。因此这里
 * 走与协议无关的做法：
 *   1. 在原图上用洋红色半透明覆盖 + 描边标出涂抹区，连同说明一起发给模型；
 *   2. 拿回结果后对齐到原图，只取涂抹区（羽化边缘、按周边色差校色）贴回原图。
 * 这样涂抹区以外的像素与原图逐像素一致，任何支持参考图的模型都能用。
 */

export class InpaintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InpaintError";
  }
}

const MARK = { r: 255, g: 0, b: 200 };
const MARK_TINT_ALPHA = 64;
const MAX_COLOR_SHIFT = 48;
const SNAP_ASPECTS = [1, 3 / 2, 2 / 3];

export interface InpaintLayout {
  width: number;
  height: number;
  padLeft: number;
  padTop: number;
  paddedWidth: number;
  paddedHeight: number;
}

export interface PreparedInpaint {
  /** 发给模型的标注图（PNG）。 */
  marked: Buffer;
  /** 单通道原始遮罩，255 = 重绘区，尺寸与原图一致。 */
  editMask: Buffer;
  layout: InpaintLayout;
}

function parseSize(size: ImageSize | string | undefined): number | null {
  const match = /^(\d+)x(\d+)$/.exec(size ?? "");
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

/** 模型出图的宽高比：显式尺寸直接用，auto 时就近吸附到 1:1 / 3:2 / 2:3。 */
export function inpaintTargetAspect(
  size: ImageSize | string | undefined,
  width: number,
  height: number,
): number {
  const explicit = parseSize(size);
  if (explicit) return explicit;
  const source = width / height;
  return SNAP_ASPECTS.reduce((best, aspect) =>
    Math.abs(Math.log(aspect / source)) < Math.abs(Math.log(best / source))
      ? aspect
      : best,
  );
}

/** 原图按目标宽高比居中补边后的布局（只补不裁，结果再按同一布局裁回）。 */
export function inpaintLayout(
  width: number,
  height: number,
  aspect: number,
): InpaintLayout {
  let paddedWidth = width;
  let paddedHeight = height;
  if (width / height < aspect) paddedWidth = Math.round(height * aspect);
  else paddedHeight = Math.round(width / aspect);
  // 宽高比差不到 1% 时不补边，避免出现 1~2px 的无意义边条。
  if (Math.abs(paddedWidth - width) / width < 0.01) paddedWidth = width;
  if (Math.abs(paddedHeight - height) / height < 0.01) paddedHeight = height;
  return {
    width,
    height,
    padLeft: Math.floor((paddedWidth - width) / 2),
    padTop: Math.floor((paddedHeight - height) / 2),
    paddedWidth,
    paddedHeight,
  };
}

function radiusFor(width: number, height: number, ratio: number, min: number) {
  return Math.max(min, Math.round(Math.min(width, height) * ratio));
}

/** 单通道遮罩向外扩张 radius 像素（模糊后低阈值二值化）。 */
async function dilate(
  mask: Buffer,
  width: number,
  height: number,
  radius: number,
): Promise<Buffer> {
  const blurred = await sharp(mask, { raw: { width, height, channels: 1 } })
    .blur(Math.max(0.3, radius / 2))
    .extractChannel(0)
    .raw()
    .toBuffer();
  const out = Buffer.alloc(width * height);
  for (let i = 0; i < out.length; i += 1) out[i] = blurred[i] > 6 ? 255 : 0;
  return out;
}

async function blurMask(
  mask: Buffer,
  width: number,
  height: number,
  sigma: number,
): Promise<Buffer> {
  return sharp(mask, { raw: { width, height, channels: 1 } })
    .blur(Math.max(0.3, sigma))
    .extractChannel(0)
    .raw()
    .toBuffer();
}

/**
 * 读取用户遮罩：亮处（白色笔刷）为重绘区。带透明通道时，不透明的笔触同样算重绘区。
 */
export async function readEditMask(
  mask: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const { data, info } = await sharp(mask)
    .ensureAlpha()
    .resize(width, height, { fit: "fill", kernel: "nearest" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(width * height);
  let painted = 0;
  for (let i = 0, p = 0; i < out.length; i += 1, p += info.channels) {
    const luminance =
      (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    const alpha = data[p + 3];
    if (luminance >= 128 && alpha >= 128) {
      out[i] = 255;
      painted += 1;
    }
  }
  if (painted === 0) throw new InpaintError("没有涂抹任何区域");
  if (painted === out.length) throw new InpaintError("涂抹区域覆盖了整张图");
  return out;
}

export async function prepareInpaint({
  source,
  mask,
  size,
}: {
  source: Buffer;
  mask: Buffer;
  size?: ImageSize | string;
}): Promise<PreparedInpaint> {
  const base = sharp(source).rotate();
  const { data: rgb, info } = await base
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const editMask = await readEditMask(mask, width, height);
  const outline = radiusFor(width, height, 0.004, 3);
  const ring = await dilate(editMask, width, height, outline);

  const marked = Buffer.alloc(width * height * 3);
  const tint = MARK_TINT_ALPHA / 255;
  for (let i = 0, p = 0; i < editMask.length; i += 1, p += 3) {
    if (editMask[i]) {
      marked[p] = Math.round(rgb[p] * (1 - tint) + MARK.r * tint);
      marked[p + 1] = Math.round(rgb[p + 1] * (1 - tint) + MARK.g * tint);
      marked[p + 2] = Math.round(rgb[p + 2] * (1 - tint) + MARK.b * tint);
    } else if (ring[i]) {
      marked[p] = MARK.r;
      marked[p + 1] = MARK.g;
      marked[p + 2] = MARK.b;
    } else {
      marked[p] = rgb[p];
      marked[p + 1] = rgb[p + 1];
      marked[p + 2] = rgb[p + 2];
    }
  }

  const layout = inpaintLayout(
    width,
    height,
    inpaintTargetAspect(size, width, height),
  );
  let image = sharp(marked, { raw: { width, height, channels: 3 } });
  if (layout.paddedWidth !== width || layout.paddedHeight !== height) {
    image = image.extend({
      left: layout.padLeft,
      right: layout.paddedWidth - width - layout.padLeft,
      top: layout.padTop,
      bottom: layout.paddedHeight - height - layout.padTop,
      extendWith: "copy",
    });
  }
  return {
    marked: await image.png().toBuffer(),
    editMask,
    layout,
  };
}

/** 把模型输出对齐回原图，仅替换涂抹区（羽化 + 校色），其余像素保持原样。 */
export async function compositeInpaint({
  source,
  output,
  editMask,
  layout,
}: {
  source: Buffer;
  output: Buffer;
  editMask: Buffer;
  layout: InpaintLayout;
}): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { width, height } = layout;
  const src = await sharp(source)
    .rotate()
    .removeAlpha()
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();
  const out = await sharp(output)
    .removeAlpha()
    .resize(layout.paddedWidth, layout.paddedHeight, {
      fit: "fill",
      kernel: "lanczos3",
    })
    .extract({ left: layout.padLeft, top: layout.padTop, width, height })
    .raw()
    .toBuffer();

  const feather = radiusFor(width, height, 0.006, 3);
  const grown = await dilate(editMask, width, height, feather);
  const soft = await blurMask(grown, width, height, feather / 2);
  // 羽化不能侵蚀涂抹区本身：涂抹区内强制完全替换。
  for (let i = 0; i < soft.length; i += 1) if (editMask[i]) soft[i] = 255;

  // 校色：取紧贴羽化带外侧的一圈，比较原图与输出的平均色差。
  const outer = await dilate(grown, width, height, feather * 3);
  const shift = [0, 0, 0];
  let samples = 0;
  for (let i = 0, p = 0; i < soft.length; i += 1, p += 3) {
    if (outer[i] && !soft[i]) {
      shift[0] += src[p] - out[p];
      shift[1] += src[p + 1] - out[p + 1];
      shift[2] += src[p + 2] - out[p + 2];
      samples += 1;
    }
  }
  const offset = shift.map((sum) =>
    samples
      ? Math.max(-MAX_COLOR_SHIFT, Math.min(MAX_COLOR_SHIFT, sum / samples))
      : 0,
  );

  const result = Buffer.from(src);
  for (let i = 0, p = 0; i < soft.length; i += 1, p += 3) {
    const weight = soft[i] / 255;
    if (weight === 0) continue;
    for (let c = 0; c < 3; c += 1) {
      const corrected = Math.max(0, Math.min(255, out[p + c] + offset[c]));
      result[p + c] = Math.round(src[p + c] * (1 - weight) + corrected * weight);
    }
  }
  return {
    buffer: await sharp(result, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer(),
    width,
    height,
  };
}

export function inpaintPrompt(prompt: string, extraReferences: number): string {
  const refs =
    extraReferences > 0
      ? ` The other ${extraReferences === 1 ? "image is a reference" : "images are references"} for what to place there; the FIRST image is the one to edit.`
      : "";
  return [
    "LOCAL EDIT (inpainting). In the first image, a magenta outline with a light magenta tint marks the ONLY region to change." +
      refs,
    "Inside that region, apply this request:",
    prompt.trim(),
    "Rules: keep the exact same framing, camera angle, scale and canvas; leave everything outside the marked region untouched; blend lighting, perspective and texture naturally with the surroundings; the final image must contain no magenta outline or tint.",
  ].join("\n");
}

export interface InpaintJob {
  request: InternalRequest;
  source: Buffer;
  prepared: PreparedInpaint;
}

/**
 * 在已加载参考图字节的请求上准备局部重绘：原图换成标注图并排到第一位，提示词加上说明。
 */
export async function buildInpaintJob(
  request: InternalRequest,
  mask: Buffer,
): Promise<InpaintJob> {
  const spec = request.inpaint;
  if (!spec) throw new InpaintError("缺少局部重绘参数");
  const references = request.referenceImages ?? [];
  const baseIndex = references.findIndex((image) => image.key === spec.baseKey);
  const base = baseIndex >= 0 ? references[baseIndex] : undefined;
  if (!base?.b64) throw new InpaintError("局部重绘的原图已不可用");
  const source = Buffer.from(base.b64, "base64");
  const prepared = await prepareInpaint({ source, mask, size: request.size });
  const others = references.filter((_, index) => index !== baseIndex);
  return {
    source,
    prepared,
    request: {
      ...request,
      prompt: inpaintPrompt(request.prompt, others.length),
      referenceImages: [
        {
          key: base.key,
          mimeType: "image/png",
          b64: prepared.marked.toString("base64"),
        },
        ...others,
      ],
    },
  };
}

export async function finishInpaintImage(
  job: InpaintJob,
  output: Buffer,
): Promise<GeneratedImageData> {
  const merged = await compositeInpaint({
    source: job.source,
    output,
    editMask: job.prepared.editMask,
    layout: job.prepared.layout,
  });
  return {
    b64: merged.buffer.toString("base64"),
    width: merged.width,
    height: merged.height,
    mimeType: "image/png",
  };
}
