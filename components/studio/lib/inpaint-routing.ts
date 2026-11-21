import { sortImageModels } from "./image-routing";
import type { ModelInfo } from "./types";

/** 能做局部重绘的模型：支持参考图且能出 PNG。当前选中的模型优先。 */
export function inpaintModelCandidates(
  models: ModelInfo[],
  preferredId?: string | null,
): ModelInfo[] {
  const eligible = sortImageModels(models).filter(
    (model) =>
      model.available &&
      model.capabilities.supportsReferenceImage &&
      model.capabilities.outputFormats.includes("png"),
  );
  const preferred = eligible.find((model) => model.id === preferredId);
  return preferred
    ? [preferred, ...eligible.filter((model) => model.id !== preferred.id)]
    : eligible;
}

function parseSize(size: string): { width: number; height: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(size);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

/**
 * 选出图尺寸：宽高比尽量贴近原图，且分辨率不超过原图需要的档位（避免多扣点）。
 * 服务端会把原图按这个比例补边后再请求，结果裁回原尺寸。
 */
export function inpaintSizeFor(
  model: ModelInfo,
  width: number,
  height: number,
): string {
  const gifOnly = new Set(model.capabilities.gifSizes ?? []);
  const sizes: Array<{ size: string; parsed: { width: number; height: number } }> =
    [];
  for (const size of model.capabilities.sizes) {
    if (size === "auto" || gifOnly.has(size)) continue;
    const parsed = parseSize(size);
    if (parsed) sizes.push({ size, parsed });
  }
  if (!sizes.length) return model.defaults.size;
  const longSide = Math.max(width, height);
  const neededLong = longSide <= 1600 ? 1536 : longSide <= 2048 ? 2048 : 3840;
  const affordable = sizes.filter(
    (item) => Math.max(item.parsed.width, item.parsed.height) <= neededLong,
  );
  const pool = affordable.length ? affordable : sizes;
  const aspect = width / height;
  const score = (item: (typeof pool)[number]) =>
    Math.abs(Math.log(item.parsed.width / item.parsed.height / aspect));
  return pool.reduce((best, item) => {
    const delta = score(item) - score(best);
    if (delta < -1e-6) return item;
    if (
      Math.abs(delta) <= 1e-6 &&
      item.parsed.width * item.parsed.height >
        best.parsed.width * best.parsed.height
    )
      return item;
    return best;
  }).size;
}
