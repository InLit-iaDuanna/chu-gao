import { imageSizeOptionsForFormat } from "@/lib/models/options";
import type { ModelInfo } from "./types";

export function resolveGenerationOptions(
  model: ModelInfo | null,
  options: { size?: string; outputFormat?: string },
) {
  if (!model) return { ...options, sizes: [] as string[] };

  const formats = model.capabilities.outputFormats;
  const outputFormat =
    formats.find((format) => format === options.outputFormat) ??
    formats.find((format) => format === model.defaults.outputFormat) ??
    formats[0];
  const sizes = imageSizeOptionsForFormat(model, outputFormat);
  const size =
    sizes.find((size) => size === options.size) ??
    sizes.find((size) => size === model.defaults.size) ??
    sizes[0];

  return { outputFormat, size, sizes };
}

export function estimatedCreditLabel(
  credits: number | undefined,
  model: ModelInfo | null,
  size?: string,
): string {
  if (size === "auto") return "按实际尺寸计费";
  if (credits === undefined) return "";
  const multiplier = model?.fallbackCostMultiplier ?? 1;
  const maximum = Number.isFinite(multiplier)
    ? Math.ceil(credits * Math.max(1, multiplier))
    : credits;
  return maximum > credits
    ? `${credits} 至 ${maximum} 积分`
    : `${credits} 积分`;
}
