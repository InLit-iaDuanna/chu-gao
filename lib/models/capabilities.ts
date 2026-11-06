import type { ImageSize, ModelDefinition } from "@/lib/models/types";

// 选出一个可用的出图尺寸：优先 preferred，其次模型默认值，最后能力列表首项。
export function firstSupportedSize(
  model: ModelDefinition,
  preferred?: ImageSize | null,
): ImageSize {
  const sizes = model.capabilities.sizes;

  if (preferred && sizes.includes(preferred)) {
    return preferred;
  }

  if (sizes.includes(model.defaults.size)) {
    return model.defaults.size;
  }

  return sizes[0] ?? "auto";
}

export function isSizeSupported(
  model: ModelDefinition,
  size: ImageSize,
): boolean {
  return model.capabilities.sizes.includes(size);
}
