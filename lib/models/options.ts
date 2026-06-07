import type { AspectRatio, Image2Mode, Resolution } from "@/lib/models/types";

export const IMAGE_ASPECT_RATIO_OPTIONS = [
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "5:4",
  "4:5",
  "16:9",
  "9:16",
  "2:1",
  "1:2",
  "21:9",
  "9:21",
] as const satisfies readonly AspectRatio[];

export const IMAGE_RESOLUTION_OPTIONS = [
  "1K",
  "2K",
  "4K",
] as const satisfies readonly Resolution[];

export const IMAGE2_DEFAULT_RESOLUTION_ASPECT_RATIOS = {
  "1K": ["1:1", "3:2", "2:3"],
  "2K": [...IMAGE_ASPECT_RATIO_OPTIONS],
  "4K": ["16:9", "9:16", "2:1", "1:2", "21:9", "9:21"],
} as const satisfies Record<Resolution, readonly AspectRatio[]>;

export const IMAGE2_MODE_OPTIONS = [
  "standard",
  "high",
] as const satisfies readonly Image2Mode[];

export const IMAGE2_MODE_LABEL: Record<Image2Mode, string> = {
  standard: "标准版",
  high: "高推理",
};
