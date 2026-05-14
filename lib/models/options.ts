import type { AspectRatio, Resolution } from "@/lib/models/types";

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
  "High",
] as const satisfies readonly Resolution[];
